const models = require('./models');

const RESOURCE_MODELS = {
  departments: models.Department,
  events: models.Event,
  sermons: models.Sermon,
  joinRequests: models.JoinRequest,
  prayerRequests: models.PrayerRequest,
  testimonies: models.Testimony,
  contactMessages: models.ContactMessage,
  pages: models.CustomPage,
  eventRegistrations: models.EventRegistration,
  executives: models.Executive,
  members: models.Member
};

function genId(prefix) {
  return `${prefix}_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
}

function clean(doc) {
  if (!doc) return doc;
  const obj = doc.toObject ? doc.toObject() : doc;
  delete obj._id;
  delete obj.__v;
  return obj;
}

function modelFor(resource) {
  const model = RESOURCE_MODELS[resource];
  if (!model) throw new Error(`Unknown resource: ${resource}`);
  return model;
}

async function getAll(resource) {
  const docs = await modelFor(resource).find({}).lean();
  return docs.map((d) => {
    delete d._id;
    delete d.__v;
    return d;
  });
}

async function getById(resource, id) {
  const doc = await modelFor(resource).findOne({ id }).lean();
  if (!doc) return null;
  delete doc._id;
  delete doc.__v;
  return doc;
}

async function create(resource, data, idPrefix) {
  const Model = modelFor(resource);
  const id = data.id || genId(idPrefix || resource.slice(0, 4));
  const doc = await Model.create({ ...data, id });
  return clean(doc);
}

async function updateById(resource, id, data) {
  const Model = modelFor(resource);
  const doc = await Model.findOneAndUpdate(
    { id },
    { $set: { ...data, id } },
    { new: true }
  );
  return clean(doc);
}

async function patchById(resource, id, data) {
  const Model = modelFor(resource);
  const doc = await Model.findOneAndUpdate({ id }, { $set: data }, { new: true });
  return clean(doc);
}

async function removeById(resource, id) {
  await modelFor(resource).deleteOne({ id });
  return true;
}

async function getSettings() {
  let doc = await models.Settings.findOne({ singleton: 'main' }).lean();
  if (!doc) return {};
  delete doc._id;
  delete doc.__v;
  return doc;
}

async function setSettings(data) {
  const doc = await models.Settings.findOneAndUpdate(
    { singleton: 'main' },
    { $set: { ...data, singleton: 'main' } },
    { new: true, upsert: true }
  );
  return clean(doc);
}

module.exports = {
  genId, getAll, getById, create, updateById, patchById, removeById,
  getSettings, setSettings
};
