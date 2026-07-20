import { Agent } from "agents";

export type HermesState = {
  lastAction: { method: string; at: string } | null;
  zones: string[];
};

export class HermesAgent extends Agent<{}, HermesState> {
  initialState: HermesState = {
    lastAction: null,
    zones: [],
  };

  getState(): HermesState {
    return (this.state.data ?? this.initialState) as HermesState;
  }

  persist(partial: Partial<HermesState>) {
    const next = { ...(this.state.data ?? this.initialState), ...partial } as HermesState;
    this.setState(next);
    return next;
  }

  async listZones() {
    const token = (globalThis as any).ENV?.CLOUDFLARE_API_TOKEN;
    const url = "https://api.cloudflare.com/client/v4/zones";
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
    });
    const data = (await res.json()) as any;
    const zones = Array.isArray(data.result) ? data.result.map((z: any) => z.id) : [];
    const state = this.persist({ lastAction: { method: "listZones", at: new Date().toISOString() }, zones });
    return { ok: res.ok, status: res.status, zones, state };
  }

  async createDNSRecord(zoneId: string, type: string, name: string, content: string, ttl = 1, proxied = false) {
    const token = (globalThis as any).ENV?.CLOUDFLARE_API_TOKEN;
    const url = `https://api.cloudflare.com/client/v4/zones/${zoneId}/dns_records`;
    const body = { type, name, content, ttl, proxied };
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    const data = (await res.json()) as any;
    const state = this.persist({ lastAction: { method: "createDNSRecord", at: new Date().toISOString() } });
    return { ok: res.ok, status: res.status, result: data.result, state };
  }

  async updateDNSRecord(zoneId: string, recordId: string, newContent: string) {
    const token = (globalThis as any).ENV?.CLOUDFLARE_API_TOKEN;
    const url = `https://api.cloudflare.com/client/v4/zones/${zoneId}/dns_records/${recordId}`;
    const body = { content: newContent };
    const res = await fetch(url, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    const data = (await res.json()) as any;
    const state = this.persist({ lastAction: { method: "updateDNSRecord", at: new Date().toISOString() } });
    return { ok: res.ok, status: res.status, result: data.result, state };
  }

  async deleteDNSRecord(zoneId: string, recordId: string) {
    const token = (globalThis as any).ENV?.CLOUDFLARE_API_TOKEN;
    const url = `https://api.cloudflare.com/client/v4/zones/${zoneId}/dns_records/${recordId}`;
    const res = await fetch(url, {
      method: "DELETE",
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });
    const data = (await res.json()) as any;
    const state = this.persist({ lastAction: { method: "deleteDNSRecord", at: new Date().toISOString() } });
    return { ok: res.ok, status: res.status, result: data.result, state };
  }

  async listWorkers() {
    const token = (globalThis as any).ENV?.CLOUDFLARE_API_TOKEN;
    const accountId = (globalThis as any).ENV?.CLOUDFLARE_ACCOUNT_ID;
    const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/scripts`;
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });
    const data = (await res.json()) as any;
    const scripts = Array.isArray(data.result) ? data.result.map((s: any) => s.name) : [];
    const state = this.persist({ lastAction: { method: "listWorkers", at: new Date().toISOString() } });
    return { ok: res.ok, status: res.status, scripts, state };
  }

  async updateWorker(scriptName: string, source: string) {
    const token = (globalThis as any).ENV?.CLOUDFLARE_API_TOKEN;
    const accountId = (globalThis as any).ENV?.CLOUDFLARE_ACCOUNT_ID;
    const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/scripts/${scriptName}`;
    const res = await fetch(url, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/javascript",
      },
      body: source,
    });
    const data = (await res.json()) as any;
    const state = this.persist({ lastAction: { method: "updateWorker", at: new Date().toISOString() } });
    return { ok: res.ok, status: res.status, result: data.result, state };
  }

  async getAnalytics(zoneId: string) {
    const token = (globalThis as any).ENV?.CLOUDFLARE_API_TOKEN;
    const url = `https://api.cloudflare.com/client/v4/zones/${zoneId}/analytics/dashboard?since=-6h`;
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });
    const data = (await res.json()) as any;
    const state = this.persist({ lastAction: { method: "getAnalytics", at: new Date().toISOString() } });
    return { ok: res.ok, status: res.status, analytics: data.result ?? data, state };
  }
}

export default HermesAgent;
