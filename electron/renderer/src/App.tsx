import { useEffect, useMemo, useState } from 'react';
import Dashboard from './pages/Dashboard';
import ProjectCreate from './pages/ProjectCreate';
import ProjectDetail from './pages/ProjectDetail';
import WorkspaceWindow from './pages/WorkspaceWindow';
import type { ProjectAction, ProjectCreateInput, ProjectDetail as ProjectDetailType, ProjectSummary } from './types';

type ViewMode = 'dashboard' | 'create' | 'detail';

function getWorkspaceProjectKeyFromHash(hash: string): string {
  if (!hash.startsWith('#/workspace')) {
    return '';
  }
  const queryStart = hash.indexOf('?');
  if (queryStart < 0) {
    return '';
  }
  const query = hash.slice(queryStart + 1);
  const params = new URLSearchParams(query);
  return params.get('projectKey') ?? '';
}

function toKoreanTimeLabel(isoString: string): string {
  if (!isoString) {
    return '-';
  }
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) {
    return isoString;
  }
  return new Intl.DateTimeFormat('ko-KR', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  }).format(date);
}

function MainApp() {
  const [view, setView] = useState<ViewMode>('dashboard');
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [version, setVersion] = useState('loading...');
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [selectedProjectKey, setSelectedProjectKey] = useState<string>('');
  const [selectedProject, setSelectedProject] = useState<ProjectDetailType | null>(null);
  const [consoleLogs, setConsoleLogs] = useState<string[]>(['[init] STEP 2 준비 중...']);
  const [busy, setBusy] = useState(false);
  const [busyMessage, setBusyMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState('');

  const api = window.devManager;
  const isDesktop = Boolean(api);

  const selectedSummary = useMemo(
    () => projects.find((project) => project.projectKey === selectedProjectKey) ?? null,
    [projects, selectedProjectKey]
  );

  function pushLog(message: string): void {
    const timestamp = new Date().toISOString();
    setConsoleLogs((prev) => [`[${timestamp}] ${message}`, ...prev].slice(0, 120));
  }

  async function refreshProjects(): Promise<void> {
    if (!api) {
      setProjects([]);
      return;
    }

    const result = await api.listProjects();
    setProjects(result);
  }

  async function openProjectDetail(projectKey: string): Promise<void> {
    if (!api) {
      return;
    }

    const detail = await api.getProjectDetail(projectKey);
    setSelectedProject(detail);
    setSelectedProjectKey(projectKey);
    setView('detail');
  }

  async function handleProjectCreate(payload: ProjectCreateInput): Promise<void> {
    if (!api) {
      return;
    }

    setBusy(true);
    setBusyMessage('프로젝트 생성중...');
    setErrorMessage('');
    pushLog('프로젝트 생성 시작...');

    try {
      const created = await api.createProject(payload);
      pushLog(`프로젝트 생성 완료: ${created.name}`);
      await refreshProjects();
      await openProjectDetail(created.projectKey);
    } catch (error) {
      const message = error instanceof Error ? error.message : '프로젝트 생성 실패';
      setErrorMessage(message);
      pushLog(`오류: ${message}`);
      throw error;
    } finally {
      setBusy(false);
      setBusyMessage('');
    }
  }

  async function handleSaveDocs(projectInfo: string, workflow: string): Promise<void> {
    if (!api || !selectedProjectKey) {
      return;
    }

    setBusy(true);
    setBusyMessage('문서 저장중...');
    setErrorMessage('');
    pushLog(`${selectedProjectKey}: 문서 저장 시작...`);

    try {
      const updated = await api.saveProjectDocs({ projectKey: selectedProjectKey, projectInfo, workflow });
      setSelectedProject(updated);
      pushLog(`문서 저장 완료: ${updated.summary.name}`);
      await refreshProjects();
    } catch (error) {
      const message = error instanceof Error ? error.message : '문서 저장 실패';
      setErrorMessage(message);
      pushLog(`오류: ${message}`);
      throw error;
    } finally {
      setBusy(false);
      setBusyMessage('');
    }
  }

  async function handleProjectAction(projectKey: string, action: ProjectAction): Promise<void> {
    if (!api) {
      return;
    }

    const actionLabel =
      action === 'run'
        ? '실행'
        : action === 'deploy'
          ? '배포'
          : action === 'sync'
            ? '최초동기화'
            : action === 'restore'
              ? '최초상태복구'
              : '저장';

    setBusy(true);
    setBusyMessage(`${actionLabel}중...`);
    setErrorMessage('');
    pushLog(`${projectKey}: ${actionLabel} 시작...`);

    try {
      let updatedSummary: ProjectSummary | null = null;

      if (action === 'sync') {
        const syncResult = await api.runInitialSync({ projectKey });
        pushLog(`${projectKey}: ${syncResult.message}`);
      } else if (action === 'restore') {
        const restoreResult = await api.runRestoreInitial({ projectKey });
        pushLog(`${projectKey}: ${restoreResult.message}`);
        const refreshed = await api.getProjectDetail(projectKey);
        setSelectedProject(refreshed);
      } else if (action === 'deploy') {
        const deployResult = await api.runDeploy({ projectKey });
        pushLog(`${projectKey}: ${deployResult.message}`);
        const refreshed = await api.getProjectDetail(projectKey);
        setSelectedProject(refreshed);
      } else if (action === 'run') {
        updatedSummary = await api.recordProjectAction({ projectKey, action });
        await api.openWorkspaceWindow({ projectKey });
        pushLog(`${updatedSummary.name}: 워크스페이스 실행`);
      } else {
        updatedSummary = await api.recordProjectAction({ projectKey, action });
        pushLog(`${updatedSummary.name}: ${actionLabel}`);
      }

      await refreshProjects();
      if (selectedProjectKey === projectKey) {
        const updatedDetail = await api.getProjectDetail(projectKey);
        setSelectedProject(updatedDetail);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : `${actionLabel} 실패`;
      setErrorMessage(message);
      pushLog(`오류: ${message}`);
    } finally {
      setBusy(false);
      setBusyMessage('');
    }
  }

  async function handleProjectDelete(projectKey: string): Promise<void> {
    if (!api) {
      return;
    }

    const target = projects.find((item) => item.projectKey === projectKey);
    const confirmMessage = target
      ? `프로젝트를 삭제할까요?\n- ${target.name} (${target.projectKey})\n\n서버(FTP)에는 영향이 없습니다.`
      : `프로젝트를 삭제할까요? (${projectKey})\n\n서버(FTP)에는 영향이 없습니다.`;

    if (!window.confirm(confirmMessage)) {
      return;
    }

    setBusy(true);
    setBusyMessage('프로젝트 삭제중...');
    setErrorMessage('');
    pushLog(`${projectKey}: 프로젝트 삭제 시작...`);

    try {
      const result = await api.deleteProject({ projectKey });
      pushLog(result.message);

      if (selectedProjectKey === projectKey) {
        setSelectedProjectKey('');
        setSelectedProject(null);
        setView('dashboard');
      }

      await refreshProjects();
    } catch (error) {
      const message = error instanceof Error ? error.message : '프로젝트 삭제 실패';
      setErrorMessage(message);
      pushLog(`오류: ${message}`);
    } finally {
      setBusy(false);
      setBusyMessage('');
    }
  }

  useEffect(() => {
    if (!api) {
      setVersion('web-preview');
      setErrorMessage('Electron 환경에서만 프로젝트 CRUD를 사용할 수 있습니다.');
      return;
    }

    void api
      .getVersion()
      .then(setVersion)
      .catch(() => setVersion('unavailable'));

    void refreshProjects()
      .then(() => {
        pushLog('프로젝트 목록 로드 완료');
      })
      .catch((error) => {
        const message = error instanceof Error ? error.message : '프로젝트 목록 로드 실패';
        setErrorMessage(message);
        pushLog(`오류: ${message}`);
      });
  }, []);

  return (
    <div className={`app-shell ${sidebarOpen ? '' : 'sidebar-collapsed'}`}>
      <aside className={`sidebar ${sidebarOpen ? '' : 'is-collapsed'}`}>
        <h1>DevManager</h1>
        <button onClick={() => setView('dashboard')}>프로젝트 목록</button>
        <button onClick={() => setView('create')}>새 프로젝트</button>
        <button onClick={() => setView('detail')} disabled={!selectedSummary}>
          프로젝트 상세
        </button>
      </aside>

      <main className="main-panel">
        <header className="topbar">
          <div className="topbar-left">
            <button className="outline-btn" onClick={() => setSidebarOpen((prev) => !prev)}>
              {sidebarOpen ? '패널 닫기' : '패널 열기'}
            </button>
            <strong>PubAI Desktop Manager</strong>
          </div>
          <span>Electron v{version}</span>
        </header>

        <section className="content">
          {busy && busyMessage && <div className="alert-info">{busyMessage}</div>}
          {errorMessage && <div className="alert-error">{errorMessage}</div>}

          {view === 'dashboard' && (
            <Dashboard
              projects={projects}
              busy={busy}
              onRefresh={() => void refreshProjects()}
              onSelect={(projectKey) => void openProjectDetail(projectKey)}
              onAction={(projectKey, action) => void handleProjectAction(projectKey, action)}
              onDelete={(projectKey) => void handleProjectDelete(projectKey)}
              toDateLabel={toKoreanTimeLabel}
            />
          )}

          {view === 'create' && (
            <ProjectCreate busy={busy} isDesktop={isDesktop} onCreate={handleProjectCreate} />
          )}

          {view === 'detail' && (
            <ProjectDetail
              busy={busy}
              isDesktop={isDesktop}
              detail={selectedProject}
              onReload={() => {
                if (selectedProjectKey) {
                  void openProjectDetail(selectedProjectKey);
                }
              }}
              onSave={(projectInfo, workflow) => void handleSaveDocs(projectInfo, workflow)}
              onAction={(action) => {
                if (selectedProjectKey) {
                  void handleProjectAction(selectedProjectKey, action);
                }
              }}
              onDelete={() => {
                if (selectedProjectKey) {
                  void handleProjectDelete(selectedProjectKey);
                }
              }}
              toDateLabel={toKoreanTimeLabel}
            />
          )}
        </section>

        <footer className="console">
          <div className="console-title">실시간 로그 콘솔</div>
          <div className="console-body">{consoleLogs.join('\n')}</div>
        </footer>
      </main>
    </div>
  );
}

export default function App() {
  const workspaceProjectKey = getWorkspaceProjectKeyFromHash(window.location.hash);
  if (workspaceProjectKey) {
    return <WorkspaceWindow projectKey={workspaceProjectKey} />;
  }
  return <MainApp />;
}
