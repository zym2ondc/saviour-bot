@echo off
setlocal EnableDelayedExpansion
title Saviour Bot - Setup
cd /d "%~dp0"

echo ========================================
echo  SAVIOUR BOT - First time setup
echo ========================================
echo.

:: ---------- 1. Check Node.js ----------
where node >nul 2>nul
if %errorlevel% equ 0 goto :haveNode

echo [!] Node.js not found. Trying to install it with winget...
where winget >nul 2>nul
if %errorlevel% neq 0 (
  echo [X] No winget on this PC. Install Node.js LTS manually from:
  echo     https://nodejs.org/en/download
  echo Then run setup.bat again.
  pause
  exit /b 1
)
winget install -e --id OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements
if %errorlevel% neq 0 (
  echo [X] Install failed. Get Node.js LTS from https://nodejs.org/en/download, then re-run setup.bat.
  pause
  exit /b 1
)
echo [*] Node.js installed. Close this window, open a NEW one here, and run setup.bat again.
pause
exit /b 0

:haveNode
for /f "tokens=*" %%v in ('node --version') do echo [*] Found %%v

:: ---------- 2. Install dependencies ----------
echo [*] Installing dependencies (discord.js, dotenv, express)...
call npm.cmd install --no-audit --no-fund
if %errorlevel% neq 0 (
  echo [X] npm install failed. Check your internet and run setup.bat again.
  pause
  exit /b 1
)

:: ---------- 3. Create .env if missing ----------
if exist .env goto :haveEnv
echo.
echo --- Bot config: make your OWN bot at discord.com/developers/applications ---
echo --- (Bot -^> Reset Token / copy token, OAuth2 -^> copy Client ID) ---
set /p DISCORD_TOKEN=Bot token:
set /p CLIENT_ID=Client ID:
set /p GUILD_ID=Server ID - right-click server, Copy Server ID (ENTER to skip):
(
  echo DISCORD_TOKEN=!DISCORD_TOKEN!
  echo CLIENT_ID=!CLIENT_ID!
  echo # Instant commands need your server ID above. Empty = global, up to 1 hour delay.
  echo GUILD_ID=!GUILD_ID!
  echo.
  echo TICKET_CATEGORY_ID=
  echo TICKET_STAFF_ROLE_ID=
  echo TICKET_LOG_CHANNEL_ID=
  echo.
  echo CLIENT_SECRET=
  echo OAUTH_REDIRECT_URI=http://localhost:3000/callback
  echo PORT=3000
  echo VERIFIED_ROLE_ID=
  echo UNVERIFIED_ROLE_ID=
) > .env
echo [*] .env created.
goto :deploy

:haveEnv
echo [*] .env already exists, keeping it.

:: ---------- 4. Register commands + start ----------
:deploy
echo [*] Registering slash commands...
call npm.cmd run deploy
echo.
echo ========================================
echo  Starting bot - leave this window open.
echo  Invite it with (swap in your Client ID):
echo  https://discord.com/oauth2/authorize?client_id=YOUR_CLIENT_ID^&permissions=8^&scope=bot+applications.commands
echo ========================================
echo.
call npm.cmd start
pause
