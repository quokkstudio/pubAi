import path from 'node:path';
import { promises as fs } from 'node:fs';
import { appendProjectLog } from './logger';
import { downloadInitialSkin, uploadDeltaFiles } from './ftpEngine';
import { deployBySolution, type DeployResult } from './deployRouter';
import type { MakeShopAutomationConfig } from './makeshopEngine';

export type SolutionType = 'cafe24' | 'godomall' | 'makeshop';

export interface ProjectSecret {
  value: string;
  encrypted: boolean;
  algorithm?: string;
}

export interface ProjectCreateInput {
  name: string;
  solutionType: SolutionType;
  adminUrl: string;
  adminId: string;
  adminPassword: string;
  ftpHost: string;
  ftpPort?: number;
  ftpUser: string;
  ftpPassword: string;
  ftpRemotePath?: string;
  skinId?: string;
  makeshopAutomation?: MakeShopAutomationConfig;
  dueDate: string;
}

export interface StoredProjectConfig {
  projectKey: string;
  name: string;
  solutionType: SolutionType;
  adminUrl: string;
  adminId: string;
  adminPassword: ProjectSecret;
  ftpHost: string;
  ftpPort?: number;
  ftpUser: string;
  ftpPassword: ProjectSecret;
  ftpRemotePath?: string;
  skinId?: string;
  makeshopAutomation?: MakeShopAutomationConfig;
  dueDate: string;
  createdAt: string;
  updatedAt: string;
  lastWorkedAt: string;
}

export interface ProjectSummary {
  projectKey: string;
  name: string;
  solutionType: SolutionType;
  dueDate: string;
  lastWorkedAt: string;
  projectPath: string;
  localPath: string;
}

export interface ProjectDetail {
  summary: ProjectSummary;
  config: StoredProjectConfig;
  projectInfo: string;
  workflow: string;
  localFiles: string[];
  recentLogs: string[];
}

export type ProjectAction = 'run' | 'deploy' | 'sync' | 'save-docs';

export interface InitialSyncResult {
  projectKey: string;
  solutionType: SolutionType;
  mode: 'ftp' | 'manual';
  message: string;
  remotePath?: string;
  localPath: string;
  fileCount?: number;
  syncedAt: string;
}

export interface ProjectDeployResult extends DeployResult {
  projectKey: string;
  solutionType: SolutionType;
}

export interface AutoUploadResult {
  attempted: boolean;
  uploaded: boolean;
  message: string;
  relativePath: string;
  uploadedAt?: string;
}

const CONFIG_FILE = 'config.json';
const PROJECT_INFO_FILE = 'project-info.md';
const WORKFLOW_FILE = 'workflow.md';

interface ProjectPaths {
  projectPath: string;
  configPath: string;
  projectInfoPath: string;
  workflowPath: string;
  localPath: string;
  logsPath: string;
}

function buildPaths(projectsRoot: string, projectKey: string): ProjectPaths {
  const projectPath = path.join(projectsRoot, projectKey);
  return {
    projectPath,
    configPath: path.join(projectPath, CONFIG_FILE),
    projectInfoPath: path.join(projectPath, PROJECT_INFO_FILE),
    workflowPath: path.join(projectPath, WORKFLOW_FILE),
    localPath: path.join(projectPath, 'local'),
    logsPath: path.join(projectPath, 'logs')
  };
}

async function ensureProjectsRoot(projectsRoot: string): Promise<void> {
  await fs.mkdir(projectsRoot, { recursive: true });
}

async function readJsonFile<T>(filePath: string): Promise<T> {
  const raw = await fs.readFile(filePath, 'utf-8');
  return JSON.parse(raw) as T;
}

async function writeJsonFile(filePath: string, data: unknown): Promise<void> {
  const serialized = JSON.stringify(data, null, 2);
  await fs.writeFile(filePath, `${serialized}\n`, 'utf-8');
}

async function readFileOrEmpty(filePath: string): Promise<string> {
  try {
    return await fs.readFile(filePath, 'utf-8');
  } catch {
    return '';
  }
}

function toSummary(paths: ProjectPaths, config: StoredProjectConfig): ProjectSummary {
  return {
    projectKey: config.projectKey,
    name: config.name,
    solutionType: config.solutionType,
    dueDate: config.dueDate,
    lastWorkedAt: config.lastWorkedAt,
    projectPath: paths.projectPath,
    localPath: paths.localPath
  };
}

function tailLines(text: string, maxLines: number): string[] {
  const lines = text.split(/\r?\n/).filter(Boolean);
  return lines.slice(Math.max(0, lines.length - maxLines));
}

