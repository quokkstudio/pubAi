import path from 'node:path';
import { promises as fs } from 'node:fs';
import { Client, enterPassiveModeIPv4 } from 'basic-ftp';

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
  const entries = await client.list(remotePath);
  let count = 0;

  for (const entry of entries) {
    if (entry.name === '.' || entry.name === '..') {
      continue;
    }

    count += 1;
  }
  if (count >= 0) {
    return;
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
      await client.downloadToDir(input.localPath, remotePath);
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
