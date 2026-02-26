import path from 'node:path';
import os from 'node:os';
import { promises as fs } from 'node:fs';
import { spawn } from 'node:child_process';

export type CodexSandboxMode = 'read-only' | 'workspace-write' | 'danger-full-access';
export type CodexMcpPreset = 'playwright' | 'chrome-devtools';

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

export interface CodexMcpServer {
  name: string;
  enabled: boolean;
  transport?: {
    type?: string;
    command?: string;
    args?: string[];
  };
}

export interface CodexState {
  codexHome: string;
  configPath: string;
  loggedIn: boolean;
  loginMessage: string;
  mcpServers: CodexMcpServer[];
}

interface CodexCommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

interface CodexCommandOptions {
  args: string[];
  cwd: string;
  stdinText?: string;
}

interface McpPresetSpec {
  name: string;
  command: string;
  args: string[];
}

const MCP_PRESETS: Record<CodexMcpPreset, McpPresetSpec> = {
  playwright: {
    name: 'playwright',
    command: 'npx',
    args: ['-y', '@playwright/mcp@latest']
  },
  'chrome-devtools': {
    name: 'chrome-devtools',
    command: 'npx',
    args: ['-y', 'chrome-devtools-mcp@latest']
  }
};

function getCodexHome(cwd: string): string {
  return path.join(path.resolve(cwd), '.codex-home');
}

function getCodexConfigPath(codexHome: string): string {
  return path.join(codexHome, 'config.toml');
}

async function ensureCodexHome(cwd: string): Promise<{ codexHome: string; configPath: string }> {
  const codexHome = getCodexHome(cwd);
  const configPath = getCodexConfigPath(codexHome);
  await fs.mkdir(codexHome, { recursive: true });
  await fs
    .access(configPath)
    .catch(async () => fs.writeFile(configPath, '', 'utf-8'));
  return { codexHome, configPath };
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

async function runCodexCommand(options: CodexCommandOptions): Promise<CodexCommandResult> {
  const { codexHome } = await ensureCodexHome(options.cwd);

  return new Promise((resolve, reject) => {
    const child = spawn('codex', options.args, {
      cwd: options.cwd,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
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

    if (options.stdinText !== undefined) {
      child.stdin.write(options.stdinText);
    }
    child.stdin.end();
  });
}

function parseMcpList(rawJson: string): CodexMcpServer[] {
  try {
    const parsed = JSON.parse(rawJson) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed
      .map((item) => item as CodexMcpServer)
      .filter((item) => typeof item.name === 'string');
  } catch {
    return [];
  }
}

export async function getCodexState(cwd: string): Promise<CodexState> {
  const { codexHome, configPath } = await ensureCodexHome(cwd);

  const loginResult = await runCodexCommand({
    cwd,
    args: ['login', 'status']
  });
  const loggedIn = loginResult.exitCode === 0;
  const loginMessage = (loginResult.stdout || loginResult.stderr).trim() || (loggedIn ? 'Logged in' : 'Not logged in');

  const mcpResult = await runCodexCommand({
    cwd,
    args: ['mcp', 'list', '--json']
  });

  return {
    codexHome,
    configPath,
    loggedIn,
    loginMessage,
    mcpServers: mcpResult.exitCode === 0 ? parseMcpList(mcpResult.stdout) : []
  };
}

export async function loginCodexWithApiKey(cwd: string, apiKey: string): Promise<CodexState> {
  const trimmedKey = apiKey.trim();
  if (!trimmedKey) {
    throw new Error('API 키를 입력하세요.');
  }

  const result = await runCodexCommand({
    cwd,
    args: ['login', '--with-api-key'],
    stdinText: `${trimmedKey}\n`
  });

  if (result.exitCode !== 0) {
    throw new Error((result.stderr || result.stdout || 'Codex 로그인 실패').trim());
  }

  return getCodexState(cwd);
}

export async function logoutCodex(cwd: string): Promise<CodexState> {
  await runCodexCommand({
    cwd,
    args: ['logout']
  });
  return getCodexState(cwd);
}

export async function setMcpPresetEnabled(
  cwd: string,
  preset: CodexMcpPreset,
  enabled: boolean
): Promise<CodexState> {
  const spec = MCP_PRESETS[preset];
  const current = await getCodexState(cwd);
  const exists = current.mcpServers.some((server) => server.name === spec.name);

  if (!enabled) {
    if (exists) {
      await runCodexCommand({
        cwd,
        args: ['mcp', 'remove', spec.name]
      });
    }
    return getCodexState(cwd);
  }

  if (exists) {
    await runCodexCommand({
      cwd,
      args: ['mcp', 'remove', spec.name]
    });
  }

  const result = await runCodexCommand({
    cwd,
    args: ['mcp', 'add', spec.name, '--', spec.command, ...spec.args]
  });

  if (result.exitCode !== 0) {
    throw new Error((result.stderr || result.stdout || 'MCP 설정 실패').trim());
  }

  return getCodexState(cwd);
}

export async function runCodex(options: CodexRunOptions): Promise<CodexRunResult> {
  const startedAt = new Date().toISOString();
  const cwd = path.resolve(options.cwd);
  const sandboxMode = options.sandboxMode ?? 'workspace-write';
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

  const { stdout, stderr, exitCode } = await runCodexCommand({ args, cwd });
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
