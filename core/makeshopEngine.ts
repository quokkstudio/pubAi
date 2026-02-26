import path from 'node:path';
import { promises as fs } from 'node:fs';
import { spawn } from 'node:child_process';

export interface MakeShopAutomationConfig {
  loginIdSelector?: string;
  loginPasswordSelector?: string;
  loginSubmitSelector?: string;
  uploadPageUrl?: string;
  uploadSkinIdSelector?: string;
  uploadFileInputSelector?: string;
  uploadSubmitSelector?: string;
  successTextPattern?: string;
  headless?: boolean;
  keepBrowserOpen?: boolean;
}

export interface MakeShopDeployInput {
  projectPath: string;
  localPath: string;
  adminUrl: string;
  adminId: string;
  adminPassword: string;
  skinId: string;
  automation?: MakeShopAutomationConfig;
  onLog?: (message: string) => Promise<void> | void;
}

export interface MakeShopDeployResult {
  startedAt: string;
  finishedAt: string;
  archivePath: string;
  uploadedFileName: string;
  message: string;
}

interface SelectorOptions {
  timeoutMs: number;
}

type PlaywrightModule = {
  chromium: {
    launch: (options: { headless: boolean }) => Promise<any>;
  };
};

type PlaywrightPage = any;

function getTimestampLabel(date = new Date()): string {
  const iso = date.toISOString().replace(/[:.]/g, '-');
  return iso.slice(0, 19);
}

async function logStep(onLog: MakeShopDeployInput['onLog'], message: string): Promise<void> {
  if (!onLog) {
    return;
  }
  await onLog(`[MakeShop] ${message}`);
}

async function ensureLocalHasFiles(localPath: string): Promise<void> {
  const entries = await fs.readdir(localPath, { withFileTypes: true });
  if (entries.length === 0) {
    throw new Error('local 폴더가 비어 있어 MakeShop 배포를 진행할 수 없습니다.');
  }
}

function runTarCreate(archivePath: string, sourcePath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn('tar', ['-cf', archivePath, '-C', sourcePath, '.'], {
      stdio: ['ignore', 'ignore', 'pipe'],
      windowsHide: true
    });

    let stderr = '';
    child.stderr.on('data', (chunk: Buffer | string) => {
      stderr += chunk.toString();
    });

    child.once('error', (error) => {
      reject(error);
    });

    child.once('close', (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`tar 압축 실패(code=${code}): ${stderr.trim() || 'unknown error'}`));
    });
  });
}

async function createArchive(projectPath: string, localPath: string): Promise<{ archivePath: string; uploadedFileName: string }> {
  const deployDir = path.join(projectPath, '.deploy');
  await fs.mkdir(deployDir, { recursive: true });

  const uploadedFileName = `makeshop-${getTimestampLabel()}.tar`;
  const archivePath = path.join(deployDir, uploadedFileName);

  await runTarCreate(archivePath, localPath);
  return { archivePath, uploadedFileName };
}

async function tryFillBySelectors(
  page: PlaywrightPage,
  selectors: string[],
  value: string,
  options: SelectorOptions
): Promise<boolean> {
  for (const selector of selectors) {
    const locator = page.locator(selector);
    if ((await locator.count()) === 0) {
      continue;
    }
    await locator.first().fill(value, { timeout: options.timeoutMs });
    return true;
  }
  return false;
}

async function tryClickBySelectors(
  page: PlaywrightPage,
  selectors: string[],
  options: SelectorOptions
): Promise<boolean> {
  for (const selector of selectors) {
    const locator = page.locator(selector);
    if ((await locator.count()) === 0) {
      continue;
    }
    await locator.first().click({ timeout: options.timeoutMs });
    return true;
  }
  return false;
}

async function trySetInputFileBySelectors(
  page: PlaywrightPage,
  selectors: string[],
  filePath: string,
  options: SelectorOptions
): Promise<boolean> {
  for (const selector of selectors) {
    const locator = page.locator(selector);
    if ((await locator.count()) === 0) {
      continue;
    }
    await locator.first().setInputFiles(filePath, { timeout: options.timeoutMs });
    return true;
  }
  return false;
}

function loadPlaywright(): PlaywrightModule {
  const required = require('playwright') as PlaywrightModule | undefined;
  if (!required) {
    throw new Error('playwright 모듈을 찾을 수 없습니다. `npm i playwright` 후 다시 시도하세요.');
  }
  return required;
}

async function waitForSuccessText(page: PlaywrightPage, pattern: RegExp, timeoutMs: number): Promise<void> {
  const started = Date.now();
  while (Date.now() - started <= timeoutMs) {
    const bodyText = await page.locator('body').first().innerText().catch(() => '');
    if (bodyText && pattern.test(bodyText)) {
      return;
    }
    await page.waitForTimeout(1000);
  }
  throw new Error(`업로드 완료 문구를 찾지 못했습니다. pattern=${pattern.source}`);
}

