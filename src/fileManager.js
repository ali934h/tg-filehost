"use strict";

const fs = require("fs-extra");
const path = require("path");
const { v4: uuidv4 } = require("uuid");
const cfg = require("./config");
const logger = require("./logger");

const META_FILE = path.join(cfg.uploadDir, ".meta.json");
const TMP_DIR = path.join(cfg.uploadDir, ".tmp");

let metaQueue = Promise.resolve();

async function ensureDirs() {
  await fs.ensureDir(cfg.uploadDir);
  await fs.ensureDir(TMP_DIR);
  if (!(await fs.pathExists(META_FILE))) {
    await fs.writeJson(META_FILE, []);
  }
}

async function readMeta() {
  await ensureDirs();
  try {
    return await fs.readJson(META_FILE);
  } catch (err) {
    logger.error("Failed to read meta, resetting:", err.message);
    await fs.writeJson(META_FILE, []);
    return [];
  }
}

// Serialize all meta writes through a single promise chain to avoid
// read-modify-write races when multiple uploads finish concurrently.
function withMetaLock(fn) {
  metaQueue = metaQueue.then(fn, fn);
  return metaQueue;
}

async function appendMeta(entry) {
  return withMetaLock(async () => {
    const meta = await readMeta();
    meta.push(entry);
    await fs.writeJson(META_FILE, meta, { spaces: 2 });
    return entry;
  });
}

async function removeMeta(id) {
  return withMetaLock(async () => {
    const meta = await readMeta();
    const idx = meta.findIndex((f) => f.id === id);
    if (idx === -1) return null;
    const [removed] = meta.splice(idx, 1);
    await fs.writeJson(META_FILE, meta, { spaces: 2 });
    return removed;
  });
}

async function clearMeta() {
  return withMetaLock(async () => {
    const meta = await readMeta();
    await fs.writeJson(META_FILE, [], { spaces: 2 });
    return meta;
  });
}

async function listFiles() {
  return readMeta();
}

async function findById(id) {
  const meta = await readMeta();
  return meta.find((f) => f.id === id) || null;
}

async function findByShortId(shortId) {
  const meta = await readMeta();
  const matches = meta.filter((f) => f.id.startsWith(shortId));
  if (matches.length === 0) return { match: null, ambiguous: false };
  if (matches.length > 1) return { match: null, ambiguous: true, matches };
  return { match: matches[0], ambiguous: false };
}

async function deleteFile(id) {
  const removed = await removeMeta(id);
  if (!removed) return false;
  try {
    await fs.remove(path.join(cfg.uploadDir, removed.fileName));
  } catch (err) {
    logger.warn(`Failed to remove file ${removed.fileName}:`, err.message);
  }
  return true;
}

async function deleteAllFiles() {
  const removed = await clearMeta();
  for (const entry of removed) {
    try {
      await fs.remove(path.join(cfg.uploadDir, entry.fileName));
    } catch (err) {
      logger.warn(`Failed to remove file ${entry.fileName}:`, err.message);
    }
  }
  return removed.length;
}

/**
 * Stream a Telegram document/photo to disk via gramJS iterDownload.
 * Writes to a .tmp partial first, renames on success, deletes on error.
 */
async function saveFileStream(client, msg, originalName) {
  await ensureDirs();
  const ext = path.extname(originalName) || "";
  const id = uuidv4();
  const fileName = `${id}${ext}`;
  const tmpPath = path.join(TMP_DIR, fileName);
  const finalPath = path.join(cfg.uploadDir, fileName);

  const writeStream = fs.createWriteStream(tmpPath);

  try {
    for await (const chunk of client.iterDownload({
      file: msg.media,
      requestSize: 1024 * 1024,
    })) {
      if (!writeStream.write(chunk)) {
        await new Promise((resolve) => writeStream.once("drain", resolve));
      }
    }
    await new Promise((resolve, reject) => {
      writeStream.end();
      writeStream.on("finish", resolve);
      writeStream.on("error", reject);
    });
    await fs.move(tmpPath, finalPath, { overwrite: true });
  } catch (err) {
    try { writeStream.destroy(); } catch (_) {}
    try { await fs.remove(tmpPath); } catch (_) {}
    throw err;
  }

  return { id, fileName, filePath: finalPath };
}

function formatSize(bytes) {
  if (!Number.isFinite(bytes)) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

async function getTotalStorage() {
  const meta = await readMeta();
  const total = meta.reduce((sum, f) => sum + (f.size || 0), 0);
  return { count: meta.length, totalBytes: total, total: formatSize(total) };
}

module.exports = {
  ensureDirs,
  saveFileStream,
  appendMeta,
  listFiles,
  findById,
  findByShortId,
  deleteFile,
  deleteAllFiles,
  getTotalStorage,
  formatSize,
};
