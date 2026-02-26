import type { MakeShopAutomationConfig, MakeShopDeployResult } from './makeshopEngine';
import { deployMakeShopArchive } from './makeshopEngine';
import type { SolutionType } from './projectManager';

export interface DeployContext {
  solutionType: SolutionType;
  projectPath: string;
  localPath: string;
  adminUrl: string;
  adminId: string;
  adminPassword: string;
  skinId?: string;
  makeshopAutomation?: MakeShopAutomationConfig;
  onLog?: (message: string) => Promise<void> | void;
}

export interface DeployResult {
  mode: 'cafe24-delta' | 'godomall-delta' | 'makeshop-playwright';
  message: string;
  startedAt: string;
  finishedAt: string;
  archivePath?: string;
  uploadedFileName?: string;
}

function toMakeShopDeployResult(result: MakeShopDeployResult): DeployResult {
  return {
    mode: 'makeshop-playwright',
    message: result.message,
    startedAt: result.startedAt,
    finishedAt: result.finishedAt,
    archivePath: result.archivePath,
    uploadedFileName: result.uploadedFileName
  };
}

export async function deployBySolution(context: DeployContext): Promise<DeployResult> {
  if (context.solutionType === 'cafe24') {
    throw new Error('Cafe24 변경분 배포는 STEP 5에서 구현 예정입니다.');
  }

  if (context.solutionType === 'godomall') {
    throw new Error('Godomall 변경분 배포는 STEP 5에서 구현 예정입니다.');
  }

  if (context.solutionType === 'makeshop') {
    if (!context.skinId?.trim()) {
      throw new Error('MakeShop 배포에는 skin_id가 필요합니다.');
    }

    const result = await deployMakeShopArchive({
      projectPath: context.projectPath,
      localPath: context.localPath,
      adminUrl: context.adminUrl,
      adminId: context.adminId,
      adminPassword: context.adminPassword,
      skinId: context.skinId,
      automation: context.makeshopAutomation,
      onLog: context.onLog
    });

    return toMakeShopDeployResult(result);
  }

  throw new Error(`지원하지 않는 솔루션 타입: ${context.solutionType}`);
}