export async function deployMakeShopArchive(input: MakeShopDeployInput): Promise<MakeShopDeployResult> {
  const startedAt = new Date().toISOString();
  const adminUrl = input.adminUrl.trim();
  const adminId = input.adminId.trim();
  const adminPassword = input.adminPassword;
  const skinId = input.skinId.trim();

  if (!adminUrl || !adminId || !adminPassword || !skinId) {
    throw new Error('MakeShop 배포에 필요한 관리자 URL/ID/PW/skin_id가 부족합니다.');
  }

  await ensureLocalHasFiles(input.localPath);
  await logStep(input.onLog, `로컬 압축 준비: ${input.localPath}`);
  const { archivePath, uploadedFileName } = await createArchive(input.projectPath, input.localPath);
  await logStep(input.onLog, `압축 완료: ${archivePath}`);

  const playwright = loadPlaywright();
  const browser = await playwright.chromium.launch({ headless: input.automation?.headless ?? true });
  const options: SelectorOptions = { timeoutMs: 12_000 };
  const uploadSuccessPattern = input.automation?.successTextPattern
    ? new RegExp(input.automation.successTextPattern, 'i')
    : /(업로드|저장|적용).*(완료|성공)|완료되었습니다|success/i;

  const loginIdSelectors = [
    input.automation?.loginIdSelector,
    'input[name="id"]',
    'input[name="userid"]',
    '#id',
    '#userid',
    'input[type="text"]'
  ].filter((value): value is string => Boolean(value));

  const loginPasswordSelectors = [
    input.automation?.loginPasswordSelector,
    'input[name="password"]',
    'input[name="passwd"]',
    '#password',
    '#passwd',
    'input[type="password"]'
  ].filter((value): value is string => Boolean(value));

  const loginSubmitSelectors = [
    input.automation?.loginSubmitSelector,
    'button[type="submit"]',
    'input[type="submit"]',
    'button:has-text("로그인")',
    'a:has-text("로그인")'
  ].filter((value): value is string => Boolean(value));

  const uploadFileSelectors = [
    input.automation?.uploadFileInputSelector,
    'input[type="file"]',
    'input[name="file"]',
    'input[name="upload"]'
  ].filter((value): value is string => Boolean(value));

  const uploadSkinIdSelectors = [
    input.automation?.uploadSkinIdSelector,
    'input[name="skin_id"]',
    'input[name="skinId"]',
    '#skin_id',
    '#skinId'
  ].filter((value): value is string => Boolean(value));

  const uploadSubmitSelectors = [
    input.automation?.uploadSubmitSelector,
    'button[type="submit"]',
    'input[type="submit"]',
    'button:has-text("업로드")',
    'button:has-text("저장")',
    'a:has-text("업로드")'
  ].filter((value): value is string => Boolean(value));

  try {
    const context = await browser.newContext();
    const page = await context.newPage();

    await logStep(input.onLog, `관리자 페이지 접속: ${adminUrl}`);
    await page.goto(adminUrl, { waitUntil: 'domcontentloaded' });

    const idFilled = await tryFillBySelectors(page, loginIdSelectors, adminId, options);
    const passwordFilled = await tryFillBySelectors(page, loginPasswordSelectors, adminPassword, options);
    if (!idFilled || !passwordFilled) {
      throw new Error('로그인 입력 필드를 찾지 못했습니다. makeshopAutomation 셀렉터를 확인하세요.');
    }

    const loginSubmitted = await tryClickBySelectors(page, loginSubmitSelectors, options);
    if (!loginSubmitted) {
      throw new Error('로그인 버튼을 찾지 못했습니다. makeshopAutomation 셀렉터를 확인하세요.');
    }

    await page.waitForTimeout(1500);
    await page.waitForURL(/(admin|manager|makeshop)/i, { timeout: 20_000 }).catch(() => undefined);
    await logStep(input.onLog, '로그인 시도 완료');

    if (input.automation?.uploadPageUrl) {
      await page.goto(input.automation.uploadPageUrl, { waitUntil: 'domcontentloaded' });
      await logStep(input.onLog, `업로드 페이지 이동: ${input.automation.uploadPageUrl}`);
    }

    const skinSet = await tryFillBySelectors(page, uploadSkinIdSelectors, skinId, options);
    if (skinSet) {
      await logStep(input.onLog, `skin_id 입력: ${skinId}`);
    }

    const fileSelected = await trySetInputFileBySelectors(page, uploadFileSelectors, archivePath, options);
    if (!fileSelected) {
      throw new Error('업로드 파일 입력 필드를 찾지 못했습니다. makeshopAutomation 셀렉터를 확인하세요.');
    }
    await logStep(input.onLog, `압축 파일 선택: ${uploadedFileName}`);

    const uploadSubmitted = await tryClickBySelectors(page, uploadSubmitSelectors, options);
    if (!uploadSubmitted) {
      throw new Error('업로드 실행 버튼을 찾지 못했습니다. makeshopAutomation 셀렉터를 확인하세요.');
    }
    await logStep(input.onLog, '업로드 요청 전송');

    await waitForSuccessText(page, uploadSuccessPattern, 30_000);

    await logStep(input.onLog, `완료 감지 패턴: ${uploadSuccessPattern.source}`);
    const finishedAt = new Date().toISOString();
    const message = `MakeShop 업로드 완료: skin_id=${skinId}, file=${uploadedFileName}`;
    await logStep(input.onLog, message);

    if (input.automation?.keepBrowserOpen) {
      await logStep(input.onLog, 'keepBrowserOpen=true 설정으로 브라우저를 유지합니다.');
      return { startedAt, finishedAt, archivePath, uploadedFileName, message };
    }

    await browser.close();
    return { startedAt, finishedAt, archivePath, uploadedFileName, message };
  } catch (error) {
    if (!input.automation?.keepBrowserOpen) {
      await browser.close().catch(() => undefined);
    }
    throw error;
  }
}
