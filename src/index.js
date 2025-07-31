// src/index.js
const express = require('express');
const cors    = require('cors');
const api     = require('./api');
const morgan  = require('morgan');
const { startScheduler } = require('./poller');
const { PORT } = require('./config');

const app = express();

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

// Allow your UI origin (or all origins) to access these endpoints:
app.use(
  cors({
    origin: 'https://bid-limit-ui.pages.dev',  
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
