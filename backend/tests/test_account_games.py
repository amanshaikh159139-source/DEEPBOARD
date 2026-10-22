"""SQLite-backed API tests for account-owned DeepBoard game history."""
import os
import sys
import tempfile
import unittest

# Keep tests away from a developer's real local database and signed sessions.
_TEST_ROOT = tempfile.TemporaryDirectory()
os.environ["DB_BACKEND"] = "sqlite"
os.environ["DEEPBOARD_DB_PATH"] = os.path.join(_TEST_ROOT.name, "import.sqlite3")
os.environ["DEEPBOARD_SECRET_KEY"] = "deepboard-test-secret"

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))
import app as backend  # noqa: E402


class AccountGameApiTests(unittest.TestCase):
    def setUp(self):
        self.db_dir = tempfile.TemporaryDirectory()
        backend.DB_BACKEND = "sqlite"
        backend.DB_PATH = os.path.join(self.db_dir.name, "test.sqlite3")
        backend.init_user_db()
        self.client = backend.app.test_client()

    def tearDown(self):
        self.db_dir.cleanup()

    def register(self, username, email):
        return self.client.post("/api/auth/register", json={
            "username": username,
            "email": email,
            "password": "a-safe-test-password",
        })

    def test_guest_cannot_read_or_write_account_games(self):
        self.assertEqual(self.client.get("/api/games").status_code, 401)
        self.assertEqual(self.client.post("/api/games", json={"id": "g1"}).status_code, 401)

    def test_signed_in_user_can_save_update_list_and_delete_game(self):
        response = self.register("player_one", "one@example.test")
        self.assertEqual(response.status_code, 201, response.get_json())

        first = {
            "id": "test-game-1",
            "savedAt": 1000,
            "source": "bot",
            "white": "player_one",
            "black": "Stockfish",
            "result": "1-0",
            "plies": 24,
            "pgn": "1. e4 e5 2. Nf3 Nc6",
            "analysis": None,
        }
        response = self.client.post("/api/games", json=first)
        self.assertEqual(response.status_code, 200, response.get_json())

        updated = dict(first, savedAt=2000, result="0-1",
                       analysis={"accuracy": {"w": 81.2, "b": 90.0}})
        response = self.client.post("/api/games", json=updated)
        self.assertEqual(response.status_code, 200, response.get_json())

        listed = self.client.get("/api/games")
        self.assertEqual(listed.status_code, 200)
        games = listed.get_json()["games"]
        self.assertEqual(len(games), 1)
        self.assertEqual(games[0]["result"], "0-1")
        self.assertEqual(games[0]["analysis"]["accuracy"]["b"], 90.0)

        response = self.client.delete("/api/games/test-game-1")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(self.client.get("/api/games").get_json()["games"], [])

    def test_game_history_isolated_between_accounts(self):
        self.assertEqual(self.register("player_one", "one@example.test").status_code, 201)
        self.client.post("/api/games", json={"id": "private-game", "savedAt": 1, "result": "1-0"})
        self.client.post("/api/auth/logout", json={})
        self.assertEqual(self.register("player_two", "two@example.test").status_code, 201)
        games = self.client.get("/api/games").get_json()["games"]
        self.assertEqual(games, [])

    def test_clear_games_only_clears_the_signed_in_account(self):
        self.assertEqual(self.register("player_one", "one@example.test").status_code, 201)
        for game_id in ("one", "two"):
            response = self.client.post("/api/games", json={
                "id": game_id, "savedAt": 10, "result": "1/2-1/2"
            })
            self.assertEqual(response.status_code, 200)
        self.assertEqual(len(self.client.get("/api/games").get_json()["games"]), 2)
        self.assertEqual(self.client.delete("/api/games").status_code, 200)
        self.assertEqual(self.client.get("/api/games").get_json()["games"], [])


if __name__ == "__main__":
    unittest.main()
