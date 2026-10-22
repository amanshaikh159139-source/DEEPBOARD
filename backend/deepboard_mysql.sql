-- DeepBoard MySQL schema for XAMPP / phpMyAdmin.
-- Import this file in phpMyAdmin. It creates the database used by backend/.env.
CREATE DATABASE IF NOT EXISTS deepboard_db
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;
USE deepboard_db;

CREATE TABLE IF NOT EXISTS users (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  username VARCHAR(32) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  email VARCHAR(254) NULL,
  google_sub VARCHAR(255) NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_users_username (username),
  UNIQUE KEY uq_users_email (email),
  UNIQUE KEY uq_users_google_sub (google_sub)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS games (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id BIGINT UNSIGNED NOT NULL,
  game_key VARCHAR(128) NOT NULL,
  source VARCHAR(32) NULL,
  ref VARCHAR(1024) NULL,
  white VARCHAR(255) NULL,
  black VARCHAR(255) NULL,
  result VARCHAR(8) NULL,
  reason VARCHAR(255) NULL,
  game_date VARCHAR(32) NULL,
  plies INT UNSIGNED NULL,
  pgn LONGTEXT NULL,
  analysis_json LONGTEXT NULL,
  game_json LONGTEXT NOT NULL,
  saved_at BIGINT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_games_user_game (user_id, game_key),
  KEY idx_games_user_saved (user_id, saved_at),
  CONSTRAINT fk_games_user FOREIGN KEY (user_id)
    REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
