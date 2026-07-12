// Durable Object: HFT Backup — maintains state when Railway is unavailable

export class HFTBackup {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.lastRailwayCheck = 0;
    this.railwayHealthy = true;
    this.failureCount = 0;
    this.maxFailures = 3;
  }

  async fetch(request) {
    const url = new URL(request.url);
    const method = request.method;

    if (method === 'POST' && url.pathname === '/sync-state') {
      return this.syncState(request);
    }
    if (method === 'GET' && url.pathname === '/get-state') {
      return this.getState();
    }
    if (method === 'POST' && url.pathname === '/record-opportunity') {
      return this.recordOpportunity(request);
    }
    if (method === 'POST' && url.pathname === '/update-position') {
      return this.updatePosition(request);
    }
    if (method === 'GET' && url.pathname === '/health') {
      return this.getHealth();
    }
    if (method === 'POST' && url.pathname === '/mark-railway-down') {
      return this.markRailwayDown();
    }
    if (method === 'POST' && url.pathname === '/mark-railway-up') {
      return this.markRailwayUp();
    }

    return new Response('Not Found', { status: 404 });
  }

  async syncState(request) {
    const body = await request.json();
    const { positions, prices, lastOpportunity } = body;

    await this.state.storage.put('positions', positions || []);
    await this.state.storage.put('prices', prices || {});
    await this.state.storage.put('lastOpportunity', lastOpportunity);
    await this.state.storage.put('lastSyncTime', Date.now());

    return new Response(JSON.stringify({ success: true }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  async getState() {
    const positions = await this.state.storage.get('positions');
    const prices = await this.state.storage.get('prices');
    const lastOpportunity = await this.state.storage.get('lastOpportunity');
    const lastSyncTime = await this.state.storage.get('lastSyncTime');

    return new Response(
      JSON.stringify({
        positions: positions || [],
        prices: prices || {},
        lastOpportunity,
        lastSyncTime,
        railwayHealthy: this.railwayHealthy,
      }),
      { headers: { 'Content-Type': 'application/json' } }
    );
  }

  async recordOpportunity(request) {
    const opportunity = await request.json();
    const opportunities = (await this.state.storage.get('opportunities')) || [];
    opportunities.push({ ...opportunity, recordedAt: Date.now() });
    // Keep only last 100
    if (opportunities.length > 100) opportunities.shift();
    await this.state.storage.put('opportunities', opportunities);

    return new Response(JSON.stringify({ success: true }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  async updatePosition(request) {
    const position = await request.json();
    const positions = (await this.state.storage.get('positions')) || [];
    const idx = positions.findIndex((p) => p.id === position.id);
    if (idx >= 0) {
      positions[idx] = { ...positions[idx], ...position, updatedAt: Date.now() };
    } else {
      positions.push({ ...position, createdAt: Date.now() });
    }
    await this.state.storage.put('positions', positions);

    return new Response(JSON.stringify({ success: true }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  async getHealth() {
    const lastSyncTime = await this.state.storage.get('lastSyncTime');
    const timeSinceSync = Date.now() - (lastSyncTime || 0);

    return new Response(
      JSON.stringify({
        healthy: this.railwayHealthy,
        failureCount: this.failureCount,
        timeSinceSyncMs: timeSinceSync,
        stateAvailable: timeSinceSync < 300000, // 5 minutes
      }),
      { headers: { 'Content-Type': 'application/json' } }
    );
  }

  async markRailwayDown() {
    this.failureCount++;
    if (this.failureCount >= this.maxFailures) {
      this.railwayHealthy = false;
      await this.state.storage.put('railwayDown', true);
      await this.state.storage.put('railwayDownTime', Date.now());
    }

    return new Response(JSON.stringify({ failureCount: this.failureCount }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  async markRailwayUp() {
    this.failureCount = 0;
    this.railwayHealthy = true;
    await this.state.storage.put('railwayDown', false);

    return new Response(JSON.stringify({ railwayHealthy: true }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
