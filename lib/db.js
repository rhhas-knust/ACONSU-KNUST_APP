const mongoose = require('mongoose');
const dns = require('dns');
// connect-mongo v6 is an ESM package with a CJS build that exposes the store
// as a NAMED export; `require('connect-mongo')` itself is the module object,
// not the store, so destructuring here is deliberate.
const { MongoStore } = require('connect-mongo');

// Node's default DNS resolver sometimes fails the special SRV lookup that
// `mongodb+srv://` URIs need (common on Windows / some routers), even when
// the same connection works fine in tools like Compass. Pointing Node at
// public DNS resolvers fixes this without touching OS-level network settings.
dns.setServers(['8.8.8.8', '1.1.1.1']);

let connected = false;

async function connectDB() {
  if (connected) return mongoose.connection;
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    throw new Error(
      'MONGODB_URI is not set. Add it to your .env file (see .env.example) — the app cannot start without it.'
    );
  }
  await mongoose.connect(uri, {
    // sensible production defaults
    maxPoolSize: 10,
    serverSelectionTimeoutMS: 8000
  });
  connected = true;
  console.log('Connected to MongoDB Atlas');
  watchConnection();
  return mongoose.connection;
}

// A connection that drops AFTER startup used to be silent. The server keeps
// listening, every page still loads, and every query behind them fails — which
// looks like the app being broken rather than the database being away. These
// say so in the logs, where Render shows them.
let watching = false;
function watchConnection() {
  if (watching) return;
  watching = true;
  mongoose.connection.on('disconnected', () => {
    connected = false;
    console.error('MongoDB: connection LOST — requests needing the database will fail until it returns');
  });
  mongoose.connection.on('reconnected', () => {
    connected = true;
    console.log('MongoDB: reconnected');
  });
  mongoose.connection.on('error', (err) => {
    console.error('MongoDB error:', err.message);
  });
}

const READY_STATES = ['disconnected', 'connected', 'connecting', 'disconnecting'];

// What the database is doing right now, in terms safe to show anyone: no URI,
// no credentials, no host. `pingMs` is a real round trip rather than a cached
// flag, because mongoose can report 'connected' while the cluster has stopped
// answering queries.
async function dbStatus() {
  const conn = mongoose.connection;
  const state = READY_STATES[conn.readyState] || 'unknown';
  const status = { state, connected: conn.readyState === 1, name: conn.name || '', pingMs: null };
  if (conn.readyState !== 1 || !conn.db) return status;
  const started = Date.now();
  try {
    await conn.db.admin().ping();
    status.pingMs = Date.now() - started;
  } catch (e) {
    // Answered the handshake, will not answer a query. That is still down.
    status.connected = false;
    status.state = 'unreachable';
    status.error = e.message;
  }
  return status;
}

// Sessions live in MongoDB rather than in the server's memory. With the
// default MemoryStore, every restart — and on Render that means every single
// deploy — signed out every admin, every office holder and every member at
// once, on the website and inside the Android app alike. It also made more
// than one instance impossible, since each would hold its own sessions.
// Returns undefined when there's no database configured, which leaves
// express-session on its in-memory default.
function createSessionStore() {
  const uri = process.env.MONGODB_URI;
  if (!uri) return undefined;
  return MongoStore.create({
    mongoUrl: uri,
    collectionName: 'sessions',
    ttl: 8 * 60 * 60,      // matches the cookie's own 8 hours
    touchAfter: 60 * 10    // only rewrite an idle session every 10 minutes
  });
}

module.exports = { connectDB, createSessionStore, dbStatus };
