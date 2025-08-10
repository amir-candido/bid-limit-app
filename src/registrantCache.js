// src/registrantCache.js
const { fetchAllRegistrantsByAuctionId } = require('./bidjs-rest');

class RegistrantCache {
  constructor() {
    // Map<auctionId, Map<registrantUuid, {name,email}>>
    this.cache = new Map();
  }

  /** Populate (or refresh) the cache for a given auction */
  async loadAuction(auctionId) {
    const entries = await fetchAllRegistrantsByAuctionId(auctionId);
    const m = new Map();
    for (const r of entries) {
      m.set(r.registrantUuid, {
        name: `${r.firstName} ${r.lastName}`.trim(),
        email: r.email
      });
    }
    this.cache.set(auctionId, m);
  }

  /** Get profile {name,email} or null */
  get(auctionId, registrantUuid) {
    return this.cache.get(auctionId)?.get(registrantUuid) || null;
  }
}

module.exports = new RegistrantCache();
