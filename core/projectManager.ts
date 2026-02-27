import path from 'node:path';
import { promises as fs } from 'node:fs';
import { appendProjectLog } from './logger';
import { deleteRemoteFiles, downloadInitialSkin, uploadDeltaFiles } from './ftpEngine';
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

export type ProjectAction = 'run' | 'deploy' | 'sync' | 'restore' | 'save-docs';

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

export interface ProjectRestoreResult {
  projectKey: string;
  solutionType: SolutionType;
  restoredFileCount: number;
  deletedFileCount: number;
  message: string;
  startedAt: string;
  finishedAt: string;
}

export interface ProjectDeleteResult {
  projectKey: string;
  deletedAt: string;
  message: string;
}

export interface AutoUploadResult {
  attempted: boolean;
  uploaded: boolean;
  message: string;
  relativePath: string;
  uploadedAt?: string;
}

export interface LocalFileSnapshot {
  mtimeMs: number;
  size: number;
}

export interface LocalFileDiff {
  upserted: string[];
  deleted: string[];
}

export interface AutoUploadBatchResult {
  attempted: boolean;
  uploaded: boolean;
  uploadedCount: number;
  deletedCount: number;
  uploadedFiles: string[];
  deletedFiles: string[];
  restoredProtectedFiles: string[];
  manualDeleteSkippedFiles: string[];
  message: string;
  uploadedAt?: string;
}

interface InitialBaselineSnapshot {
  createdAt: string;
  remotePath: string;
  files: string[];
}

interface SyncRuleState {
  trackedNewServerFiles: string[];
}

const CONFIG_FILE = 'config.json';
const PROJECT_INFO_FILE = 'project-info.md';
const WORKFLOW_FILE = 'workflow.md';
const RAW_DIR = 'raw';
const SYNC_DIR = '.sync';
const BASELINE_FILE = 'initial-baseline.json';
const SYNC_STATE_FILE = 'sync-rule-state.json';

interface ProjectPaths {
  projectPath: string;
  configPath: string;
  projectInfoPath: string;
  workflowPath: string;
  localPath: string;
  logsPath: string;
  rawPath: string;
  syncPath: string;
  baselinePath: string;
  syncStatePath: string;
}

function buildPaths(projectsRoot: string, projectKey: string): ProjectPaths {
  const projectPath = path.join(projectsRoot, projectKey);
  return {
    projectPath,
    configPath: path.join(projectPath, CONFIG_FILE),
    projectInfoPath: path.join(projectPath, PROJECT_INFO_FILE),
    workflowPath: path.join(projectPath, WORKFLOW_FILE),
    localPath: path.join(projectPath, 'local'),
    logsPath: path.join(projectPath, 'logs'),
    rawPath: path.join(projectPath, RAW_DIR),
    syncPath: path.join(projectPath, SYNC_DIR),
    baselinePath: path.join(projectPath, SYNC_DIR, BASELINE_FILE),
    syncStatePath: path.join(projectPath, SYNC_DIR, SYNC_STATE_FILE)
  };
}

