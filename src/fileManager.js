const fs = require('fs-extra');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const UPLOAD_DIR = process.env.UPLOAD_DIR || './uploads';
const FILES_SUBDOMAIN = process.env.FILES_SUBDOMAIN || 'files';
const DOMAIN = process.env.DOMAIN;

const META_FILE = path.join(UPLOAD_DIR, '.meta.json');

async function ensureUploadDir() {
  await fs.ensureDir(UPLOAD_DIR);
  if (!(await fs.pathExists(META_FILE))) {
    await fs.writeJson(META_FILE, []);
  }
}

async function readMeta() {
  await ensureUploadDir();
  return await fs.readJson(META_FILE);
}

async function writeMeta(data) {
  await fs.writeJson(META_FILE, data, { spaces: 2 });
}

async function saveFile(fileStream, originalName, mimeType, size) {
  await ensureUploadDir();
  const ext = path.extname(originalName) || '';
  const uuid = uuidv4();
  const fileName = `${uuid}${ext}`;
  const filePath = path.join(UPLOAD_DIR, fileName);

  await fs.outputFile(filePath, fileStream);

  const meta = await readMeta();
  const entry = {
    id: uuid,
    originalName,
    fileName,
    mimeType,
    size,
    uploadedAt: new Date().toISOString(),
    url: `https://${FILES_SUBDOMAIN}.${DOMAIN}/files/${fileName}`
  };
  meta.push(entry);
  await writeMeta(meta);

  return entry;
}

async function listFiles() {
  return await readMeta();
}

async function deleteFile(id) {
  const meta = await readMeta();
  const index = meta.findIndex(f => f.id === id);
  if (index === -1) return false;

  const entry = meta[index];
  const filePath = path.join(UPLOAD_DIR, entry.fileName);
  await fs.remove(filePath);

  meta.splice(index, 1);
  await writeMeta(meta);
  return true;
}

async function deleteAllFiles() {
  const meta = await readMeta();
  for (const entry of meta) {
    const filePath = path.join(UPLOAD_DIR, entry.fileName);
    await fs.remove(filePath);
  }
  await writeMeta([]);
  return meta.length;
}

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

async function getTotalStorage() {
  const meta = await readMeta();
  const total = meta.reduce((sum, f) => sum + (f.size || 0), 0);
  return { count: meta.length, total: formatSize(total) };
}

module.exports = { saveFile, listFiles, deleteFile, deleteAllFiles, getTotalStorage, formatSize };
