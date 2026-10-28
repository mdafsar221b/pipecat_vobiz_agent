import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Detect python executable (.venv if present, otherwise system python)
function getPythonExecutable() {
  const winVenv = path.join(__dirname, '.venv', 'Scripts', 'python.exe');
  const posixVenv = path.join(__dirname, '.venv', 'bin', 'python');

  if (process.platform === 'win32' && fs.existsSync(winVenv)) {
    return winVenv;
  }
  if (process.platform !== 'win32' && fs.existsSync(posixVenv)) {
    return posixVenv;
  }
  return process.platform === 'win32' ? 'python' : 'python3';
}

const pythonExe = getPythonExecutable();
console.log('='.repeat(60));
console.log('  Starting Pipecat Vobiz Voice AI Suite');
console.log(`  Backend Python:  ${pythonExe}`);
console.log('  Backend Server:  http://127.0.0.1:8000');
console.log('  Frontend Vite:   http://localhost:3000');
console.log('='.repeat(60));

// Spawn Python backend server without cmd shell to avoid space splitting
const backend = spawn(pythonExe, ['server.py'], {
  cwd: __dirname,
  stdio: 'inherit',
  shell: false,
});

// Spawn Vite frontend dev server
const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const frontend = spawn(npmCmd, ['run', 'dev'], {
  cwd: path.join(__dirname, 'frontend'),
  stdio: 'inherit',
  shell: process.platform === 'win32',
});

function shutdown() {
  console.log('\nShutting down backend and frontend servers...');
  try {
    if (process.platform === 'win32') {
      if (backend.pid) spawn('taskkill', ['/pid', backend.pid.toString(), '/f', '/t'], { shell: true });
      if (frontend.pid) spawn('taskkill', ['/pid', frontend.pid.toString(), '/f', '/t'], { shell: true });
    } else {
      backend.kill('SIGTERM');
      frontend.kill('SIGTERM');
    }
  } catch {
    // Process cleanup completed
  }
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

backend.on('exit', (code) => {
  if (code !== 0 && code !== null) {
    console.error(`Backend exited with code ${code}`);
    shutdown();
  }
});

frontend.on('exit', (code) => {
  if (code !== 0 && code !== null) {
    console.error(`Frontend exited with code ${code}`);
    shutdown();
  }
});
