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
    bidLimit DECIMAL(15,2) DEFAULT NULL,
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

CREATE TABLE suspension_actions (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  auctionUuid CHAR(36),
  userUuid CHAR(36),
  registrantUuid CHAR(36),
  action VARCHAR(32), -- 'awaiting_deposit', 'unsuspend', 'limit_update'
  actor VARCHAR(64),  -- 'system' or admin username
  meta JSON NULL,
  createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);