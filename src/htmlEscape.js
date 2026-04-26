/**
 * HTML escaping for Telegram's `parse_mode: 'HTML'`.
 *
 * Telegram only requires `<`, `>`, and `&` to be escaped inside text.
 * See https://core.telegram.org/bots/api#html-style.
 */

"use strict";

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

module.exports = { escapeHtml };
