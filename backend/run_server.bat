@echo off
cd /d "%~dp0"
if exist "venv\Scripts\activate.bat" call "venv\Scripts\activate.bat"
python app.py
if errorlevel 1 (
  echo DeepBoard stopped with an error. See the message above.
  pause
)
