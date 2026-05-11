/**
 * URL → Telegram file.
 *
 * Triggered when an allowed user sends a plain text message that looks like
 * an http(s) URL. We HEAD the URL, reject anything that smells like a web
 * page (text/html, 4xx/5xx, oversized, redirect loops) and stream the rest
 * to a temp file, then forward it to the user as a Telegram document. The
 * downloaded file is *not* written into UPLOAD_DIR — this mode never produces
 * a direct link.
 */

"use strict";

const path = require("path");
const fsp = require("fs").promises;
const { URL } = require("url");

const config = require("../config");
const logger = require("../logger");
const fileManager = require("../fileManager");
const { escapeHtml } = require("../htmlEscape");

// Accept anything that starts with http(s):// followed by at least one
// non-whitespace character. We allow internal whitespace (spaces in paths
// like "Graphic Card" are common on CDN buckets and browsers tolerate them
// by percent-encoding), but reject multi-line text — that cannot be a
// single URL.
const URL_REGEX = /^https?:\/\/\S/i;

function looksLikeUrl(text) {
  if (!text) return false;
  const trimmed = text.trim();
  if (!URL_REGEX.test(trimmed)) return false;
  if (/[\r\n]/.test(trimmed)) return false;
  return true;
}

// Normalize a user-supplied URL into a strictly RFC-compliant form by
// running it through the WHATWG URL parser. This percent-encodes spaces and
// other unsafe characters in the path while leaving the query string
// (signatures, tokens, ...) untouched.
function normalizeUrl(text) {
  try {
    return new URL(text.trim()).href;
  } catch (_e) {
    return null;
  }
}

function isHtmlContentType(type) {
  if (!type) return false;
  const lower = String(type).toLowerCase();
  return (
    lower.startsWith("text/html") ||
    lower.startsWith("application/xhtml+xml")
  );
}

function fileNameFromContentDisposition(header) {
  if (!header) return null;
  // RFC 5987 filename*=UTF-8''<encoded>
  const star = header.match(/filename\*\s*=\s*([^;]+)/i);
  if (star) {
    const v = star[1].trim();
    const m = v.match(/^[Uu][Tt][Ff]-8''(.+)$/);
    if (m) {
      try {
        return decodeURIComponent(m[1]);
      } catch (_e) {
        // fall through
      }
    }
  }
  const plain = header.match(/filename\s*=\s*"?([^";]+)"?/i);
  if (plain) return plain[1].trim();
  return null;
}

function fileNameFromUrl(urlString) {
  try {
    const u = new URL(urlString);
    const last = path.basename(u.pathname);
    if (last && last !== "/") {
      try {
        return decodeURIComponent(last);
      } catch (_e) {
        return last;
      }
    }
  } catch (_e) {
    /* ignore */
  }
  return null;
}

