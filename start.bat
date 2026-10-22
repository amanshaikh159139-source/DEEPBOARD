@echo off
setlocal
cd /d "%~dp0backend"

echo.
echo  DeepBoard - Local Chess Workspace
echo  ---------------------------------

if not exist "venv\Scripts\python.exe" (
  echo [1/3] Creating the Python environment...
  where python >nul 2>nul
  if errorlevel 1 (
    echo Python was not found. Install Python 3.10 or newer and try again.
    pause
    exit /b 1
  )
  python -m venv venv
  if errorlevel 1 goto setup_error
)
call "venv\Scripts\activate.bat"
if errorlevel 1 goto setup_error

echo [2/3] Checking Python dependencies...
python -m pip install --disable-pip-version-check -r requirements.txt
if errorlevel 1 goto setup_error

if not exist ".env" (
  copy /y ".env.example" ".env" >nul
  echo Created backend\.env from the example configuration.
)

REM Reuse an already running backend rather than starting a duplicate server.
powershell -NoProfile -ExecutionPolicy Bypass -Command "try { $r=Invoke-WebRequest -UseBasicParsing -TimeoutSec 2 http://127.0.0.1:5050/api/ping; if ($r.StatusCode -eq 200) { exit 0 } else { exit 1 } } catch { exit 1 }"
if not errorlevel 1 (
  echo DeepBoard is already running. Opening the existing server...
  start "" "http://127.0.0.1:5050"
  exit /b 0
)

echo [3/3] Starting the backend. Keep the DeepBoard Server window open while using the app.
start "DeepBoard Server" "%~dp0backend\run_server.bat"

REM Wait briefly for Flask, then open the app. This does not start one server per analysis.
for /L %%i in (1,1,25) do (
  powershell -NoProfile -ExecutionPolicy Bypass -Command "try { $r=Invoke-WebRequest -UseBasicParsing -TimeoutSec 1 http://127.0.0.1:5050/api/ping; if ($r.StatusCode -eq 200) { exit 0 } else { exit 1 } } catch { exit 1 }" >nul 2>nul
  if not errorlevel 1 goto open_app
  timeout /t 1 /nobreak >nul
)
echo The server did not become ready in 25 seconds. Check the DeepBoard Server window for errors.
pause
exit /b 1

:open_app
start "" "http://127.0.0.1:5050"
echo DeepBoard is ready. Keep the server window running until you finish.
exit /b 0

:setup_error
echo Setup failed. Check that Python and pip are installed and that the internet connection is available for package installation.
pause
exit /b 1
