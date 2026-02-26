import { app, BrowserWindow, ipcMain, shell } from 'electron';
import path from 'node:path';
import { promises as fs } from 'node:fs';

const isDev = Boolean(process.env.ELECTRON_RENDERER_URL);

function createWindow() {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    backgroundColor: '#0f131a',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  if (isDev && process.env.ELECTRON_RENDERER_URL) {
    void win.loadURL(process.env.ELECTRON_RENDERER_URL);
    win.webContents.openDevTools({ mode: 'detach' });
  } else {
    void win.loadFile(path.join(__dirname, '../renderer/index.html'));
  }
}

app.whenReady().then(() => {
  ipcMain.handle('app:getVersion', () => app.getVersion());

  ipcMain.handle('fs:readText', async (_, filePath: string) => {
    return fs.readFile(filePath, 'utf-8');
  });

  ipcMain.handle('shell:openPath', async (_, targetPath: string) => {
    return shell.openPath(targetPath);
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
