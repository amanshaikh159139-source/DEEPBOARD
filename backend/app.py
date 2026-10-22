"""
app.py  -  DeepBoard backend (Flask)
====================================
Run it with:      python app.py
Then open:        http://127.0.0.1:5050

What this server does
---------------------
  * serves the website files from ../frontend      (index.html, css, js)
  * GET  /api/health              is Stockfish available?
  * POST /api/engine/bestmove     {fen, level}       -> bot move
  * POST /api/engine/evaluate     {fen, movetime}    -> evaluation for game analysis
  * GET  /api/chesscom/games      ?username=..&max=  -> import games from chess.com

All chess RULES (legal moves, check, checkmate, PGN parsing ...) live in the
browser: frontend/js/chess-rules.js.  The backend only hosts Stockfish.
"""

import os
import re
import sqlite3
import secrets
import time
import threading
import requests
from dotenv import load_dotenv
from werkzeug.security import generate_password_hash, check_password_hash
from flask import session

from flask import Flask, jsonify, request, send_from_directory

import chesscom
import uci_engine

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
load_dotenv(os.path.join(BASE_DIR, ".env"))
FRONTEND_DIR = os.path.abspath(os.path.join(BASE_DIR, "..", "frontend"))

app = Flask(__name__, static_folder=None)
app.config.update(SESSION_COOKIE_HTTPONLY=True, SESSION_COOKIE_SAMESITE="Lax", PERMANENT_SESSION_LIFETIME=60 * 60 * 24 * 14)
_secret_from_env = os.environ.get("DEEPBOARD_SECRET_KEY")
_secret_path = os.path.join(BASE_DIR, ".session_secret")
if _secret_from_env:
    app.secret_key = _secret_from_env
else:
    try:
        with open(_secret_path, "r", encoding="utf-8") as _secret_file:
            app.secret_key = _secret_file.read().strip()
    except FileNotFoundError:
        app.secret_key = secrets.token_hex(32)
        with open(_secret_path, "w", encoding="utf-8") as _secret_file:
            _secret_file.write(app.secret_key)

DB_PATH = os.path.join(BASE_DIR, "deepboard_users.sqlite3")


def db_connect():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_user_db():
    with db_connect() as conn:
        conn.execute("CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT NOT NULL UNIQUE COLLATE NOCASE, password_hash TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)")
        # Additive migrations preserve existing local accounts.
        columns = {row[1] for row in conn.execute("PRAGMA table_info(users)").fetchall()}
        if "email" not in columns:
            conn.execute("ALTER TABLE users ADD COLUMN email TEXT")
        if "google_sub" not in columns:
            conn.execute("ALTER TABLE users ADD COLUMN google_sub TEXT")
        conn.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_unique ON users(email) WHERE email IS NOT NULL")
        conn.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_users_google_sub_unique ON users(google_sub) WHERE google_sub IS NOT NULL")


init_user_db()


# --------------------------------------------------------------------------
# Small helpers
# --------------------------------------------------------------------------
@app.after_request
def add_headers(response):
    """Allow the frontend to call the API even if it is opened from another
    port (for example VS Code "Live Server" on :5500), and never cache files
    so that your edits show up immediately after a browser refresh."""
    origin = request.headers.get("Origin", "")
    # Local development may use VS Code Live Server on a different port.
    # Reflect only loopback origins so session cookies can be used safely.
    # Reflect only local development origins. Never enable wildcard CORS for
    # an app that uses cookie-backed authentication.
    if re.fullmatch(r"https?://(127\.0\.0\.1|localhost)(:\d{1,5})?", origin):
        response.headers["Access-Control-Allow-Origin"] = origin
        response.headers["Access-Control-Allow-Credentials"] = "true"
        response.headers["Vary"] = "Origin"
    response.headers["Access-Control-Allow-Headers"] = "Content-Type, Authorization"
    response.headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS"
    response.headers["Cache-Control"] = "no-store"
    return response


def error(message, status=400):
    return jsonify({"error": message}), status


_FEN_ROW = re.compile(r"^[pnbrqkPNBRQK1-8]{1,8}$")


