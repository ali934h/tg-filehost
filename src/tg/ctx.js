/**
 * Ctx wraps a GramJS event in a small, telegraf-like shape used by the
 * handlers. Exposes the underlying message via `ctx.message.raw` so handlers
 * that work with media (documents, photos, ...) can reach the GramJS
 * Message object directly.
 */

"use strict";

const { Button } = require("telegram/tl/custom/button");

function buttonsFromReplyMarkup(opts) {
  if (!opts || !opts.reply_markup) return undefined;
  const rm = opts.reply_markup;
  if (!rm || !Array.isArray(rm.inline_keyboard)) return undefined;
  return rm.inline_keyboard.map((row) =>
    row.map((b) => {
      if (b.callback_data !== undefined) {
        return Button.inline(b.text, Buffer.from(String(b.callback_data)));
      }
      if (b.url) {
        return Button.url(b.text, b.url);
      }
      return Button.inline(b.text, Buffer.from(b.text));
    })
  );
}

function normalizeOpts(opts) {
  if (!opts) return {};
  const out = {};
  if (opts.parse_mode) out.parseMode = String(opts.parse_mode).toLowerCase();
  if (opts.disable_web_page_preview === true) out.linkPreview = false;
  const buttons = buttonsFromReplyMarkup(opts);
  if (buttons) out.buttons = buttons;
  return out;
}

class Ctx {
  constructor({ client, message, callbackEvent, senderId, chatId }) {
    this.client = client;
    this._msg = message || null;
    this._cb = callbackEvent || null;
    this.match = null;

    const sid = senderId !== undefined ? senderId : null;
    this.from = sid != null ? { id: Number(sid) } : { id: null };
    this.chat = chatId != null ? { id: chatId } : { id: this.from.id };

    if (message) {
      this.message = {
        text: message.message || "",
        message_id: Number(message.id),
        media: message.media || null,
        raw: message,
      };
    }
    if (callbackEvent) {
      this.callbackQuery = {
        data: callbackEvent.data ? callbackEvent.data.toString() : "",
        message: { message_id: Number(callbackEvent.messageId) },
      };
    }

    this.telegram = {
      editMessageText: async (chatIdArg, messageId, _inlineId, text, opts) =>
        client.editMessage(chatIdArg, {
          message: Number(messageId),
          text,
          ...normalizeOpts(opts),
        }),
      deleteMessage: async (chatIdArg, messageId) =>
        client.deleteMessages(chatIdArg, [Number(messageId)], { revoke: true }),
    };
  }

  async reply(text, opts) {
    const sent = await this.client.sendMessage(this.chat.id, {
      message: text,
      ...normalizeOpts(opts),
    });
    return { message_id: Number(sent.id) };
  }

  async replyToCurrent(text, opts) {
    const replyTo = this._msg ? Number(this._msg.id) : undefined;
    const sent = await this.client.sendMessage(this.chat.id, {
      message: text,
      replyTo,
      ...normalizeOpts(opts),
    });
    return { message_id: Number(sent.id) };
  }

  async editMessageText(text, opts) {
    const messageId = this._cb
      ? Number(this._cb.messageId)
      : this._msg
        ? Number(this._msg.id)
        : null;
    if (messageId == null) throw new Error("No message to edit");
    return this.client.editMessage(this.chat.id, {
      message: messageId,
      text,
      ...normalizeOpts(opts),
    });
  }

  async answerCbQuery(text) {
    if (!this._cb || typeof this._cb.answer !== "function") return;
    try {
      await this._cb.answer({ message: text || undefined });
    } catch (_e) {
      // CallbackQuery answers are best-effort; ignore expiry errors.
    }
  }

  async deleteMessage() {
    const messageId = this._cb
      ? Number(this._cb.messageId)
      : this._msg
        ? Number(this._msg.id)
        : null;
    if (messageId == null) return;
    try {
      await this.client.deleteMessages(this.chat.id, [messageId], {
        revoke: true,
      });
    } catch (_e) {
      // ignore
    }
  }
}

module.exports = { Ctx, normalizeOpts, buttonsFromReplyMarkup };
