/**
 * Periodic retention sweep.
 *
 * If RETENTION_DAYS > 0, every RETENTION_INTERVAL_MS the bot scans hosted
 * files and deletes any whose `uploadedAt` (sidecar) — or mtime, as a
 * fallback — is older than the configured retention window. RETENTION_DAYS=0
 * disables the sweep entirely (files are kept forever).
 *
 * Files downloaded from external URLs and forwarded to Telegram are *not*
 * touched by retention: they live in TEMP_DIR and are removed by their
 * handler immediately after upload.
 */

"use strict";

const fsp = require("fs").promises;
const path = require("path");

const config = require("./config");
const logger = require("./logger");
const filesStore = require("./files");
const fileManager = require("./fileManager");

let timer = null;

async function runOnce() {
  if (config.retentionDays <= 0) return 0;

  const cutoff = Date.now() - config.retentionDays * 24 * 60 * 60 * 1000;
  const all = await filesStore.listFiles();
  let removed = 0;

  for (const entry of all) {
    let ts = new Date(entry.uploadedAt).getTime();
    if (!Number.isFinite(ts)) {
      try {
        const stat = await fsp.stat(filesStore.filePathFor(entry.fileName));
        ts = stat.mtimeMs;
      } catch (_e) {
        continue;
      }
    }
    if (ts < cutoff) {
      const ok = await filesStore.deleteById(entry.id);
      if (ok) {
        removed++;
        logger.info(
          `Retention removed ${entry.fileName} (originalName=${entry.originalName})`
        );
      }
    }
  }

  if (removed > 0) {
    logger.info(`Retention sweep removed ${removed} expired file(s)`);
  }
  return removed;
}

async function sweepTempDir() {
  await fileManager.cleanupOldTmpPartials(config.tempDir, config.tempMaxAgeMs);
  await fileManager.cleanupOldTmpPartials(
    path.join(config.uploadDir, fileManager.TMP_SUBDIR),
    config.tempMaxAgeMs
  );
}

function start() {
  if (timer) return;

  if (config.retentionDays > 0) {
    logger.info(
      `Retention enabled: files older than ${config.retentionDays} day(s) will be removed every ${Math.round(
        config.retentionIntervalMs / 60000
      )} minute(s)`
    );
  } else {
    logger.info("Retention disabled (RETENTION_DAYS=0). Files are kept forever.");
  }

  timer = setInterval(async () => {
    try {
      await runOnce();
    } catch (err) {
      logger.warn("Retention sweep failed", { error: err.message });
    }
    try {
      await sweepTempDir();
    } catch (err) {
      logger.warn("Temp cleanup failed", { error: err.message });
    }
  }, config.retentionIntervalMs);
  timer.unref?.();
}

function stop() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

module.exports = { start, stop, runOnce };
