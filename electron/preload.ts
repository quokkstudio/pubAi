import { contextBridge, ipcRenderer } from 'electron';
import type { ProjectAction, ProjectCreateInput } from '../core/projectManager';

contextBridge.exposeInMainWorld('devManager', {
  getVersion: (): Promise<string> => ipcRenderer.invoke('app:getVersion'),
  readText: (filePath: string): Promise<string> => ipcRenderer.invoke('fs:readText', filePath),
  openPath: (targetPath: string): Promise<string> => ipcRenderer.invoke('shell:openPath', targetPath),
  openInVSCode: (targetPath: string): Promise<string> => ipcRenderer.invoke('shell:openInVSCode', targetPath),
  listProjects: (): Promise<unknown> => ipcRenderer.invoke('projects:list'),
  createProject: (payload: ProjectCreateInput): Promise<unknown> => ipcRenderer.invoke('projects:create', payload),
  getProjectDetail: (projectKey: string): Promise<unknown> => ipcRenderer.invoke('projects:getDetail', projectKey),
  saveProjectDocs: (payload: { projectKey: string; projectInfo: string; workflow: string }): Promise<unknown> =>
    ipcRenderer.invoke('projects:saveDocs', payload),
  recordProjectAction: (payload: { projectKey: string; action: ProjectAction }): Promise<unknown> =>
    ipcRenderer.invoke('projects:recordAction', payload),
  runInitialSync: (payload: { projectKey: string }): Promise<unknown> => ipcRenderer.invoke('projects:initialSync', payload),
  runDeploy: (payload: { projectKey: string }): Promise<unknown> => ipcRenderer.invoke('projects:deploy', payload)
});
