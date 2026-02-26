import { app, BrowserWindow, ipcMain, shell } from 'electron';
import path from 'node:path';
import { existsSync, promises as fs } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import {
  createProject,
  getProjectDetail,
  listProjects,
  recordProjectAction,
  runInitialSync,
  saveProjectDocs,
  type ProjectAction,
  type ProjectCreateInput
} from '../core/projectManager';

const isDev = Boolean(process.env.ELECTRON_RENDERER_URL);

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
