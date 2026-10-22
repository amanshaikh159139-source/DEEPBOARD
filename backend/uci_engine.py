"""
uci_engine.py
=============
A small wrapper that talks to a UCI chess engine (normally Stockfish) through
stdin / stdout pipes.

No third-party chess library is needed: the engine itself understands FEN
positions, and the browser (frontend/js/chess-rules.js) is in charge of the
chess rules (legal moves, SAN, PGN ...).  This file only does:

    * find the Stockfish program on your computer
    * start it and keep it running
    * ask it for the best move (bot) or an evaluation (game analysis)

Scores returned by this module are always from WHITE's point of view.
"""

import atexit
import glob
import os
import queue
import shutil
import subprocess
import threading
import time

BASE_DIR = os.path.dirname(os.path.abspath(__file__))

# --------------------------------------------------------------------------
# Difficulty levels for "Play vs Bot".
#   skill     -> Stockfish "Skill Level" option (0 - 20)
#   elo       -> Stockfish "UCI_Elo" option (it clamps to the engine's range)
#   depth     -> optional search depth limit
#   movetime  -> thinking time in milliseconds
# Edit these numbers if you want the bot to be weaker or stronger.
# --------------------------------------------------------------------------
LEVELS = {
    1: {"skill": 0,    "elo": None, "depth": 1,    "movetime": 70},
    2: {"skill": 2,    "elo": None, "depth": 2,    "movetime": 100},
    3: {"skill": None, "elo": 1500, "depth": None, "movetime": 150},
    4: {"skill": None, "elo": 1800, "depth": None, "movetime": 220},
    5: {"skill": None, "elo": 2000, "depth": None, "movetime": 300},
    6: {"skill": None, "elo": 2500, "depth": None, "movetime": 500},
    7: {"skill": 20,   "elo": None, "depth": None, "movetime": 1000},
}

# Used for game analysis: full strength, no handicap.
FULL_STRENGTH = {"skill": 20, "elo": None}


class EngineError(Exception):
    """Raised when the engine does not answer or has crashed."""


# --------------------------------------------------------------------------
# Locating Stockfish
# --------------------------------------------------------------------------
def _looks_like_engine(path):
    name = os.path.basename(path).lower()
    if not name.startswith("stockfish") or not os.path.isfile(path):
        return False
    ext = os.path.splitext(name)[1]
    # Windows: .exe | Mac/Linux: no extension (or a version like ".1")
    return ext in ("", ".exe") or ext[1:].isdigit()


def find_stockfish():
    """Return the path of the Stockfish executable, or None.

    Search order:
      1. the STOCKFISH_PATH environment variable
      2. any file called stockfish* inside backend/stockfish/ (recursive)
      3. a program called "stockfish" found on the system PATH
    """
    env_path = os.environ.get("STOCKFISH_PATH")
    if env_path and os.path.isfile(env_path):
        return env_path

    folder = os.path.join(BASE_DIR, "stockfish")
    if os.path.isdir(folder):
        pattern = os.path.join(folder, "**", "*")
        for path in sorted(glob.glob(pattern, recursive=True)):
            # Do not attempt the bundled Windows .exe on macOS/Linux; let a
            # compatible user-supplied path or PATH install be selected instead.
            if os.name != "nt" and path.lower().endswith(".exe"):
                continue
            if os.name == "nt" and os.path.splitext(path)[1].lower() not in (".exe", ""):
                continue
            if _looks_like_engine(path):
                if os.name != "nt" and not os.access(path, os.X_OK):
                    try:
                        os.chmod(path, 0o755)  # downloaded files are often not executable
                    except OSError:
                        pass
                return path

    return shutil.which("stockfish")


# --------------------------------------------------------------------------
# Parsing "info ..." lines sent by the engine
# --------------------------------------------------------------------------
def parse_info(line):
    """Turn  'info depth 12 ... score cp 34 ... pv e2e4 e7e5'  into a dict."""
    tokens = line.split()
    out = {}
    i = 1
    while i < len(tokens):
        key = tokens[i]
        try:
            if key == "depth":
                out["depth"] = int(tokens[i + 1])
                i += 2
            elif key == "multipv":
                out["multipv"] = int(tokens[i + 1])
                i += 2
            elif key == "score":
                kind = tokens[i + 1]  # "cp" or "mate"
                out[kind] = int(tokens[i + 2])
                i += 3
                if i < len(tokens) and tokens[i] in ("lowerbound", "upperbound"):
                    out["bound"] = tokens[i]
                    i += 1
            elif key == "pv":
                out["pv"] = tokens[i + 1:]
                break
            else:
                i += 1
        except (IndexError, ValueError):
            break
    return out


