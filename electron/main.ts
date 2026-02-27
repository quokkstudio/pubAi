import { app, BrowserWindow, ipcMain, shell } from 'electron';
import path from 'node:path';
import { existsSync, promises as fs } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import {
  getCodexState,
  getCodexChatStore,
  startCodexLoginWithChatGPT,
  logoutCodex,
  runCodex,
  saveCodexChatStore,
  setCodexBinaryPath,
  setMcpPresetEnabled,
  type CodexChatStore,
  type CodexMcpPreset
} from '../core/codexEngine';
import {
  autoUploadSavedFile,
  createProject,
  getProjectDetail,
  listProjects,
  recordProjectAction,
  runDeploy,
  runInitialSync,
  saveProjectDocs,
  type ProjectAction,
  type ProjectCreateInput
} from '../core/projectManager';

const isDev = Boolean(process.env.ELECTRON_RENDERER_URL);
const workspaceWindows = new Map<string, BrowserWindow>();

app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-gpu');
app.commandLine.appendSwitch('disable-gpu-compositing');
app.commandLine.appendSwitch('disable-gpu-sandbox');
app.commandLine.appendSwitch('no-sandbox');
app.commandLine.appendSwitch('disable-setuid-sandbox');
app.commandLine.appendSwitch('disable-dev-shm-usage');
app.commandLine.appendSwitch('use-gl', 'swiftshader');
app.commandLine.appendSwitch('enable-logging');

function getProjectsRoot(): string {
  return path.join(process.cwd(), 'projects');
}

