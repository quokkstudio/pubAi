/// <reference types="vite/client" />

interface DevManagerApi {
  getVersion: () => Promise<string>;
  readText: (filePath: string) => Promise<string>;
  openPath: (targetPath: string) => Promise<string>;
}

declare global {
  interface Window {
    devManager: DevManagerApi;
  }
}

export {};
