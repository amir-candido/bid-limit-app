// src/db.js
const mysql   = require('mysql2/promise');
const { DB_USER, DB_PASSWORD } = require('./config');

// MySQL connection
const db = mysql.createPool({
  host: 'localhost',
  user: DB_USER,
  password: DB_PASSWORD,
  database: 'bidapp',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0  
});
db.on && db.on('error', (err) => console.error('MySQL pool error:', err)); 

module.exports = { db };
