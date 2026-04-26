/**
 * Metadata store for hosted files served via /files/<name>.
 *
 * Each entry on disk is stored at `<UPLOAD_DIR>/<id><ext>` and accompanied
 * by a sidecar `<UPLOAD_DIR>/<id><ext>.json` carrying:
 *   { id, originalName, fileName, size, uploadedAt, uploaderUserId, url }
 *
 * Storing one JSON per file (instead of a single global meta.json) means:
 *   - no read-modify-write races between concurrent uploads,
 *   - retention sweep can decide what to delete by inspecting individual
 *     files,
 *   - nginx is configured to deny `\.json$` requests so sidecars never leak.
 */

"use strict";

const path = require("path");
const fsp = require("fs").promises;

const config = require("./config");
const logger = require("./logger");

const META_SUFFIX = ".json";

function metaPathFor(fileName) {
  return path.join(config.uploadDir, `${fileName}${META_SUFFIX}`);
}

function filePathFor(fileName) {
  return path.join(config.uploadDir, fileName);
}

function buildPublicUrl(fileName) {
  return `https://${config.host}/files/${fileName}`;
}

async function readMeta(fileName) {
  try {
    const raw = await fsp.readFile(metaPathFor(fileName), "utf8");
    return JSON.parse(raw);
  } catch (err) {
    if (err.code !== "ENOENT") {
      logger.warn(`Failed to read meta for ${fileName}`, { error: err.message });
    }
    return null;
  }
}

async function writeMeta(fileName, entry) {
  await fsp.writeFile(
    metaPathFor(fileName),
    JSON.stringify(entry, null, 2),
    "utf8"
  );
}

async function deleteMeta(fileName) {
  try {
    await fsp.unlink(metaPathFor(fileName));
  } catch (err) {
    if (err.code !== "ENOENT") {
      logger.warn(`Failed to remove meta for ${fileName}`, {
        error: err.message,
      });
    }
  }
}

async function appendMeta(entry) {
  await writeMeta(entry.fileName, entry);
  return entry;
}

async function listFiles() {
  let entries;
  try {
    entries = await fsp.readdir(config.uploadDir, { withFileTypes: true });
  } catch (err) {
    if (err.code === "ENOENT") return [];
    throw err;
  }

  const items = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (entry.name.startsWith(".")) continue;
    if (entry.name.endsWith(META_SUFFIX)) continue;
    const meta = await readMeta(entry.name);
    if (meta) {
      items.push(meta);
    } else {
      // No sidecar — surface the raw file so the user can still see / delete it.
      try {
        const stat = await fsp.stat(filePathFor(entry.name));
        items.push({
          id: entry.name.replace(/\.[^.]+$/, ""),
          originalName: entry.name,
          fileName: entry.name,
          size: stat.size,
          uploadedAt: stat.mtime.toISOString(),
          uploaderUserId: null,
          url: buildPublicUrl(entry.name),
        });
      } catch (_e) {
        // ignore stat failures
      }
    }
  }

  items.sort((a, b) => {
    const ta = new Date(a.uploadedAt).getTime();
    const tb = new Date(b.uploadedAt).getTime();
    return tb - ta;
  });
  return items;
}

async function findById(id) {
  const all = await listFiles();
  return all.find((f) => f.id === id) || null;
}

async function deleteById(id) {
  const entry = await findById(id);
  if (!entry) return false;
  try {
    await fsp.unlink(filePathFor(entry.fileName));
  } catch (err) {
    if (err.code !== "ENOENT") {
      logger.warn(`Failed to remove file ${entry.fileName}`, {
        error: err.message,
      });
    }
  }
  await deleteMeta(entry.fileName);
  return true;
}

async function deleteAll() {
  const all = await listFiles();
  for (const entry of all) {
    try {
      await fsp.unlink(filePathFor(entry.fileName));
    } catch (err) {
      if (err.code !== "ENOENT") {
        logger.warn(`Failed to remove file ${entry.fileName}`, {
          error: err.message,
        });
      }
    }
    await deleteMeta(entry.fileName);
  }
  return all.length;
}

async function totalStorage() {
  const all = await listFiles();
  const totalBytes = all.reduce((sum, f) => sum + (f.size || 0), 0);
  return { count: all.length, totalBytes };
}

module.exports = {
  buildPublicUrl,
  readMeta,
  writeMeta,
  deleteMeta,
  appendMeta,
  listFiles,
  findById,
  deleteById,
  deleteAll,
  totalStorage,
  filePathFor,
  metaPathFor,
};
