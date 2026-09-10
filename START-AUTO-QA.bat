@echo off
setlocal
cd /d "%~dp0"
if not exist ".venv-autoqa\Scripts\python.exe" (
  echo Auto QA is not installed yet.
  echo Run INSTALL-AUTO-QA.bat first.
  pause
  exit /b 1
)
where ollama >nul 2>&1 || (echo Ollama is not installed or not in PATH.& pause & exit /b 1)
start "Ollama" /min cmd /c "ollama serve"
timeout /t 2 /nobreak >nul
set AUTO_QA_PYTHON=%CD%\.venv-autoqa\Scripts\python.exe
node autoqa\server.mjs
pause
