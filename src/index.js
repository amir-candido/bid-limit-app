const express = require('express');
const api = require('./api');
const { startScheduler } = require('./poller');
const { PORT } = require('./config');

const app = express();
app.use('/admin', api);

app.listen(PORT, () => {
  console.log(`Bid‑limit service listening on port ${PORT}`);
  startScheduler();
});
