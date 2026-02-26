import { useEffect, useMemo, useState } from 'react';
import type {
  CodexRunResult,
  CodexSandboxMode,
  ProjectDetail,
  WorkspaceEntry
} from '../types';

interface WorkspaceWindowProps {
  projectKey: string;
}

interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: string;
}

type DragMode = 'left' | 'right' | null;

function nowLabel(): string {
  return new Date().toLocaleTimeString('ko-KR', { hour12: false });
}

export default function WorkspaceWindow({ projectKey }: WorkspaceWindowProps) {
  const api = window.devManager;
  const [projectDetail, setProjectDetail] = useState<ProjectDetail | null>(null);
  const [leftWidth, setLeftWidth] = useState(280);
  const [rightWidth, setRightWidth] = useState(420);
  const [dragMode, setDragMode] = useState<DragMode>(null);

  const [entriesMap, setEntriesMap] = useState<Record<string, WorkspaceEntry[]>>({});
  const [expandedFolders, setExpandedFolders] = useState<string[]>(['']);
  const [openedFilePath, setOpenedFilePath] = useState('');
  const [openedFileContent, setOpenedFileContent] = useState('');
  const [savedAt, setSavedAt] = useState('');
  const [busy, setBusy] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  const [codexMessages, setCodexMessages] = useState<ChatMessage[]>([
    {
      role: 'system',
      content: 'Codex 패널 준비 완료. 프로젝트 파일을 참고해 질문할 수 있습니다.',
      timestamp: nowLabel()
    }
  ]);
  const [prompt, setPrompt] = useState('');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [model, setModel] = useState('gpt-5-codex');
  const [reasoningLevel, setReasoningLevel] = useState<'low' | 'medium' | 'high'>('high');
  const [sandboxMode, setSandboxMode] = useState<CodexSandboxMode>('workspace-write');
  const [attachmentPaths, setAttachmentPaths] = useState<string[]>([]);
  const [lastUsage, setLastUsage] = useState<CodexRunResult['usage'] | null>(null);

  const isDirty = useMemo(() => Boolean(openedFilePath), [openedFilePath]);
  const rootEntries = entriesMap[''] ?? [];

  function pushChat(role: ChatMessage['role'], content: string): void {
    setCodexMessages((prev) => [{ role, content, timestamp: nowLabel() }, ...prev].slice(0, 60));
  }

  async function loadEntries(relativePath = ''): Promise<void> {
    if (!api) {
      return;
    }
    const entries = await api.workspaceListEntries({ projectKey, relativePath });
    setEntriesMap((prev) => ({ ...prev, [relativePath]: entries }));
  }

  async function loadProject(): Promise<void> {
    if (!api) {
      return;
    }
    const detail = await api.getProjectDetail(projectKey);
    setProjectDetail(detail);
    await loadEntries('');
  }

  async function openFile(relativePath: string): Promise<void> {
    if (!api) {
      return;
    }
    setBusy(true);
    setErrorMessage('');
    try {
      const result = await api.workspaceReadFile({ projectKey, relativePath });
      setOpenedFilePath(result.relativePath);
      setOpenedFileContent(result.content);
    } catch (error) {
      const message = error instanceof Error ? error.message : '파일 열기 실패';
      setErrorMessage(message);
    } finally {
      setBusy(false);
    }
  }

  async function saveFile(): Promise<void> {
    if (!api || !openedFilePath) {
      return;
    }
    setBusy(true);
    setErrorMessage('');
    try {
      const result = await api.workspaceWriteFile({
        projectKey,
        relativePath: openedFilePath,
        content: openedFileContent
      });
      setSavedAt(result.savedAt);
      pushChat('system', `파일 저장 완료: ${result.relativePath}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : '파일 저장 실패';
      setErrorMessage(message);
    } finally {
      setBusy(false);
    }
  }

  async function runCodexPrompt(): Promise<void> {
    if (!api || !prompt.trim()) {
      return;
    }

    const userPrompt = prompt.trim();
    setPrompt('');
    pushChat('user', userPrompt);

    setBusy(true);
    setErrorMessage('');
    try {
      const result = await api.runCodex({
        projectKey,
        prompt: userPrompt,
        model,
        reasoningLevel,
        sandboxMode,
        attachments: attachmentPaths
      });
      setLastUsage(result.usage);
      if (result.ok) {
        pushChat('assistant', result.output || '(빈 응답)');
      } else {
        pushChat('system', result.stderr || 'Codex 실행 실패');
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Codex 실행 실패';
      setErrorMessage(message);
      pushChat('system', message);
    } finally {
      setBusy(false);
    }
  }

  function toggleFolder(relativePath: string): void {
    const isExpanded = expandedFolders.includes(relativePath);
    if (isExpanded) {
      setExpandedFolders((prev) => prev.filter((path) => path !== relativePath));
      return;
    }

    setExpandedFolders((prev) => [...prev, relativePath]);
    if (!entriesMap[relativePath]) {
      void loadEntries(relativePath);
    }
  }

  function renderEntries(entries: WorkspaceEntry[], depth: number): JSX.Element[] {
    return entries.flatMap((entry) => {
      const row = (
        <div key={entry.relativePath} className="tree-row" style={{ paddingLeft: `${depth * 14 + 10}px` }}>
          {entry.isDirectory ? (
            <button className="tree-btn" onClick={() => toggleFolder(entry.relativePath)}>
              {expandedFolders.includes(entry.relativePath) ? '▾' : '▸'} {entry.name}
            </button>
          ) : (
            <button className="tree-file-btn" onClick={() => void openFile(entry.relativePath)}>
              {entry.name}
            </button>
          )}
        </div>
      );

      if (!entry.isDirectory || !expandedFolders.includes(entry.relativePath)) {
        return [row];
      }

      const children = entriesMap[entry.relativePath] ?? [];
      return [row, ...renderEntries(children, depth + 1)];
    });
  }

  useEffect(() => {
    void loadProject().catch((error) => {
      const message = error instanceof Error ? error.message : '워크스페이스 로드 실패';
      setErrorMessage(message);
    });
  }, [projectKey]);

  useEffect(() => {
    if (!dragMode) {
      return;
    }

    function onMove(event: MouseEvent): void {
      const viewportWidth = window.innerWidth;
      if (dragMode === 'left') {
        const next = Math.min(Math.max(event.clientX, 180), viewportWidth - rightWidth - 360);
        setLeftWidth(next);
      } else {
        const rightEdge = viewportWidth - event.clientX;
        const next = Math.min(Math.max(rightEdge, 320), viewportWidth - leftWidth - 320);
        setRightWidth(next);
      }
    }

    function onUp(): void {
      setDragMode(null);
    }

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [dragMode, leftWidth, rightWidth]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        void saveFile();
      }
    }

    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  });

  return (
    <div className="workspace-root">
      <header className="workspace-topbar">
        <div>
          <strong>{projectDetail?.summary.name ?? projectKey}</strong>
          <span className="workspace-meta"> {projectDetail?.summary.localPath ?? ''}</span>
        </div>
        <div className="workspace-actions">
          <button className="outline-btn" onClick={() => void loadProject()} disabled={busy}>
            새로고침
          </button>
          <button className="outline-btn" onClick={() => void saveFile()} disabled={busy || !isDirty}>
            저장
          </button>
        </div>
      </header>

      {errorMessage && <div className="alert-error workspace-error">{errorMessage}</div>}

      <div className="workspace-body">
        <aside className="workspace-left" style={{ width: `${leftWidth}px` }}>
          <div className="panel-title">Explorer</div>
          <div className="tree-scroll">{renderEntries(rootEntries, 0)}</div>
        </aside>

        <div
          className="workspace-splitter"
          role="separator"
          aria-label="left panel resize"
          onMouseDown={() => setDragMode('left')}
        />

        <section className="workspace-editor">
          <div className="editor-header">
            <strong>{openedFilePath || '파일을 선택하세요'}</strong>
            <span>{savedAt ? `저장: ${savedAt}` : ''}</span>
          </div>
          <textarea
            className="workspace-editor-input"
            value={openedFileContent}
            onChange={(event) => setOpenedFileContent(event.target.value)}
            placeholder="좌측에서 파일을 선택하면 편집할 수 있습니다."
            spellCheck={false}
            disabled={!openedFilePath}
          />
        </section>

        <div
          className="workspace-splitter"
          role="separator"
          aria-label="right panel resize"
          onMouseDown={() => setDragMode('right')}
        />

        <aside className="workspace-right" style={{ width: `${rightWidth}px` }}>
          <div className="panel-title codex-title-row">
            <span>CODEX</span>
            <button className="outline-btn" onClick={() => setSettingsOpen((prev) => !prev)}>
              설정
            </button>
          </div>

          {settingsOpen && (
            <div className="codex-settings">
              <label>
                모델
                <select value={model} onChange={(event) => setModel(event.target.value)}>
                  <option value="gpt-5-codex">GPT-5-Codex</option>
                  <option value="gpt-5">GPT-5</option>
                  <option value="o3">o3</option>
                </select>
              </label>
              <label>
                이성 수준
                <select
                  value={reasoningLevel}
                  onChange={(event) => setReasoningLevel(event.target.value as 'low' | 'medium' | 'high')}
                >
                  <option value="low">낮음</option>
                  <option value="medium">보통</option>
                  <option value="high">높음</option>
                </select>
              </label>
              <label>
                권한/샌드박스
                <select
                  value={sandboxMode}
                  onChange={(event) => setSandboxMode(event.target.value as CodexSandboxMode)}
                >
                  <option value="read-only">read-only</option>
                  <option value="workspace-write">workspace-write</option>
                  <option value="danger-full-access">danger-full-access</option>
                </select>
              </label>
              <div className="codex-usage">
                사용량: in {lastUsage?.inputChars ?? 0} / out {lastUsage?.outputChars ?? 0}
              </div>
            </div>
          )}

          <div className="codex-chat-log">
            {codexMessages.map((message, index) => (
              <div key={`${message.timestamp}-${index}`} className={`chat-msg chat-${message.role}`}>
                <div className="chat-meta">
                  {message.role} · {message.timestamp}
                </div>
                <pre>{message.content}</pre>
              </div>
            ))}
          </div>

          <div className="codex-input-row">
            <label className="attach-btn">
              첨부
              <input
                type="file"
                multiple
                onChange={(event) => {
                  const files = Array.from(event.target.files ?? []);
                  const paths = files
                    .map((file) => ((file as File & { path?: string }).path ? (file as File & { path?: string }).path! : file.name))
                    .filter(Boolean);
                  setAttachmentPaths(paths);
                }}
              />
            </label>
            <textarea
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              placeholder="프로젝트 코드 기준으로 요청을 입력하세요"
              spellCheck={false}
            />
            <button onClick={() => void runCodexPrompt()} disabled={busy || !prompt.trim()}>
              전송
            </button>
          </div>
          {attachmentPaths.length > 0 && (
            <div className="attachment-list">{attachmentPaths.map((pathItem) => `• ${pathItem}`).join('\n')}</div>
          )}
        </aside>
      </div>
    </div>
  );
}