# --------------------------------------------------------------------------
# The engine wrapper
# --------------------------------------------------------------------------
class UciEngine:
    def __init__(self, path, threads=None, hash_mb=128):
        self.path = path
        self.threads = threads or int(os.environ.get("STOCKFISH_THREADS", min(4, os.cpu_count() or 1)))
        self.hash_mb = hash_mb
        self.name = "Stockfish"
        self.options = {}
        self._applied = {}
        self._lock = threading.RLock()
        self._proc = None
        self._lines = queue.Queue()
        self._start()
        atexit.register(self.close)

    # ---- process handling -------------------------------------------------
    def _start(self):
        self._applied = {}
        self.options = {}
        kwargs = {}
        if os.name == "nt":
            kwargs["creationflags"] = subprocess.CREATE_NO_WINDOW  # no black console window
        self._proc = subprocess.Popen(
            [self.path],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            universal_newlines=True,
            bufsize=1,
            cwd=os.path.dirname(os.path.abspath(self.path)),
            **kwargs
        )
        self._lines = queue.Queue()
        threading.Thread(target=self._reader, args=(self._proc, self._lines), daemon=True).start()

        self._send("uci")
        self._wait_for("uciok", 15, parse_handshake=True)
        self._set("Threads", self.threads)
        self._set("Hash", self.hash_mb)
        self._send("isready")
        self._wait_for("readyok", 15)

    @staticmethod
    def _reader(proc, line_queue):
        """Background thread: copy every line the engine prints into a queue."""
        try:
            for line in proc.stdout:
                line_queue.put(line.strip())
        except Exception:
            pass
        line_queue.put(None)  # None = the engine has exited

    def _send(self, text):
        try:
            self._proc.stdin.write(text + "\n")
            self._proc.stdin.flush()
        except (BrokenPipeError, OSError, ValueError) as exc:
            raise EngineError("Engine pipe closed: %s" % exc)

    def _read(self, deadline):
        remaining = deadline - time.time()
        if remaining <= 0:
            raise EngineError("Engine timed out")
        try:
            line = self._lines.get(timeout=remaining)
        except queue.Empty:
            raise EngineError("Engine timed out")
        if line is None:
            raise EngineError("Engine process exited")
        return line

    def _wait_for(self, token, timeout, parse_handshake=False):
        deadline = time.time() + timeout
        while True:
            line = self._read(deadline)
            if parse_handshake:
                if line.startswith("id name "):
                    self.name = line[len("id name "):].strip() or self.name
                elif line.startswith("option name "):
                    self._parse_option(line)
            if line == token:
                return

    def _parse_option(self, line):
        rest = line[len("option name "):]
        name, _, spec = rest.partition(" type ")
        parts = spec.split()
        info = {"type": parts[0] if parts else ""}
        for key in ("min", "max", "default"):
            if key in parts and parts.index(key) + 1 < len(parts):
                info[key] = parts[parts.index(key) + 1]
        self.options[name.strip()] = info

    def _set(self, name, value):
        """Send 'setoption' only when the engine supports it and the value changed."""
        if self.options and name not in self.options:
            return
        value = str(value)
        if self._applied.get(name) == value:
            return
        self._send("setoption name %s value %s" % (name, value))
        self._applied[name] = value

    def _configure(self, config):
        elo = config.get("elo")
        if elo:
            info = self.options.get("UCI_Elo", {})
            lo = int(info.get("min", elo))
            hi = int(info.get("max", elo))
            self._set("UCI_LimitStrength", "true")
            self._set("UCI_Elo", max(lo, min(hi, int(elo))))
        else:
            self._set("UCI_LimitStrength", "false")
            self._set("Skill Level", config.get("skill", 20) if config.get("skill") is not None else 20)

    def close(self):
        proc, self._proc = self._proc, None
        if proc is None:
            return
        try:
            proc.stdin.write("quit\n")
            proc.stdin.flush()
        except Exception:
            pass
        try:
            proc.terminate()
            proc.wait(timeout=2)
        except Exception:
            try:
                proc.kill()
            except Exception:
                pass

    # ---- public API -------------------------------------------------------
    def analyse(self, fen, movetime=None, depth=None, config=None):
        """Search a position.

        movetime  thinking time in milliseconds
        depth     search depth (use one or both)
        config    {"skill": .., "elo": ..}  (see LEVELS)

        Returns a dict with: uci (best move or None), cp / mate (WHITE point of
        view), depth, pv (list of UCI moves), engine (name).
        """
        config = config or FULL_STRENGTH
        with self._lock:
            try:
                return self._analyse_once(fen, movetime, depth, config)
            except EngineError:
                # The engine crashed or hung - restart it and try one more time.
                self.close()
                self._start()
                return self._analyse_once(fen, movetime, depth, config)

    def _analyse_once(self, fen, movetime, depth, config):
        if self._proc is None or self._proc.poll() is not None:
            self._start()
        self._configure(config)
        self._send("position fen " + fen)

        command = ["go"]
        if depth:
            command.append("depth %d" % int(depth))
        if movetime:
            command.append("movetime %d" % int(movetime))
        if not depth and not movetime:
            command.append("movetime 300")
        self._send(" ".join(command))

        budget = (movetime or 0) / 1000.0 + 10 + (30 if depth and not movetime else 0)
        deadline = time.time() + budget
        last = None
        best = None
        while True:
            try:
                line = self._read(deadline)
            except EngineError:
                try:
                    self._send("stop")
                except EngineError:
                    pass
                raise
            if line.startswith("info") and " score " in line:
                info = parse_info(line)
                exact = "bound" not in info and ("cp" in info or "mate" in info)
                if exact and info.get("multipv", 1) == 1:
                    last = info
            elif line.startswith("bestmove"):
                parts = line.split()
                if len(parts) > 1 and parts[1] != "(none)":
                    best = parts[1]
                break

        return self._build_result(fen, best, last)

    def _build_result(self, fen, best, last):
        fields = fen.split()
        white_to_move = len(fields) < 2 or fields[1] == "w"
        sign = 1 if white_to_move else -1  # UCI scores are from the side to move
        last = last or {}
        cp = last.get("cp")
        mate = last.get("mate")
        return {
            "uci": best,
            "cp": None if cp is None else sign * cp,
            "mate": None if mate is None else sign * mate,
            "depth": last.get("depth"),
            "pv": last.get("pv", []),
            "engine": self.name,
        }
