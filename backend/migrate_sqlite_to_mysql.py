"""Copy existing DeepBoard SQLite users and game history into configured MySQL.

Run from the backend directory after setting DB_BACKEND=mysql in backend/.env.
The destination must be empty; this script never overwrites MySQL accounts.
"""
import os
import sqlite3
import sys

import app as backend


def main():
    if backend.DB_BACKEND != "mysql":
        print("Set DB_BACKEND=mysql in backend/.env, then run this script again.")
        return 2

    source_path = backend.DB_PATH
    if not os.path.isfile(source_path):
        print("No SQLite database was found at:", source_path)
        return 2

    source = sqlite3.connect(source_path)
    source.row_factory = sqlite3.Row
    try:
        tables = {row[0] for row in source.execute(
            "SELECT name FROM sqlite_master WHERE type='table'"
        ).fetchall()}
        if "users" not in tables:
            print("The SQLite database has no users table.")
            return 2

        user_columns = {row[1] for row in source.execute("PRAGMA table_info(users)").fetchall()}
        selected = ["id", "username", "password_hash", "created_at"]
        for optional in ("email", "google_sub"):
            if optional in user_columns:
                selected.append(optional)
        source_users = source.execute(
            "SELECT " + ", ".join(selected) + " FROM users ORDER BY id"
        ).fetchall()

        source_games = []
        if "games" in tables:
            game_columns = {row[1] for row in source.execute("PRAGMA table_info(games)").fetchall()}
            required = {
                "user_id", "game_key", "source", "ref", "white", "black", "result",
                "reason", "game_date", "plies", "pgn", "analysis_json", "game_json", "saved_at",
            }
            if required.issubset(game_columns):
                source_games = source.execute(
                    "SELECT user_id, game_key, source, ref, white, black, result, reason, "
                    "game_date, plies, pgn, analysis_json, game_json, saved_at "
                    "FROM games ORDER BY id"
                ).fetchall()

        with backend.db_connect() as destination:
            user_count = destination.execute("SELECT COUNT(*) AS total FROM users").fetchone()["total"]
            game_count = destination.execute("SELECT COUNT(*) AS total FROM games").fetchone()["total"]
            if user_count or game_count:
                print("The MySQL destination already contains users or games.")
                print("No data was changed. Use an empty DeepBoard database for this migration.")
                return 2

            inserted_users = 0
            for row in source_users:
                values = dict(row)
                destination.execute(
                    "INSERT INTO users (id, username, password_hash, created_at, email, google_sub) "
                    "VALUES (?, ?, ?, ?, ?, ?)",
                    (values["id"], values["username"], values["password_hash"], values["created_at"],
                     values.get("email"), values.get("google_sub")),
                )
                inserted_users += 1

            inserted_games = 0
            for row in source_games:
                destination.execute(
                    "INSERT INTO games "
                    "(user_id, game_key, source, ref, white, black, result, reason, game_date, plies, "
                    "pgn, analysis_json, game_json, saved_at) "
                    "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                    tuple(row),
                )
                inserted_games += 1

        print("Migration complete.")
        print("Users copied:", inserted_users)
        print("Games copied:", inserted_games)
        print("The original SQLite file was not modified.")
        return 0
    finally:
        source.close()


if __name__ == "__main__":
    sys.exit(main())
