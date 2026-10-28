@echo off
REM Deploy hawkesgenwebsite to the portal server (54.163.56.66)
REM Usage: deploy.bat

setlocal

set SSH_KEY=C:\Projects\hawkesstudio\deploy\.keys\gen_public_ed25519
set SERVER=ubuntu@ec2-54-163-56-66.compute-1.amazonaws.com
set DIR=/srv/hawkes/hawkesgenwebsite

echo.
echo ===== Deploying hawkesgenwebsite to %SERVER% =====
echo.

echo [1/3] Pulling latest code from origin/main...
ssh -i "%SSH_KEY%" %SERVER% "cd %DIR% && sudo -u hawkes git fetch origin main && sudo -u hawkes git reset --hard origin/main"
if errorlevel 1 (
    echo ERROR: Failed to pull code
    exit /b 1
)

echo.
echo [2/3] Restarting hawkesgen-portal service...
ssh -i "%SSH_KEY%" %SERVER% "sudo systemctl restart hawkesgen-portal"
if errorlevel 1 (
    echo ERROR: Failed to restart service
    exit /b 1
)

echo.
echo [3/3] Waiting for service to be healthy...
timeout /t 5 /nobreak >nul
ssh -i "%SSH_KEY%" %SERVER% "curl -s http://127.0.0.1:8800/v1/health | grep -q '\"ok\":true'"
if errorlevel 1 (
    echo WARNING: Service health check failed or timed out
    echo Check logs with: ssh -i "%SSH_KEY%" %SERVER% "journalctl -u hawkesgen-portal -n 50"
) else (
    echo.
    echo ===== Deploy complete! =====
    echo Portal is live at https://hawkesgen.ai
)

echo.
