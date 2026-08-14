// Run once after setting MONGODB_URI in .env:
//   node migrate-to-mongo.js
// Safe to re-run — it upserts by "id", so it won't create duplicates.

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const { connectDB } = require('./lib/db');
const models = require('./lib/models');

const DATA_DIR = path.join(__dirname, 'data');

function readJSON(file) {
  const p = path.join(DATA_DIR, `${file}.json`);
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, 'utf-8'));
}

async function upsertMany(Model, items) {
  if (!items || !items.length) return 0;
  let count = 0;
  for (const item of items) {
    await Model.findOneAndUpdate({ id: item.id }, { $set: item }, { upsert: true, new: true });
    count++;
  }
  return count;
}

async function run() {
  console.log('Connecting to MongoDB Atlas...');
  await connectDB();

  const departments = readJSON('departments');
  const events = readJSON('events');
  const sermons = readJSON('sermons');
  const joinRequests = readJSON('joinRequests');
  const prayerRequests = readJSON('prayerRequests');
  const testimonies = readJSON('testimonies');
  const contactMessages = readJSON('contactMessages');
  const settings = readJSON('settings');

  const results = {
    departments: await upsertMany(models.Department, departments),
    events: await upsertMany(models.Event, events),
    sermons: await upsertMany(models.Sermon, sermons),
    joinRequests: await upsertMany(models.JoinRequest, joinRequests),
    prayerRequests: await upsertMany(models.PrayerRequest, prayerRequests),
    testimonies: await upsertMany(models.Testimony, testimonies),
    contactMessages: await upsertMany(models.ContactMessage, contactMessages)
  };

  if (settings && Object.keys(settings).length) {
    await models.Settings.findOneAndUpdate(
      { singleton: 'main' },
      { $set: { ...settings, singleton: 'main' } },
      { upsert: true }
    );
    results.settings = 1;
  }

  console.log('Migration complete:', results);
  await mongoose.connection.close();
  process.exit(0);
}

run().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
