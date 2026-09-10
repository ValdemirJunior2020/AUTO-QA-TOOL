@echo off
setlocal
cd /d "%~dp0"
echo ============================================================
echo QA CONTROL CENTER - LOCAL AUTO QA INSTALLER
echo ============================================================
where node >nul 2>&1 || (echo [ERROR] Node.js is required.& pause & exit /b 1)
where ffmpeg >nul 2>&1 || (echo [ERROR] FFmpeg is required in PATH.& pause & exit /b 1)
where ollama >nul 2>&1 || (echo [ERROR] Ollama is required.& pause & exit /b 1)

set PY_CMD=
py -3.12 -c "import sys" >nul 2>&1 && set PY_CMD=py -3.12
if not defined PY_CMD py -3.11 -c "import sys" >nul 2>&1 && set PY_CMD=py -3.11
if not defined PY_CMD (
  echo [ERROR] Python 3.11 or 3.12 is required for the local transcription environment.
  echo Python 3.14 is intentionally not used here to avoid package compatibility problems.
  pause
  exit /b 1
)

if not exist ".venv-autoqa\Scripts\python.exe" (
  echo Creating isolated Auto QA Python environment...
  %PY_CMD% -m venv .venv-autoqa || exit /b 1
)

".venv-autoqa\Scripts\python.exe" -m pip install --upgrade pip
".venv-autoqa\Scripts\python.exe" -c "import faster_whisper" >nul 2>&1
if errorlevel 1 (
  echo Installing faster-whisper...
  ".venv-autoqa\Scripts\python.exe" -m pip install faster-whisper || exit /b 1
) else (
  echo [OK] faster-whisper already installed - skipping.
)

ollama list | findstr /i /c:"qwen3:8b" >nul 2>&1
if errorlevel 1 (
  echo qwen3:8b is not installed. Downloading it with Ollama...
  ollama pull qwen3:8b || exit /b 1
) else (
  echo [OK] qwen3:8b already installed - skipping.
)

echo.
echo [OK] Auto QA dependencies are ready.
echo Run START-AUTO-QA.bat before using Auto QA.
pause
