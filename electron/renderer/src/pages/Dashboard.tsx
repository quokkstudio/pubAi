import type { ProjectAction, ProjectSummary } from '../types';

interface DashboardProps {
  projects: ProjectSummary[];
  busy: boolean;
  onRefresh: () => void;
  onSelect: (projectKey: string) => void;
  onAction: (projectKey: string, action: ProjectAction) => void;
  onDelete: (projectKey: string) => void;
  toDateLabel: (isoString: string) => string;
}

export default function Dashboard({ projects, busy, onRefresh, onSelect, onAction, onDelete, toDateLabel }: DashboardProps) {
  return (
    <div>
      <div className="section-header">
        <h2>프로젝트 리스트</h2>
        <button className="outline-btn" onClick={onRefresh} disabled={busy}>
          새로고침
        </button>
      </div>

      {projects.length === 0 ? (
        <p>생성된 프로젝트가 없습니다. 새 프로젝트를 먼저 만들어주세요.</p>
      ) : (
        <div className="table-wrap">
          <table className="project-table">
            <thead>
              <tr>
                <th>프로젝트명</th>
                <th>타입</th>
                <th>최근 작업</th>
                <th>완료 예정일</th>
                <th>작업</th>
              </tr>
            </thead>
            <tbody>
              {projects.map((project) => (
                <tr key={project.projectKey}>
                  <td>
                    <button className="link-btn" onClick={() => onAction(project.projectKey, 'run')}>
                      {project.name}
                    </button>
                  </td>
                  <td>{project.solutionType}</td>
                  <td>{toDateLabel(project.lastWorkedAt)}</td>
                  <td>{project.dueDate || '-'}</td>
                  <td>
                    <div className="action-row">
                      <button onClick={() => onAction(project.projectKey, 'run')} disabled={busy}>
                        실행
                      </button>
                      <button onClick={() => onSelect(project.projectKey)} disabled={busy}>
                        상세
                      </button>
                      <button onClick={() => onAction(project.projectKey, 'deploy')} disabled={busy}>
                        배포
                      </button>
                      <button onClick={() => onAction(project.projectKey, 'sync')} disabled={busy}>
                        최초 동기화
                      </button>
                      <button onClick={() => onAction(project.projectKey, 'restore')} disabled={busy}>
                        복구
                      </button>
                      <button onClick={() => onDelete(project.projectKey)} disabled={busy}>
                        삭제
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
