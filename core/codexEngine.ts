export interface CodexRunOptions {
  cwd: string;
  prompt: string;
}

export async function runCodex(_options: CodexRunOptions): Promise<void> {
  throw new Error('STEP 3에서 Codex CLI 연동 구현 예정');
}
