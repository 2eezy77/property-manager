/**
 * Start API with LAN access (0.0.0.0 + private-network CORS).
 * Usage: npm run dev:lan
 */
process.env.DEV_LAN = '1';
process.env.HOST = process.env.HOST || '0.0.0.0';

const { spawn } = require('child_process');
const path = require('path');

const nodemonBin = path.join(__dirname, '..', 'node_modules', 'nodemon', 'bin', 'nodemon.js');
const child = spawn(process.execPath, [nodemonBin, 'src/app.js'], {
  stdio: 'inherit',
  env: process.env,
  cwd: path.join(__dirname, '..'),
});

child.on('exit', (code) => process.exit(code ?? 0));
