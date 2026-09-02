const TELEGRAM_MAX_LENGTH = 3500;

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

function formatSection(title, content) {
  return `${title}:\n${content || 'لا يوجد'}`;
}

function truncateMessage(message) {
  if (message.length <= TELEGRAM_MAX_LENGTH) return message;
  return `${message.slice(0, TELEGRAM_MAX_LENGTH - 20)}\n\n[message truncated]`;
}

function buildAlertMessage(event) {
  const logs = (event.logs || [])
    .map((log) => `[${log.timestamp}] ${Array.isArray(log.message) ? log.message.join(' ') : log.message}`)
    .join('\n');
  const exceptions = (event.exceptions || [])
    .map((exception) => `${exception.name}: ${exception.message}`)
    .join('\n');
  const requestUrl = event.event?.request?.url || 'unknown';
  const requestMethod = event.event?.request?.method || 'unknown';

  return truncateMessage(`⚠️ <b>خطأ في البوت الرئيسي</b>
<pre>${escapeHtml([
  `Status: ${event.outcome || 'unknown'}`,
  `Script: ${event.scriptName || 'unknown'}`,
  `Request: ${requestMethod} ${requestUrl}`,
  formatSection('Logs', logs),
  formatSection('Exceptions', exceptions)
].join('\n\n'))}</pre>`);
}

export default {
  async fetch() {
    return Response.json({ ok: true, worker: 'ultimate-arbitrage-tail' });
  },

  async tail(events, env) {
    for (const event of events) {
      if (event.outcome === 'ok') continue;

      if (env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_CHAT_ID) {
        const message = buildAlertMessage(event);
        await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: env.TELEGRAM_CHAT_ID,
            text: message,
            parse_mode: 'HTML'
          })
        });
      }
    }
  }
};
