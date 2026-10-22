#!/usr/bin/env bash
# Sets up and starts DeepBoard on macOS / Linux:  ./start.sh
cd "$(dirname "$0")/backend" || exit 1
if [ ! -d venv ]; then
  echo "Creating virtual environment..."
  python3 -m venv venv
fi
source venv/bin/activate
if [ ! -f .env ]; then cp .env.example .env; fi
pip install -q -r requirements.txt
echo
python app.py
