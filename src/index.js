// src/index.js
const express = require('express');
const cors    = require('cors');
const api     = require('./api');
const morgan  = require('morgan');
const { startScheduler } = require('./poller');
const { PORT, CORS_ORIGIN_PRODUCTION, CORS_ORIGIN_LOCAL } = require('./config');

const app = express();

//This prevents undefined entries if you forget to define one in your .env.
const allowed = [CORS_ORIGIN_LOCAL, CORS_ORIGIN_PRODUCTION].filter(Boolean);

app.use(cors({
  origin: (origin, cb) => {
    if (!origin) return cb(null, true);
    if (allowed.includes(origin)) return cb(null, true);
    
    console.warn(`🚫 Blocked CORS request from: ${origin}`);
    cb(new Error(`Origin ${origin} not allowed by CORS`));
  },
  methods: ['GET','POST','PATCH','OPTIONS']
}));

// JSON‑body parsing
app.use(express.json());

app.use(morgan((tokens, req, res) => {
  return [
    tokens.method(req, res),
    tokens.url(req, res),
    tokens.status(req, res),
    tokens['response-time'](req, res), 'ms',
    '- Body:', JSON.stringify(req.body),
    '- Headers:', JSON.stringify(req.headers)
  ].join(' ');
}));


// Mount your admin API
app.use('/admin', api);

app.listen(PORT, () => {
  console.log(`Admin API listening on port ${PORT}`);
  startScheduler();
});
