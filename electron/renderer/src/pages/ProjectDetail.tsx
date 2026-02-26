import { useEffect, useState } from 'react';
import type { ProjectAction, ProjectDetail as ProjectDetailType } from '../types';

interface ProjectDetailProps {
  busy: boolean;
  isDesktop: boolean;
  detail: ProjectDetailType | null;
  onReload: () => void;
  onSave: (projectInfo: string, workflow: string) => void;
  onAction: (action: ProjectAction) => void;
  toDateLabel: (isoString: string) => string;
}

export default function ProjectDetail({
  busy,
  isDesktop,
  detail,
  onReload,
  onSave,
  onAction,
  toDateLabel
}: ProjectDetailProps) {
  const [projectInfoDraft, setProjectInfoDraft] = useState('');
  const [workflowDraft, setWorkflowDraft] = useState('');

  useEffect(() => {
    if (!detail) {
      setProjectInfoDraft('');
      setWorkflowDraft('');
      return;
    }

    setProjectInfoDraft(detail.projectInfo);
    setWorkflowDraft(detail.workflow);
  }, [detail]);

  if (!isDesktop) {
    return <p>Electron 앱에서만 프로젝트 상세를 사용할 수 있습니다.</p>;
  }

  if (!detail) {
    return <p>좌측 프로젝트 목록에서 프로젝트를 선택해주세요.</p>;
  }

  return (
    <div className="detail-grid">
      <div className="detail-column">
        <div className="section-header">
          <h2>{detail.summary.name}</h2>
          <button className="outline-btn" onClick={onReload} disabled={busy}>
            새로고침
          </button>
        </div>

        <div className="kv-list">
          <div>
            <span>프로젝트 키</span>
            <strong>{detail.summary.projectKey}</strong>
          </div>
          <div>
            <span>타입</span>
            <strong>{detail.summary.solutionType}</strong>
          </div>
          <div>
            <span>최근 작업</span>
            <strong>{toDateLabel(detail.summary.lastWorkedAt)}</strong>
          </div>
          <div>
            <span>완료 예정일</span>
            <strong>{detail.summary.dueDate || '-'}</strong>
          </div>
          <div>
            <span>local 경로</span>
            <strong>{detail.summary.localPath}</strong>
          </div>
        </div>

        <div className="action-row">
          <button onClick={() => onAction('run')} disabled={busy}>
            VSCode/폴더 열기
          </button>
          <button onClick={() => onAction('sync')} disabled={busy}>
            최초 동기화
          </button>
          <button onClick={() => onAction('deploy')} disabled={busy}>
            배포
          </button>
        </div>

        <h3>Local 폴더 트리</h3>
        <pre className="code-block">{detail.localFiles.length ? detail.localFiles.join('\n') : '(파일 없음)'}</pre>
      </div>

      <div className="detail-column">
        <h3>project-info.md</h3>
        <textarea
          className="editor"
          value={projectInfoDraft}
          onChange={(event) => setProjectInfoDraft(event.target.value)}
          spellCheck={false}
        />

        <h3>workflow.md</h3>
        <textarea
          className="editor"
          value={workflowDraft}
          onChange={(event) => setWorkflowDraft(event.target.value)}
          spellCheck={false}
        />

        <div className="form-actions">
          <button onClick={() => onSave(projectInfoDraft, workflowDraft)} disabled={busy}>
            문서 저장
          </button>
        </div>

        <h3>프로젝트 로그</h3>
        <pre className="code-block">{detail.recentLogs.length ? detail.recentLogs.join('\n') : '(로그 없음)'}</pre>
      </div>
    </div>
  );
}
