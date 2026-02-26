import type { SolutionType } from './projectManager';

export async function deployBySolution(solutionType: SolutionType): Promise<void> {
  if (solutionType === 'cafe24' || solutionType === 'godomall') {
    return;
  }

  if (solutionType === 'makeshop') {
    return;
  }

  throw new Error(`지원하지 않는 솔루션 타입: ${solutionType}`);
}
