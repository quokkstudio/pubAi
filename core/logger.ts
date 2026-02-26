import path from 'node:path';
import { promises as fs } from 'node:fs';

export function createLogLine(message: string): string {
  const timestamp = new Date().toISOString();
  return `[${timestamp}] ${message}`;
}

function getLogFileName(date = new Date()): string {
  return `${date.toISOString().slice(0, 10)}.log`;
}

export async function appendProjectLog(projectRoot: string, message: string): Promise<void> {
  const logsDir = path.join(projectRoot, 'logs');
  await fs.mkdir(logsDir, { recursive: true });
  const logFilePath = path.join(logsDir, getLogFileName());
  await fs.appendFile(logFilePath, `${createLogLine(message)}\n`, 'utf-8');
}
