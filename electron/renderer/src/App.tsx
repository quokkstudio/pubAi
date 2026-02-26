import { useEffect, useState } from 'react';
import Dashboard from './pages/Dashboard';
import ProjectCreate from './pages/ProjectCreate';
import ProjectDetail from './pages/ProjectDetail';

type ViewMode = 'dashboard' | 'create' | 'detail';

export default function App() {
  const [view, setView] = useState<ViewMode>('dashboard');
  const [version, setVersion] = useState('loading...');

  useEffect(() => {
    void window.devManager.getVersion().then(setVersion);
  }, []);

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <h1>DevManager</h1>
        <button onClick={() => setView('dashboard')}>프로젝트 목록</button>
        <button onClick={() => setView('create')}>새 프로젝트</button>
        <button onClick={() => setView('detail')}>프로젝트 상세</button>
      </aside>

      <main className="main-panel">
        <header className="topbar">
          <strong>PubAI Desktop Manager</strong>
          <span>Electron v{version}</span>
        </header>

        <section className="content">
          {view === 'dashboard' && <Dashboard />}
          {view === 'create' && <ProjectCreate />}
          {view === 'detail' && <ProjectDetail />}
        </section>

        <footer className="console">
          <div className="console-title">실시간 로그 콘솔</div>
          <div className="console-body">[init] STEP 1 기본 구조가 로드되었습니다.</div>
        </footer>
      </main>
    </div>
  );
}
