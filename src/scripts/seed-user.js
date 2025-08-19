// scripts/seed-user.js
const bcrypt = require('bcrypt');
const { db } = require('../src/db'); // adapt path if different

async function run() {
  const email = process.argv[2];
  const password = process.argv[3];

  if (!email || !password) {
    console.error('Usage: node scripts/seed-user.js email@example.com password123');
    process.exit(2);
  }

  const passwordHash = await bcrypt.hash(password, 10);

  const sql = `INSERT INTO users (email, passwordHash) VALUES (?, ?, ?)`;
  try {
    await db.execute(sql, [email, passwordHash]);
    console.log('User created:', { email });
    process.exit(0);
  } catch (err) {
    console.error('Failed to create user:', err);
    process.exit(1);
  }
}

run();
