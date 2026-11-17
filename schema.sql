-- MySQL schema for the portfolio contact form.
-- The app creates this table by itself on first start (db.create_all()).
-- Use this file only if you prefer to create it by hand:
--
--   mysql -u root -p < schema.sql

CREATE DATABASE IF NOT EXISTS portfolio
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE portfolio;

CREATE TABLE IF NOT EXISTS contact_messages (
  id          INT          NOT NULL AUTO_INCREMENT,
  name        VARCHAR(80)  NOT NULL,
  email       VARCHAR(120) NOT NULL,
  message     TEXT         NOT NULL,
  ip_address  VARCHAR(45)  NULL,
  created_at  DATETIME     NOT NULL,
  PRIMARY KEY (id),
  KEY ix_contact_messages_ip_address (ip_address),
  KEY ix_contact_messages_created_at (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- A dedicated database user (replace the password!):
-- CREATE USER 'portfolio'@'localhost' IDENTIFIED BY 'change-this-password';
-- GRANT SELECT, INSERT ON portfolio.* TO 'portfolio'@'localhost';
-- If you let the app create the table itself, also grant CREATE.
