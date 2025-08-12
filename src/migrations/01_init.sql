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
    startTime DATETIME DEFAULT NULL,
    endTime DATETIME DEFAULT NULL,
    createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updatedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uniq_auctionUuid (auctionUuid)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
