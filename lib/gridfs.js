const mongoose = require('mongoose');

let bucket = null;

// Call only after connectDB() has resolved — needs an open connection.
function getBucket() {
  if (bucket) return bucket;
  bucket = new mongoose.mongo.GridFSBucket(mongoose.connection.db, { bucketName: 'uploads' });
  return bucket;
}

function uploadBuffer(buffer, filename, metadata) {
  return new Promise((resolve, reject) => {
    const uploadStream = getBucket().openUploadStream(filename, { metadata });
    uploadStream.on('error', reject);
    uploadStream.on('finish', () => resolve(uploadStream.id));
    uploadStream.end(buffer);
  });
}

async function listFiles(query) {
  const cursor = getBucket().find(query || {}).sort({ uploadDate: -1 });
  return cursor.toArray();
}

async function findFile(id) {
  const files = await getBucket().find({ _id: new mongoose.Types.ObjectId(id) }).toArray();
  return files[0] || null;
}

function openDownloadStream(id) {
  return getBucket().openDownloadStream(new mongoose.Types.ObjectId(id));
}

async function deleteFile(id) {
  await getBucket().delete(new mongoose.Types.ObjectId(id));
}

module.exports = { getBucket, uploadBuffer, listFiles, findFile, openDownloadStream, deleteFile };
