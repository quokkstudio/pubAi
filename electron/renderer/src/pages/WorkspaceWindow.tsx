import { useEffect, useMemo, useState } from 'react';
import type {
  CodexChatMessage,
  CodexChatSession,
  CodexChatStore,
  CodexState,
  CodexRunResult,
  CodexSandboxMode,
  ProjectDetail,
  WorkspaceEntry
} from '../types';

interface WorkspaceWindowProps {
  projectKey: string;
}

type DragMode = 'left' | 'right' | null;
type ChatTab = 'chat' | 'codex';

function nowLabel(): string {
  return new Date().toLocaleTimeString('ko-KR', { hour12: false });
}

function nowIso(): string {
  return new Date().toISOString();
}

function toLabelFromIso(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return nowLabel();
  }
  return date.toLocaleTimeString('ko-KR', { hour12: false });
}

function toPosixPath(input: string): string {
  return input.replace(/\\/g, '/');
}

function makeDefaultChatSession(): CodexChatSession {
  const timestamp = nowIso();
  return {
    id: `session-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    title: '새 대화',
    createdAt: timestamp,
    updatedAt: timestamp,
    messages: [
      {
        role: 'system',
        content: 'Codex 패널 준비 완료. 프로젝트 파일을 참고해 질문할 수 있습니다.',
        timestamp
      }
    ]
  };
}

function makeDefaultChatStore(): CodexChatStore {
  const session = makeDefaultChatSession();
  return {
    activeSessionId: session.id,
    sessions: [session]
  };
}

function buildSessionTitle(messages: CodexChatMessage[]): string {
  const firstUser = messages.find((message) => message.role === 'user' && message.content.trim());
  if (!firstUser) {
    return '새 대화';
  }
  const normalized = firstUser.content.replace(/\s+/g, ' ').trim();
  return normalized.length > 30 ? `${normalized.slice(0, 30)}...` : normalized;
}

function sortSessions(sessions: CodexChatSession[]): CodexChatSession[] {
  return [...sessions].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
}

function appendMessageToStore(
  store: CodexChatStore,
  sessionId: string,
  role: CodexChatMessage['role'],
  content: string
): CodexChatStore {
  const timestamp = nowIso();
  const sessions = store.sessions.map((session) => {
    if (session.id !== sessionId) {
      return session;
    }

    const messages = [...session.messages, { role, content, timestamp }].slice(-200);
    return {
      ...session,
      messages,
      updatedAt: timestamp,
      title: buildSessionTitle(messages)
    };
  });

  return {
    activeSessionId: sessionId,
    sessions: sortSessions(sessions).slice(0, 50)
  };
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
  const [busyLabel, setBusyLabel] = useState('');
  const [errorMessage, setErrorMessage] = useState('');

  const [chatStore, setChatStore] = useState<CodexChatStore>(makeDefaultChatStore());
  const [prompt, setPrompt] = useState('');
  const [chatTab, setChatTab] = useState<ChatTab>('codex');
  const [settingsMenuOpen, setSettingsMenuOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [model, setModel] = useState('gpt-5.3-codex');
  const [reasoningLevel, setReasoningLevel] = useState<'low' | 'medium' | 'high'>('high');
  const [sandboxMode, setSandboxMode] = useState<CodexSandboxMode>('workspace-write');
  const [attachmentPaths, setAttachmentPaths] = useState<string[]>([]);
  const [lastUsage, setLastUsage] = useState<CodexRunResult['usage'] | null>(null);
  const [codexState, setCodexState] = useState<CodexState | null>(null);
  const [codexBinaryInput, setCodexBinaryInput] = useState('');

  const activeFileContent = activeFilePath ? fileBuffers[activeFilePath] ?? '' : '';
  const isDirty = useMemo(() => Boolean(activeFilePath && dirtyFiles[activeFilePath]), [activeFilePath, dirtyFiles]);
  const rootEntries = entriesMap[''] ?? [];
  const activeSession = useMemo(
    () => chatStore.sessions.find((session) => session.id === chatStore.activeSessionId) ?? chatStore.sessions[0] ?? null,
    [chatStore]
  );
  const codexMessages = activeSession?.messages ?? [];

  async function withBusy<T>(label: string, task: () => Promise<T>): Promise<T> {
    setBusy(true);
    setBusyLabel(label);
    try {
      return await task();
    } finally {
      setBusy(false);
      setBusyLabel('');
    }
  }

  async function persistChatStore(nextStore: CodexChatStore): Promise<void> {
    if (!api) {
      return;
    }
    await api.saveCodexChatStore({ projectKey, store: nextStore });
  }

  function pushChat(role: CodexChatMessage['role'], content: string): void {
    const session = activeSession;
    const baseStore = chatStore.sessions.length > 0 ? chatStore : makeDefaultChatStore();
    const sessionId = session?.id ?? baseStore.activeSessionId;
    const nextStore = appendMessageToStore(baseStore, sessionId, role, content);
    setChatStore(nextStore);
    void persistChatStore(nextStore).catch((error) => {
      const message = error instanceof Error ? error.message : '대화 저장 실패';
      setErrorMessage(message);
    });
  }

  function getRelativePathFromLocal(absolutePath: string): string | null {
    if (!projectDetail || !absolutePath) {
      return null;
    }

    const base = toPosixPath(projectDetail.summary.localPath).replace(/\/+$/, '');
    const target = toPosixPath(absolutePath);
    const lowerBase = base.toLowerCase();
    const lowerTarget = target.toLowerCase();

    if (lowerTarget === lowerBase) {
      return '';
    }

    if (!lowerTarget.startsWith(`${lowerBase}/`)) {
      return null;
    }

    return target.slice(base.length + 1);
  }

  function hasMcpServer(name: string): boolean {
    return (codexState?.mcpServers ?? []).some((server) => server.name === name && server.enabled);
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

  async function loadCodexState(): Promise<void> {
    if (!api) {
      return;
    }
    const state = await api.getCodexState({ projectKey });
    setCodexState(state);
    setCodexBinaryInput(state.codexBinaryPath || 'codex');
  }

  async function loadChatStore(): Promise<void> {
    if (!api) {
      return;
    }
    const store = await api.getCodexChatStore({ projectKey });
    setChatStore(store);
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

    await withBusy('파일 여는 중...', async () => {
      const result = await api.workspaceReadFile({ projectKey, relativePath });
      setFileBuffers((prev) => ({ ...prev, [result.relativePath]: result.content }));
      setOpenTabs((prev) => (prev.includes(result.relativePath) ? prev : [...prev, result.relativePath]));
      setActiveFilePath(result.relativePath);
    }).catch((error) => {
      const message = error instanceof Error ? error.message : '파일 열기 실패';
      setErrorMessage(message);
    });
  }

  async function saveFile(): Promise<void> {
    if (!api || !activeFilePath) {
      return;
    }
    await withBusy('파일 저장 중...', async () => {
      const result = await api.workspaceWriteFile({
        projectKey,
        relativePath: activeFilePath,
        content: fileBuffers[activeFilePath] ?? ''
      });
      setSavedAt(result.savedAt);
      setDirtyFiles((prev) => ({ ...prev, [result.relativePath]: false }));
      pushChat('system', `파일 저장 완료: ${result.relativePath}`);
    }).catch((error) => {
      const message = error instanceof Error ? error.message : '파일 저장 실패';
      setErrorMessage(message);
    });
  }

  async function runCodexPrompt(): Promise<void> {
    if (!api || !prompt.trim() || !activeSession) {
      return;
    }

    const userPrompt = prompt.trim();
    setPrompt('');
    const userStore = appendMessageToStore(chatStore, activeSession.id, 'user', userPrompt);
    setChatStore(userStore);
    void persistChatStore(userStore).catch((error) => {
      const message = error instanceof Error ? error.message : '대화 저장 실패';
      setErrorMessage(message);
    });

    await withBusy('Codex 응답 생성 중...', async () => {
      const result = await api.runCodex({
        projectKey,
        prompt: userPrompt,
        model,
        reasoningLevel,
        sandboxMode,
        attachments: attachmentPaths
      });
      setLastUsage(result.usage);
      await loadCodexState();

      const role: CodexChatMessage['role'] = result.ok ? 'assistant' : 'system';
      const content = result.ok ? result.output || '(빈 응답)' : result.stderr || 'Codex 실행 실패';
      const nextStore = appendMessageToStore(userStore, userStore.activeSessionId, role, content);
      setChatStore(nextStore);
      await persistChatStore(nextStore);
    }).catch((error) => {
      const message = error instanceof Error ? error.message : 'Codex 실행 실패';
      setErrorMessage(message);
      const nextStore = appendMessageToStore(userStore, userStore.activeSessionId, 'system', message);
      setChatStore(nextStore);
      void persistChatStore(nextStore);
    });
  }

  async function handleCodexLogin(): Promise<void> {
    if (!api) {
      return;
    }
    await withBusy('Codex 로그인 창 여는 중...', async () => {
      const result = await api.startCodexLoginChatGPT({ projectKey });
      pushChat('system', result.message);
    }).catch((error) => {
      const message = error instanceof Error ? error.message : 'Codex ChatGPT 로그인 실패';
      setErrorMessage(message);
      pushChat('system', message);
    });
  }

  async function handleCodexLogout(): Promise<void> {
    if (!api) {
      return;
    }
    await withBusy('Codex 로그아웃 처리 중...', async () => {
      const state = await api.logoutCodex({ projectKey });
      setCodexState(state);
      pushChat('system', 'Codex 로그아웃 완료');
    }).catch((error) => {
      const message = error instanceof Error ? error.message : 'Codex 로그아웃 실패';
      setErrorMessage(message);
      pushChat('system', message);
    });
  }

  async function toggleMcpPreset(preset: 'playwright' | 'chrome-devtools', enabled: boolean): Promise<void> {
    if (!api) {
      return;
    }
    await withBusy(`MCP ${preset} ${enabled ? '활성화' : '비활성화'} 중...`, async () => {
      const state = await api.setCodexMcpPreset({ projectKey, preset, enabled });
      setCodexState(state);
      pushChat('system', `MCP ${preset} ${enabled ? '활성화' : '비활성화'} 완료`);
    }).catch((error) => {
      const message = error instanceof Error ? error.message : 'MCP 설정 실패';
      setErrorMessage(message);
      pushChat('system', message);
    });
  }

  async function handleSaveCodexBinaryPath(): Promise<void> {
    if (!api) {
      return;
    }
    await withBusy('Codex 경로 저장 중...', async () => {
      const state = await api.setCodexBinaryPath({ projectKey, binaryPath: codexBinaryInput });
      setCodexState(state);
      pushChat('system', `Codex 실행 경로 저장: ${state.codexBinaryPath}`);
    }).catch((error) => {
      const message = error instanceof Error ? error.message : 'Codex 경로 저장 실패';
      setErrorMessage(message);
      pushChat('system', message);
    });
  }

  async function handleCreateNewChat(): Promise<void> {
    const baseStore = chatStore.sessions.length > 0 ? chatStore : makeDefaultChatStore();
    const newSession = makeDefaultChatSession();
    const nextStore: CodexChatStore = {
      activeSessionId: newSession.id,
      sessions: [newSession, ...baseStore.sessions].slice(0, 50)
    };

    setChatStore(nextStore);
    await withBusy('새 대화 생성 중...', async () => {
      await persistChatStore(nextStore);
    }).catch((error) => {
      const message = error instanceof Error ? error.message : '새 대화 생성 실패';
      setErrorMessage(message);
    });
  }

  function selectChatSession(sessionId: string): void {
    if (!chatStore.sessions.some((session) => session.id === sessionId)) {
      return;
    }
    const nextStore = {
      ...chatStore,
      activeSessionId: sessionId
    };
    setChatStore(nextStore);
    void persistChatStore(nextStore).catch((error) => {
      const message = error instanceof Error ? error.message : '대화 선택 저장 실패';
      setErrorMessage(message);
    });
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
    setErrorMessage('');
    void withBusy('워크스페이스 불러오는 중...', async () => {
      await Promise.all([loadProject(), loadCodexState(), loadChatStore()]);
    }).catch((error) => {
      const message = error instanceof Error ? error.message : 'Codex 상태 확인 실패';
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
            <button
              className="ghost-btn"
              onClick={() =>
                void withBusy('탐색기 새로고침 중...', async () => {
                  await loadProject();
                }).catch((error) => {
                  const message = error instanceof Error ? error.message : '탐색기 새로고침 실패';
                  setErrorMessage(message);
                })
              }
              disabled={busy}
            >
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

        {busy && <div className="workspace-busy-banner">진행 중: {busyLabel || '처리 중...'}</div>}
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
              <button onClick={() => setSettingsMenuOpen((prev) => !prev)}>⚙</button>
            </div>
          </div>

          {settingsMenuOpen && (
            <div className="codex-settings-menu">
              <div className="settings-account">
                <strong>{codexState?.loggedIn ? '로그인됨' : '로그인 필요'}</strong>
                <span>{codexState?.loginMessage ?? '상태 확인 중'}</span>
              </div>

              <button className="settings-menu-item" onClick={() => pushChat('system', '개인 계정 정보는 Codex 로그인 상태를 따릅니다.')}>
                개인 계정
              </button>
              <button className="settings-menu-item" onClick={() => setSettingsOpen((prev) => !prev)}>
                Codex 설정 {settingsOpen ? '닫기' : '열기'}
              </button>
              <button
                className="settings-menu-item"
                onClick={() =>
                  void withBusy('로그인 상태 확인 중...', async () => {
                    await loadCodexState();
                  }).catch((error) => {
                    const message = error instanceof Error ? error.message : '로그인 상태 확인 실패';
                    setErrorMessage(message);
                  })
                }
                disabled={busy}
              >
                로그인 상태 새로고침
              </button>
              <button className="settings-menu-item" onClick={() => pushChat('system', 'IDE 설정 메뉴는 현재 기본값으로 동작합니다.')}>
                IDE 설정
              </button>
              <button className="settings-menu-item" onClick={() => pushChat('system', 'MCP 설정은 아래 토글에서 관리하세요.')}>
                MCP 설정
              </button>
              <button
                className="settings-menu-item"
                onClick={() => {
                  if (!codexState?.configPath) {
                    return;
                  }

                  const relativePath = getRelativePathFromLocal(codexState.configPath);
                  if (relativePath) {
                    void openFile(relativePath);
                    return;
                  }

                  void api.openPath(codexState.configPath);
                }}
                disabled={!codexState?.configPath}
              >
                config.toml 열기
              </button>
              <button
                className="settings-menu-item"
                onClick={() => {
                  if (codexState?.codexHome) {
                    void api.openPath(codexState.codexHome);
                  }
                }}
                disabled={!codexState?.codexHome}
              >
                MCP 설정 열기
              </button>
              <button className="settings-menu-item" onClick={() => pushChat('system', '시스템 설정은 로컬 Codex Home 기반으로 동작합니다.')}>
                시스템 설정
              </button>
              <button className="settings-menu-item" onClick={() => pushChat('system', '언어: ko-KR (현재 고정)')}>
                언어
              </button>
              <button className="settings-menu-item" onClick={() => pushChat('system', '단축키: Ctrl/Cmd+S 저장, Ctrl/Cmd+W 탭 닫기')}>
                키보드 단축키
              </button>

              <div className="settings-divider" />

              <div className="settings-login-box">
                <input
                  type="text"
                  placeholder="codex 실행파일 경로 (예: C:\\codex\\codex.exe)"
                  value={codexBinaryInput}
                  onChange={(event) => setCodexBinaryInput(event.target.value)}
                />
                <button onClick={() => void handleSaveCodexBinaryPath()} disabled={busy || !codexBinaryInput.trim()}>
                  경로 저장
                </button>
              </div>
              <div className="settings-binary-status">
                {codexState?.codexBinaryDetected ? '실행파일 감지됨' : '실행파일 미감지'} · {codexState?.codexBinaryPath || 'codex'}
              </div>

              <div className="settings-divider" />

              <div className="settings-mcp-row">
                <label>
                  <input
                    type="checkbox"
                    checked={hasMcpServer('playwright')}
                    onChange={(event) => void toggleMcpPreset('playwright', event.target.checked)}
                  />
                  Playwright MCP
                </label>
              </div>
              <div className="settings-mcp-row">
                <label>
                  <input
                    type="checkbox"
                    checked={hasMcpServer('chrome-devtools')}
                    onChange={(event) => void toggleMcpPreset('chrome-devtools', event.target.checked)}
                  />
                  Chrome DevTools MCP
                </label>
              </div>

              <div className="settings-divider" />

              {!codexState?.loggedIn && (
                <button className="settings-menu-item" onClick={() => void handleCodexLogin()} disabled={busy}>
                  ChatGPT로 코덱스 연결
                </button>
              )}

              {codexState?.loggedIn && (
                <button className="settings-menu-item danger" onClick={() => void handleCodexLogout()} disabled={busy}>
                  로그아웃
                </button>
              )}
            </div>
          )}

          <div className="codex-session-strip">
            <div className="codex-session-head">
              <span>대화 목록</span>
              <button onClick={() => void handleCreateNewChat()} disabled={busy}>
                새 대화
              </button>
            </div>
            <div className="codex-session-list">
              {chatStore.sessions.map((session) => (
                <button
                  key={session.id}
                  className={`codex-session-item ${chatStore.activeSessionId === session.id ? 'active' : ''}`}
                  onClick={() => selectChatSession(session.id)}
                >
                  <strong>{session.title || '새 대화'}</strong>
                  <span>
                    {toLabelFromIso(session.updatedAt)} · {session.messages.length} msgs
                  </span>
                </button>
              ))}
            </div>
          </div>

          {settingsOpen && (
            <div className="codex-settings codex-settings-inline">
              <label>
                모델
                <select value={model} onChange={(event) => setModel(event.target.value)}>
                  <option value="gpt-5.3-codex">GPT-5.3-Codex</option>
                  <option value="gpt-5.2-codex">GPT-5.2-Codex</option>
                  <option value="gpt-5.1-codex-max">GPT-5.1-Codex-Max</option>
                  <option value="gpt-5.2">GPT-5.2</option>
                  <option value="gpt-5.1-codex-mini">GPT-5.1-Codex-Mini</option>
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
                  {message.role} · {toLabelFromIso(message.timestamp)}
                </div>
                <pre>{message.content}</pre>
              </div>
            ))}
            {busy && chatTab === 'codex' && <div className="chat-working-indicator">작업 중... {busyLabel || '응답 대기'}</div>}
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
              disabled={busy}
            />
            <button onClick={() => void runCodexPrompt()} disabled={busy || !prompt.trim()}>
              {busy ? '…' : '↑'}
            </button>
          </div>

          <div className="codex-quick-controls">
            <label>
              모델
              <select value={model} onChange={(event) => setModel(event.target.value)}>
                <option value="gpt-5.3-codex">GPT-5.3-Codex</option>
                <option value="gpt-5.2-codex">GPT-5.2-Codex</option>
                <option value="gpt-5.1-codex-max">GPT-5.1-Codex-Max</option>
                <option value="gpt-5.2">GPT-5.2</option>
                <option value="gpt-5.1-codex-mini">GPT-5.1-Codex-Mini</option>
              </select>
            </label>
            <label>
              이성
              <select
                value={reasoningLevel}
                onChange={(event) => setReasoningLevel(event.target.value as 'low' | 'medium' | 'high')}
              >
                <option value="low">low</option>
                <option value="medium">medium</option>
                <option value="high">high</option>
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

          <div className="codex-footer-row">
            <span>{model}</span>
            <span>{reasoningLevel}</span>
            <span>{sandboxMode}</span>
            <span>{codexState?.loggedIn ? 'Logged in' : 'Logged out'}</span>
            <span>{codexState?.codexBinaryDetected ? 'CLI OK' : 'CLI Missing'}</span>
            <span>{busy ? `진행중: ${busyLabel || '처리중'}` : '상태: Ready'}</span>
            <span>
              사용량 {lastUsage?.inputChars ?? 0}/{lastUsage?.outputChars ?? 0}
            </span>
          </div>

          {attachmentPaths.length > 0 && (
            <div className="attachment-list">
              {attachmentPaths.map((pathItem) => (
                <button key={pathItem} className="attachment-open-btn" onClick={() => void api.openPath(pathItem)}>
                  • {pathItem}
                </button>
              ))}
            </div>
          )}
        </aside>
      )}
    </div>
  );
}
