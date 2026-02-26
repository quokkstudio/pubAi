import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('devManager', {
  getVersion: (): Promise<string> => ipcRenderer.invoke('app:getVersion'),
  readText: (filePath: string): Promise<string> => ipcRenderer.invoke('fs:readText', filePath),
  openPath: (targetPath: string): Promise<string> => ipcRenderer.invoke('shell:openPath', targetPath)
});
