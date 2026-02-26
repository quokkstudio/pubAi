export type SolutionType = 'cafe24' | 'godomall' | 'makeshop';

export interface ProjectConfig {
  name: string;
  solutionType: SolutionType;
  adminUrl: string;
  adminId: string;
  adminPassword: string;
  ftpHost: string;
  ftpUser: string;
  ftpPassword: string;
  skinId?: string;
  dueDate: string;
}

export function normalizeProjectName(name: string): string {
  return name.trim().replace(/\s+/g, '-');
}
