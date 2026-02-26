/// <reference types="vite/client" />
import type { ProjectAction, ProjectCreateInput, ProjectDetail, ProjectSummary } from './types';

interface DevManagerApi {
  getVersion: () => Promise<string>;
  readText: (filePath: string) => Promise<string>;
  openPath: (targetPath: string) => Promise<string>;
  listProjects: () => Promise<ProjectSummary[]>;
  createProject: (payload: ProjectCreateInput) => Promise<ProjectSummary>;
  getProjectDetail: (projectKey: string) => Promise<ProjectDetail>;
  saveProjectDocs: (payload: { projectKey: string; projectInfo: string; workflow: string }) => Promise<ProjectDetail>;
  recordProjectAction: (payload: { projectKey: string; action: ProjectAction }) => Promise<ProjectSummary>;
}

declare global {
  interface Window {
    devManager: DevManagerApi;
  }
}

export {};