def valid_fen(fen):
    """Cheap sanity check so a broken FEN can never reach the engine."""
    if not isinstance(fen, str) or len(fen) > 120:
        return False
    fields = fen.split()
    if len(fields) < 2 or fields[1] not in ("w", "b"):
        return False
    rows = fields[0].split("/")
    if len(rows) != 8:
        return False
    for row in rows:
        if not _FEN_ROW.match(row):
            return False
        total = sum(int(c) if c.isdigit() else 1 for c in row)
        if total != 8:
            return False
    return fields[0].count("K") == 1 and fields[0].count("k") == 1


# --------------------------------------------------------------------------
# Stockfish (started once, on first use)
# --------------------------------------------------------------------------
_engine = None
_engine_problem = None
_engine_last_attempt = 0.0
_engine_init_lock = threading.Lock()


def get_engine(force_retry=False):
    """Create one shared engine process and retry a failed startup occasionally.

    Engine.analyse serializes all UCI traffic with its own lock. Retrying allows
    users to install/fix Stockfish without having to restart Flask immediately.
    """
    global _engine, _engine_problem, _engine_last_attempt
    if _engine is not None and getattr(_engine, "_proc", None) is not None:
        if _engine._proc.poll() is None:
            return _engine
        try:
            _engine.close()
        except Exception:
            pass
        _engine = None
        _engine_problem = "Stockfish process stopped unexpectedly."
    with _engine_init_lock:
        now = time.time()
        if _engine is None and (force_retry or now - _engine_last_attempt >= 5):
            _engine_last_attempt = now
            _engine_problem = None
            path = uci_engine.find_stockfish()
            if not path:
                _engine_problem = "Stockfish was not found. Install it or set STOCKFISH_PATH."
            else:
                try:
                    _engine = uci_engine.UciEngine(path)
                except Exception as exc:  # noqa: BLE001
                    _engine_problem = "Stockfish could not be started: %s" % exc
                    _engine = None
    return _engine


# --------------------------------------------------------------------------
# Local account API. User-specific game data remains in browser storage in this
# additive version; this account table does not claim cross-device game sync.
# --------------------------------------------------------------------------
@app.get("/api/auth/me")
def auth_me():
    uid = session.get("user_id")
    if not uid:
        return jsonify({"authenticated": False, "user": None})
    with db_connect() as conn:
        row = conn.execute("SELECT id, username, email, created_at FROM users WHERE id = ?", (uid,)).fetchone()
    if row is None:
        session.clear()
        return jsonify({"authenticated": False, "user": None})
    return jsonify({"authenticated": True, "user": dict(row)})


@app.post("/api/auth/register")
def auth_register():
    data = request.get_json(silent=True) or {}
    username = str(data.get("username", "")).strip()
    email = str(data.get("email", "")).strip().lower()
    password = data.get("password", "")
    if not re.fullmatch(r"[A-Za-z0-9_.-]{3,32}", username):
        return error("Username must be 3–32 characters and use letters, numbers, dots, underscores or hyphens.")
    if not re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", email) or len(email) > 254:
        return error("Enter a valid email address.")
    if not isinstance(password, str) or len(password) < 8 or len(password) > 128:
        return error("Password must be between 8 and 128 characters.")
    try:
        with db_connect() as conn:
            cur = conn.execute("INSERT INTO users (username, password_hash, email) VALUES (?, ?, ?)", (username, generate_password_hash(password), email))
            uid = cur.lastrowid
    except sqlite3.IntegrityError:
        return error("That username or email already exists. Please sign in or use different details.", 409)
    session.clear()
    session["user_id"] = uid
    session.permanent = True
    return jsonify({"ok": True, "user": {"id": uid, "username": username}}), 201


@app.post("/api/auth/login")
def auth_login():
    data = request.get_json(silent=True) or {}
    username = str(data.get("username", "")).strip()
    password = data.get("password", "")
    with db_connect() as conn:
        row = conn.execute("SELECT id, username, password_hash FROM users WHERE username = ? COLLATE NOCASE OR email = ? COLLATE NOCASE", (username, username)).fetchone()
    if row is None or not isinstance(password, str) or not check_password_hash(row["password_hash"], password):
        return error("Incorrect username or password.", 401)
    session.clear()
    session["user_id"] = row["id"]
    session.permanent = True
    return jsonify({"ok": True, "user": {"id": row["id"], "username": row["username"]}})


