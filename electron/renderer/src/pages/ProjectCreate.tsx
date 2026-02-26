import { useMemo, useState, type FormEvent } from 'react';
import type { ProjectCreateInput, SolutionType } from '../types';

interface ProjectCreateProps {
  busy: boolean;
  isDesktop: boolean;
  onCreate: (payload: ProjectCreateInput) => Promise<void>;
}

function getDefaultDueDate(): string {
  const date = new Date();
  date.setDate(date.getDate() + 7);
  return date.toISOString().slice(0, 10);
}

export default function ProjectCreate({ busy, isDesktop, onCreate }: ProjectCreateProps) {
  const [solutionType, setSolutionType] = useState<SolutionType>('cafe24');
  const [name, setName] = useState('');
  const [adminUrl, setAdminUrl] = useState('');
  const [adminId, setAdminId] = useState('');
  const [adminPassword, setAdminPassword] = useState('');
  const [ftpHost, setFtpHost] = useState('');
  const [ftpUser, setFtpUser] = useState('');
  const [ftpPassword, setFtpPassword] = useState('');
  const [skinId, setSkinId] = useState('');
  const [dueDate, setDueDate] = useState(getDefaultDueDate());
  const [message, setMessage] = useState('');

  const isMakeShop = useMemo(() => solutionType === 'makeshop', [solutionType]);

  function resetForm(): void {
    setName('');
    setAdminUrl('');
    setAdminId('');
    setAdminPassword('');
    setFtpHost('');
    setFtpUser('');
    setFtpPassword('');
    setSkinId('');
    setDueDate(getDefaultDueDate());
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    setMessage('');

    if (!isDesktop) {
      setMessage('Electron 앱에서만 프로젝트를 생성할 수 있습니다.');
      return;
    }

    void onCreate({
      name,
      solutionType,
      adminUrl,
      adminId,
      adminPassword,
      ftpHost,
      ftpUser,
      ftpPassword,
      skinId: isMakeShop ? skinId : undefined,
      dueDate
    })
      .then(() => {
        setMessage('프로젝트 생성 완료');
        resetForm();
      })
      .catch(() => {
        setMessage('프로젝트 생성에 실패했습니다.');
      });
  }

  return (
    <div>
      <h2>프로젝트 생성</h2>
      <form className="form-grid" onSubmit={handleSubmit}>
        <label>
          프로젝트명
          <input required value={name} onChange={(event) => setName(event.target.value)} placeholder="예: mall-renewal" />
        </label>

        <label>
          솔루션 타입
          <select value={solutionType} onChange={(event) => setSolutionType(event.target.value as SolutionType)}>
            <option value="cafe24">Cafe24</option>
            <option value="godomall">Godomall</option>
            <option value="makeshop">MakeShop</option>
          </select>
        </label>

        <label>
          관리자 URL
          <input required value={adminUrl} onChange={(event) => setAdminUrl(event.target.value)} placeholder="https://..." />
        </label>

        <label>
          관리자 ID
          <input required value={adminId} onChange={(event) => setAdminId(event.target.value)} />
        </label>

        <label>
          관리자 PW
          <input required type="password" value={adminPassword} onChange={(event) => setAdminPassword(event.target.value)} />
        </label>

        <label>
          FTP Host
          <input required value={ftpHost} onChange={(event) => setFtpHost(event.target.value)} />
        </label>

        <label>
          FTP User
          <input required value={ftpUser} onChange={(event) => setFtpUser(event.target.value)} />
        </label>

        <label>
          FTP Password
          <input required type="password" value={ftpPassword} onChange={(event) => setFtpPassword(event.target.value)} />
        </label>

        <label>
          완료 예정일
          <input required type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} />
        </label>

        {isMakeShop && (
          <label>
            skin_id
            <input required value={skinId} onChange={(event) => setSkinId(event.target.value)} />
          </label>
        )}

        <div className="form-actions">
          <button type="submit" disabled={busy}>
            생성
          </button>
        </div>
      </form>

      {message && <p>{message}</p>}
    </div>
  );
}
