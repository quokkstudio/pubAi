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
type ChatTab = 'chat' | 'codex';

function nowLabel(): string {
  return new Date().toLocaleTimeString('ko-KR', { hour12: false });
}

export default function WorkspaceWindow({ projectKey }: WorkspaceWindowProps) {
  const api = window.devManager;
  const [projectDetail, setProjectDetail] = useState<ProjectDetail | null>(null);
  const [leftWidth, setLeftWidth] = useState(300);
  const [rightWidth, setRightWidth] = useState(460);
  const [showExplorer, setShowExplorer] = useState(true);
  const [showCodex, setShowCodex] = useState(true);
  const [dragMode, setDragMode] = useState<DragMode>(null);

  const [entriesMap, setEntriesMap] = useState<Record<string, WorkspaceEntry[]>>({});
  const [expandedFolders, setExpandedFolders] = useState<string[]>(['']);
  const [openTabs, setOpenTabs] = useState<string[]>([]);
  const [activeFilePath, setActiveFilePath] = useState('');
  const [fileBuffers, setFileBuffers] = useState<Record<string, string>>({});
  const [dirtyFiles, setDirtyFiles] = useState<Record<string, boolean>>({});
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
  const [chatTab, setChatTab] = useState<ChatTab>('codex');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [model, setModel] = useState('gpt-5-codex');
  const [reasoningLevel, setReasoningLevel] = useState<'low' | 'medium' | 'high'>('high');
  const [sandboxMode, setSandboxMode] = useState<CodexSandboxMode>('workspace-write');
  const [attachmentPaths, setAttachmentPaths] = useState<string[]>([]);
  const [lastUsage, setLastUsage] = useState<CodexRunResult['usage'] | null>(null);

  const activeFileContent = activeFilePath ? fileBuffers[activeFilePath] ?? '' : '';
  const isDirty = useMemo(() => Boolean(activeFilePath && dirtyFiles[activeFilePath]), [activeFilePath, dirtyFiles]);
  const rootEntries = entriesMap[''] ?? [];

  function pushChat(role: ChatMessage['role'], content: string): void {
    setCodexMessages((prev) => [...prev, { role, content, timestamp: nowLabel() }].slice(-80));
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
    if (fileBuffers[relativePath] !== undefined) {
      if (!openTabs.includes(relativePath)) {
        setOpenTabs((prev) => [...prev, relativePath]);
      }
      setActiveFilePath(relativePath);
      return;
    }

    setBusy(true);
    setErrorMessage('');
    try {
      const result = await api.workspaceReadFile({ projectKey, relativePath });
      setFileBuffers((prev) => ({ ...prev, [result.relativePath]: result.content }));
      setOpenTabs((prev) => (prev.includes(result.relativePath) ? prev : [...prev, result.relativePath]));
      setActiveFilePath(result.relativePath);
    } catch (error) {
      const message = error instanceof Error ? error.message : '파일 열기 실패';
      setErrorMessage(message);
    } finally {
      setBusy(false);
    }
  }

  async function saveFile(): Promise<void> {
    if (!api || !activeFilePath) {
      return;
    }
    setBusy(true);
    setErrorMessage('');
    try {
      const result = await api.workspaceWriteFile({
        projectKey,
        relativePath: activeFilePath,
        content: fileBuffers[activeFilePath] ?? ''
      });
      setSavedAt(result.savedAt);
      setDirtyFiles((prev) => ({ ...prev, [result.relativePath]: false }));
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

  function closeTab(relativePath: string): void {
    const nextTabs = openTabs.filter((path) => path !== relativePath);
    setOpenTabs(nextTabs);
    if (activeFilePath === relativePath) {
      setActiveFilePath(nextTabs[nextTabs.length - 1] ?? '');
    }
  }

  function renderEntries(entries: WorkspaceEntry[], depth: number): JSX.Element[] {
    return entries.flatMap((entry) => {
      const row = (
        <div key={entry.relativePath} className="tree-row" style={{ paddingLeft: `${depth * 14 + 8}px` }}>
          {entry.isDirectory ? (
            <button className="tree-btn" onClick={() => toggleFolder(entry.relativePath)}>
              {expandedFolders.includes(entry.relativePath) ? '▾' : '▸'} {entry.name}
            </button>
          ) : (
            <button
              className={`tree-file-btn ${activeFilePath === entry.relativePath ? 'active' : ''}`}
              onClick={() => void openFile(entry.relativePath)}
            >
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
        const reservedRight = showCodex ? rightWidth + 6 : 0;
        const next = Math.min(Math.max(event.clientX - 50, 220), viewportWidth - reservedRight - 460);
        setLeftWidth(next);
      } else {
        const rightEdge = viewportWidth - event.clientX;
        const reservedLeft = showExplorer ? leftWidth + 58 + 6 : 58;
        const next = Math.min(Math.max(rightEdge, 360), viewportWidth - reservedLeft - 420);
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
  }, [dragMode, leftWidth, rightWidth, showCodex, showExplorer]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        void saveFile();
      }

      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'w' && activeFilePath) {
        event.preventDefault();
        closeTab(activeFilePath);
      }
    }

    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  });

  return (
    <div className="ide-shell">
      <aside className="ide-activitybar">
        <button
          className={`activity-btn ${showExplorer ? 'active' : ''}`}
          onClick={() => setShowExplorer((prev) => !prev)}
          title="Explorer"
        >
          📁
        </button>
        <button
          className={`activity-btn ${showCodex ? 'active' : ''}`}
          onClick={() => setShowCodex((prev) => !prev)}
          title="Codex"
        >
          ✦
        </button>
      </aside>

      {showExplorer && (
        <aside className="ide-explorer" style={{ width: `${leftWidth}px` }}>
          <div className="ide-panel-header">
            <span>EXPLORER</span>
            <button className="ghost-btn" onClick={() => void loadProject()}>
              ↻
            </button>
          </div>
          <div className="ide-project-label">{projectDetail?.summary.name ?? projectKey}</div>
          <div className="tree-scroll">{renderEntries(rootEntries, 0)}</div>
        </aside>
      )}

      {showExplorer && (
        <div
          className="workspace-splitter"
          role="separator"
          aria-label="left panel resize"
          onMouseDown={() => setDragMode('left')}
        />
      )}

      <section className="ide-main">
        <div className="ide-tabbar">
          {openTabs.length === 0 && <div className="tab-empty">열린 파일 없음</div>}
          {openTabs.map((tabPath) => (
            <button
              key={tabPath}
              className={`ide-tab ${activeFilePath === tabPath ? 'active' : ''}`}
              onClick={() => setActiveFilePath(tabPath)}
            >
              <span>{tabPath.split('/').pop()}</span>
              {dirtyFiles[tabPath] && <em>●</em>}
              <i
                onClick={(event) => {
                  event.stopPropagation();
                  closeTab(tabPath);
                }}
              >
                ×
              </i>
            </button>
          ))}
        </div>

        {errorMessage && <div className="alert-error workspace-error">{errorMessage}</div>}

        <textarea
          className="workspace-editor-input ide-editor-input"
          value={activeFileContent}
          onChange={(event) => {
            if (!activeFilePath) {
              return;
            }
            const value = event.target.value;
            setFileBuffers((prev) => ({ ...prev, [activeFilePath]: value }));
            setDirtyFiles((prev) => ({ ...prev, [activeFilePath]: true }));
          }}
          placeholder="좌측에서 파일을 선택하면 편집할 수 있습니다."
          spellCheck={false}
          disabled={!activeFilePath}
        />

        <div className="ide-statusbar">
          <span>{activeFilePath || 'No file selected'}</span>
          <span>{savedAt ? `저장: ${savedAt}` : ''}</span>
          <button className="status-save-btn" onClick={() => void saveFile()} disabled={busy || !isDirty}>
            저장
          </button>
        </div>
      </section>

      {showCodex && (
        <div
          className="workspace-splitter"
          role="separator"
          aria-label="right panel resize"
          onMouseDown={() => setDragMode('right')}
        />
      )}

      {showCodex && (
        <aside className="ide-codex" style={{ width: `${rightWidth}px` }}>
          <div className="codex-top-tabs">
            <button className={chatTab === 'chat' ? 'active' : ''} onClick={() => setChatTab('chat')}>
              CHAT
            </button>
            <button className={chatTab === 'codex' ? 'active' : ''} onClick={() => setChatTab('codex')}>
              CODEX
            </button>
            <div className="codex-toolbar">
              <button onClick={() => setSettingsOpen((prev) => !prev)}>⚙</button>
            </div>
          </div>

          {settingsOpen && (
            <div className="codex-settings codex-settings-inline">
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
            </div>
          )}

          <div className="codex-chat-log codex-chat-log-vscode">
            {codexMessages.map((message, index) => (
              <div key={`${message.timestamp}-${index}`} className={`chat-msg chat-${message.role}`}>
                <div className="chat-meta">
                  {message.role} · {message.timestamp}
                </div>
                <pre>{message.content}</pre>
              </div>
            ))}
          </div>

          <div className="codex-input-row codex-input-vscode">
            <label className="attach-btn">
              +
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
              placeholder="Ask Codex..."
              spellCheck={false}
            />
            <button onClick={() => void runCodexPrompt()} disabled={busy || !prompt.trim()}>
              ↑
            </button>
          </div>

          <div className="codex-footer-row">
            <span>{model}</span>
            <span>{reasoningLevel}</span>
            <span>{sandboxMode}</span>
            <span>
              사용량 {lastUsage?.inputChars ?? 0}/{lastUsage?.outputChars ?? 0}
            </span>
          </div>

          {attachmentPaths.length > 0 && (
            <div className="attachment-list">{attachmentPaths.map((pathItem) => `• ${pathItem}`).join('\n')}</div>
          )}
        </aside>
      )}
    </div>
  );
}
