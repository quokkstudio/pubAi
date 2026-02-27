import path from 'node:path';
import { promises as fs } from 'node:fs';
import { uploadDeltaFiles } from './ftpEngine';
import type { MakeShopAutomationConfig, MakeShopDeployResult } from './makeshopEngine';
import { deployMakeShopArchive } from './makeshopEngine';
import type { SolutionType } from './projectManager';

export interface DeployContext {
  solutionType: SolutionType;
  projectPath: string;
  localPath: string;
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
  onLog?: (message: string) => Promise<void> | void;
}

export interface DeployResult {
  mode: 'cafe24-delta' | 'godomall-delta' | 'makeshop-playwright';
  message: string;
  startedAt: string;
  finishedAt: string;
  archivePath?: string;
  uploadedFileName?: string;
}

interface LocalFileSnapshot {
  relativePath: string;
  absolutePath: string;
  mtimeMs: number;
  size: number;
}

interface DeltaManifest {
  updatedAt: string;
  files: Record<string, { mtimeMs: number; size: number }>;
}

function toMakeShopDeployResult(result: MakeShopDeployResult): DeployResult {
  return {
    mode: 'makeshop-playwright',
    message: result.message,
    startedAt: result.startedAt,
    finishedAt: result.finishedAt,
    archivePath: result.archivePath,
    uploadedFileName: result.uploadedFileName
  };
}

function getDeltaManifestPath(projectPath: string, solutionType: 'cafe24' | 'godomall'): string {
  return path.join(projectPath, '.deploy', `${solutionType}-delta-manifest.json`);
}

function toPosixRelativePath(basePath: string, absolutePath: string): string {
  return path.relative(basePath, absolutePath).replace(/\\/g, '/');
}

async function collectLocalFileSnapshot(localPath: string): Promise<LocalFileSnapshot[]> {
  const files: LocalFileSnapshot[] = [];

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

      const stat = await fs.stat(fullPath);
      files.push({
        absolutePath: fullPath,
        relativePath: toPosixRelativePath(localPath, fullPath),
        mtimeMs: Math.trunc(stat.mtimeMs),
        size: stat.size
      });
    }
  }

  await walk(localPath);
  files.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
  return files;
}

async function readDeltaManifest(manifestPath: string): Promise<DeltaManifest> {
  const raw = await fs.readFile(manifestPath, 'utf-8').catch(() => '');
  if (!raw.trim()) {
    return { updatedAt: '', files: {} };
  }
  try {
    const parsed = JSON.parse(raw) as DeltaManifest;
    return {
      updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : '',
      files: parsed.files && typeof parsed.files === 'object' ? parsed.files : {}
    };
  } catch {
    return { updatedAt: '', files: {} };
  }
}

function toDeltaManifest(snapshot: LocalFileSnapshot[], updatedAt: string): DeltaManifest {
  const files: Record<string, { mtimeMs: number; size: number }> = {};
  for (const item of snapshot) {
    files[item.relativePath] = { mtimeMs: item.mtimeMs, size: item.size };
  }
  return { updatedAt, files };
}

function detectChangedFiles(snapshot: LocalFileSnapshot[], manifest: DeltaManifest): LocalFileSnapshot[] {
  return snapshot.filter((item) => {
    const previous = manifest.files[item.relativePath];
    if (!previous) {
      return true;
    }
    return item.mtimeMs !== previous.mtimeMs || item.size !== previous.size;
  });
}

async function deployFtpDelta(
  context: DeployContext,
  solutionType: 'cafe24' | 'godomall'
): Promise<DeployResult> {
  const startedAt = new Date().toISOString();
  const remotePath = context.ftpRemotePath?.trim() || '/';
  const manifestPath = getDeltaManifestPath(context.projectPath, solutionType);
  await fs.mkdir(path.dirname(manifestPath), { recursive: true });

  if (!context.ftpHost || !context.ftpUser || !context.ftpPassword) {
    throw new Error(`${solutionType} 배포에 필요한 FTP 정보가 비어 있습니다.`);
  }

  await context.onLog?.(`${solutionType} 변경 감지 시작 (local: ${context.localPath})`);
  const snapshot = await collectLocalFileSnapshot(context.localPath);
  const previousManifest = await readDeltaManifest(manifestPath);
  const changedFiles = detectChangedFiles(snapshot, previousManifest);

  if (changedFiles.length === 0) {
    const finishedAt = new Date().toISOString();
    await context.onLog?.(`${solutionType} 변경 파일 없음 (manifest 기준)`);
    return {
      mode: solutionType === 'cafe24' ? 'cafe24-delta' : 'godomall-delta',
      message: `변경 파일 없음 (${snapshot.length} files scanned)`,
      startedAt,
      finishedAt
    };
  }

  await context.onLog?.(
    `${solutionType} 변경 파일 ${changedFiles.length}개 업로드 시작 -> ${context.ftpHost}:${context.ftpPort ?? 21}${remotePath}`
  );

  const upload = await uploadDeltaFiles({
    credential: {
      host: context.ftpHost,
      port: context.ftpPort ?? 21,
      user: context.ftpUser,
      password: context.ftpPassword
    },
    remotePath,
    files: changedFiles.map((item) => ({ absolutePath: item.absolutePath, relativePath: item.relativePath })),
    onProgress: async (uploaded, total, relativePath) => {
      if (uploaded === 1 || uploaded === total || uploaded % 20 === 0) {
        await context.onLog?.(`업로드 진행 ${uploaded}/${total}: ${relativePath}`);
      }
    }
  });

  const nextManifest = toDeltaManifest(snapshot, upload.finishedAt);
  await fs.writeFile(manifestPath, `${JSON.stringify(nextManifest, null, 2)}\n`, 'utf-8');
  await context.onLog?.(`${solutionType} 변경 배포 완료: ${upload.uploadedCount}개 업로드`);

  return {
    mode: solutionType === 'cafe24' ? 'cafe24-delta' : 'godomall-delta',
    message: `변경 파일 ${upload.uploadedCount}개 배포 완료`,
    startedAt,
    finishedAt: upload.finishedAt
  };
}

export async function deployBySolution(context: DeployContext): Promise<DeployResult> {
  if (context.solutionType === 'cafe24') {
    return deployFtpDelta(context, 'cafe24');
  }

  if (context.solutionType === 'godomall') {
    return deployFtpDelta(context, 'godomall');
  }

  if (context.solutionType === 'makeshop') {
    if (!context.skinId?.trim()) {
      throw new Error('MakeShop 배포에는 skin_id가 필요합니다.');
    }

    const result = await deployMakeShopArchive({
      projectPath: context.projectPath,
      localPath: context.localPath,
      adminUrl: context.adminUrl,
      adminId: context.adminId,
      adminPassword: context.adminPassword,
      skinId: context.skinId,
      automation: context.makeshopAutomation,
      onLog: context.onLog
    });

    return toMakeShopDeployResult(result);
  }

  throw new Error(`지원하지 않는 솔루션 타입: ${context.solutionType}`);
}
