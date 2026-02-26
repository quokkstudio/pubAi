import path from 'node:path';
import os from 'node:os';
import { promises as fs } from 'node:fs';
import { spawn } from 'node:child_process';

export type CodexSandboxMode = 'read-only' | 'workspace-write' | 'danger-full-access';

export interface CodexRunOptions {
  cwd: string;
  prompt: string;
  model?: string;
  reasoningLevel?: 'low' | 'medium' | 'high';
  sandboxMode?: CodexSandboxMode;
  attachments?: string[];
}

export interface CodexRunResult {
  ok: boolean;
  message: string;
  startedAt: string;
  finishedAt: string;
  output: string;
  stderr: string;
  exitCode: number;
  usage: {
    inputChars: number;
    outputChars: number;
  };
}

function normalizeAttachmentPath(cwd: string, filePath: string): string {
  if (path.isAbsolute(filePath)) {
    return filePath;
  }
  return path.resolve(cwd, filePath);
}

function buildPrompt(prompt: string, attachments: string[]): string {
  if (attachments.length === 0) {
    return prompt;
  }

  const lines = ['[Attached files]', ...attachments.map((filePath) => `- ${filePath}`), '', prompt];
  return lines.join('\n');
}

function runCodexCommand(args: string[], cwd: string, codexHome: string): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve, reject) => {
    const child = spawn('codex', args, {
      cwd,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        CODEX_HOME: codexHome
      }
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk: Buffer | string) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk: Buffer | string) => {
      stderr += chunk.toString();
    });

    child.once('error', (error) => reject(error));
    child.once('close', (code) => {
      resolve({ stdout, stderr, exitCode: code ?? 1 });
    });
  });
}

export async function runCodex(options: CodexRunOptions): Promise<CodexRunResult> {
  const startedAt = new Date().toISOString();
  const cwd = path.resolve(options.cwd);
  const sandboxMode = options.sandboxMode ?? 'workspace-write';
  const codexHome = path.join(cwd, '.codex-home');
  await fs.mkdir(codexHome, { recursive: true });

  const outputFilePath = path.join(os.tmpdir(), `codex-last-${Date.now()}-${Math.random().toString(36).slice(2)}.txt`);
  const attachmentPaths = (options.attachments ?? [])
    .map((filePath) => normalizeAttachmentPath(cwd, filePath))
    .filter(Boolean);
  const prompt = buildPrompt(options.prompt, attachmentPaths);

  const args: string[] = ['exec', '--skip-git-repo-check', '--sandbox', sandboxMode, '-C', cwd, '-o', outputFilePath];
  if (options.model?.trim()) {
    args.push('-m', options.model.trim());
  }
  args.push(prompt);

  const { stdout, stderr, exitCode } = await runCodexCommand(args, cwd, codexHome);

  const output = await fs.readFile(outputFilePath, 'utf-8').catch(() => stdout.trim());
  await fs.rm(outputFilePath, { force: true }).catch(() => undefined);

  const finishedAt = new Date().toISOString();
  const ok = exitCode === 0;
  const message = ok ? 'Codex 실행 완료' : 'Codex 실행 실패';

  return {
    ok,
    message,
    startedAt,
    finishedAt,
    output: output || '',
    stderr,
    exitCode,
    usage: {
      inputChars: prompt.length,
      outputChars: (output || '').length
    }
  };
}
