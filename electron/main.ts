import { app, BrowserWindow, ipcMain, shell } from 'electron';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import {
  createProject,
  getProjectDetail,
  listProjects,
  recordProjectAction,
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
app.commandLine.appendSwitch('use-gl', 'swiftshader');
app.commandLine.appendSwitch('enable-logging');

function getProjectsRoot(): string {
  return path.join(process.cwd(), 'projects');
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