function toWindowsPathIfNeeded(inputPath: string): string {
  if (process.platform !== 'win32') {
    return inputPath;
  }

  const normalized = inputPath.replace(/\\/g, '/');
  const mntMatch = normalized.match(/^\/mnt\/([a-zA-Z])\/(.*)$/);
  if (!mntMatch) {
    return path.win32.normalize(inputPath);
  }

  const drive = mntMatch[1].toUpperCase();
  const rest = mntMatch[2].replace(/\//g, '\\');
  return `${drive}:\\${rest}`;
}

async function tryLaunchVSCodeCLI(resolvedPath: string): Promise<boolean> {
  try {
    if (process.platform === 'win32') {
      const whereCode = spawnSync('cmd.exe', ['/d', '/s', '/c', 'where code.cmd'], {
        stdio: ['ignore', 'pipe', 'ignore'],
        encoding: 'utf8',
        windowsHide: true
      });

      const codeBin = whereCode.status === 0 ? whereCode.stdout.split(/\r?\n/).find((line) => line.trim()) : '';
      if (codeBin) {
        const child = spawn(codeBin.trim(), ['-n', resolvedPath], {
          detached: true,
          stdio: 'ignore',
          windowsHide: true
        });
        child.unref();
        return true;
      }

      const candidates = [
        path.join(process.env.LOCALAPPDATA ?? '', 'Programs', 'Microsoft VS Code', 'Code.exe'),
        path.join(process.env['ProgramFiles'] ?? '', 'Microsoft VS Code', 'Code.exe'),
        path.join(process.env['ProgramFiles(x86)'] ?? '', 'Microsoft VS Code', 'Code.exe')
      ].filter(Boolean);

      for (const candidate of candidates) {
        if (!existsSync(candidate)) {
          continue;
        }

        const child = spawn(candidate, ['-n', resolvedPath], {
          detached: true,
          stdio: 'ignore',
          windowsHide: true
        });
        child.unref();
        return true;
      }

      return false;
    }

    const child = spawn('code', ['-n', resolvedPath], {
      detached: true,
      stdio: 'ignore'
    });
    child.unref();
    return true;
  } catch {
    return false;
  }
}

async function openInVSCode(targetPath: string): Promise<string> {
  const resolvedPath = toWindowsPathIfNeeded(path.resolve(targetPath));
  const uriPath = resolvedPath.replace(/\\/g, '/');
  const vscodeUri = encodeURI(`vscode://file/${uriPath}`);

  const launched = await tryLaunchVSCodeCLI(resolvedPath);
  if (launched) {
    return '';
  }

  try {
    await shell.openExternal(vscodeUri);
    return '';
  } catch {
    const fallback = await shell.openPath(resolvedPath);
    return fallback || 'VSCode 실행 실패, 폴더 열기로 대체했습니다.';
  }
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    show: false,
    backgroundColor: '#0f131a',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  win.once('ready-to-show', () => {
    win.show();
    win.focus();
  });

  if (isDev && process.env.ELECTRON_RENDERER_URL) {
    void win.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    void win.loadFile(path.join(__dirname, '../renderer/index.html'));
  }
}

function buildWorkspaceHash(projectKey: string): string {
  return `/workspace?projectKey=${encodeURIComponent(projectKey)}`;
}

function createWorkspaceWindow(projectKey: string): BrowserWindow {
  const existing = workspaceWindows.get(projectKey);
  if (existing && !existing.isDestroyed()) {
    existing.show();
    existing.focus();
    return existing;
  }

  const win = new BrowserWindow({
    width: 1680,
    height: 980,
    minWidth: 1180,
    minHeight: 760,
    show: false,
    backgroundColor: '#0c1118',
    title: `Workspace - ${projectKey}`,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  win.once('ready-to-show', () => {
    win.show();
    win.focus();
  });

  if (isDev && process.env.ELECTRON_RENDERER_URL) {
    const target = `${process.env.ELECTRON_RENDERER_URL}#${buildWorkspaceHash(projectKey)}`;
    void win.loadURL(target);
  } else {
    void win.loadFile(path.join(__dirname, '../renderer/index.html'), {
      hash: buildWorkspaceHash(projectKey)
    });
  }

  win.on('closed', () => {
    workspaceWindows.delete(projectKey);
  });

  workspaceWindows.set(projectKey, win);
  return win;
}

function toPosixRelativePath(basePath: string, targetPath: string): string {
  return path.relative(basePath, targetPath).replace(/\\/g, '/');
}

function assertWithinBase(basePath: string, targetPath: string): void {
  const resolvedBase = path.resolve(basePath);
  const resolvedTarget = path.resolve(targetPath);
  const relative = path.relative(resolvedBase, resolvedTarget);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('허용되지 않은 경로 접근입니다.');
  }
}

function resolveLocalTarget(localPath: string, relativePath = ''): string {
  const normalized = relativePath.replace(/\\/g, '/').replace(/^\/+/, '');
  const absolute = path.resolve(localPath, normalized);
  assertWithinBase(localPath, absolute);
  return absolute;
}

async function listWorkspaceEntries(localPath: string, relativePath = ''): Promise<
  Array<{ name: string; relativePath: string; isDirectory: boolean }>
> {
  const targetPath = resolveLocalTarget(localPath, relativePath);
  const entries = await fs.readdir(targetPath, { withFileTypes: true });

  return entries
    .filter((entry) => !entry.name.startsWith('.'))
    .sort((a, b) => {
      if (a.isDirectory() && !b.isDirectory()) {
        return -1;
      }
      if (!a.isDirectory() && b.isDirectory()) {
        return 1;
      }
      return a.name.localeCompare(b.name);
    })
    .map((entry) => {
      const fullPath = path.join(targetPath, entry.name);
      return {
        name: entry.name,
        relativePath: toPosixRelativePath(localPath, fullPath),
        isDirectory: entry.isDirectory()
      };
    });
}

app.whenReady().then(() => {
  const projectsRoot = getProjectsRoot();

  ipcMain.handle('app:getVersion', () => app.getVersion());

  ipcMain.handle('fs:readText', async (_, filePath: string) => {
    return fs.readFile(filePath, 'utf-8');
  });

  ipcMain.handle('shell:openPath', async (_, targetPath: string) => {
    return shell.openPath(targetPath);
  });

  ipcMain.handle('shell:openInVSCode', async (_, targetPath: string) => {
    return openInVSCode(targetPath);
  });

  ipcMain.handle('projects:list', async () => {
    return listProjects(projectsRoot);
  });

  ipcMain.handle('projects:create', async (_, payload: ProjectCreateInput) => {
    return createProject(projectsRoot, payload);
  });

  ipcMain.handle('projects:getDetail', async (_, projectKey: string) => {
    return getProjectDetail(projectsRoot, projectKey);
  });

  ipcMain.handle(
    'projects:saveDocs',
    async (_, payload: { projectKey: string; projectInfo: string; workflow: string }) => {
      return saveProjectDocs(projectsRoot, payload.projectKey, {
        projectInfo: payload.projectInfo,
        workflow: payload.workflow
      });
    }
  );

  ipcMain.handle('projects:recordAction', async (_, payload: { projectKey: string; action: ProjectAction }) => {
    return recordProjectAction(projectsRoot, payload.projectKey, payload.action);
  });

  ipcMain.handle('projects:initialSync', async (_, payload: { projectKey: string }) => {
    return runInitialSync(projectsRoot, payload.projectKey);
  });

  ipcMain.handle('projects:deploy', async (_, payload: { projectKey: string }) => {
    return runDeploy(projectsRoot, payload.projectKey);
  });

  ipcMain.handle('workspace:openWindow', async (_, payload: { projectKey: string }) => {
    createWorkspaceWindow(payload.projectKey);
    return true;
  });

  ipcMain.handle('workspace:listEntries', async (_, payload: { projectKey: string; relativePath?: string }) => {
    const detail = await getProjectDetail(projectsRoot, payload.projectKey);
    return listWorkspaceEntries(detail.summary.localPath, payload.relativePath ?? '');
  });

  ipcMain.handle('workspace:readFile', async (_, payload: { projectKey: string; relativePath: string }) => {
    const detail = await getProjectDetail(projectsRoot, payload.projectKey);
    const fullPath = resolveLocalTarget(detail.summary.localPath, payload.relativePath);
    const content = await fs.readFile(fullPath, 'utf-8');
    return {
      relativePath: toPosixRelativePath(detail.summary.localPath, fullPath),
      content
    };
  });

  ipcMain.handle(
    'workspace:writeFile',
    async (_, payload: { projectKey: string; relativePath: string; content: string }) => {
      const detail = await getProjectDetail(projectsRoot, payload.projectKey);
      const fullPath = resolveLocalTarget(detail.summary.localPath, payload.relativePath);
      await fs.writeFile(fullPath, payload.content, 'utf-8');
      const savedRelativePath = toPosixRelativePath(detail.summary.localPath, fullPath);
      const autoUpload = await autoUploadSavedFile(projectsRoot, payload.projectKey, savedRelativePath);
      return {
        relativePath: savedRelativePath,
        savedAt: new Date().toISOString(),
        autoUpload
      };
    }
  );

  ipcMain.handle(
    'codex:run',
    async (
      _,
      payload: {
        projectKey: string;
        prompt: string;
        model?: string;
        reasoningLevel?: 'none' | 'low' | 'medium' | 'high';
        sandboxMode?: 'read-only' | 'workspace-write' | 'danger-full-access';
        attachments?: string[];
      }
    ) => {
      const detail = await getProjectDetail(projectsRoot, payload.projectKey);
      return runCodex({
        cwd: detail.summary.localPath,
        prompt: payload.prompt,
        model: payload.model,
        reasoningLevel: payload.reasoningLevel,
        sandboxMode: payload.sandboxMode,
        attachments: payload.attachments
      });
    }
  );

  ipcMain.handle('codex:getState', async (_, payload: { projectKey: string }) => {
    const detail = await getProjectDetail(projectsRoot, payload.projectKey);
    return getCodexState(detail.summary.localPath);
  });

  ipcMain.handle('codex:getChatStore', async (_, payload: { projectKey: string }) => {
    const detail = await getProjectDetail(projectsRoot, payload.projectKey);
    return getCodexChatStore(detail.summary.localPath);
  });

  ipcMain.handle('codex:saveChatStore', async (_, payload: { projectKey: string; store: CodexChatStore }) => {
    const detail = await getProjectDetail(projectsRoot, payload.projectKey);
    return saveCodexChatStore(detail.summary.localPath, payload.store);
  });

  ipcMain.handle('codex:startLoginChatGPT', async (_, payload: { projectKey: string }) => {
    const detail = await getProjectDetail(projectsRoot, payload.projectKey);
    return startCodexLoginWithChatGPT(detail.summary.localPath);
  });

  ipcMain.handle('codex:logout', async (_, payload: { projectKey: string }) => {
    const detail = await getProjectDetail(projectsRoot, payload.projectKey);
    return logoutCodex(detail.summary.localPath);
  });

  ipcMain.handle('codex:setBinaryPath', async (_, payload: { projectKey: string; binaryPath: string }) => {
    const detail = await getProjectDetail(projectsRoot, payload.projectKey);
    return setCodexBinaryPath(detail.summary.localPath, payload.binaryPath);
  });

  ipcMain.handle(
    'codex:setMcpPreset',
    async (_, payload: { projectKey: string; preset: CodexMcpPreset; enabled: boolean }) => {
      const detail = await getProjectDetail(projectsRoot, payload.projectKey);
      return setMcpPresetEnabled(detail.summary.localPath, payload.preset, payload.enabled);
    }
  );

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