async function readRecentLogs(logsPath: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(logsPath, { withFileTypes: true });
    const files = entries
      .filter((entry) => entry.isFile() && entry.name.endsWith('.log'))
      .map((entry) => entry.name)
      .sort((a, b) => b.localeCompare(a));

    if (files.length === 0) {
      return [];
    }

    const latestFile = path.join(logsPath, files[0]);
    const raw = await fs.readFile(latestFile, 'utf-8');
    return tailLines(raw, 80);
  } catch {
    return [];
  }
}

async function listLocalFiles(localPath: string, maxFiles = 300): Promise<string[]> {
  const output: string[] = [];

  async function walk(currentPath: string, basePath: string): Promise<void> {
    if (output.length >= maxFiles) {
      return;
    }

    let entries: Array<{ name: string; isDirectory: () => boolean; isFile: () => boolean }>;
    try {
      entries = await fs.readdir(currentPath, { withFileTypes: true });
    } catch {
      return;
    }

    entries.sort((a, b) => {
      if (a.isDirectory() && !b.isDirectory()) {
        return -1;
      }
      if (!a.isDirectory() && b.isDirectory()) {
        return 1;
      }
      return a.name.localeCompare(b.name);
    });

    for (const entry of entries) {
      const entryPath = path.join(currentPath, entry.name);
      const relativePath = path.relative(basePath, entryPath).replace(/\\/g, '/');

      if (entry.isDirectory()) {
        output.push(`${relativePath}/`);
        await walk(entryPath, basePath);
      } else if (entry.isFile()) {
        output.push(relativePath);
      }

      if (output.length >= maxFiles) {
        return;
      }
    }
  }

  await walk(localPath, localPath);
  return output;
}

export function normalizeProjectName(name: string): string {
  const normalized = name
    .trim()
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return normalized.toLowerCase();
}

export async function createProject(projectsRoot: string, input: ProjectCreateInput): Promise<ProjectSummary> {
  await ensureProjectsRoot(projectsRoot);

  const projectKey = normalizeProjectName(input.name);
  if (!projectKey) {
    throw new Error('프로젝트명은 비어 있을 수 없습니다.');
  }
  if (input.solutionType === 'makeshop' && !input.skinId?.trim()) {
    throw new Error('MakeShop 프로젝트는 skin_id가 필요합니다.');
  }

  const paths = buildPaths(projectsRoot, projectKey);
  const exists = await fs
    .stat(paths.projectPath)
    .then(() => true)
    .catch(() => false);
  if (exists) {
    throw new Error(`이미 존재하는 프로젝트입니다: ${projectKey}`);
  }

  await fs.mkdir(paths.projectPath, { recursive: true });
  await fs.mkdir(paths.localPath, { recursive: true });
  await fs.mkdir(paths.logsPath, { recursive: true });

  const now = new Date().toISOString();
  const config: StoredProjectConfig = {
    projectKey,
    name: input.name.trim(),
    solutionType: input.solutionType,
    adminUrl: input.adminUrl.trim(),
    adminId: input.adminId.trim(),
    adminPassword: { value: input.adminPassword, encrypted: false },
    ftpHost: input.ftpHost.trim(),
    ftpPort: input.ftpPort ?? 21,
    ftpUser: input.ftpUser.trim(),
    ftpPassword: { value: input.ftpPassword, encrypted: false },
    ftpRemotePath: input.ftpRemotePath?.trim() || '/',
    skinId: input.skinId?.trim() || undefined,
    makeshopAutomation: input.makeshopAutomation,
    dueDate: input.dueDate,
    createdAt: now,
    updatedAt: now,
    lastWorkedAt: now
  };

  const projectInfoTemplate = [
    `# ${config.name}`,
    '',
    `- 프로젝트 키: ${config.projectKey}`,
    `- 솔루션 타입: ${config.solutionType}`,
    `- 관리자 URL: ${config.adminUrl}`,
    `- 완료 예정일: ${config.dueDate}`,
    `- FTP 호스트: ${config.ftpHost}`,
    `- FTP 경로: ${config.ftpRemotePath ?? '/'}`,
    '',
    '## 메모',
    '- '
  ].join('\n');

  const workflowTemplate = [
    '# Workflow',
    '',
    '- [ ] 요구사항 정리',
    '- [ ] 로컬 작업',
    '- [ ] 검수',
    '- [ ] 배포'
  ].join('\n');

  await writeJsonFile(paths.configPath, config);
  await fs.writeFile(paths.projectInfoPath, `${projectInfoTemplate}\n`, 'utf-8');
  await fs.writeFile(paths.workflowPath, `${workflowTemplate}\n`, 'utf-8');
  await appendProjectLog(paths.projectPath, `프로젝트 생성: ${config.name} (${config.solutionType})`);

  return toSummary(paths, config);
}

