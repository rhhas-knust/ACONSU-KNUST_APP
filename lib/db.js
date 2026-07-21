const mongoose = require('mongoose');
const dns = require('dns');

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

module.exports = { connectDB };
