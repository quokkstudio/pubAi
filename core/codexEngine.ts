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

export interface CodexChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: string;
}

export interface CodexChatSession {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messages: CodexChatMessage[];
}

export interface CodexChatStore {
  activeSessionId: string;
  sessions: CodexChatSession[];
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

interface ResolvedCodexCommandResult {
  command: string;
  result: CodexCommandResult;
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
  const resolved = path.resolve(cwd);
  const normalized = resolved.replace(/\\/g, '/');
  const m = normalized.match(/^(.*\/projects\/[^/]+)\/local(?:\/.*)?$/i);
  if (m?.[1]) {
    return path.join(path.normalize(m[1]), '.codex-home');
  }
  return path.join(resolved, '.codex-home');
}

function getLegacyLocalCodexHome(cwd: string): string {
  return path.join(path.resolve(cwd), '.codex-home');
}

function getLegacyWorkspaceCodexHome(cwd: string): string | null {
  const resolved = path.resolve(cwd);
  const normalized = resolved.replace(/\\/g, '/');
  const m = normalized.match(/^(.*)\/projects\/[^/]+\/local(?:\/.*)?$/i);
  if (!m?.[1]) {
    return null;
  }
  return path.join(path.normalize(m[1]), '.codex-home');
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

function getCodexChatStorePath(codexHome: string): string {
  return path.join(codexHome, 'chat-sessions.json');
}

function nowIso(): string {
  return new Date().toISOString();
}

function trimChatText(input: string): string {
  return input.replace(/\s+/g, ' ').trim();
}

function buildSessionTitle(messages: CodexChatMessage[]): string {
  const firstUser = messages.find((item) => item.role === 'user' && trimChatText(item.content).length > 0);
  if (!firstUser) {
    return '새 대화';
  }

  const normalized = trimChatText(firstUser.content);
  return normalized.length > 30 ? `${normalized.slice(0, 30)}...` : normalized;
}

function createDefaultChatSession(): CodexChatSession {
  const iso = nowIso();
  return {
    id: `session-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    title: '새 대화',
    createdAt: iso,
    updatedAt: iso,
    messages: [
      {
        role: 'system',
        content: 'Codex 패널 준비 완료. 프로젝트 파일을 참고해 질문할 수 있습니다.',
        timestamp: iso
      }
    ]
  };
}

function normalizeChatStore(input: unknown): CodexChatStore {
  if (!input || typeof input !== 'object') {
    const session = createDefaultChatSession();
    return { activeSessionId: session.id, sessions: [session] };
  }

  const parsed = input as { activeSessionId?: string; sessions?: unknown[] };
  const sessions: CodexChatSession[] = Array.isArray(parsed.sessions)
    ? parsed.sessions
        .map((item) => item as Partial<CodexChatSession>)
        .filter((item) => typeof item.id === 'string' && Array.isArray(item.messages))
        .map((item) => {
          const messages: CodexChatMessage[] = (item.messages ?? [])
            .map((msg) => msg as Partial<CodexChatMessage>)
            .filter(
              (msg): msg is CodexChatMessage =>
                (msg.role === 'user' || msg.role === 'assistant' || msg.role === 'system') &&
                typeof msg.content === 'string' &&
                typeof msg.timestamp === 'string'
            )
            .slice(-200);

          const createdAt = typeof item.createdAt === 'string' ? item.createdAt : nowIso();
          const updatedAt = typeof item.updatedAt === 'string' ? item.updatedAt : createdAt;
          const title = typeof item.title === 'string' && item.title.trim() ? item.title.trim() : buildSessionTitle(messages);

          return {
            id: item.id!,
            title: title || '새 대화',
            createdAt,
            updatedAt,
            messages
          };
        })
        .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
        .slice(0, 50)
    : [];

  if (sessions.length === 0) {
    const session = createDefaultChatSession();
    return { activeSessionId: session.id, sessions: [session] };
  }

  const activeSessionId =
    typeof parsed.activeSessionId === 'string' && sessions.some((session) => session.id === parsed.activeSessionId)
      ? parsed.activeSessionId
      : sessions[0].id;

  return {
    activeSessionId,
    sessions
  };
}

async function readChatStore(codexHome: string): Promise<CodexChatStore> {
  const storePath = getCodexChatStorePath(codexHome);
  const raw = await fs.readFile(storePath, 'utf-8').catch(() => '');
  const parsed = raw.trim() ? JSON.parse(raw) : null;
  return normalizeChatStore(parsed);
}

async function writeChatStore(codexHome: string, store: CodexChatStore): Promise<CodexChatStore> {
  const normalized = normalizeChatStore(store);
  const storePath = getCodexChatStorePath(codexHome);
  await fs.writeFile(storePath, `${JSON.stringify(normalized, null, 2)}\n`, 'utf-8');
  return normalized;
}

async function pathExists(targetPath: string): Promise<boolean> {
  return fs
    .access(targetPath)
    .then(() => true)
    .catch(() => false);
}

async function copyIfMissing(sourcePath: string, targetPath: string): Promise<void> {
  const [sourceExists, targetExists] = await Promise.all([pathExists(sourcePath), pathExists(targetPath)]);
  if (!sourceExists || targetExists) {
    return;
  }
  await fs.cp(sourcePath, targetPath, { recursive: true });
}

async function migrateLegacyCodexHome(cwd: string, codexHome: string): Promise<void> {
  const normalizedTarget = path.resolve(codexHome);
  const legacyHomes = [getLegacyLocalCodexHome(cwd), getLegacyWorkspaceCodexHome(cwd)].filter(
    (item): item is string => Boolean(item)
  );

  await fs.mkdir(codexHome, { recursive: true });

  const filesToMigrate = ['auth.json', 'config.toml', 'devmanager-settings.json', 'models_cache.json'];
  const dirsToMigrate = ['sessions', 'skills', 'tmp'];

  for (const legacyHome of legacyHomes) {
    const normalizedLegacy = path.resolve(legacyHome);
    if (normalizedLegacy === normalizedTarget) {
      continue;
    }

    const legacyExists = await pathExists(legacyHome);
    if (!legacyExists) {
      continue;
    }

    for (const fileName of filesToMigrate) {
      await copyIfMissing(path.join(legacyHome, fileName), path.join(codexHome, fileName));
    }
    for (const dirName of dirsToMigrate) {
      await copyIfMissing(path.join(legacyHome, dirName), path.join(codexHome, dirName));
    }
  }
}

async function importFromUserCodexHomeIfNeeded(codexHome: string): Promise<void> {
  const targetAuth = path.join(codexHome, 'auth.json');
  const targetAuthExists = await pathExists(targetAuth);
  if (targetAuthExists) {
    return;
  }

  const userCodexHome = path.join(os.homedir(), '.codex');
  await copyIfMissing(path.join(userCodexHome, 'auth.json'), targetAuth);
  await copyIfMissing(path.join(userCodexHome, 'config.toml'), path.join(codexHome, 'config.toml'));
  await copyIfMissing(path.join(userCodexHome, 'models_cache.json'), path.join(codexHome, 'models_cache.json'));
}

async function ensureCodexHome(cwd: string): Promise<{ codexHome: string; configPath: string }> {
  const codexHome = getCodexHome(cwd);
  await migrateLegacyCodexHome(cwd, codexHome);
  const configPath = getCodexConfigPath(codexHome);
  await fs.mkdir(codexHome, { recursive: true });
  await importFromUserCodexHomeIfNeeded(codexHome);
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

async function runSingleCodexCommand(
  command: string,
  args: string[],
  cwd: string,
  codexHome: string,
  usePipeStdin: boolean
): Promise<CodexCommandResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      windowsHide: true,
      stdio: [usePipeStdin ? 'pipe' : 'ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        CODEX_HOME: codexHome
      }
    });

    let stdout = '';
    let stderr = '';

    child.stdout?.on('data', (chunk: Buffer | string) => {
      stdout += chunk.toString();
    });
    child.stderr?.on('data', (chunk: Buffer | string) => {
      stderr += chunk.toString();
    });
    child.once('error', (error) => reject(error));
    child.once('close', (code) => resolve({ stdout, stderr, exitCode: code ?? 1 }));

    if (usePipeStdin) {
      child.stdin?.end();
    }
  });
}

function addCandidate(candidates: Set<string>, value: string | undefined): void {
  const trimmed = value?.trim();
  if (trimmed) {
    candidates.add(trimmed);
  }
}

async function getWindowsVscodeCodexCandidates(): Promise<string[]> {
  const roots = [path.join(os.homedir(), '.vscode', 'extensions'), path.join(os.homedir(), '.vscode-insiders', 'extensions')];
  const matches: string[] = [];

  for (const root of roots) {
    const entries = await fs.readdir(root, { withFileTypes: true }).catch(() => []);
    const versions = entries
      .filter((entry) => entry.isDirectory() && /^openai\.chatgpt-.*-win32/i.test(entry.name))
      .map((entry) => entry.name)
      .sort((a, b) => b.localeCompare(a, 'en', { numeric: true, sensitivity: 'base' }));

    for (const versionDir of versions) {
      const archCandidates = ['windows-x86_64', 'windows-arm64'];
      for (const arch of archCandidates) {
        const candidate = path.join(root, versionDir, 'bin', arch, 'codex.exe');
        if (await pathExists(candidate)) {
          matches.push(candidate);
        }
      }
    }
  }

  return matches;
}

async function getLinuxVscodeCodexCandidates(): Promise<string[]> {
  const roots = [path.join(os.homedir(), '.vscode', 'extensions'), path.join(os.homedir(), '.vscode-server', 'extensions')];
  const matches: string[] = [];

  for (const root of roots) {
    const entries = await fs.readdir(root, { withFileTypes: true }).catch(() => []);
    const versions = entries
      .filter((entry) => entry.isDirectory() && /^openai\.chatgpt-.*-linux/i.test(entry.name))
      .map((entry) => entry.name)
      .sort((a, b) => b.localeCompare(a, 'en', { numeric: true, sensitivity: 'base' }));

    for (const versionDir of versions) {
      const archCandidates = ['linux-x86_64', 'linux-arm64'];
      for (const arch of archCandidates) {
        const candidate = path.join(root, versionDir, 'bin', arch, 'codex');
        if (await pathExists(candidate)) {
          matches.push(candidate);
        }
      }
    }
  }

  return matches;
}

async function getDarwinVscodeCodexCandidates(): Promise<string[]> {
  const roots = [path.join(os.homedir(), '.vscode', 'extensions'), path.join(os.homedir(), '.vscode-insiders', 'extensions')];
  const matches: string[] = [];

  for (const root of roots) {
    const entries = await fs.readdir(root, { withFileTypes: true }).catch(() => []);
    const versions = entries
      .filter((entry) => entry.isDirectory() && /^openai\.chatgpt-.*-darwin/i.test(entry.name))
      .map((entry) => entry.name)
      .sort((a, b) => b.localeCompare(a, 'en', { numeric: true, sensitivity: 'base' }));

    for (const versionDir of versions) {
      const archCandidates = ['darwin-arm64', 'darwin-x64'];
      for (const arch of archCandidates) {
        const candidate = path.join(root, versionDir, 'bin', arch, 'codex');
        if (await pathExists(candidate)) {
          matches.push(candidate);
        }
      }
    }
  }

  return matches;
}

async function getNvmCodexCandidates(): Promise<string[]> {
  const root = path.join(os.homedir(), '.nvm', 'versions', 'node');
  const entries = await fs.readdir(root, { withFileTypes: true }).catch(() => []);
  const versions = entries
    .filter((entry) => entry.isDirectory() && /^v\d+/i.test(entry.name))
    .map((entry) => entry.name)
    .sort((a, b) => b.localeCompare(a, 'en', { numeric: true, sensitivity: 'base' }));

  const matches: string[] = [];
  for (const versionDir of versions) {
    const candidate = path.join(root, versionDir, 'bin', 'codex');
    if (await pathExists(candidate)) {
      matches.push(candidate);
    }
  }
  return matches;
}

async function getCodexCommandCandidates(preferredCommand: string): Promise<string[]> {
  const candidates = new Set<string>();

  addCandidate(candidates, preferredCommand);
  addCandidate(candidates, 'codex');

  if (process.platform === 'win32') {
    addCandidate(candidates, process.env.CODEX_BINARY_PATH);
    addCandidate(candidates, path.join(process.env.APPDATA ?? '', 'npm', 'codex.cmd'));
    addCandidate(candidates, path.join(process.env.APPDATA ?? '', 'npm', 'codex'));
    addCandidate(candidates, path.join(process.env.LOCALAPPDATA ?? '', 'Programs', 'nodejs', 'codex.cmd'));

    const vscodeCandidates = await getWindowsVscodeCodexCandidates();
    for (const candidate of vscodeCandidates) {
      addCandidate(candidates, candidate);
    }
  } else {
    const nvmCandidates = await getNvmCodexCandidates();
    for (const candidate of nvmCandidates) {
      addCandidate(candidates, candidate);
    }

    if (process.platform === 'darwin') {
      const vscodeCandidates = await getDarwinVscodeCodexCandidates();
      for (const candidate of vscodeCandidates) {
        addCandidate(candidates, candidate);
      }
    } else {
      const vscodeCandidates = await getLinuxVscodeCodexCandidates();
      for (const candidate of vscodeCandidates) {
        addCandidate(candidates, candidate);
      }
    }

    addCandidate(candidates, path.join(os.homedir(), '.local', 'bin', 'codex'));
    addCandidate(candidates, path.join(os.homedir(), '.npm-global', 'bin', 'codex'));
    addCandidate(candidates, '/usr/local/bin/codex');
    addCandidate(candidates, '/opt/homebrew/bin/codex');
    addCandidate(candidates, '/usr/bin/codex');
  }

  return [...candidates];
}

async function persistResolvedCodexCommand(codexHome: string, command: string): Promise<void> {
  const settings = await readLocalSettings(codexHome);
  const current = settings.codexBinaryPath?.trim();
  if (current === command) {
    return;
  }
  settings.codexBinaryPath = command;
  await writeLocalSettings(codexHome, settings);
}

async function runCodexCommandResolved(
  options: CodexCommandOptions,
  usePipeStdin: boolean
): Promise<ResolvedCodexCommandResult> {
  const { codexHome, command: preferredCommand } = await resolveCodexBinary(options.cwd);
  const candidates = await getCodexCommandCandidates(preferredCommand);
  let lastError: Error | null = null;

  for (const command of candidates) {
    try {
      const result = await runSingleCodexCommand(command, options.args, options.cwd, codexHome, usePipeStdin);
      if (result.exitCode === -2) {
        continue;
      }
      await persistResolvedCodexCommand(codexHome, command);
      return { command, result };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (/ENOENT/i.test(message)) {
        continue;
      }
      lastError = error instanceof Error ? error : new Error(message);
      break;
    }
  }

  if (lastError) {
    throw lastError;
  }

  throw new Error(`codex 실행파일을 찾을 수 없습니다. 설정에서 경로를 지정하세요. (${preferredCommand})`);
}

async function checkCodexBinary(cwd: string): Promise<{ command: string; detected: boolean; message: string }> {
  const fallback = await resolveCodexBinary(cwd);
  const resolved = await runCodexCommandResolved(
    {
      cwd,
      args: ['--version']
    },
    false
  ).catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    return {
      command: fallback.command,
      result: { stdout: '', stderr: message, exitCode: 1 }
    };
  });

  const { command, result } = resolved;
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
  const resolved = await runCodexCommandResolved(options, true);
  return resolved.result;
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

export async function getCodexChatStore(cwd: string): Promise<CodexChatStore> {
  const { codexHome } = await ensureCodexHome(cwd);
  const store = await readChatStore(codexHome).catch(() => normalizeChatStore(null));
  return writeChatStore(codexHome, store);
}

export async function saveCodexChatStore(cwd: string, store: CodexChatStore): Promise<CodexChatStore> {
  const { codexHome } = await ensureCodexHome(cwd);
  return writeChatStore(codexHome, store);
}
