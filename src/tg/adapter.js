/**
 * BotAdapter — translates a small telegraf-like API
 * (bot.command / bot.action / bot.on('text') / bot.on('media') / bot.use /
 * bot.catch) into GramJS event handlers.
 *
 * Handlers receive a Ctx instance that exposes ctx.reply, ctx.editMessageText,
 * ctx.answerCbQuery, etc. For media uploads, ctx.message.raw / ctx.message.media
 * give direct access to the underlying GramJS Message.
 */

"use strict";

const { Api } = require("telegram");
const { NewMessage } = require("telegram/events");
const { CallbackQuery } = require("telegram/events/CallbackQuery");

const { Ctx } = require("./ctx");

class BotAdapter {
  constructor(client) {
    this.client = client;
    this.middlewares = [];
    this.commandHandlers = new Map();
    this.actionHandlers = [];
    this.textHandler = null;
    this.mediaHandler = null;
    this.errorHandler = null;
  }

  use(fn) {
    this.middlewares.push(fn);
  }

  command(name, handler) {
    this.commandHandlers.set(name, handler);
  }

  action(matcher, handler) {
    this.actionHandlers.push({ matcher, handler });
  }

  on(event, handler) {
    if (event === "text") this.textHandler = handler;
    else if (event === "media") this.mediaHandler = handler;
  }

  catch(handler) {
    this.errorHandler = handler;
  }

  async _runWithMiddleware(ctx, terminal) {
    let i = 0;
    const dispatch = async () => {
      if (i < this.middlewares.length) {
        const mw = this.middlewares[i++];
        await mw(ctx, dispatch);
      } else {
        await terminal();
      }
    };
    await dispatch();
  }

  async _onMessage(event) {
    const msg = event.message;
    if (!msg || !msg.isPrivate) return;
    const senderId = msg.senderId ? Number(msg.senderId.toString()) : null;
    if (!senderId) return;

    const ctx = new Ctx({
      client: this.client,
      message: msg,
      senderId,
      chatId: senderId,
    });

    const text = (msg.message || "").trim();
    const cmdMatch = text.match(/^\/([a-zA-Z0-9_]+)(?:@\w+)?(?:\s|$)/);
    const command = cmdMatch ? cmdMatch[1].toLowerCase() : null;

    const terminal = async () => {
      if (command && this.commandHandlers.has(command)) {
        await this.commandHandlers.get(command)(ctx);
        return;
      }
      if (msg.media && this.mediaHandler) {
        await this.mediaHandler(ctx);
        return;
      }
      if (text && this.textHandler) {
        await this.textHandler(ctx);
      }
    };

    try {
      await this._runWithMiddleware(ctx, terminal);
    } catch (err) {
      if (this.errorHandler) {
        try {
          await this.errorHandler(err, ctx);
        } catch (_e) {
          // swallow
        }
      } else {
        throw err;
      }
    }
  }

  async _onCallback(event) {
    const data = event.data ? event.data.toString() : "";
    const senderId = event.senderId
      ? Number(event.senderId.toString())
      : null;
    if (!senderId) return;

    let chatId;
    try {
      const chat = await event.getChat();
      chatId = chat ? chat.id : senderId;
    } catch (_e) {
      chatId = senderId;
    }

    const ctx = new Ctx({
      client: this.client,
      callbackEvent: event,
      senderId,
      chatId,
    });

    const terminal = async () => {
      for (const { matcher, handler } of this.actionHandlers) {
        let match = null;
        if (typeof matcher === "string") {
          if (matcher === data) match = [data];
        } else if (matcher instanceof RegExp) {
          match = data.match(matcher);
        }
        if (match) {
          ctx.match = match;
          await handler(ctx);
          return;
        }
      }
      try {
        await event.answer({});
      } catch (_e) {
        // ignore
      }
    };

    try {
      await this._runWithMiddleware(ctx, terminal);
    } catch (err) {
      if (this.errorHandler) {
        try {
          await this.errorHandler(err, ctx);
        } catch (_e) {
          // swallow
        }
      } else {
        throw err;
      }
    }
  }

  attach() {
    this.client.addEventHandler(
      (e) => this._onMessage(e),
      new NewMessage({ incoming: true })
    );
    this.client.addEventHandler(
      (e) => this._onCallback(e),
      new CallbackQuery({})
    );
  }

  async setMyCommands(commands) {
    const apiCmds = commands.map(
      (c) =>
        new Api.BotCommand({ command: c.command, description: c.description })
    );
    await this.client.invoke(
      new Api.bots.SetBotCommands({
        scope: new Api.BotCommandScopeDefault(),
        langCode: "",
        commands: apiCmds,
      })
    );
  }
}

module.exports = { BotAdapter };
