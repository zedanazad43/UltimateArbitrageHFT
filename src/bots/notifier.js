// Notifier Bot — delegates to the Telegram notification layer

/**
 * Sends a Telegram notification message using the bot token / chat ID stored in
 * Cloudflare Worker secrets (TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID).
 *
 * @param {object} env     — Cloudflare Worker env bindings
 * @param {object} config  — bot config entry from config.json (unused, kept for interface compat)
 * @param {string} message — Markdown-formatted message text
 * @returns {Promise<void>}
 */
export const notify = async (env, config, message) => {
  const token  = env.TELEGRAM_BOT_TOKEN;
  const chatId = env.TELEGRAM_CHAT_ID;

  if (!token || !chatId) {
    console.warn('[Notifier] TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID not configured — skipping');
    return;
  }

  try {
    const resp = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: message, parse_mode: 'Markdown' })
    });
    await resp.body?.cancel();
    console.log('[Notifier] Message sent:', message.slice(0, 60));
  } catch (err) {
    console.error('[Notifier] Failed to send Telegram message:', err.message);
  }
};
