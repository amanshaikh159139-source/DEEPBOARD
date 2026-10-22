"""
chesscom.py
===========
Downloads a player's recent games from the free public chess.com API.

    https://api.chess.com/pub/player/<username>/games/archives   -> list of monthly archive URLs
    https://api.chess.com/pub/player/<username>/games/YYYY/MM    -> all games of that month

The browser could call chess.com directly, but going through this backend
avoids any browser (CORS) restrictions and lets us tidy the data first.
"""

import re
import time

import requests

API_ROOT = "https://api.chess.com/pub/player"

# chess.com asks API users to identify their app in the User-Agent header.
HEADERS = {"User-Agent": "DeepBoard-Local/1.0 (student chess project)"}

# Cache so that clicking "Import" twice does not hit chess.com again.
_CACHE = {}
CACHE_SECONDS = 300

REASONS = {
    "checkmated": "checkmate",
    "resigned": "resignation",
    "timeout": "timeout",
    "abandoned": "abandonment",
    "agreed": "agreement",
    "repetition": "repetition",
    "stalemate": "stalemate",
    "insufficient": "insufficient material",
    "50move": "50-move rule",
    "timevsinsufficient": "timeout vs insufficient material",
}


class ChessComError(Exception):
    def __init__(self, message, status=502):
        super().__init__(message)
        self.message = message
        self.status = status


def _get_json(url):
    try:
        response = requests.get(url, headers=HEADERS, timeout=15)
    except requests.RequestException as exc:
        raise ChessComError("Could not reach chess.com (%s). Check your internet connection." % exc.__class__.__name__)
    if response.status_code == 404:
        raise ChessComError("not-found", 404)
    if response.status_code == 429:
        raise ChessComError("chess.com is rate-limiting requests. Wait a minute and try again.", 429)
    if response.status_code != 200:
        raise ChessComError("chess.com answered with HTTP %d." % response.status_code)
    try:
        return response.json()
    except ValueError:
        raise ChessComError("chess.com returned something that is not JSON.")


def _result_code(white_result, black_result):
    if white_result == "win":
        return "1-0"
    if black_result == "win":
        return "0-1"
    return "1/2-1/2"


def _opening_from_pgn(pgn):
    match = re.search(r'\[ECOUrl "([^"]+)"\]', pgn or "")
    if not match:
        return None
    slug = match.group(1).rstrip("/").split("/")[-1]
    slug = re.split(r"\d", slug)[0].rstrip("-")  # drop the move list that follows the name
    return slug.replace("-", " ").strip() or None


def _simplify(game, username):
    white = game.get("white", {})
    black = game.get("black", {})
    result = _result_code(white.get("result"), black.get("result"))

    if white.get("result") == "win":
        reason_key = black.get("result")
    elif black.get("result") == "win":
        reason_key = white.get("result")
    else:
        reason_key = white.get("result")

    me = None
    if (white.get("username") or "").lower() == username:
        me = "white"
    elif (black.get("username") or "").lower() == username:
        me = "black"

    outcome = None
    if me:
        if result == "1/2-1/2":
            outcome = "draw"
        elif (result == "1-0") == (me == "white"):
            outcome = "win"
        else:
            outcome = "loss"

    pgn = game.get("pgn") or ""
    return {
        "url": game.get("url"),
        "pgn": pgn,
        "white": {"username": white.get("username"), "rating": white.get("rating")},
        "black": {"username": black.get("username"), "rating": black.get("rating")},
        "result": result,
        "reason": REASONS.get(reason_key, reason_key),
        "time_class": game.get("time_class"),
        "time_control": game.get("time_control"),
        "rated": game.get("rated"),
        "end_time": game.get("end_time"),
        "my_color": me,
        "outcome": outcome,
        "opening": _opening_from_pgn(pgn),
        "accuracies": game.get("accuracies"),
    }


def fetch_games(username, max_games=25, max_months=12):
    """Return up to `max_games` of the player's newest standard-chess games."""
    username = (username or "").strip().lower()
    if not re.fullmatch(r"[a-z0-9_-]{2,50}", username):
        raise ChessComError("That does not look like a valid chess.com username.", 400)
    max_games = max(1, min(int(max_games), 100))

    cache_key = (username, max_games)
    cached = _CACHE.get(cache_key)
    if cached and time.time() - cached[0] < CACHE_SECONDS:
        return cached[1]

    try:
        archives = _get_json("%s/%s/games/archives" % (API_ROOT, username)).get("archives", [])
    except ChessComError as exc:
        if exc.message == "not-found":
            raise ChessComError("No chess.com player called '%s' was found." % username, 404)
        raise

    games = []
    for url in list(reversed(archives))[:max_months]:  # newest month first
        try:
            month = _get_json(url).get("games", [])
        except ChessComError:
            continue
        for game in reversed(month):  # newest game first
            if game.get("rules", "chess") != "chess":
                continue  # skip chess960, bughouse, etc.
            if not game.get("pgn"):
                continue
            games.append(_simplify(game, username))
            if len(games) >= max_games:
                break
        if len(games) >= max_games:
            break

    _CACHE[cache_key] = (time.time(), games)
    return games
