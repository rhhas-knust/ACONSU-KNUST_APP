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
  return mongoose.connection;
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

module.exports = { connectDB, createSessionStore };
