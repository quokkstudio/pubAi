#!/usr/bin/env node
const { spawn } = require('node:child_process');
const path = require('node:path');

const electronBinary = require('electron');
const entry = process.argv[2] || './dist/electron/main.js';
const args = [path.resolve(entry), ...process.argv.slice(3)];

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;

const child = spawn(electronBinary, args, {
  stdio: 'inherit',
  env
});

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 0);
});
