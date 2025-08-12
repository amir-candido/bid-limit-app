// webhook.js
const express = require('express');
const mysql = require('mysql2/promise');
const Redis = require('ioredis');

const app = express();
app.use(express.json());

// MySQL connection
const db = mysql.createPool({
  host: 'localhost',
  user: 'amir',
  password: '@mirc@nteetu!',
  database: 'bidapp'
});

// Redis connection
const redis = new Redis({
  host: '127.0.0.1',
  port: 6379
});

// Webhook endpoint
app.post('/bidjs/webhook', async (req, res) => {
  try {
    const { auctionUuid, registrantUuid, userUuid, firstName, lastName, bidLimit } = req.body;

    // 1. Upsert into MySQL
    const sql = `
      INSERT INTO registrants
        (auctionUuid, registrantUuid, userUuid, firstName, lastName, bidLimit)
      VALUES (?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        firstName = VALUES(firstName),
        lastName = VALUES(lastName),
        bidLimit = VALUES(bidLimit),
        updatedAt = CURRENT_TIMESTAMP
    `;

    await db.query(sql, [auctionUuid, registrantUuid, userUuid, firstName, lastName, bidLimit]);

    // 2. HMSET into Redis
    const redisKey = `registrant:${auctionUuid}:${userUuid}`;
    await redis.hset(redisKey, {
      auctionUuid,
      registrantUuid,
      userUuid,
      firstName: firstName || '',
      lastName: lastName || '',
      bidLimit: bidLimit || ''
    });

    // 3. Return HTTP 200
    res.sendStatus(200);

  } catch (err) {
    console.error('Webhook processing error:', err);
    res.sendStatus(500);
  }
});

app.listen(3000, () => {
  console.log('Webhook handler listening on port 3000');
});
