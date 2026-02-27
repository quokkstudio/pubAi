import path from 'node:path';
import { promises as fs } from 'node:fs';
import { Client, enterPassiveModeIPv4, FileType } from 'basic-ftp';

export interface FtpCredential {
  host: string;
  user: string;
  password: string;
  port?: number;
}

export interface InitialSyncInput {
  credential: FtpCredential;
  localPath: string;
  remotePath: string;
}

export interface InitialSyncResult {
  remotePath: string;
  localPath: string;
  fileCount: number;
  syncedAt: string;
}

export interface DeltaUploadFile {
  absolutePath: string;
  relativePath: string;
}

export interface DeltaUploadInput {
  credential: FtpCredential;
  remotePath: string;
  files: DeltaUploadFile[];
  onProgress?: (uploaded: number, total: number, relativePath: string) => Promise<void> | void;
}

export interface DeltaUploadResult {
  remotePath: string;
  uploadedCount: number;
  startedAt: string;
  finishedAt: string;
}

export interface DeltaDeleteInput {
  credential: FtpCredential;
  remotePath: string;
  relativePaths: string[];
  onProgress?: (deleted: number, total: number, relativePath: string) => Promise<void> | void;
}

export interface DeltaDeleteResult {
  remotePath: string;
  deletedCount: number;
  startedAt: string;
  finishedAt: string;
}

const FTP_TIMEOUT_MS = 180_000;
const MAX_RETRY = 3;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function normalizeRemotePath(rawPath: string): string {
  const trimmed = rawPath.trim();
  if (!trimmed || trimmed === '.') {
    return '/';
  }
  return trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
}

function isRetryableFtpError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /ETIMEDOUT|ECONNRESET|EPIPE|Socket closed|data connection/i.test(message);
}

function isPermissionDeniedFtpError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /(^|\\s)550\\b|Permission denied/i.test(message);
}

async function emptyDirectory(targetPath: string): Promise<void> {
  await fs.mkdir(targetPath, { recursive: true });
  const entries = await fs.readdir(targetPath, { withFileTypes: true });

  await Promise.all(
    entries.map(async (entry) => {
      const entryPath = path.join(targetPath, entry.name);
      await fs.rm(entryPath, { recursive: true, force: true });
    })
  );
}

async function countLocalFiles(targetPath: string): Promise<number> {
  let count = 0;
  const entries = await fs.readdir(targetPath, { withFileTypes: true });

  for (const entry of entries) {
    const entryPath = path.join(targetPath, entry.name);
    if (entry.isDirectory()) {
      count += await countLocalFiles(entryPath);
    } else if (entry.isFile()) {
      count += 1;
    }
  }

  return count;
}

async function assertRemotePathExists(client: Client, remotePath: string): Promise<void> {
  await client.list(remotePath);
}

function joinRemotePath(basePath: string, name: string): string {
  const trimmed = basePath.replace(/\/$/, '');
  if (!trimmed) {
    return `/${name}`;
  }
  return `${trimmed}/${name}`;
}

function getRemoteParentDir(remoteFilePath: string): string {
  const normalized = remoteFilePath.replace(/\/+/g, '/');
  const idx = normalized.lastIndexOf('/');
  if (idx <= 0) {
    return '/';
  }
  return normalized.slice(0, idx);
}

async function downloadDirectoryRecursive(client: Client, remoteDir: string, localDir: string): Promise<void> {
  await fs.mkdir(localDir, { recursive: true });

  let entries;
  try {
    entries = await client.list(remoteDir);
  } catch (error) {
    if (isPermissionDeniedFtpError(error)) {
      return;
    }
    throw error;
  }

  for (const entry of entries) {
    if (entry.name === '.' || entry.name === '..') {
      continue;
    }

    const remoteEntryPath = joinRemotePath(remoteDir, entry.name);
    const localEntryPath = path.join(localDir, entry.name);

    if (entry.type === FileType.Directory) {
      await downloadDirectoryRecursive(client, remoteEntryPath, localEntryPath);
      continue;
    }

    if (entry.type !== FileType.File) {
      continue;
    }

    try {
      await client.downloadTo(localEntryPath, remoteEntryPath);
    } catch (error) {
      if (isPermissionDeniedFtpError(error)) {
        continue;
      }
      throw error;
    }
  }
}

