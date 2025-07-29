// src/index.js
const express = require('express');
const cors    = require('cors');
const api     = require('./api');
const { startScheduler } = require('./poller');
const { PORT } = require('./config');

const app = express();

// Allow your UI origin (or all origins) to access these endpoints:
app.use(
  cors({
    origin: process.env.CORS_ORIGIN || '*', // or 'http://localhost:5173'
    methods: ['GET','POST','PATCH','OPTIONS'],
    allowedHeaders: ['Content-Type','Authorization','BDXAPI_NAME'],
    credentials: false
  })
);

// JSON‑body parsing
app.use(express.json());

// Mount your admin API
app.use('/admin', api);

app.listen(PORT, () => {
  console.log(`Admin API listening on port ${PORT}`);
  startScheduler();
});
