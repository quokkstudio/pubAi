import { useEffect, useMemo, useState } from 'react';
import Dashboard from './pages/Dashboard';
import ProjectCreate from './pages/ProjectCreate';
import ProjectDetail from './pages/ProjectDetail';
import type { ProjectAction, ProjectCreateInput, ProjectDetail as ProjectDetailType, ProjectSummary } from './types';

type ViewMode = 'dashboard' | 'create' | 'detail';

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

export default function App() {
  const [view, setView] = useState<ViewMode>('dashboard');
  const [version, setVersion] = useState('loading...');
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [selectedProjectKey, setSelectedProjectKey] = useState<string>('');
  const [selectedProject, setSelectedProject] = useState<ProjectDetailType | null>(null);
  const [consoleLogs, setConsoleLogs] = useState<string[]>(['[init] STEP 2 준비 중...']);
  const [busy, setBusy] = useState(false);
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
    setErrorMessage('');

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
    }
  }

  async function handleSaveDocs(projectInfo: string, workflow: string): Promise<void> {
    if (!api || !selectedProjectKey) {
      return;
    }

    setBusy(true);
    setErrorMessage('');

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
    }
  }

  async function handleProjectAction(projectKey: string, action: ProjectAction): Promise<void> {
    if (!api) {
      return;
    }

    const actionLabel = action === 'run' ? '실행' : action === 'deploy' ? '배포' : action === 'sync' ? '최초 동기화' : '저장';

    setBusy(true);
    setErrorMessage('');

    try {
      let updatedSummary: ProjectSummary | null = null;

      if (action === 'sync') {
        const syncResult = await api.runInitialSync({ projectKey });
        pushLog(`${projectKey}: ${syncResult.message}`);
      } else {
        updatedSummary = await api.recordProjectAction({ projectKey, action });
        pushLog(`${updatedSummary.name}: ${actionLabel}`);
      }

      if (action === 'run') {
        if (updatedSummary) {
          await api.openPath(updatedSummary.localPath);
        }
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
    <div className="app-shell">
      <aside className="sidebar">
        <h1>DevManager</h1>
        <button onClick={() => setView('dashboard')}>프로젝트 목록</button>
        <button onClick={() => setView('create')}>새 프로젝트</button>
        <button onClick={() => setView('detail')} disabled={!selectedSummary}>
          프로젝트 상세
        </button>
      </aside>

      <main className="main-panel">
        <header className="topbar">
          <strong>PubAI Desktop Manager</strong>
          <span>Electron v{version}</span>
        </header>

        <section className="content">
          {errorMessage && <div className="alert-error">{errorMessage}</div>}

          {view === 'dashboard' && (
            <Dashboard
              projects={projects}
              busy={busy}
              onRefresh={() => void refreshProjects()}
              onSelect={(projectKey) => void openProjectDetail(projectKey)}
              onAction={(projectKey, action) => void handleProjectAction(projectKey, action)}
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
