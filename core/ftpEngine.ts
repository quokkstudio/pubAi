import path from 'node:path';
import { promises as fs } from 'node:fs';
import { Client, FileType } from 'basic-ftp';

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

async function countRemoteFiles(client: Client, remotePath: string): Promise<number> {
  const entries = await client.list(remotePath);
  let count = 0;

  for (const entry of entries) {
    if (entry.name === '.' || entry.name === '..') {
      continue;
    }

    const childPath = `${remotePath.replace(/\/$/, '')}/${entry.name}`;
    if (entry.type === FileType.Directory) {
      count += await countRemoteFiles(client, childPath);
    } else if (entry.type === FileType.File) {
      count += 1;
    }
  }

  return count;
}

export async function downloadInitialSkin(input: InitialSyncInput): Promise<InitialSyncResult> {
  const client = new Client(60_000);
  client.ftp.verbose = false;

  const remotePath = input.remotePath.trim() || '/';
  await emptyDirectory(input.localPath);

  try {
    await client.access({
      host: input.credential.host,
      port: input.credential.port ?? 21,
      user: input.credential.user,
      password: input.credential.password,
      secure: false
    });

    const fileCount = await countRemoteFiles(client, remotePath).catch(() => 0);
    await client.downloadToDir(input.localPath, remotePath);

    return {
      remotePath,
      localPath: input.localPath,
      fileCount,
      syncedAt: new Date().toISOString()
    };
  } finally {
    client.close();
  }
}
