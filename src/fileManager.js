/**
 * Filesystem helpers shared between the upload + URL-download paths.
 *
 * Uploads from Telegram are streamed via GramJS' iterDownload to a `.tmp`
 * partial and atomically renamed into UPLOAD_DIR on success, so half-written
 * files never leak through nginx.
 *
 * URL-to-Telegram downloads go through TEMP_DIR and are deleted after the
 * file is forwarded to the chat — they never end up in UPLOAD_DIR.
 */

"use strict";

const fs = require("fs");
const fsp = fs.promises;
const path = require("path");
const crypto = require("crypto");

const config = require("./config");
const logger = require("./logger");

const TMP_SUBDIR = ".tmp";

async function ensureDir(dir) {
  await fsp.mkdir(dir, { recursive: true });
}

async function ensureRuntimeDirs() {
  await ensureDir(config.uploadDir);
  await ensureDir(path.join(config.uploadDir, TMP_SUBDIR));
  await ensureDir(config.tempDir);
}

function randomId() {
  // 16 bytes = 32 hex chars. Plenty of entropy for unguessable URLs and
  // also short enough to keep filenames manageable.
  return crypto.randomBytes(16).toString("hex");
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let n = Number(bytes);
  let i = 0;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i++;
  }
  return `${n.toFixed(n >= 10 || i === 0 ? 0 : 1)} ${units[i]}`;
}

function sanitizeExtension(ext) {
  if (!ext) return "";
  const cleaned = String(ext).replace(/[^a-zA-Z0-9.]/g, "");
  if (!cleaned.startsWith(".")) return "";
  if (cleaned.length > 16) return "";
  return cleaned.toLowerCase();
}

function safeBaseName(raw, fallback) {
  const cleaned = String(raw || "")
    .replace(/[\u0000-\u001f]/g, "")
    .replace(/[\\/]/g, "_")
    .replace(/[<>:"|?*]/g, "_")
    .trim();
  return cleaned || fallback;
}

/**
 * Stream a Telegram document/photo to disk via gramJS iterDownload.
 * Writes to a `.tmp` partial first, renames on success, deletes on error.
 *
 * Returns { id, fileName, filePath } where fileName is `<id><ext>` and
 * filePath is the final on-disk location inside UPLOAD_DIR.
 */
async function saveTelegramMediaStream(client, msg, originalName) {
  await ensureRuntimeDirs();
  const ext = sanitizeExtension(path.extname(originalName));
  const id = randomId();
  const fileName = `${id}${ext}`;
  const tmpPath = path.join(config.uploadDir, TMP_SUBDIR, fileName);
  const finalPath = path.join(config.uploadDir, fileName);

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
    await fsp.rename(tmpPath, finalPath);
  } catch (err) {
    try { writeStream.destroy(); } catch (_e) { /* ignore */ }
    try { await fsp.unlink(tmpPath); } catch (_e) { /* ignore */ }
    throw err;
  }

  return { id, fileName, filePath: finalPath };
}

/**
 * Stream an arbitrary HTTP(S) response body to a temp file. Aborts when
 * the cumulative size would exceed `maxBytes`. Returns { tmpPath, size }.
 */
async function streamResponseToTempFile(response, tmpPath, maxBytes, signal) {
  const writeStream = fs.createWriteStream(tmpPath);
  let received = 0;
  const reader = response.body.getReader();

  try {
    while (true) {
      if (signal?.aborted) {
        throw new Error("Download aborted");
      }
      const { value, done } = await reader.read();
      if (done) break;
      received += value.byteLength;
      if (received > maxBytes) {
        throw new Error(
          `Download exceeds maximum allowed size of ${formatBytes(maxBytes)}`
        );
      }
      if (!writeStream.write(value)) {
        await new Promise((resolve) => writeStream.once("drain", resolve));
      }
    }
    await new Promise((resolve, reject) => {
      writeStream.end();
      writeStream.on("finish", resolve);
      writeStream.on("error", reject);
    });
  } catch (err) {
    try { writeStream.destroy(); } catch (_e) { /* ignore */ }
    try { await fsp.unlink(tmpPath); } catch (_e) { /* ignore */ }
    throw err;
  }

  return { tmpPath, size: received };
}

async function deletePath(p) {
  try {
    await fsp.unlink(p);
  } catch (err) {
    if (err.code !== "ENOENT") {
      logger.warn(`Failed to remove file ${p}`, { error: err.message });
    }
  }
}

async function cleanupOldTmpPartials(rootDir, maxAgeMs) {
  try {
    const entries = await fsp.readdir(rootDir, { withFileTypes: true });
    const now = Date.now();
    let removed = 0;
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      const filePath = path.join(rootDir, entry.name);
      try {
        const stats = await fsp.stat(filePath);
        if (now - stats.mtimeMs > maxAgeMs) {
          await fsp.unlink(filePath);
          removed++;
        }
      } catch (_e) {
        // ignore
      }
    }
    if (removed > 0) {
      logger.info(`Cleaned up ${removed} stale tmp file(s) from ${rootDir}`);
    }
  } catch (err) {
    if (err.code !== "ENOENT") {
      logger.warn(`Failed to clean ${rootDir}`, { error: err.message });
    }
  }
}

module.exports = {
  ensureDir,
  ensureRuntimeDirs,
  randomId,
  formatBytes,
  sanitizeExtension,
  safeBaseName,
  saveTelegramMediaStream,
  streamResponseToTempFile,
  deletePath,
  cleanupOldTmpPartials,
  TMP_SUBDIR,
};