@app.post("/api/auth/google")
def auth_google():
    """Verify Google Identity Services ID tokens on the server."""
    # This callback is used only by the local web UI. Reject cross-site login
    # attempts while still allowing the localhost/127.0.0.1 dev origins.
    origin = request.headers.get("Origin", "")
    if not re.fullmatch(r"https?://(127\.0\.0\.1|localhost)(:\d{1,5})?", origin):
        return error("Google sign-in must be started from the local DeepBoard website.", 403)
    client_id = os.environ.get("GOOGLE_CLIENT_ID", "").strip()
    if not client_id:
        return error("Google Sign-In is not configured yet. Set GOOGLE_CLIENT_ID in the backend environment and frontend/js/config.js.", 503)
    data = request.get_json(silent=True) or {}
    credential = data.get("credential")
    if not isinstance(credential, str) or len(credential) > 10000:
        return error("Google did not provide a valid credential.", 400)
    try:
        from google.oauth2 import id_token
        from google.auth.transport import requests as google_requests
        claims = id_token.verify_oauth2_token(credential, google_requests.Request(), client_id)
    except ImportError:
        return error("Google Sign-In dependencies are missing. Run start.bat again to install requirements.", 503)
    except Exception:
        return error("Google Sign-In could not verify this account. Try again.", 401)
    email = str(claims.get("email", "")).strip().lower()
    subject = str(claims.get("sub", "")).strip()
    if not email or claims.get("email_verified") is not True or not subject:
        return error("Google must provide a verified email address.", 401)

    local = re.sub(r"[^A-Za-z0-9_.-]", "", email.split("@", 1)[0]) or "googleplayer"
    username = local[:32]
    with db_connect() as conn:
        # A stable Google subject identifies the returning federated account.
        row = conn.execute("SELECT id, username FROM users WHERE google_sub = ?", (subject,)).fetchone()
        if row:
            uid, username = row["id"], row["username"]
            # Keep the stored email current when it is not owned by another user.
            email_owner = conn.execute("SELECT id FROM users WHERE email = ? AND id <> ?", (email, uid)).fetchone()
            if not email_owner:
                conn.execute("UPDATE users SET email = ? WHERE id = ?", (email, uid))
        else:
            # Do not silently attach Google to a password account using email
            # alone. Require a separately authenticated linking flow in future.
            existing_email = conn.execute("SELECT id FROM users WHERE email = ?", (email,)).fetchone()
            if existing_email:
                return error("This email already belongs to a local account. Sign in with your password first; Google account linking is not enabled yet.", 409)
            # The hashed random password keeps compatibility with the existing
            # NOT NULL schema; it is never disclosed or used for Google login.
            for suffix in range(0, 1000):
                candidate = username if suffix == 0 else (local[:25] + str(suffix))[:32]
                try:
                    cur = conn.execute("INSERT INTO users (username, password_hash, email, google_sub) VALUES (?, ?, ?, ?)",
                                       (candidate, generate_password_hash(secrets.token_urlsafe(40)), email, subject))
                    uid, username = cur.lastrowid, candidate
                    break
                except sqlite3.IntegrityError:
                    continue
            else:
                return error("Could not create a unique local profile for this Google account.", 409)
    session.clear()
    session["user_id"] = uid
    session.permanent = True
    return jsonify({"ok": True, "user": {"id": uid, "username": username, "email": email}})


@app.post("/api/chat")
def api_chat():
    """Optional general-purpose assistant. Never expose the API key to the browser."""
    api_key = os.environ.get("OPENAI_API_KEY", "").strip()
    if not api_key:
        return error("AI chat is not configured. Add OPENAI_API_KEY to the backend environment; built-in chess help remains available.", 503)
    data = request.get_json(silent=True) or {}
    messages = data.get("messages", [])
    if not isinstance(messages, list) or len(messages) > 12:
        return error("Please send up to 12 recent chat messages.", 400)
    safe_messages = []
    for message in messages:
        if not isinstance(message, dict) or message.get("role") not in ("user", "assistant"):
            continue
        content = message.get("content")
        if isinstance(content, str) and content.strip():
            safe_messages.append({"role": message["role"], "content": content.strip()[:2000]})
    if not safe_messages or safe_messages[-1]["role"] != "user":
        return error("Enter a message first.", 400)
    try:
        resp = requests.post("https://api.openai.com/v1/chat/completions", timeout=35,
            headers={"Authorization": "Bearer " + api_key, "Content-Type": "application/json"},
            json={"model": os.environ.get("OPENAI_MODEL", "gpt-4o-mini"),
                  "messages": [{"role": "system", "content": "You are DeepBoard's helpful assistant. Answer questions across general topics and chess in clear, friendly language. Be accurate and never invent Stockfish results or claim to see a board unless its position is included in the conversation."}] + safe_messages,
                  "temperature": 0.5, "max_tokens": 700})
        resp.raise_for_status()
        content = resp.json()["choices"][0]["message"]["content"].strip()
        return jsonify({"reply": content})
    except requests.Timeout:
        return error("The AI service timed out. Please try again.", 504)
    except (requests.RequestException, ValueError, KeyError, IndexError):
        return error("The AI service is temporarily unavailable. Check the API key and try again.", 502)


