const Redis                       = require('ioredis');
const { REDIS_HOST, REDIS_PORT }   = require('./config');


// Redis connection
const redis = new Redis({
  host: REDIS_HOST,
  port: REDIS_PORT
});
redis.on('error', (err) => console.error('Redis error:', err));

module.exports = { redis };