export async function listProjects(projectsRoot: string): Promise<ProjectSummary[]> {
  await ensureProjectsRoot(projectsRoot);
  const entries = await fs.readdir(projectsRoot, { withFileTypes: true });

  const summaries = await Promise.all(
    entries
      .filter((entry) => entry.isDirectory())
      .map(async (entry) => {
        const paths = buildPaths(projectsRoot, entry.name);
        const exists = await fs
          .stat(paths.configPath)
          .then(() => true)
          .catch(() => false);
        if (!exists) {
          return null;
        }

        try {
          const config = await readJsonFile<StoredProjectConfig>(paths.configPath);
          return toSummary(paths, config);
        } catch {
          return null;
        }
      })
  );

  return summaries
    .filter((summary): summary is ProjectSummary => summary !== null)
    .sort((a, b) => b.lastWorkedAt.localeCompare(a.lastWorkedAt));
}

export async function getProjectDetail(projectsRoot: string, projectKey: string): Promise<ProjectDetail> {
  const paths = buildPaths(projectsRoot, projectKey);
  const config = await readJsonFile<StoredProjectConfig>(paths.configPath);

  const [projectInfo, workflow, localFiles, recentLogs] = await Promise.all([
    readFileOrEmpty(paths.projectInfoPath),
    readFileOrEmpty(paths.workflowPath),
    listLocalFiles(paths.localPath),
    readRecentLogs(paths.logsPath)
  ]);

  return {
    summary: toSummary(paths, config),
    config,
    projectInfo,
    workflow,
    localFiles,
    recentLogs
  };
}

export async function saveProjectDocs(
  projectsRoot: string,
  projectKey: string,
  payload: { projectInfo: string; workflow: string }
): Promise<ProjectDetail> {
  const paths = buildPaths(projectsRoot, projectKey);
  const config = await readJsonFile<StoredProjectConfig>(paths.configPath);

  await fs.writeFile(paths.projectInfoPath, payload.projectInfo, 'utf-8');
  await fs.writeFile(paths.workflowPath, payload.workflow, 'utf-8');

  const now = new Date().toISOString();
  config.updatedAt = now;
  config.lastWorkedAt = now;
  await writeJsonFile(paths.configPath, config);
  await appendProjectLog(paths.projectPath, '문서 저장: project-info.md, workflow.md');

  return getProjectDetail(projectsRoot, projectKey);
}

export async function recordProjectAction(
  projectsRoot: string,
  projectKey: string,
  action: ProjectAction
): Promise<ProjectSummary> {
  const paths = buildPaths(projectsRoot, projectKey);
  const config = await readJsonFile<StoredProjectConfig>(paths.configPath);

  const now = new Date().toISOString();
  config.updatedAt = now;
  config.lastWorkedAt = now;
  await writeJsonFile(paths.configPath, config);
  await appendProjectLog(paths.projectPath, `작업 실행: ${action}`);

  return toSummary(paths, config);
}

