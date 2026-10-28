"""
run.py — Concurrently run both Backend (port 8000) and Frontend (port 3000)
"""

import os
import subprocess
import sys
import time
from pathlib import Path

BASE_DIR = Path(__file__).parent


def get_python_exe() -> str:
    # Use current venv python if available, otherwise current sys.executable
    venv_python = BASE_DIR / ".venv" / "Scripts" / "python.exe"
    if os.name == "nt" and venv_python.exists():
        return str(venv_python)
    posix_venv = BASE_DIR / ".venv" / "bin" / "python"
    if posix_venv.exists():
        return str(posix_venv)
    return sys.executable


def main():
    python_exe = get_python_exe()
    npm_cmd = "npm.cmd" if os.name == "nt" else "npm"

    print("=" * 60)
    print("  Starting Pipecat Vobiz Voice AI Suite")
    print(f"  Backend:  http://127.0.0.1:8000 ({python_exe})")
    print("  Frontend: http://localhost:3000 (Vite Dev Server)")
    print("=" * 60)

    backend_proc = subprocess.Popen([python_exe, "server.py"], cwd=BASE_DIR)
    time.sleep(1.0)
    frontend_proc = subprocess.Popen([npm_cmd, "run", "dev"], cwd=BASE_DIR / "frontend")

    try:
        while True:
            time.sleep(1)
            if backend_proc.poll() is not None or frontend_proc.poll() is not None:
                break
    except KeyboardInterrupt:
        print("\nShutting down both servers...")
    finally:
        for proc in (backend_proc, frontend_proc):
            if proc.poll() is None:
                proc.terminate()
                try:
                    proc.wait(timeout=3)
                except subprocess.TimeoutExpired:
                    proc.kill()


if __name__ == "__main__":
    main()
