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