@app.post("/api/auth/logout")
def auth_logout():
    session.clear()
    return jsonify({"ok": True})


# --------------------------------------------------------------------------
# API routes
# --------------------------------------------------------------------------
@app.get("/api/ping")
def api_ping():
    """Fast process check that does not start or wait for the chess engine."""
    return jsonify({"ok": True, "backend": "ready"})


@app.get("/api/health")
def api_health():
    engine = get_engine()
    return jsonify({
        "ok": True,
        "backend": "ready",
        "stockfish": engine is not None,
        "engine": engine.name if engine else None,
        "path": engine.path if engine else None,
        "problem": None if engine else _engine_problem,
    })


@app.post("/api/engine/bestmove")
def api_bestmove():
    data = request.get_json(silent=True) or {}
    fen = data.get("fen")
    if not valid_fen(fen):
        return error("Invalid FEN.")
    try:
        level = max(1, min(7, int(data.get("level", 7))))
    except (TypeError, ValueError):
        return error("level must be a number from 1 to 7.")

    engine = get_engine()
    if engine is None:
        return error(_engine_problem or "No engine.", 503)

    cfg = uci_engine.LEVELS[level]
    try:
        result = engine.analyse(fen, movetime=cfg["movetime"], depth=cfg["depth"], config=cfg)
    except uci_engine.EngineError as exc:
        return error(str(exc), 500)
    return jsonify(result)


@app.post("/api/engine/evaluate")
def api_evaluate():
    data = request.get_json(silent=True) or {}
    fen = data.get("fen")
    if not valid_fen(fen):
        return error("Invalid FEN.")
    try:
        movetime = max(30, min(10000, int(data.get("movetime", 300))))
        depth = data.get("depth")
        depth = max(1, min(40, int(depth))) if depth else None
    except (TypeError, ValueError):
        return error("movetime and depth must be numbers.")

    engine = get_engine()
    if engine is None:
        return error(_engine_problem or "No engine.", 503)

    try:
        result = engine.analyse(fen, movetime=movetime, depth=depth, config=uci_engine.FULL_STRENGTH)
    except uci_engine.EngineError as exc:
        return error(str(exc), 500)
    return jsonify(result)


@app.get("/api/chesscom/games")
def api_chesscom_games():
    username = request.args.get("username", "")
    try:
        limit = int(request.args.get("max", 25))
    except ValueError:
        limit = 25
    try:
        games = chesscom.fetch_games(username, max_games=limit)
    except chesscom.ChessComError as exc:
        return error(exc.message, exc.status)
    return jsonify({"username": username.strip().lower(), "count": len(games), "games": games})


# --------------------------------------------------------------------------
# Website files
# --------------------------------------------------------------------------
@app.get("/")
def index():
    return send_from_directory(FRONTEND_DIR, "index.html")


@app.get("/<path:filename>")
def static_files(filename):
    return send_from_directory(FRONTEND_DIR, filename)


# --------------------------------------------------------------------------
if __name__ == "__main__":
    host = os.environ.get("HOST", "127.0.0.1")
    port = int(os.environ.get("PORT", 5050))

    print()
    print("  DeepBoard backend")
    print("  -----------------")
    engine = get_engine()
    if engine:
        print("  Engine : %s" % engine.name)
        print("  Path   : %s" % engine.path)
    else:
        print("  Engine : %s" % _engine_problem)
        print("           The built-in JavaScript engine will be used instead.")
        print("           For full strength, put the Stockfish program inside backend/stockfish/")
    print()
    print("  Open in your browser:  http://%s:%d" % (host, port))
    print("  (press Ctrl+C to stop)")
    print()

    # Use one process (no Werkzeug reloader) so the shared UCI engine is not
    # accidentally duplicated. The engine itself serializes its UCI traffic.
    app.run(host=host, port=port, debug=False, threaded=True)
