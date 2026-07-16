const fs=require('fs');
const code=fs.readFileSync('index.js','utf8');
const insert=`app.get('/api/stats', async (c) => {
  try {
    const { getRecentOpportunities } = require('./src/infra/cache.js');
    const opps = getRecentOpportunities(100);
    const bySymbol = {};
    for (const o of opps) { bySymbol[o.symbol] = (bySymbol[o.symbol]||0)+1; }
    return ok(c, { totalOpportunities: opps.length, topSymbols: Object.entries(bySymbol).sort((a,b)=>b[1]-a[1]).slice(0,10), latestSpread: opps[0] ? opps[0].spread_pct : 0, timestamp: new Date().toISOString() });
  } catch (e) { return err(c,'STATS_FAIL',500,e.message); }
});

app.get('/api/exchanges/health', async (c) => {
  try {
    const { getDb } = require('./src/db/opportunities.cjs');
    const db = getDb();
    if (!db) return ok(c, {});
    const rows = db.prepare('SELECT exchange, status, latency_ms, last_check FROM exchange_health').all();
    const health = {};
    for (const r of rows) health[r.exchange] = { status: r.status, latency_ms: r.latency_ms, last_check: r.last_check };
    return ok(c, health);
  } catch (e) { return err(c,'HEALTH_FAIL',500,e.message); }
});`;
const marker=`};\nconsole.log('[DB] SQLite initialized');`;
const idx=code.lastIndexOf(marker);
if(idx===-1){console.log('MARKER_NOT_FOUND');process.exit(1);}
const insertIdx=idx+marker.length;
const newCode=code.slice(0,insertIdx)+'\n\n'+insert+'\n'+code.slice(insertIdx);
fs.writeFileSync('index.js',newCode);
console.log('ROUTES_ADDED');
