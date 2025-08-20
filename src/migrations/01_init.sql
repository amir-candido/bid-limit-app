-- Create the database (if not already created)
CREATE DATABASE IF NOT EXISTS bidapp
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE bidapp;

-- Registrants table
CREATE TABLE IF NOT EXISTS registrants (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    auctionUuid CHAR(36) NOT NULL,
    registrantUuid CHAR(36) NOT NULL,
    userUuid CHAR(36) NOT NULL,
    fullName VARCHAR(100) DEFAULT NULL,
    bidLimit BIGINT DEFAULT NULL,
    createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updatedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uniq_auction_user (auctionUuid, userUuid)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Auctions table (optional for metadata; helps with joins later)
CREATE TABLE IF NOT EXISTS auctions (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    auctionUuid CHAR(36) NOT NULL,
    title VARCHAR(255) DEFAULT NULL,
    createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updatedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uniq_auctionUuid (auctionUuid)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS audit_logs (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  uuid CHAR(36) NOT NULL, /* GUID for idempotency / trace */
  auction_uuid CHAR(36) DEFAULT NULL,
  user_uuid CHAR(36) DEFAULT NULL,
  registrant_uuid CHAR(36) DEFAULT NULL,
  event_type VARCHAR(100) NOT NULL,   -- e.g. 'awaiting_deposit', 'unsuspend', 'limit_update', 'retry_enqueued'
  actor VARCHAR(128) NOT NULL,         -- 'system' or admin username or service name
  severity ENUM('INFO','WARN','ERROR') NOT NULL DEFAULT 'INFO',
  meta JSON DEFAULT NULL,              -- arbitrary structured data (api response, error, requests)
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  processed TINYINT(1) NOT NULL DEFAULT 0, -- optional marker for worker processing
  PRIMARY KEY (id),
  UNIQUE KEY ux_audit_uuid (uuid),
  KEY idx_auction_created (auction_uuid, created_at),
  KEY idx_user_created (user_uuid, created_at),
  KEY idx_event_created (event_type, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS users (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  email VARCHAR(255) NOT NULL UNIQUE,
  passwordHash VARCHAR(255) NOT NULL,
  role VARCHAR(50) DEFAULT 'admin',
  createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updatedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