export async function downloadInitialSkin(input: InitialSyncInput): Promise<InitialSyncResult> {
  const host = input.credential.host.trim();
  if (!host) {
    throw new Error('FTP host가 비어 있습니다.');
  }

  const remotePath = normalizeRemotePath(input.remotePath);
  let lastError: unknown;

  for (let attempt = 1; attempt <= MAX_RETRY; attempt += 1) {
    const client = new Client(FTP_TIMEOUT_MS);
    client.ftp.verbose = false;
    client.prepareTransfer = enterPassiveModeIPv4;

    try {
      await client.access({
        host,
        port: input.credential.port ?? 21,
        user: input.credential.user,
        password: input.credential.password,
        secure: false
      });

      await assertRemotePathExists(client, remotePath);
      await emptyDirectory(input.localPath);
      await downloadDirectoryRecursive(client, remotePath, input.localPath);
      const fileCount = await countLocalFiles(input.localPath);

      return {
        remotePath,
        localPath: input.localPath,
        fileCount,
        syncedAt: new Date().toISOString()
      };
    } catch (error) {
      lastError = error;
      if (!isRetryableFtpError(error) || attempt === MAX_RETRY) {
        throw error;
      }
      await sleep(attempt * 1500);
    } finally {
      client.close();
    }
  }

  throw lastError;
}

export async function uploadDeltaFiles(input: DeltaUploadInput): Promise<DeltaUploadResult> {
  const host = input.credential.host.trim();
  if (!host) {
    throw new Error('FTP host가 비어 있습니다.');
  }

  const startedAt = new Date().toISOString();
  const remotePath = normalizeRemotePath(input.remotePath);
  let lastError: unknown;

  for (let attempt = 1; attempt <= MAX_RETRY; attempt += 1) {
    const client = new Client(FTP_TIMEOUT_MS);
    client.ftp.verbose = false;
    client.prepareTransfer = enterPassiveModeIPv4;

    try {
      await client.access({
        host,
        port: input.credential.port ?? 21,
        user: input.credential.user,
        password: input.credential.password,
        secure: false
      });

      await client.ensureDir(remotePath);
      await client.cd('/');

      let uploaded = 0;
      const total = input.files.length;

      for (const file of input.files) {
        const normalizedRelative = file.relativePath.replace(/\\/g, '/').replace(/^\/+/, '');
        const remoteFilePath = joinRemotePath(remotePath, normalizedRelative);
        const remoteDir = getRemoteParentDir(remoteFilePath);

        await client.ensureDir(remoteDir);
        await client.cd('/');
        await client.uploadFrom(file.absolutePath, remoteFilePath);

        uploaded += 1;
        if (input.onProgress) {
          await input.onProgress(uploaded, total, normalizedRelative);
        }
      }

      return {
        remotePath,
        uploadedCount: input.files.length,
        startedAt,
        finishedAt: new Date().toISOString()
      };
    } catch (error) {
      lastError = error;
      if (!isRetryableFtpError(error) || attempt === MAX_RETRY) {
        throw error;
      }
      await sleep(attempt * 1500);
    } finally {
      client.close();
    }
  }

  throw lastError;
}

export async function deleteRemoteFiles(input: DeltaDeleteInput): Promise<DeltaDeleteResult> {
  const host = input.credential.host.trim();
  if (!host) {
    throw new Error('FTP host가 비어 있습니다.');
  }

  const startedAt = new Date().toISOString();
  const remotePath = normalizeRemotePath(input.remotePath);
  let lastError: unknown;

  for (let attempt = 1; attempt <= MAX_RETRY; attempt += 1) {
    const client = new Client(FTP_TIMEOUT_MS);
    client.ftp.verbose = false;
    client.prepareTransfer = enterPassiveModeIPv4;

    try {
      await client.access({
        host,
        port: input.credential.port ?? 21,
        user: input.credential.user,
        password: input.credential.password,
        secure: false
      });

      let deleted = 0;
      const total = input.relativePaths.length;

      for (const relativePath of input.relativePaths) {
        const normalizedRelative = relativePath.replace(/\\/g, '/').replace(/^\/+/, '');
        const remoteFilePath = joinRemotePath(remotePath, normalizedRelative);

        try {
          await client.remove(remoteFilePath);
          deleted += 1;
          if (input.onProgress) {
            await input.onProgress(deleted, total, normalizedRelative);
          }
        } catch (error) {
          if (isPermissionDeniedFtpError(error)) {
            continue;
          }
          throw error;
        }
      }

      return {
        remotePath,
        deletedCount: deleted,
        startedAt,
        finishedAt: new Date().toISOString()
      };
    } catch (error) {
      lastError = error;
      if (!isRetryableFtpError(error) || attempt === MAX_RETRY) {
        throw error;
      }
      await sleep(attempt * 1500);
    } finally {
      client.close();
    }
  }

  throw lastError;
}
