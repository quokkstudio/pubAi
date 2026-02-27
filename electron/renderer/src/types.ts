export type SolutionType = 'cafe24' | 'godomall' | 'makeshop';

export type ProjectAction = 'run' | 'deploy' | 'sync' | 'save-docs';

export interface ProjectSecret {
  value: string;
  encrypted: boolean;
  algorithm?: string;
}

export interface ProjectCreateInput {
  name: string;
  solutionType: SolutionType;
  adminUrl: string;
  adminId: string;
  adminPassword: string;
  ftpHost: string;
  ftpPort?: number;
  ftpUser: string;
  ftpPassword: string;
  ftpRemotePath?: string;
  skinId?: string;
  dueDate: string;
}

export interface StoredProjectConfig {
  projectKey: string;
  name: string;
  solutionType: SolutionType;
  adminUrl: string;
  adminId: string;
  adminPassword: ProjectSecret;
  ftpHost: string;
  ftpPort?: number;
  ftpUser: string;
  ftpPassword: ProjectSecret;
  ftpRemotePath?: string;
  skinId?: string;
  dueDate: string;
  createdAt: string;
  updatedAt: string;
  lastWorkedAt: string;
}

export interface ProjectSummary {
  projectKey: string;
  name: string;
  solutionType: SolutionType;
  dueDate: string;
  lastWorkedAt: string;
  projectPath: string;
  localPath: string;
}

export interface ProjectDetail {
  summary: ProjectSummary;
  config: StoredProjectConfig;
  projectInfo: string;
  workflow: string;
  localFiles: string[];
  recentLogs: string[];
}

export interface InitialSyncResult {
  projectKey: string;
  solutionType: SolutionType;
  mode: 'ftp' | 'manual';
  message: string;
  remotePath?: string;
  localPath: string;
  fileCount?: number;
  syncedAt: string;
}

export interface ProjectDeployResult {
  projectKey: string;
  solutionType: SolutionType;
  mode: 'cafe24-delta' | 'godomall-delta' | 'makeshop-playwright';
  message: string;
  startedAt: string;
  finishedAt: string;
  archivePath?: string;
  uploadedFileName?: string;
}

export interface WorkspaceEntry {
  name: string;
  relativePath: string;
  isDirectory: boolean;
}

export interface WorkspaceFileReadResult {
  relativePath: string;
  content: string;
}

export interface WorkspaceFileWriteResult {
  relativePath: string;
  savedAt: string;
}

export type CodexSandboxMode = 'read-only' | 'workspace-write' | 'danger-full-access';

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