function assertProjectKeySafe(projectKey: string): void {
  const normalized = normalizeProjectName(projectKey);
  if (!normalized || normalized !== projectKey) {
    throw new Error('유효하지 않은 프로젝트 키입니다.');
  }
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

function normalizeRelativePath(input: string): string {
  return input.replace(/\\/g, '/').replace(/^\/+/, '');
}

function isPathInsideLocal(localPath: string, absolutePath: string): boolean {
  const relative = path.relative(localPath, absolutePath);
  return Boolean(relative) && !relative.startsWith('..') && !path.isAbsolute(relative);
}

function joinPreview(list: string[], max = 8): string {
  if (list.length <= max) {
    return list.join(', ');
  }
  return `${list.slice(0, max).join(', ')} ...(+${list.length - max})`;
}

export async function collectLocalFileSnapshotMap(localPath: string): Promise<Record<string, LocalFileSnapshot>> {
  const output: Record<string, LocalFileSnapshot> = {};

  async function walk(currentPath: string): Promise<void> {
    const entries = await fs.readdir(currentPath, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      const fullPath = path.join(currentPath, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
        continue;
      }
      if (!entry.isFile()) {
        continue;
      }

      const stat = await fs.stat(fullPath).catch(() => null);
      if (!stat) {
        continue;
      }

      const relativePath = path.relative(localPath, fullPath).replace(/\\/g, '/');
      output[relativePath] = {
        mtimeMs: Math.trunc(stat.mtimeMs),
        size: stat.size
      };
    }
  }

  await walk(localPath);
  return output;
}

export function diffLocalFileSnapshotMap(
  before: Record<string, LocalFileSnapshot>,
  after: Record<string, LocalFileSnapshot>
): LocalFileDiff {
  const upserted = Object.keys(after).filter((relativePath) => {
    const prev = before[relativePath];
    if (!prev) {
      return true;
    }
    return prev.mtimeMs !== after[relativePath].mtimeMs || prev.size !== after[relativePath].size;
  });

  const deleted = Object.keys(before).filter((relativePath) => !after[relativePath]);

  upserted.sort((a, b) => a.localeCompare(b));
  deleted.sort((a, b) => a.localeCompare(b));

  return { upserted, deleted };
}

async function readInitialBaseline(paths: ProjectPaths): Promise<InitialBaselineSnapshot | null> {
  const raw = await fs.readFile(paths.baselinePath, 'utf-8').catch(() => '');
  if (!raw.trim()) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as Partial<InitialBaselineSnapshot>;
    if (!Array.isArray(parsed.files)) {
      return null;
    }

    return {
      createdAt: typeof parsed.createdAt === 'string' ? parsed.createdAt : '',
      remotePath: typeof parsed.remotePath === 'string' ? parsed.remotePath : '/',
      files: parsed.files
        .filter((item): item is string => typeof item === 'string')
        .map((item) => normalizeRelativePath(item))
        .filter(Boolean)
        .sort((a, b) => a.localeCompare(b))
    };
  } catch {
    return null;
  }
}

async function writeInitialBaseline(paths: ProjectPaths, baseline: InitialBaselineSnapshot): Promise<void> {
  await fs.mkdir(paths.syncPath, { recursive: true });
  await fs.writeFile(paths.baselinePath, `${JSON.stringify(baseline, null, 2)}\n`, 'utf-8');
}

async function readSyncRuleState(paths: ProjectPaths): Promise<SyncRuleState> {
  const raw = await fs.readFile(paths.syncStatePath, 'utf-8').catch(() => '');
  if (!raw.trim()) {
    return { trackedNewServerFiles: [] };
  }

  try {
    const parsed = JSON.parse(raw) as Partial<SyncRuleState>;
    const tracked = Array.isArray(parsed.trackedNewServerFiles)
      ? parsed.trackedNewServerFiles.filter((item): item is string => typeof item === 'string')
      : [];
    return {
      trackedNewServerFiles: [...new Set(tracked.map((item) => normalizeRelativePath(item)).filter(Boolean))].sort((a, b) =>
        a.localeCompare(b)
      )
    };
  } catch {
    return { trackedNewServerFiles: [] };
  }
}

async function writeSyncRuleState(paths: ProjectPaths, state: SyncRuleState): Promise<void> {
  await fs.mkdir(paths.syncPath, { recursive: true });
  const normalized: SyncRuleState = {
    trackedNewServerFiles: [...new Set(state.trackedNewServerFiles.map((item) => normalizeRelativePath(item)).filter(Boolean))].sort(
      (a, b) => a.localeCompare(b)
    )
  };
  await fs.writeFile(paths.syncStatePath, `${JSON.stringify(normalized, null, 2)}\n`, 'utf-8');
}

