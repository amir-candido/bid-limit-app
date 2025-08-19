// src/services/createAuthService.js
'use strict';

/**
 * createAuthService - session-based auth using MySQL-backed session store.
 *
 * CommonJS module that returns:
 *   { sessionMiddleware, router, requireAuth, attachUser }
 *
 * Dependencies:
 *   - db: a mysql2/promise Pool or Connection (required)
 *   - sessionSecret: string secret for express-session (required)
 *   - cookieOpts: optional cookie settings (object)
 *   - logger: optional logger (console by default)
 *
 * NOTE: this file expects the package "express-mysql-session" to be installed.
 * Install with:
 *   npm install express-mysql-session
 *
 * The mysql session store works with mysql2 pools/clients in the common usage:
 *   const MySQLStore = require('express-mysql-session')(session);
 *   const store = new MySQLStore({}, dbPool);
 *
 * If you intentionally do not want to add the dependency, the code will throw
 * an informative error so you can choose to install the package.
 */

const express = require('express');
const session = require('express-session');
const bcrypt = require('bcrypt');

module.exports = function createAuthService({ db, sessionSecret, cookieOpts = {}, logger = console }) {
  if (!db) throw new Error('createAuthService: db (mysql2 pool) is required');
  if (!sessionSecret) throw new Error('createAuthService: sessionSecret is required');

  // try to require express-mysql-session (throw friendly error if missing)
  let MySQLStore;
  try {
    MySQLStore = require('express-mysql-session')(session);
  } catch (err) {
    // provide a clear instruction
    throw new Error(
      'Missing dependency "express-mysql-session". Install it with: npm install express-mysql-session\n' +
      'Original error: ' + (err && err.message)
    );
  }

  // Create a session store backed by MySQL.
  // The second argument may be a mysql connection/pool; express-mysql-session supports mysql2 pools.
  // Pass an empty options object for defaults; you can customize schema if needed.
  const sessionStore = new MySQLStore({}, db);

  // session middleware - mount this before your protected routes
  const sessionMiddleware = session({
    store: sessionStore,
    secret: sessionSecret,
    resave: false,
    saveUninitialized: false,
    cookie: Object.assign({
      httpOnly: true,
      secure: false,     // set to true when using https in production
      sameSite: 'lax',
      maxAge: 1000 * 60 * 60 * 8 // 8 hours
    }, cookieOpts)
  });

  // attachUser: convenient middleware to expose req.user from session
  function attachUser(req, res, next) {
    try {
      if (req.session && req.session.user) {
        // shallow copy to avoid accidental mutations of session by user code
        req.user = Object.assign({}, req.session.user);
      }
    } catch (e) {
      // don't block on attach failures
      logger.warn && logger.warn('attachUser error', e && e.message);
    }
    return next();
  }

  // requireAuth middleware - protect endpoints
  function requireAuth(req, res, next) {
    if (req.session && req.session.user && req.session.user.id) {
      return next();
    }
    return res.status(401).json({ error: 'unauthenticated' });
  }

  // Express router for auth endpoints: /auth/login, /auth/logout, /auth/me
  const router = express.Router();

  // POST /auth/login { email, password }
  // NOTE: router uses express.json() for this endpoint specifically to avoid relying
  // on global body parser ordering.
  router.post('/login', express.json(), async (req, res) => {
    const { email, password } = req.body || {};
    if (!email || !password) {
      return res.status(400).json({ error: 'email_and_password_required' });
    }

    try {
      // Find user by email
      const [rows] = await db.execute(
        'SELECT id, userUuid, email, passwordHash, role FROM users WHERE email = ? LIMIT 1',
        [String(email).toLowerCase()]
      );

      if (!rows || rows.length === 0) {
        return res.status(401).json({ error: 'invalid_credentials' });
      }

      const user = rows[0];
      const valid = await bcrypt.compare(String(password), user.passwordHash);
      if (!valid) {
        return res.status(401).json({ error: 'invalid_credentials' });
      }

      // Store minimal user info in session (avoid storing sensitive data)
      req.session.user = {
        id: user.id,
        userUuid: user.userUuid,
        email: user.email,
        role: user.role || 'admin'
      };

      // Save session and respond with safe user object
      req.session.save((err) => {
        if (err) {
          logger.error && logger.error('session.save error', err && err.message);
          return res.status(500).json({ error: 'session_save_failed' });
        }
        return res.json({ ok: true, user: req.session.user });
      });
    } catch (err) {
      logger.error && logger.error('Login error', err && err.message);
      return res.status(500).json({ error: 'internal_error' });
    }
  });

  // POST /auth/logout
  router.post('/logout', (req, res) => {
    if (!req.session) return res.json({ ok: true });
    const sid = req.sessionID;
    req.session.destroy((err) => {
      if (err) {
        logger.warn && logger.warn('Session destroy failed', err && err.message);
        return res.status(500).json({ error: 'logout_failed' });
      }
      // Clear cookie - default name is connect.sid (unless changed)
      res.clearCookie('connect.sid');
      return res.json({ ok: true, sid });
    });
  });

  // GET /auth/me
  router.get('/me', (req, res) => {
    if (req.session && req.session.user) {
      return res.json({ user: req.session.user });
    }
    return res.status(401).json({ error: 'unauthenticated' });
  });

  // return public API
  return {
    sessionMiddleware,
    router,
    requireAuth,
    attachUser,
    // expose the underlying store for migrations/inspection if needed
    _sessionStore: sessionStore
  };
};