export async function runInitialSync(projectsRoot: string, projectKey: string): Promise<InitialSyncResult> {
  const paths = buildPaths(projectsRoot, projectKey);
  const config = await readJsonFile<StoredProjectConfig>(paths.configPath);
  const now = new Date().toISOString();

  if (config.solutionType === 'makeshop') {
    config.updatedAt = now;
    config.lastWorkedAt = now;
    await writeJsonFile(paths.configPath, config);
    const message = 'MakeShop은 STEP3에서 수동 local 복사 방식입니다.';
    await appendProjectLog(paths.projectPath, `최초 동기화 안내: ${message}`);
    return {
      projectKey,
      solutionType: config.solutionType,
      mode: 'manual',
      message,
      localPath: paths.localPath,
      syncedAt: now
    };
  }

  if (!config.ftpHost || !config.ftpUser || !config.ftpPassword.value) {
    throw new Error('FTP 접속 정보가 부족합니다. host/user/password를 확인하세요.');
  }

  const remotePath = config.ftpRemotePath?.trim() || '/';
  await appendProjectLog(
    paths.projectPath,
    `최초 동기화 시작: FTP ${config.ftpHost}:${config.ftpPort ?? 21} ${remotePath} -> ${paths.localPath}`
  );

  try {
    const result = await downloadInitialSkin({
      credential: {
        host: config.ftpHost,
        port: config.ftpPort ?? 21,
        user: config.ftpUser,
        password: config.ftpPassword.value
      },
      localPath: paths.localPath,
      remotePath
    });

    config.updatedAt = result.syncedAt;
    config.lastWorkedAt = result.syncedAt;
    await writeJsonFile(paths.configPath, config);
    await appendProjectLog(
      paths.projectPath,
      `최초 동기화 완료: ${result.fileCount}개 파일 다운로드 (${result.remotePath})`
    );

    return {
      projectKey,
      solutionType: config.solutionType,
      mode: 'ftp',
      message: `FTP 최초 동기화 완료 (${result.fileCount} files)`,
      remotePath: result.remotePath,
      localPath: result.localPath,
      fileCount: result.fileCount,
      syncedAt: result.syncedAt
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'FTP 최초 동기화 실패';
    await appendProjectLog(paths.projectPath, `최초 동기화 실패: ${message}`);
    throw error;
  }
}

export async function runDeploy(projectsRoot: string, projectKey: string): Promise<ProjectDeployResult> {
  const paths = buildPaths(projectsRoot, projectKey);
  const config = await readJsonFile<StoredProjectConfig>(paths.configPath);

  await appendProjectLog(paths.projectPath, `배포 시작: ${config.solutionType}`);

  try {
    const result = await deployBySolution({
      solutionType: config.solutionType,
      projectPath: paths.projectPath,
      localPath: paths.localPath,
      adminUrl: config.adminUrl,
      adminId: config.adminId,
      adminPassword: config.adminPassword.value,
      ftpHost: config.ftpHost,
      ftpPort: config.ftpPort ?? 21,
      ftpUser: config.ftpUser,
      ftpPassword: config.ftpPassword.value,
      ftpRemotePath: config.ftpRemotePath,
      skinId: config.skinId,
      makeshopAutomation: config.makeshopAutomation,
      onLog: async (message) => {
        await appendProjectLog(paths.projectPath, message);
      }
    });

    const now = result.finishedAt || new Date().toISOString();
    config.updatedAt = now;
    config.lastWorkedAt = now;
    await writeJsonFile(paths.configPath, config);
    await appendProjectLog(paths.projectPath, `배포 완료: ${result.message}`);

    return {
      projectKey,
      solutionType: config.solutionType,
      ...result
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : '배포 실패';
    await appendProjectLog(paths.projectPath, `배포 실패: ${message}`);
    throw error;
  }
}

export async function autoUploadSavedFile(
  projectsRoot: string,
  projectKey: string,
  relativePath: string
): Promise<AutoUploadResult> {
  const paths = buildPaths(projectsRoot, projectKey);
  const config = await readJsonFile<StoredProjectConfig>(paths.configPath);
  const normalizedRelativePath = relativePath.replace(/\\/g, '/').replace(/^\/+/, '');

  if (config.solutionType !== 'cafe24' && config.solutionType !== 'godomall') {
    return {
      attempted: false,
      uploaded: false,
      message: '자동 업로드 대상 솔루션이 아닙니다.',
      relativePath: normalizedRelativePath
    };
  }

  const absolutePath = path.resolve(paths.localPath, normalizedRelativePath);
  const checkRelative = path.relative(paths.localPath, absolutePath);
  if (!normalizedRelativePath || checkRelative.startsWith('..') || path.isAbsolute(checkRelative)) {
    return {
      attempted: true,
      uploaded: false,
      message: '허용되지 않은 파일 경로입니다.',
      relativePath: normalizedRelativePath
    };
  }

  const stat = await fs.stat(absolutePath).catch(() => null);
  if (!stat || !stat.isFile()) {
    return {
      attempted: true,
      uploaded: false,
      message: '업로드할 파일을 찾을 수 없습니다.',
      relativePath: normalizedRelativePath
    };
  }

  if (!config.ftpHost || !config.ftpUser || !config.ftpPassword.value) {
    return {
      attempted: true,
      uploaded: false,
      message: 'FTP 설정이 비어 있어 자동 업로드를 건너뜁니다.',
      relativePath: normalizedRelativePath
    };
  }

  const remotePath = config.ftpRemotePath?.trim() || '/';
  await appendProjectLog(paths.projectPath, `자동 업로드 시작: ${normalizedRelativePath}`);

  try {
    const upload = await uploadDeltaFiles({
      credential: {
        host: config.ftpHost,
        port: config.ftpPort ?? 21,
        user: config.ftpUser,
        password: config.ftpPassword.value
      },
      remotePath,
      files: [
        {
          absolutePath,
          relativePath: normalizedRelativePath
        }
      ]
    });

    config.updatedAt = upload.finishedAt;
    config.lastWorkedAt = upload.finishedAt;
    await writeJsonFile(paths.configPath, config);
    await appendProjectLog(paths.projectPath, `자동 업로드 완료: ${normalizedRelativePath}`);

    return {
      attempted: true,
      uploaded: true,
      message: `자동 업로드 완료: ${normalizedRelativePath}`,
      relativePath: normalizedRelativePath,
      uploadedAt: upload.finishedAt
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : '자동 업로드 실패';
    await appendProjectLog(paths.projectPath, `자동 업로드 실패: ${normalizedRelativePath} - ${message}`);
    return {
      attempted: true,
      uploaded: false,
      message: `자동 업로드 실패: ${message}`,
      relativePath: normalizedRelativePath
    };
  }
}
