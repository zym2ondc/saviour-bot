@echo off
setlocal
cd /d "%~dp0"
set REPO=https://gitlab.com/YOU/YOUR-REPO.git

where git >nul 2>nul
if %errorlevel% neq 0 (
  echo [X] Install Git first: https://git-scm.com/download/win
  pause
  exit /b 1
)
where node >nul 2>nul
if %errorlevel% neq 0 (
  echo [X] Install Node.js LTS first: https://nodejs.org/en/download
  pause
  exit /b 1
)

:: If this folder itself is the clone, just pull. Otherwise clone/update saviour-bot subfolder.
git rev-parse --git-dir >nul 2>nul
if %errorlevel% equ 0 (
  echo [*] Updating from GitLab...
  git pull
) else (
  echo [*] First run: cloning, then run this again inside the new folder.
  git clone %REPO% saviour-bot
  echo [*] Cloned to saviour-bot. Open it and run setup.bat
  pause
  exit /b 0
)

if not exist node_modules call npm.cmd install --no-audit --no-fund
if not exist .env (
  copy .env.example .env
  echo [*] Created .env - fill in your token/IDs, then re-run.
  pause
  exit /b 0
)
call npm.cmd start
pause
