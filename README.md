# DeepBoard

A chess app that runs entirely on your own computer.

- **Play the bot** - 200, 800, 1500, 1800, 2000, 2500, and full-strength Stockfish options. Pick your colour, undo, ask for a hint.
- **Two players, one screen** - pass-and-play with every rule enforced (castling, en passant, promotion, check, checkmate, stalemate, draws).
- **Analyze games** - paste a PGN, upload a `.pgn` file, or import your recent games from chess.com by username. Every move is rated (Best, Excellent, Good, Inaccuracy, Mistake, Blunder), both players get an accuracy score, and there is an evaluation graph.
- **History** - finished games and analyses are saved in your browser.

Frontend: plain HTML, CSS and JavaScript (no build step, no frameworks).
Backend: Python + Flask, which talks to the Stockfish engine.

---

## 1. Run it (VS Code)

You need **Python 3.10 or newer** (https://www.python.org/downloads/ - on Windows tick "Add Python to PATH").

1. In VS Code choose **File > Open Folder** and pick the `chess-app` folder.
2. Open a terminal (**Terminal > New Terminal**) and run:

**Windows (recommended)**
Double-click `start.bat`. It creates the Python environment, installs dependencies, prepares the local configuration, starts the backend once, and opens the website. Keep the server window open while using the app.

**Windows (manual alternative)**
```
cd backend
python -m venv venv
venv\Scripts\activate
pip install -r requirements.txt
python app.py
```

**macOS / Linux**
```
cd backend
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
python app.py
```

3. Open **http://127.0.0.1:5050** in your browser (also works as http://localhost:5050).

That is the whole app: Flask serves the website *and* the API from that one address.
Stop it with `Ctrl+C` in the terminal.

Shortcut: double-click `start.bat` on Windows. It creates the virtual environment, installs dependencies, reuses an already-running backend if present, starts the server otherwise, and opens the website.
In VS Code you can also press **F5** (the "DeepBoard backend" launch configuration is included) and set breakpoints in the Python files.

### Different port
```
PORT=8000 python app.py            (macOS / Linux)
set PORT=8000 && python app.py     (Windows Command Prompt)
$env:PORT=8000; python app.py      (Windows PowerShell)
```
then open http://127.0.0.1:8000. The page finds the backend automatically.

### Using VS Code "Live Server" for the frontend
You can edit `frontend/` with Live Server (usually http://127.0.0.1:5500). Keep `python app.py` running as well:
the page first tries its own address, then `BACKEND_URL` in `frontend/js/config.js` (default `http://127.0.0.1:5050`).

---

## 2. Install Stockfish (recommended)

DeepBoard has a small JavaScript fallback engine, but Stockfish provides much stronger play and analysis. The Windows Stockfish executable is bundled under `backend/stockfish/stockfish/`. On another operating system, download a compatible Stockfish build from https://stockfishchess.org/download/ and set `STOCKFISH_PATH` in `backend/.env` to the executable path. After changing engine configuration, stop and restart the server.

If the badge stays yellow ("Built-in engine"), hover over it to read why. Common fixes:
- **The engine does not start / crashes immediately** - your CPU may not support the AVX2 build. Download the plain `x86-64` or `sse41-popcnt` build instead.
- **macOS says the file cannot be opened** - run `xattr -d com.apple.quarantine backend/stockfish/<file>` once, and `chmod +x` it.
- **The file is somewhere else** - set the environment variable `STOCKFISH_PATH` to its full path.

More CPU threads make analysis faster: `STOCKFISH_THREADS=4 python app.py` (default: up to 4).

---

## 3. Project layout

```
chess-app/
  README.md
  start.bat / start.sh               one-click setup + run
  .vscode/launch.json                F5 to run the backend in VS Code
  backend/
    app.py                           Flask server: serves the site + the API
    uci_engine.py                    talks to Stockfish (UCI protocol), difficulty levels
    chesscom.py                      downloads games from the public chess.com API
    requirements.txt                 Flask, requests, dotenv, Google token verification
    .env.example                     optional Google/AI/Stockfish configuration
    run_server.bat                   runs the local Flask backend
  frontend/
    index.html                       all pages (Home, Play, Analyze, History)
    css/style.css                    all styling (colours and fonts are variables at the top)
    js/
      config.js                      settings: bot levels, analysis speeds, rating limits, board colours
      utils.js                       small helpers (DOM, storage, PGN builder, move list)
      chess-rules.js                 complete chess rules: legal moves, check/mate/draws, SAN, FEN, PGN
      ai.js                          built-in fallback engine
      pieces.js                      the piece drawings (SVG)
      board.js                       the board: drag and drop, click to move, arrows, promotion picker
      api.js                         talks to the backend and chooses Stockfish or the built-in engine
      store.js                       saves games in the browser (localStorage)
      scoring.js                     move ratings and accuracy maths
      home.js  play.js  analysis.js  history.js    the four pages
      main.js                        page routing, engine badge, board colour picker
```

### How the pieces fit together
```
 Browser (frontend)                              Flask (backend)                Stockfish
 ------------------                              ---------------                ---------
 chess-rules.js  decides what is legal
 play.js         sends a position (FEN)  --->    /api/engine/bestmove   --->    picks a move
 analysis.js     sends every position    --->    /api/engine/evaluate   --->    scores it
 analysis.js     asks for a username     --->    /api/chesscom/games    --->    api.chess.com
```
The chess *rules* live in the browser, so playing never waits on the server; the backend only hosts the engine.
If Stockfish is unavailable, the app reports engine status and uses the built-in JavaScript fallback. The backend keeps one shared engine process, serializes UCI requests, and retries a transient engine failure once before falling back.

### API
| Method | URL | Body / query | Returns |
|---|---|---|---|
| GET | `/api/ping` | - | Fast backend readiness check (does not initialize Stockfish) |
| GET | `/api/health` | - | `{ stockfish, engine, problem }` |
| POST | `/api/engine/bestmove` | `{ fen, level 1-7 }` | `{ uci, cp, mate, depth, pv }` |
| POST | `/api/engine/evaluate` | `{ fen, movetime, depth? }` | `{ uci, cp, mate, depth, pv }` |
| GET | `/api/chesscom/games` | `?username=...&max=25` | `{ games: [...] }` |

Scores `cp` (centipawns) and `mate` are always from White's point of view.

---

## 4. Things you may want to change

| I want to... | Edit |
|---|---|
| Change the bot's strength per level | `LEVELS` in `backend/uci_engine.py` (and the built-in engine's settings in `frontend/js/ai.js`) |
| Change level names, analysis speeds, rating limits (what counts as a blunder) | `frontend/js/config.js` |
| Add a board colour theme | `BOARD_THEMES` in `frontend/js/config.js` |
| Change the app colours and fonts | the variables at the top of `frontend/css/style.css` |
| Change the piece colours or shapes | `frontend/js/pieces.js` |
| Import more games from chess.com | `CHESSCOM_MAX_GAMES` in `config.js` (and `max_months` in `chesscom.py`) |
| Change how accuracy is calculated | `frontend/js/scoring.js` |

After editing a frontend file just refresh the browser (the server sends no-cache headers). After editing a Python file, restart the server. Repeated game moves and analyses do not require restarting it; the backend must remain running while the locally hosted website is being used.

---

## 5. Good to know

- **Games are stored in your browser** (localStorage), not on the server. Clearing site data deletes them. Use "Download PGN" to keep a copy.
- **Two players means the same screen.** There is no online multiplayer and no chess clock.
- **chess.com import** reads the public API: the 25 most recent standard-chess games from the last 12 months. It needs an internet connection; everything else works offline (the page fonts fall back to your system fonts).
- Analysis time per game: roughly (number of half-moves + 1) x the "Analysis depth" time (Quick 0.12 s, Balanced 0.35 s, Deep 1 s).
- The Windows Stockfish executable is included with its upstream license files. A compatible build is needed for macOS/Linux.

## 6. Troubleshooting

| Problem | Fix |
|---|---|
| `python` is not recognised | Reinstall Python and tick "Add Python to PATH", or try `py` (Windows) / `python3` |
| `ModuleNotFoundError: flask` | Activate the virtual environment, then `pip install -r requirements.txt` |
| Page says "Cannot reach the backend" | Start `python app.py` and keep the terminal open |
| `Address already in use` | Another program uses port 5050: start with a different `PORT` (see above) |
| Badge is yellow | See "Install Stockfish" above; hover the badge to read the exact reason |
| Import from chess.com fails | Check the username spelling and your internet connection |


## 7. Current upgraded features

- **Home:** intentionally minimal; the six primary destinations are Play, Analyse, Puzzle, History, Profile, and Opening learnings.
- **Sign in / Create account:** create an account with username, email, and a hashed password; sign in with username or email. Existing user databases are migrated additively. Use `start.bat` so the page and API share `http://127.0.0.1:5050`.
- **Google Sign-In:** real Google Identity Services flow with server-side ID-token verification. Configure the same OAuth web client ID in `frontend/js/config.js` (`GOOGLE_CLIENT_ID`) and `backend/.env` (`GOOGLE_CLIENT_ID`). Without credentials, username/password login remains available and the UI explains that Google is not configured. If the Google email already belongs to a separate password account, DeepBoard requires normal password sign-in rather than silently linking identities.
- **Puzzle:** local curated tactical positions with FEN, validated legal solutions, mate/material objectives, automated opponent replies for a fork line, hints, solution replay, reset, and browser-local practice rating. This is a small starter collection, not the full Lichess puzzle database.
- **Bots:** approximate 200, 800, 1500, 1800, 2000, and 2500 target ratings plus a full-strength Stockfish option. These ratings are labels, not guaranteed online Elo ratings. Local avatar SVGs are included.
- **Play experience:** dedicated Play route, enlarged board workspace, and win/loss/draw result overlay with review, rematch, and home actions.
- **Themes and motion:** four board palettes plus five interface accent themes; transitions respect reduced-motion settings.
- **Profile:** personal bot-game results use the player's colour. Unsafe insertion of dynamic game text into profile HTML was removed. Existing browser history remains local to that browser and does not sync across devices.
- **Chat:** chess help has a local fallback. To enable a general-purpose AI response, set `OPENAI_API_KEY` in `backend/.env`; `OPENAI_MODEL` defaults to `gpt-4o-mini`. The API key stays on the backend and is never put in frontend code.

## 8. Optional credentials

`start.bat` creates `backend/.env` from `.env.example` if one does not exist. Edit `backend/.env` privately:

```dotenv
DEEPBOARD_SECRET_KEY=
GOOGLE_CLIENT_ID=your-google-oauth-web-client-id.apps.googleusercontent.com
OPENAI_API_KEY=your-provider-api-key
OPENAI_MODEL=gpt-4o-mini
STOCKFISH_PATH=
STOCKFISH_THREADS=4
HOST=127.0.0.1
PORT=5050
```

Only set the variables for services you use. Leave `DEEPBOARD_SECRET_KEY` blank to use the automatically generated local secret, or set it to a long random value. Also set the public `CONFIG.GOOGLE_CLIENT_ID` value in `frontend/js/config.js` to the same Google OAuth web client ID. In Google Cloud Console, configure the app's authorized JavaScript origin as `http://127.0.0.1:5050`. Never share or commit `backend/.env` or a real API key.

## 9. Persistent local startup and troubleshooting

- Start the app by double-clicking **`start.bat`**. Keep the **DeepBoard Server** terminal window open while playing or analysing. The startup script reuses an already-running server instead of starting a second one.
- Each engine request is handled by the existing backend process; it does not start a new Flask server. The Stockfish UCI wrapper serializes concurrent requests and attempts a process restart after an engine failure.
- When the laptop shuts down, the local Python server stops too. Start `start.bat` again when you next use the site; no local app can serve new requests while the computer/server is off.
- If Google login is unavailable, check `GOOGLE_CLIENT_ID` in both locations and ensure the OAuth origin is configured. Local password login needs no Google credentials.
- If general AI chat says it is not configured, add `OPENAI_API_KEY` to `backend/.env` and restart the server. Local chess help remains available without it.
- If the Stockfish badge remains yellow, inspect `/api/health` at `http://127.0.0.1:5050/api/health`, check `backend/.env`, and confirm the executable matches your operating system and CPU.
- Games and puzzle statistics are still stored in browser `localStorage`; they do not automatically synchronize between devices/accounts.

This remains a local student project, not a hardened public production service. Do not expose the Flask development server to the public internet without a separate production/security review.
