export function createLogLine(message: string): string {
  const timestamp = new Date().toISOString();
  return `[${timestamp}] ${message}`;
}
