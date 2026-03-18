const fs = require('fs-extra');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const UPLOAD_DIR = path.resolve(process.env.UPLOAD_DIR || './uploads');
const FILES_SUBDOMAIN = process.env.FILES_SUBDOMAIN || 'files';
const DOMAIN = process.env.DOMAIN;
const META_FILE = path.join(UPLOAD_DIR, '.meta.json');

async function ensureUploadDir() {
  await fs.ensureDir(UPLOAD_DIR);
  if (!(await fs.pathExists(META_FILE))) await fs.writeJson(META_FILE, []);
}

async function readMeta() {
  await ensureUploadDir();
  return await fs.readJson(META_FILE);
}

async function writeMeta(data) {
  await fs.writeJson(META_FILE, data, { spaces: 2 });
}

async function appendMeta(entry) {
  const meta = await readMeta();
  meta.push(entry);
  await writeMeta(meta);
  return entry;
}

/**
 * Stream file directly to disk using GramJS iterDownload.
 * Uses 1MB chunks for better throughput on large files.
 */
async function saveFileStream(client, msg, originalName, mimeType) {
  await ensureUploadDir();
  const ext = path.extname(originalName) || '';
  const uuid = uuidv4();
  const fileName = `${uuid}${ext}`;
  const filePath = path.join(UPLOAD_DIR, fileName);

  const writeStream = fs.createWriteStream(filePath);

  for await (const chunk of client.iterDownload({
    file: msg.media,
    requestSize: 1024 * 1024, // 1MB per chunk for better throughput
  })) {
    if (!writeStream.write(chunk)) {
      // Backpressure: wait for drain
      await new Promise(resolve => writeStream.once('drain', resolve));
    }
  }

  await new Promise((resolve, reject) => {
    writeStream.end();
    writeStream.on('finish', resolve);
    writeStream.on('error', reject);
  });

  return { uuid, filePath, ext };
}

async function saveFile(buffer, originalName, mimeType, size) {
  await ensureUploadDir();
  const ext = path.extname(originalName) || '';
  const uuid = uuidv4();
  const fileName = `${uuid}${ext}`;
  const filePath = path.join(UPLOAD_DIR, fileName);
  await fs.outputFile(filePath, buffer);
  const entry = {
    id: uuid,
    originalName,
    fileName,
    mimeType,
    size,
    uploadedAt: new Date().toISOString(),
    url: `https://${FILES_SUBDOMAIN}.${DOMAIN}/files/${fileName}`
  };
  await appendMeta(entry);
  return entry;
}

async function listFiles() { return await readMeta(); }

async function deleteFile(id) {
  const meta = await readMeta();
  const index = meta.findIndex(f => f.id === id);
  if (index === -1) return false;
  await fs.remove(path.join(UPLOAD_DIR, meta[index].fileName));
  meta.splice(index, 1);
  await writeMeta(meta);
  return true;
}

async function deleteAllFiles() {
  const meta = await readMeta();
  for (const entry of meta) await fs.remove(path.join(UPLOAD_DIR, entry.fileName));
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

module.exports = { saveFile, saveFileStream, appendMeta, listFiles, deleteFile, deleteAllFiles, getTotalStorage, formatSize };
