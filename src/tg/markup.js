/**
 * Tiny replacement for telegraf's Markup helpers. Builds plain JSON objects
 * shaped like Bot API reply_markup, which the Ctx adapter then translates
 * into GramJS Button instances at send time.
 */

"use strict";

const Markup = {
  button: {
    callback(text, callback_data) {
      return { text, callback_data };
    },
    url(text, url) {
      return { text, url };
    },
  },
  inlineKeyboard(rows) {
    return { reply_markup: { inline_keyboard: rows } };
  },
};

module.exports = { Markup };
