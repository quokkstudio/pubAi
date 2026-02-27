/// <reference types="vite/client" />
import type {
  CodexChatStore,
  CodexState,
  CodexRunResult,
  InitialSyncResult,
  ProjectAction,
  ProjectCreateInput,
  ProjectDeployResult,
  ProjectRestoreResult,
  ProjectDetail,
  ProjectSummary,
  WorkspaceEntry,
  WorkspaceFileReadResult,
  WorkspaceFileWriteResult
} from './types';

interface DevManagerApi {
  getVersion: () => Promise<string>;
  readText: (filePath: string) => Promise<string>;
  openPath: (targetPath: string) => Promise<string>;
  openInVSCode: (targetPath: string) => Promise<string>;
  listProjects: () => Promise<ProjectSummary[]>;
  createProject: (payload: ProjectCreateInput) => Promise<ProjectSummary>;
  getProjectDetail: (projectKey: string) => Promise<ProjectDetail>;
  saveProjectDocs: (payload: { projectKey: string; projectInfo: string; workflow: string }) => Promise<ProjectDetail>;
  recordProjectAction: (payload: { projectKey: string; action: ProjectAction }) => Promise<ProjectSummary>;
  runInitialSync: (payload: { projectKey: string }) => Promise<InitialSyncResult>;
  runDeploy: (payload: { projectKey: string }) => Promise<ProjectDeployResult>;
  runRestoreInitial: (payload: { projectKey: string }) => Promise<ProjectRestoreResult>;
  openWorkspaceWindow: (payload: { projectKey: string }) => Promise<boolean>;
  workspaceListEntries: (payload: { projectKey: string; relativePath?: string }) => Promise<WorkspaceEntry[]>;
  workspaceReadFile: (payload: { projectKey: string; relativePath: string }) => Promise<WorkspaceFileReadResult>;
  workspaceWriteFile: (payload: { projectKey: string; relativePath: string; content: string }) => Promise<WorkspaceFileWriteResult>;
  runCodex: (payload: {
    projectKey: string;
    prompt: string;
    model?: string;
    reasoningLevel?: 'none' | 'low' | 'medium' | 'high';
    sandboxMode?: 'read-only' | 'workspace-write' | 'danger-full-access';
    attachments?: string[];
  }) => Promise<CodexRunResult>;
  getCodexState: (payload: { projectKey: string }) => Promise<CodexState>;
  getCodexChatStore: (payload: { projectKey: string }) => Promise<CodexChatStore>;
  saveCodexChatStore: (payload: { projectKey: string; store: CodexChatStore }) => Promise<CodexChatStore>;
  startCodexLoginChatGPT: (payload: { projectKey: string }) => Promise<{ started: boolean; message: string }>;
  logoutCodex: (payload: { projectKey: string }) => Promise<CodexState>;
  setCodexBinaryPath: (payload: { projectKey: string; binaryPath: string }) => Promise<CodexState>;
  setCodexMcpPreset: (payload: {
    projectKey: string;
    preset: 'playwright' | 'chrome-devtools';
    enabled: boolean;
  }) => Promise<CodexState>;
}

declare global {
  interface Window {
    devManager: DevManagerApi;
  }
}

export {};