async function captureInitialRawSnapshot(paths: ProjectPaths, remotePath: string): Promise<InitialBaselineSnapshot> {
  await fs.rm(paths.rawPath, { recursive: true, force: true });
  await fs.mkdir(path.dirname(paths.rawPath), { recursive: true });
  await fs.cp(paths.localPath, paths.rawPath, { recursive: true });

  const snapshot = await collectLocalFileSnapshotMap(paths.localPath);
  const files = Object.keys(snapshot).sort((a, b) => a.localeCompare(b));

  const baseline: InitialBaselineSnapshot = {
    createdAt: new Date().toISOString(),
    remotePath,
    files
  };
  await writeInitialBaseline(paths, baseline);
  await writeSyncRuleState(paths, { trackedNewServerFiles: [] });
  return baseline;
}

async function restoreBaselineFilesToLocal(paths: ProjectPaths, baselineFiles: string[]): Promise<string[]> {
  const restored: string[] = [];

  for (const relativePath of baselineFiles) {
    const sourcePath = path.resolve(paths.rawPath, relativePath);
    const sourceStat = await fs.stat(sourcePath).catch(() => null);
    if (!sourceStat || !sourceStat.isFile()) {
      continue;
    }

    const targetPath = path.resolve(paths.localPath, relativePath);
    if (!isPathInsideLocal(paths.localPath, targetPath)) {
      continue;
    }

    await fs.mkdir(path.dirname(targetPath), { recursive: true });
    await fs.copyFile(sourcePath, targetPath);
    restored.push(relativePath);
  }

  restored.sort((a, b) => a.localeCompare(b));
  return restored;
}