async function fetchWithTimeout(urlString, opts, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(urlString, { ...opts, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function probeHead(urlString) {
  try {
    const res = await fetchWithTimeout(
      urlString,
      { method: "HEAD", redirect: "follow" },
      config.httpHeadTimeoutMs
    );
    return res;
  } catch (err) {
    logger.debug("HEAD probe failed, will fall back to GET", {
      url: urlString,
      error: err.message,
    });
    return null;
  }
}

async function handle(ctx) {
  const text = (ctx.message?.text || "").trim();
  if (!looksLikeUrl(text)) {
    await ctx.reply(
      "Send a file to host it, or send a direct download URL to fetch it back as a Telegram file. Use /help for details."
    );
    return;
  }

  const urlString = normalizeUrl(text);
  if (!urlString) {
    await ctx.reply("❌ That doesn't look like a valid URL.");
    return;
  }

  const status = await ctx.reply("🔎 Checking URL...");

  // ---- HEAD probe -----------------------------------------------------
  const head = await probeHead(urlString);
  if (head) {
    if (!head.ok) {
      await ctx.telegram
        .editMessageText(
          ctx.chat.id,
          status.message_id,
          null,
          `❌ URL responded with HTTP ${head.status}.`
        )
        .catch(() => {});
      return;
    }
    const ct = head.headers.get("content-type") || "";
    if (isHtmlContentType(ct)) {
      await ctx.telegram
        .editMessageText(
          ctx.chat.id,
          status.message_id,
          null,
          "❌ This URL points to a web page, not a direct file.\n" +
            "For YouTube and similar sites use tg-video instead."
        )
        .catch(() => {});
      return;
    }
    const cl = Number(head.headers.get("content-length") || 0);
    const maxBytes = config.maxDownloadMb * 1024 * 1024;
    if (cl && cl > maxBytes) {
      await ctx.telegram
        .editMessageText(
          ctx.chat.id,
          status.message_id,
          null,
          `❌ Remote file is ${escapeHtml(
            fileManager.formatBytes(cl)
          )}, exceeds the ${config.maxDownloadMb} MB limit.`,
          { parse_mode: "HTML" }
        )
        .catch(() => {});
      return;
    }
  }

  // ---- GET + stream to temp file -------------------------------------
  const id = fileManager.randomId();
  const tmpPath = path.join(config.tempDir, `${id}.part`);
  await fileManager.ensureRuntimeDirs();

  let fileName = null;
  let actualSize = 0;
  try {
    const res = await fetchWithTimeout(
      urlString,
      { method: "GET", redirect: "follow" },
      config.httpDownloadTimeoutMs
    );
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    const ct = res.headers.get("content-type") || "";
    if (isHtmlContentType(ct)) {
      throw new Error("URL returned an HTML page, not a file.");
    }
    fileName =
      fileNameFromContentDisposition(res.headers.get("content-disposition")) ||
      fileNameFromUrl(urlString) ||
      `download_${id}.bin`;
    fileName = fileManager.safeBaseName(fileName, `download_${id}.bin`);

    const maxBytes = config.maxDownloadMb * 1024 * 1024;
    const result = await fileManager.streamResponseToTempFile(
      res,
      tmpPath,
      maxBytes
    );
    actualSize = result.size;
  } catch (err) {
    logger.warn("URL download failed", {
      url: urlString,
      error: err.message,
    });
    await fileManager.deletePath(tmpPath);
    await ctx.telegram
      .editMessageText(
        ctx.chat.id,
        status.message_id,
        null,
        `❌ Download failed: ${escapeHtml(err.message)}`,
        { parse_mode: "HTML" }
      )
      .catch(() => {});
    return;
  }

  // ---- Forward to chat ------------------------------------------------
  await ctx.telegram
    .editMessageText(
      ctx.chat.id,
      status.message_id,
      null,
      `📤 Uploading <b>${escapeHtml(fileName)}</b> (${escapeHtml(
        fileManager.formatBytes(actualSize)
      )}) to Telegram...`,
      { parse_mode: "HTML" }
    )
    .catch(() => {});

  try {
    await ctx.client.sendFile(ctx.chat.id, {
      file: tmpPath,
      forceDocument: true,
      caption: fileName,
      attributes: [
        // Force a sane filename on the Telegram side regardless of the
        // on-disk temp name.
        new (require("telegram").Api.DocumentAttributeFilename)({
          fileName,
        }),
      ],
    });
    await ctx.telegram
      .deleteMessage(ctx.chat.id, status.message_id)
      .catch(() => {});
  } catch (err) {
    logger.error("Telegram upload failed", { error: err.message });
    await ctx.telegram
      .editMessageText(
        ctx.chat.id,
        status.message_id,
        null,
        `❌ Failed to send file to Telegram: ${escapeHtml(err.message)}`,
        { parse_mode: "HTML" }
      )
      .catch(() => {});
  } finally {
    await fileManager.deletePath(tmpPath);
  }
}

module.exports = { handle, looksLikeUrl, normalizeUrl };
