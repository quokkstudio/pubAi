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
  reasoningLevel?: 'none' | 'low' | 'medium' | 'high';
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
  codexBinaryPath: string;
  codexBinaryDetected: boolean;
  loggedIn: boolean;
  loginMessage: string;
  mcpServers: CodexMcpServer[];
}

export interface CodexLoginStartResult {
  started: boolean;
  message: string;
}

interface CodexCommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

interface CodexCommandOptions {
  args: string[];
  cwd: string;
}

interface McpPresetSpec {
  name: string;
  command: string;
  args: string[];
}

interface CodexLocalSettings {
  codexBinaryPath?: string;
}

interface CodexAuthSnapshot {
  loggedIn: boolean;
  authMode?: string;
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

function getCodexSettingsPath(codexHome: string): string {
  return path.join(codexHome, 'devmanager-settings.json');
}

function getCodexAuthPath(codexHome: string): string {
  return path.join(codexHome, 'auth.json');
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

async function readLocalSettings(codexHome: string): Promise<CodexLocalSettings> {
  const settingsPath = getCodexSettingsPath(codexHome);
  const raw = await fs.readFile(settingsPath, 'utf-8').catch(() => '');
  if (!raw.trim()) {
    return {};
  }
  try {
    return JSON.parse(raw) as CodexLocalSettings;
  } catch {
    return {};
  }
}

async function writeLocalSettings(codexHome: string, settings: CodexLocalSettings): Promise<void> {
  const settingsPath = getCodexSettingsPath(codexHome);
  await fs.writeFile(settingsPath, `${JSON.stringify(settings, null, 2)}\n`, 'utf-8');
}

async function readAuthSnapshot(codexHome: string): Promise<CodexAuthSnapshot> {
  const authPath = getCodexAuthPath(codexHome);
  const raw = await fs.readFile(authPath, 'utf-8').catch(() => '');
  if (!raw.trim()) {
    return { loggedIn: false };
  }

  try {
    const parsed = JSON.parse(raw) as { auth_mode?: string; tokens?: Record<string, unknown> };
    const tokens = parsed.tokens ?? {};
    const hasAccess = typeof tokens.access_token === 'string' && Boolean(tokens.access_token);
    const hasRefresh = typeof tokens.refresh_token === 'string' && Boolean(tokens.refresh_token);
    return {
      loggedIn: hasAccess && hasRefresh,
      authMode: parsed.auth_mode
    };
  } catch {
    return { loggedIn: false };
  }
}

async function resolveCodexBinary(cwd: string): Promise<{ codexHome: string; configPath: string; command: string }> {
  const { codexHome, configPath } = await ensureCodexHome(cwd);
  const settings = await readLocalSettings(codexHome);
  const command = settings.codexBinaryPath?.trim() || 'codex';
  return { codexHome, configPath, command };
}

async function checkCodexBinary(cwd: string): Promise<{ command: string; detected: boolean; message: string }> {
  const { command } = await resolveCodexBinary(cwd);
  const result = await new Promise<CodexCommandResult>((resolve, reject) => {
    const child = spawn(command, ['--version'], {
      cwd,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env }
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk: Buffer | string) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk: Buffer | string) => {
      stderr += chunk.toString();
    });
    child.once('error', (error) => {
      const message = error instanceof Error ? error.message : String(error);
      if (/ENOENT/i.test(message)) {
        reject(new Error(`codex 실행파일을 찾을 수 없습니다. 설정에서 경로를 지정하세요. (${command})`));
        return;
      }
      reject(error);
    });
    child.once('close', (code) => resolve({ stdout, stderr, exitCode: code ?? 1 }));
  }).catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    return { stdout: '', stderr: message, exitCode: 1 };
  });

  const detected = result.exitCode === 0;
  const message = detected
    ? (result.stdout || result.stderr).trim()
    : `codex 실행파일을 찾을 수 없습니다. 현재 경로: ${command}`;

  return { command, detected, message };
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
  const { codexHome, command } = await resolveCodexBinary(options.cwd);

  return new Promise((resolve, reject) => {
    const child = spawn(command, options.args, {
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

    child.once('error', (error) => {
      const message = error instanceof Error ? error.message : String(error);
      if (/ENOENT/i.test(message)) {
        reject(new Error(`codex 실행파일을 찾을 수 없습니다. 설정에서 경로를 지정하세요. (${command})`));
        return;
      }
      reject(error);
    });
    child.once('close', (code) => {
      resolve({ stdout, stderr, exitCode: code ?? 1 });
    });
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
  const binaryStatus = await checkCodexBinary(cwd);
  const authSnapshot = await readAuthSnapshot(codexHome);
  if (!binaryStatus.detected) {
    return {
      codexHome,
      configPath,
      codexBinaryPath: binaryStatus.command,
      codexBinaryDetected: false,
      loggedIn: authSnapshot.loggedIn,
      loginMessage: binaryStatus.message,
      mcpServers: []
    };
  }

  const loginResult = await runCodexCommand({
    cwd,
    args: ['login', 'status']
  });
  const cliLoggedIn = loginResult.exitCode === 0;
  const loggedIn = cliLoggedIn || authSnapshot.loggedIn;
  const loginMessage =
    (loginResult.stdout || loginResult.stderr).trim() ||
    (loggedIn ? `Logged in${authSnapshot.authMode ? ` (${authSnapshot.authMode})` : ''}` : 'Not logged in');

  const mcpResult = await runCodexCommand({
    cwd,
    args: ['mcp', 'list', '--json']
  });

  return {
    codexHome,
    configPath,
    codexBinaryPath: binaryStatus.command,
    codexBinaryDetected: true,
    loggedIn,
    loginMessage,
    mcpServers: mcpResult.exitCode === 0 ? parseMcpList(mcpResult.stdout) : []
  };
}

export async function setCodexBinaryPath(cwd: string, binaryPath: string): Promise<CodexState> {
  const { codexHome } = await ensureCodexHome(cwd);
  const settings = await readLocalSettings(codexHome);
  const trimmed = binaryPath.trim();
  settings.codexBinaryPath = trimmed || undefined;
  await writeLocalSettings(codexHome, settings);
  return getCodexState(cwd);
}

export async function startCodexLoginWithChatGPT(cwd: string): Promise<CodexLoginStartResult> {
  const binaryStatus = await checkCodexBinary(cwd);
  if (!binaryStatus.detected) {
    throw new Error(binaryStatus.message);
  }

  const { codexHome, command } = await resolveCodexBinary(cwd);

  if (process.platform === 'win32') {
    const quotedBinary = command.includes(' ') ? `"${command}"` : command;
    const loginCommand = `${quotedBinary} login || ${quotedBinary} login --device-auth`;

    await new Promise<void>((resolve, reject) => {
      const child = spawn(
        'cmd.exe',
        ['/d', '/s', '/c', 'start', '""', 'cmd.exe', '/k', loginCommand],
        {
          cwd,
          windowsHide: false,
          detached: true,
          stdio: 'ignore',
          env: {
            ...process.env,
            CODEX_HOME: codexHome
          }
        }
      );

      child.once('error', (error) => reject(error));
      child.once('spawn', () => {
        child.unref();
        resolve();
      });
    });

    return {
      started: true,
      message:
        '로그인용 CMD 창을 열었습니다. 먼저 브라우저 자동 로그인(codex login)을 시도하고, 필요 시 device-auth로 자동 전환됩니다. 인증 후 "로그인 상태 새로고침"을 눌러주세요.'
    };
  }

  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, ['login', '--device-auth'], {
      cwd,
      windowsHide: false,
      detached: true,
      stdio: 'ignore',
      env: {
        ...process.env,
        CODEX_HOME: codexHome
      }
    });

    child.once('error', (error) => {
      const message = error instanceof Error ? error.message : String(error);
      if (/ENOENT/i.test(message)) {
        reject(new Error(`codex 실행파일을 찾을 수 없습니다. 설정에서 경로를 지정하세요. (${command})`));
        return;
      }
      reject(error);
    });

    child.once('spawn', () => {
      child.unref();
      resolve();
    });
  });

  return {
    started: true,
    message: 'ChatGPT 로그인 프로세스를 시작했습니다. 브라우저 인증 후 "로그인 상태 새로고침"을 눌러주세요.'
  };
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
  const reasoningLevel = options.reasoningLevel ?? 'high';
  const outputFilePath = path.join(os.tmpdir(), `codex-last-${Date.now()}-${Math.random().toString(36).slice(2)}.txt`);
  const attachmentPaths = (options.attachments ?? [])
    .map((filePath) => normalizeAttachmentPath(cwd, filePath))
    .filter(Boolean);
  const prompt = buildPrompt(options.prompt, attachmentPaths);

  const args: string[] = ['exec', '--skip-git-repo-check', '--sandbox', sandboxMode, '-C', cwd, '-o', outputFilePath];
  args.push('-c', `reasoning_effort="${reasoningLevel}"`);
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
