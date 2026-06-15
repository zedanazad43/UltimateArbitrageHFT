// src/bots/notifier.js — Notification Bot
// Sends alerts via Telegram (primary) with extensible channel support.
// Used by self-evaluation scripts and automated tests.

/**
 * Send a notification via configured channels.
 * Currently supports Telegram via TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID env vars.
 *
 * @param {object} env - Environment object with TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID
 * @param {object} _ctx - Reserved context parameter (unused for now)
 * @param {string} message - Markdown-formatted message to send
 * @returns {Promise<{ok: boolean, error?: string}>}
 */
export async function notify(env, _ctx, message) {
    if (!message) {
        return { ok: true };
    }

    const token = env.TELEGRAM_BOT_TOKEN || process?.env?.TELEGRAM_BOT_TOKEN;
    const chatId = env.TELEGRAM_CHAT_ID || process?.env?.TELEGRAM_CHAT_ID;

    if (!token || !chatId) {
        return { ok: false, error: 'Telegram is not configured (missing TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID)' };
    }

    try {
        const resp = await fetch(
            `https://api.telegram.org/bot${token}/sendMessage`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    chat_id: chatId,
                    text: message,
                    parse_mode: 'Markdown',
                }),
            }
        );

        if (!resp.ok) {
            const detail = await resp.text().catch(() => 'Telegram API request failed');
            return { ok: false, error: detail };
        }

        return { ok: true };
    } catch (err) {
        return { ok: false, error: err.message };
    }
}
