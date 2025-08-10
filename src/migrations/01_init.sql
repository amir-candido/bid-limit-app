BEGIN TRANSACTION;

PRAGMA foreign_keys = ON;

-- 1. registrants
CREATE TABLE IF NOT EXISTS registrants (
  auctionUuid     TEXT NOT NULL,
  registrantUuid  TEXT NOT NULL,
  bidLimit        INTEGER,
  currentTotal    INTEGER DEFAULT 0,
  fullname        TEXT,
  email           TEXT,
  status          TEXT NOT NULL DEFAULT 'APPROVED',
  PRIMARY KEY (auctionUuid, registrantUuid)
);


-- 2. current_highest
CREATE TABLE IF NOT EXISTS current_highest (
  auctionUuid       TEXT NOT NULL,
  listingUuid       TEXT NOT NULL,
  bidUuid           TEXT NOT NULL,
  registrantUuid    TEXT NOT NULL,
  PRIMARY KEY (auctionUuid, registrantUuid)
);

-- 3. index for fast lookups
CREATE INDEX IF NOT EXISTS idx_ch_user 
  ON current_highest (auctionUuid, registrantUuid);
COMMIT;