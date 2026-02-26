export interface FtpCredential {
  host: string;
  user: string;
  password: string;
}

export async function downloadInitialSkin(): Promise<void> {
  throw new Error('STEP 3에서 FTP 초기 동기화 구현 예정');
}
