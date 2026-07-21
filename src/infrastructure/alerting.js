import { setTimeout as _delay } from 'timers/promises';

export class AlertDispatcher {
  constructor() {
    this.channels = new Map();
  }
  register(name, sender) {
    this.channels.set(name, sender);
  }
  async sendAll(event) {
    const out = [];
    for (const [, sender] of this.channels) {
      try {
        const _alertResult = await sender(event);
        out.push({ channel: sender.name || 'unknown', ok: true });
      } catch (err) {
        out.push({ channel: sender.name || 'unknown', ok: false, error: String(err) });
      }
    }
    return out;
  }
}

export class TelegramAlerter {
  constructor({ botToken, chatId } = {}) {
    this.botToken = botToken;
    this.chatId = chatId;
    this.name = 'telegram';
  }
  api(method, payload = {}) {
    if (!this.botToken) return async () => ({ skipped: true });
    const base = `https://api.telegram.org/bot${this.botToken}/${method}`;
    return async () => {
      const res = await fetch(base, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...payload, chat_id: this.chatId }),
        redirect: 'manual',
      });
      if (!res.ok) throw new Error(`telegram_${method}_${res.status}`);
      return { status: res.status };
    };
  }
  sendText(text) {
    return this.api('sendMessage', { text, parse_mode: 'Markdown' });
  }
}

export class GitHubNotifier {
  constructor({ repo, token } = {}) {
    this.repo = repo;
    this.token = token;
    this.name = 'github';
  }
  async sendMessage(title, body) {
    if (!this.repo || !this.token) return { skipped: true };
    const res = await fetch(`https://api.github.com/repos/${this.repo}/issues`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${this.token}`,
        accept: 'application/vnd.github+json',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ title, body }),
      redirect: 'manual',
    });
    if (!res.ok) throw new Error(`github_issue_${res.status}`);
    return { issue: await res.json() };
  }
}