async function replaceLocalWithRawBaseline(paths: ProjectPaths, baselineFiles: string[]): Promise<void> {
  const localSnapshot = await collectLocalFileSnapshotMap(paths.localPath);
  const baselineSet = new Set(baselineFiles);

  const removableLocals = Object.keys(localSnapshot).filter((relativePath) => !baselineSet.has(relativePath));
  for (const relativePath of removableLocals) {
    const fullPath = path.resolve(paths.localPath, relativePath);
    if (!isPathInsideLocal(paths.localPath, fullPath)) {
      continue;
    }
    await fs.rm(fullPath, { force: true });
  }

  await restoreBaselineFilesToLocal(paths, baselineFiles);
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

export async function deleteProject(projectsRoot: string, projectKey: string): Promise<ProjectDeleteResult> {
  assertProjectKeySafe(projectKey);
  const paths = buildPaths(projectsRoot, projectKey);

  const exists = await fs
    .stat(paths.projectPath)
    .then((stat) => stat.isDirectory())
    .catch(() => false);

  if (!exists) {
    throw new Error(`삭제할 프로젝트를 찾을 수 없습니다: ${projectKey}`);
  }

  await fs.rm(paths.projectPath, { recursive: true, force: true });
  const deletedAt = new Date().toISOString();
  return {
    projectKey,
    deletedAt,
    message: `프로젝트 삭제 완료: ${projectKey}`
  };
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
    const baseline = await captureInitialRawSnapshot(paths, result.remotePath);
    await appendProjectLog(
      paths.projectPath,
      `기준점 생성 완료: baseline ${baseline.files.length}개, raw=${paths.rawPath}`
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

export async function runRestoreInitial(projectsRoot: string, projectKey: string): Promise<ProjectRestoreResult> {
  const paths = buildPaths(projectsRoot, projectKey);
  const config = await readJsonFile<StoredProjectConfig>(paths.configPath);
  const startedAt = new Date().toISOString();

  if (config.solutionType !== 'cafe24' && config.solutionType !== 'godomall') {
    throw new Error('최초 상태 복구는 Cafe24/Godomall에서만 지원합니다.');
  }

  if (!config.ftpHost || !config.ftpUser || !config.ftpPassword.value) {
    throw new Error('FTP 접속 정보가 부족합니다. host/user/password를 확인하세요.');
  }

  const baseline = await readInitialBaseline(paths);
  if (!baseline || baseline.files.length === 0) {
    throw new Error('최초 동기화 기준점이 없습니다. 먼저 최초 동기화를 실행하세요.');
  }

  await appendProjectLog(
    paths.projectPath,
    `최초 상태 복구 시작: baseline=${baseline.files.length}, raw=${paths.rawPath}`
  );

  await replaceLocalWithRawBaseline(paths, baseline.files);

  const baselineSet = new Set(baseline.files);
  const uploadFiles: Array<{ absolutePath: string; relativePath: string }> = [];
  for (const relativePath of baseline.files) {
    const absolutePath = path.resolve(paths.rawPath, relativePath);
    const stat = await fs.stat(absolutePath).catch(() => null);
    if (!stat || !stat.isFile()) {
      continue;
    }
    uploadFiles.push({ absolutePath, relativePath });
  }

  const remotePath = config.ftpRemotePath?.trim() || baseline.remotePath || '/';
  const uploaded = await uploadDeltaFiles({
    credential: {
      host: config.ftpHost,
      port: config.ftpPort ?? 21,
      user: config.ftpUser,
      password: config.ftpPassword.value
    },
    remotePath,
    files: uploadFiles,
    onProgress: async (current, total, relativePath) => {
      if (current === 1 || current === total || current % 50 === 0) {
        await appendProjectLog(paths.projectPath, `복구 업로드 진행 ${current}/${total}: ${relativePath}`);
      }
    }
  });

  const syncState = await readSyncRuleState(paths);
  const deletable = syncState.trackedNewServerFiles.filter((relativePath) => !baselineSet.has(relativePath));
  let deletedCount = 0;
  if (deletable.length > 0) {
    const deleted = await deleteRemoteFiles({
      credential: {
        host: config.ftpHost,
        port: config.ftpPort ?? 21,
        user: config.ftpUser,
        password: config.ftpPassword.value
      },
      remotePath,
      relativePaths: deletable
    });
    deletedCount = deleted.deletedCount;
  }

  await writeSyncRuleState(paths, { trackedNewServerFiles: [] });

  const finishedAt = new Date().toISOString();
  config.updatedAt = finishedAt;
  config.lastWorkedAt = finishedAt;
  await writeJsonFile(paths.configPath, config);

  const message = `최초 상태 복구 완료: 교체 ${uploaded.uploadedCount}개, 신규삭제 ${deletedCount}개`;
  await appendProjectLog(paths.projectPath, message);

  return {
    projectKey,
    solutionType: config.solutionType,
    restoredFileCount: uploaded.uploadedCount,
    deletedFileCount: deletedCount,
    message,
    startedAt,
    finishedAt
  };
}

export async function autoUploadSavedFile(
  projectsRoot: string,
  projectKey: string,
  relativePath: string
): Promise<AutoUploadResult> {
  const result = await autoUploadChangedFiles(projectsRoot, projectKey, [relativePath], []);
  return {
    attempted: result.attempted,
    uploaded: result.uploaded,
    message: result.message,
    relativePath: normalizeRelativePath(relativePath),
    uploadedAt: result.uploadedAt
  };
}

export async function autoUploadChangedFiles(
  projectsRoot: string,
  projectKey: string,
  upsertedPaths: string[],
  deletedPaths: string[]
): Promise<AutoUploadBatchResult> {
  const paths = buildPaths(projectsRoot, projectKey);
  const config = await readJsonFile<StoredProjectConfig>(paths.configPath);
  const normalizedUpserts = [...new Set(upsertedPaths.map(normalizeRelativePath).filter(Boolean))].sort((a, b) =>
    a.localeCompare(b)
  );
  const normalizedDeleted = [...new Set(deletedPaths.map(normalizeRelativePath).filter(Boolean))].sort((a, b) =>
    a.localeCompare(b)
  );

  const baseline = await readInitialBaseline(paths);
  const baselineSet = new Set((baseline?.files ?? []).map((item) => normalizeRelativePath(item)));
  const syncState = await readSyncRuleState(paths);
  const trackedSet = new Set(syncState.trackedNewServerFiles.map((item) => normalizeRelativePath(item)));
  const upsertSet = new Set(normalizedUpserts);
  const protectedRestored: string[] = [];
  const protectedMissingRaw: string[] = [];
  const deletableOnServer: string[] = [];
  const manualDeleteSkipped: string[] = [];

  for (const relativePath of normalizedDeleted) {
    if (baselineSet.has(relativePath)) {
      const sourcePath = path.resolve(paths.rawPath, relativePath);
      const sourceStat = await fs.stat(sourcePath).catch(() => null);
      if (!sourceStat || !sourceStat.isFile()) {
        protectedMissingRaw.push(relativePath);
        continue;
      }

      const targetPath = path.resolve(paths.localPath, relativePath);
      if (!isPathInsideLocal(paths.localPath, targetPath)) {
        continue;
      }

      await fs.mkdir(path.dirname(targetPath), { recursive: true });
      await fs.copyFile(sourcePath, targetPath);
      upsertSet.add(relativePath);
      protectedRestored.push(relativePath);
      continue;
    }

    if (trackedSet.has(relativePath)) {
      deletableOnServer.push(relativePath);
      continue;
    }

    manualDeleteSkipped.push(relativePath);
  }

  if (config.solutionType !== 'cafe24' && config.solutionType !== 'godomall') {
    return {
      attempted: false,
      uploaded: false,
      uploadedCount: 0,
      deletedCount: 0,
      uploadedFiles: [],
      deletedFiles: [],
      restoredProtectedFiles: protectedRestored,
      manualDeleteSkippedFiles: manualDeleteSkipped,
      message: '자동 업로드 대상 솔루션이 아닙니다.',
      uploadedAt: undefined
    };
  }

  if (protectedRestored.length > 0) {
    await appendProjectLog(
      paths.projectPath,
      `최초동기화 파일 보호 복구: ${protectedRestored.length}개 (${joinPreview(protectedRestored)})`
    );
  }
  if (protectedMissingRaw.length > 0) {
    await appendProjectLog(
      paths.projectPath,
      `복구 실패(원본 raw 없음): ${protectedMissingRaw.length}개 (${joinPreview(protectedMissingRaw)})`
    );
  }
  if (manualDeleteSkipped.length > 0) {
    await appendProjectLog(
      paths.projectPath,
      `삭제 스킵(신규 추적 아님): ${manualDeleteSkipped.length}개 (${joinPreview(manualDeleteSkipped)})`
    );
  }

  if (!config.ftpHost || !config.ftpUser || !config.ftpPassword.value) {
    const message = 'FTP 설정이 비어 있어 자동 업로드를 건너뜁니다.';
    await appendProjectLog(paths.projectPath, message);
    return {
      attempted: true,
      uploaded: false,
      uploadedCount: 0,
      deletedCount: 0,
      uploadedFiles: [],
      deletedFiles: [],
      restoredProtectedFiles: protectedRestored,
      manualDeleteSkippedFiles: manualDeleteSkipped,
      message:
        protectedRestored.length > 0 ? `최초동기화 파일입니다. ${protectedRestored.length}개 복구됨 (업로드는 FTP 설정 필요)` : message
    };
  }

  const uploadFiles: Array<{ absolutePath: string; relativePath: string }> = [];
  for (const relativePath of [...upsertSet].sort((a, b) => a.localeCompare(b))) {
    const absolutePath = path.resolve(paths.localPath, relativePath);
    if (!isPathInsideLocal(paths.localPath, absolutePath)) {
      continue;
    }
    const stat = await fs.stat(absolutePath).catch(() => null);
    if (!stat || !stat.isFile()) {
      continue;
    }
    uploadFiles.push({ absolutePath, relativePath });
  }

  await appendProjectLog(
    paths.projectPath,
    `자동 업로드 준비: 교체/추가 ${uploadFiles.length}개, 서버삭제 ${deletableOnServer.length}개, 삭제스킵 ${manualDeleteSkipped.length}개`
  );

  const remotePath = config.ftpRemotePath?.trim() || '/';

  try {
    let uploadedCount = 0;
    let uploadedAt = '';

    if (uploadFiles.length > 0) {
      await appendProjectLog(
        paths.projectPath,
        `자동 업로드 시작: ${uploadFiles.length}개 (${joinPreview(uploadFiles.map((item) => item.relativePath))})`
      );
      const upload = await uploadDeltaFiles({
        credential: {
          host: config.ftpHost,
          port: config.ftpPort ?? 21,
          user: config.ftpUser,
          password: config.ftpPassword.value
        },
        remotePath,
        files: uploadFiles
      });
      uploadedCount = upload.uploadedCount;
      uploadedAt = upload.finishedAt;
      await appendProjectLog(paths.projectPath, `자동 업로드 완료: ${upload.uploadedCount}개`);
    }

    let deletedCount = 0;
    if (deletableOnServer.length > 0) {
      await appendProjectLog(paths.projectPath, `서버 삭제 시작(신규 추적 파일): ${deletableOnServer.length}개`);
      const deleted = await deleteRemoteFiles({
        credential: {
          host: config.ftpHost,
          port: config.ftpPort ?? 21,
          user: config.ftpUser,
          password: config.ftpPassword.value
        },
        remotePath,
        relativePaths: deletableOnServer
      });
      deletedCount = deleted.deletedCount;
      await appendProjectLog(paths.projectPath, `서버 삭제 완료: ${deleted.deletedCount}개`);
    }

    for (const item of uploadFiles) {
      if (!baselineSet.has(item.relativePath)) {
        trackedSet.add(item.relativePath);
      }
    }
    for (const item of deletableOnServer) {
      trackedSet.delete(item);
    }
    await writeSyncRuleState(paths, { trackedNewServerFiles: [...trackedSet] });

    const completedAt = uploadedAt || new Date().toISOString();
    config.updatedAt = completedAt;
    config.lastWorkedAt = completedAt;
    await writeJsonFile(paths.configPath, config);

    const messageParts: string[] = [];
    messageParts.push(`교체/추가 ${uploadedCount}개 업로드 완료`);
    if (deletedCount > 0) {
      messageParts.push(`신규 파일 ${deletedCount}개 서버 삭제 완료`);
    }
    if (protectedRestored.length > 0) {
      messageParts.push(`최초동기화 파일입니다. ${protectedRestored.length}개 복구됨`);
    }
    if (manualDeleteSkipped.length > 0) {
      messageParts.push(`삭제 스킵 ${manualDeleteSkipped.length}개(신규 추적 아님)`);
    }
    if (protectedMissingRaw.length > 0) {
      messageParts.push(`raw 없음 ${protectedMissingRaw.length}개 복구 불가`);
    }

    return {
      attempted: true,
      uploaded: uploadedCount > 0 || deletedCount > 0,
      uploadedCount,
      deletedCount,
      uploadedFiles: uploadFiles.map((item) => item.relativePath),
      deletedFiles: deletableOnServer,
      restoredProtectedFiles: protectedRestored,
      manualDeleteSkippedFiles: manualDeleteSkipped,
      message: messageParts.join(' / '),
      uploadedAt: completedAt
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : '자동 업로드 실패';
    await appendProjectLog(paths.projectPath, `자동 업로드 실패: ${message}`);
    return {
      attempted: true,
      uploaded: false,
      uploadedCount: 0,
      deletedCount: 0,
      uploadedFiles: [],
      deletedFiles: [],
      restoredProtectedFiles: protectedRestored,
      manualDeleteSkippedFiles: manualDeleteSkipped,
      message: `자동 업로드 실패: ${message}`
    };
  }
}
