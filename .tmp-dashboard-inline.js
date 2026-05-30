
  // Free TradingView widget for quick visual validation before execution.
  (function initTradingViewWidget(){
    const script = document.createElement('script');
    script.src = 'https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js';
    script.async = true;
    script.innerHTML = JSON.stringify({
      autosize: true,
      symbol: 'BINANCE:BTCUSDT',
      interval: '15',
      timezone: 'Etc/UTC',
      theme: 'dark',
      style: '1',
      locale: 'en',
      allow_symbol_change: true,
      support_host: 'https://www.tradingview.com',
      container_id: 'tvChartWidget'
    });
    const target = document.getElementById('tvChartWidget');
    if (target) target.appendChild(script);
  })();

  const OPEN_SOURCE_SYMBOL = 'BTCUSDT';
  let _ossChart = null;
  let _ossSeries = null;
  let _ossLoaded = false;

  function _loadLightweightChartsLib(){
    return new Promise((resolve, reject) => {
      if (window.LightweightCharts) {
        resolve();
        return;
      }
      const script = document.createElement('script');
      script.src = 'https://unpkg.com/lightweight-charts/dist/lightweight-charts.standalone.production.js';
      script.async = true;
      script.onload = () => resolve();
      script.onerror = () => reject(new Error('تعذر تحميل مكتبة Lightweight Charts'));
      document.head.appendChild(script);
    });
  }

  async function initOpenSourceChart(){
    if (_ossLoaded) return;
    const container = document.getElementById('ossChart');
    if (!container) return;

    await _loadLightweightChartsLib();

    const chart = window.LightweightCharts.createChart(container, {
      layout: { background: { color: '#12161e' }, textColor: '#cfd3dc' },
      grid: {
        vertLines: { color: 'rgba(255,255,255,0.06)' },
        horzLines: { color: 'rgba(255,255,255,0.06)' }
      },
      rightPriceScale: { borderColor: '#2a2e38' },
      timeScale: { borderColor: '#2a2e38', timeVisible: true, secondsVisible: false },
      crosshair: { mode: 0 }
    });

    const areaSeriesOptions = {
      lineColor: '#2ecc71',
      topColor: 'rgba(46, 204, 113, 0.34)',
      bottomColor: 'rgba(46, 204, 113, 0.03)',
      lineWidth: 2,
    };
    const lineSeriesOptions = {
      color: '#2ecc71',
      lineWidth: 2,
    };

    let series;
    if (typeof chart.addAreaSeries === 'function') {
      series = chart.addAreaSeries(areaSeriesOptions);
    } else if (typeof chart.addSeries === 'function' && window.LightweightCharts?.AreaSeries) {
      series = chart.addSeries(window.LightweightCharts.AreaSeries, areaSeriesOptions);
    } else if (typeof chart.addLineSeries === 'function') {
      series = chart.addLineSeries(lineSeriesOptions);
    } else {
      throw new Error('نسخة Lightweight Charts الحالية لا تدعم إنشاء السلسلة المطلوبة');
    }

    _ossChart = chart;
    _ossSeries = series;
    _ossLoaded = true;

    const resize = () => {
      const width = container.clientWidth || 600;
      const height = container.clientHeight || 300;
      chart.applyOptions({ width, height });
      chart.timeScale().fitContent();
    };
    resize();
    window.addEventListener('resize', resize);
  }

  function _bestPriceFromPayload(payload){
    const data = payload?.data || {};
    const picks = [
      data.binance,
      data.bybit,
      data.okx,
      data.bitget,
      data.coinbase,
      data.kraken,
      data.alpaca,
      data.ibkr,
      data.alpha_vantage,
      data.twelve_data,
    ];
    for (const p of picks) {
      const n = Number(p);
      if (Number.isFinite(n) && n > 0) return n;
    }
    return null;
  }

  async function updateOpenSourceChartPrice(){
    if (!_ossSeries) return;
    try {
      const res = await callAdminApi('/api/market/price/' + encodeURIComponent(OPEN_SOURCE_SYMBOL));
      const payload = JSON.parse(res.text);
      const price = _bestPriceFromPayload(payload);
      if (!Number.isFinite(price) || price <= 0) return;

      const point = {
        time: Math.floor(Date.now() / 1000),
        value: Number(price),
      };
      _ossSeries.update(point);

      const meta = document.getElementById('ossChartMeta');
      if (meta) {
        meta.textContent = 'الرمز: ' + OPEN_SOURCE_SYMBOL + ' | آخر سعر: ' + Number(price).toFixed(6) + ' | آخر تحديث: ' + new Date().toLocaleTimeString('ar');
      }
    } catch (e) {
      console.warn('[oss-chart] update failed:', e.message || e);
    }
  }

  function _renderFreeSourceCard(source){
    const ok = !!source.configured;
    const border = ok ? '#2ecc71' : '#e67e22';
    const status = ok ? '<span style="color:#2ecc71">✅ جاهز</span>' : '<span style="color:#e67e22">⚠️ يحتاج تهيئة</span>';
    const missing = Array.isArray(source.missing) && source.missing.length
      ? '<div style="font-size:.74em;color:#e67e22;margin-top:6px">Missing: ' + source.missing.join(', ') + '</div>'
      : '';

    return '<div class="bal-card" style="border:1px solid ' + border + '">' +
      '<div class="bal-name">' + String(source.name || source.id || '').toUpperCase() + '</div>' +
      '<div style="font-size:.78em;color:#888;margin-top:4px">' + (source.type || 'integration') + '</div>' +
      '<div style="margin-top:8px;font-size:.82em">' + status + '</div>' +
      '<div style="font-size:.76em;color:#aaa;margin-top:4px">' + (source.note || '') + '</div>' +
      missing +
    '</div>';
  }

  async function loadFreeSources(){
    const grid = document.getElementById('freeSourcesGrid');
    if (!grid) return;
    try {
      const res = await callAdminApi('/api/free-sources');
      const payload = JSON.parse(res.text);
      const sources = Array.isArray(payload?.sources) ? payload.sources : [];
      grid.innerHTML = sources.length
        ? sources.map(_renderFreeSourceCard).join('')
        : '<span style="color:#888">لا توجد تكاملات مجانية معروضة</span>';
    } catch (e) {
      grid.innerHTML = '<span style="color:#e74c3c">❌ ' + (e.message || 'تعذر تحميل التكاملات') + '</span>';
    }
  }

  // ── Auto-refresh countdown ───────────────────────────────────────────────────
  const AUTO_REFRESH_SECONDS = 30;
  let _cd = AUTO_REFRESH_SECONDS;
  let _refreshBusy = false;

  function _setCountdown(value){
    const el = document.getElementById('countdown');
    if (el) el.textContent = String(value);
  }

  function _setCountdownLabel(text){
    const el = document.getElementById('countdownLabel');
    if (el) el.textContent = text;
  }

  function _logSettledFailures(results, scope){
    results.forEach((res) => {
      if (res.status === 'rejected') {
        console.error('[' + scope + '] refresh task failed:', res.reason?.message || res.reason);
      }
    });
  }

  async function triggerRefresh(manual = false){
    if (_refreshBusy) return;
    _refreshBusy = true;
    _setCountdownLabel(manual ? '⏳ جاري التحديث…' : '🔄 تحديث تلقائي…');
    try {
      const results = await Promise.allSettled([loadDynamic(), loadApiSnapshot(), loadFreeSources(), updateOpenSourceChartPrice()]);
      _logSettledFailures(results, 'dashboard');
    } finally {
      _refreshBusy = false;
      _cd = AUTO_REFRESH_SECONDS;
      _setCountdown(_cd);
      _setCountdownLabel('تحديث تلقائي:');
    }
  }

  setInterval(() => {
    if (_refreshBusy) return;
    _cd -= 1;
    _setCountdown(_cd);
    if (_cd <= 0) triggerRefresh(false);
  }, 1000);

  // ── Shared API helper ────────────────────────────────────────────────────────
  // When ADMIN_TOKEN is configured, auth is handled via HttpOnly session cookie.
  // Without ADMIN_TOKEN we run in open setup mode and call APIs directly.
  const adminConfigured = false;
  function setButtonsBusy(b){ document.querySelectorAll('[data-admin-action]').forEach(btn=>btn.disabled=b); }
  function disableAdminUi(){
    if(adminConfigured) return;
    document.querySelectorAll('[data-admin-action]').forEach(btn=>{
      btn.title='وضع مفتوح (بدون ADMIN_TOKEN) — فعّل التوكن للحماية الإنتاجية';
    });
  }
  async function callAdminApi(path,opts={}){
    let r;
    try{
      r = adminConfigured
        ? await fetch(path,{credentials:'same-origin',...opts})
        : await fetch(path,opts);
    }
    catch(_){ throw new Error('تعذر الاتصال بالخادم'); }
    if(adminConfigured && r.status===401){ window.location='/login'; return {text:'',r}; }
    const text=await r.text();
    if(!r.ok) throw new Error(text||('HTTP '+r.status));
    return {text,r};
  }

  // ── Admin actions ────────────────────────────────────────────────────────────
  async function adminAction(a){
    setButtonsBusy(true);
    try{ const res=await callAdminApi('/'+a); alert(res.text||'✅ تم'); location.reload(); }
    catch(e){ alert('❌ '+e.message); }
    finally{ setButtonsBusy(false); }
  }
  async function setMode(m){
    if(m==='live' && !confirm('⚠️ هل أنت متأكد من التبديل إلى وضع LIVE؟ سيتم تنفيذ أوامر حقيقية!')) return;
    setButtonsBusy(true);
    try{ await callAdminApi('/mode/'+m,{method:'POST'}); location.reload(); }
    catch(e){ alert('❌ '+e.message); }
    finally{ setButtonsBusy(false); }
  }
  async function saveConfig(){
    const body={
      max_daily_loss_usd:         parseFloat(document.getElementById('maxDailyLoss').value),
      daily_limit_usd:            parseFloat(document.getElementById('dailyLimitUsd').value),
      max_per_trade_loss_pct:     parseFloat(document.getElementById('maxPerTrade').value),
      min_seconds_between_trades: parseFloat(document.getElementById('minSeconds').value),
      initial_capital:            parseFloat(document.getElementById('initialCapital').value),
      position_size_usd:          parseFloat(document.getElementById('positionSizeUsd')?.value || '5'),
      multi_strategy_live:        !!document.getElementById('multiStrategyLive')?.checked,
      max_live_trades_per_scan:   parseInt(document.getElementById('maxLiveTradesPerScan')?.value || '3', 10),
      scan_symbol_mode:           document.getElementById('scanSymbolMode')?.value || 'cex_union',
      max_dynamic_symbols:        parseInt(document.getElementById('maxDynamicSymbols')?.value || '500', 10),
      max_metamask_symbols:       parseInt(document.getElementById('maxMetaMaskSymbols')?.value || '10000', 10),
      scan_quote_assets:          String(document.getElementById('scanQuoteAssets')?.value || '').split(',').map(v=>v.trim()).filter(Boolean),
      use_dynamic_symbols:        !!document.getElementById('useDynamicSymbols')?.checked,
      strategy_flags: {
        cex:         !!document.getElementById('flag_cex')?.checked,
        dex:         !!document.getElementById('flag_dex')?.checked,
        perps:       !!document.getElementById('flag_perps')?.checked,
        funding:     !!document.getElementById('flag_funding')?.checked,
        triangular:  !!document.getElementById('flag_triangular')?.checked,
        statistical: !!document.getElementById('flag_statistical')?.checked,
      }
    };
    const numericKeys=['max_daily_loss_usd','daily_limit_usd','max_per_trade_loss_pct','min_seconds_between_trades','initial_capital','max_live_trades_per_scan','position_size_usd','max_dynamic_symbols','max_metamask_symbols'];
    for(const k of numericKeys){
      const v=Number(body[k]);
      if(!Number.isFinite(v)||v<=0){ alert('❌ قيمة غير صحيحة: '+k); return; }
    }
    // Enforce position size safety bounds in the UI
    if (body.position_size_usd < 1 || body.position_size_usd > 500) {
      alert('❌ حجم المركز يجب أن يكون بين 1 و 500 USDT'); return;
    }
    setButtonsBusy(true);
    try{
      await callAdminApi('/config',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
      alert('✅ تم حفظ الإعدادات'); location.reload();
    }catch(e){ alert('❌ '+e.message); }
    finally{ setButtonsBusy(false); }
  }

  async function enableFullUniversePreset(){
    if (!confirm('⚠️ تفعيل مسح واسع لكل الرموز يزيد الحمل وقد يرفع زمن الدورة. المتابعة؟')) return;
    setButtonsBusy(true);
    try {
      const body = {
        use_dynamic_symbols: true,
        scan_symbol_mode: 'cex_union',
        max_dynamic_symbols: 500,
        max_metamask_symbols: 20000,
        scan_quote_assets: ['USDT', 'USDC', 'FDUSD', 'BUSD', 'DAI', 'TUSD', 'BTC', 'ETH'],
        strategy_flags: {
          cex: true,
          dex: true,
          perps: true,
          funding: true,
          triangular: true,
          statistical: true,
        }
      };
      await callAdminApi('/config', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      alert('✅ تم تفعيل وضع كل الرموز بنجاح');
      location.reload();
    } catch (e) {
      alert('❌ ' + e.message);
    } finally {
      setButtonsBusy(false);
    }
  }
  async function resetDaily(){
    if(!confirm('⚠️ إعادة تعيين إحصائيات اليوم (PnL + عدد الصفقات)؟')) return;
    setButtonsBusy(true);
    try{ const res=await callAdminApi('/reset-daily',{method:'POST'}); alert(res.text||'✅ تم'); location.reload(); }
    catch(e){ alert('❌ '+e.message); }
    finally{ setButtonsBusy(false); }
  }

  // ── P&L Chart ────────────────────────────────────────────────────────────────
  const pnlLabels = [];

  function _parseDateSafe(value){
    if (value == null || value === '') return null;
    if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
    if (typeof value === 'number') {
      const ms = value < 1e12 ? value * 1000 : value;
      const d = new Date(ms);
      return Number.isNaN(d.getTime()) ? null : d;
    }
    const raw = String(value).trim();
    if (!raw) return null;
    if (/^\d+$/.test(raw)) {
      const n = Number(raw);
      const ms = n < 1e12 ? n * 1000 : n;
      const d = new Date(ms);
      return Number.isNaN(d.getTime()) ? null : d;
    }
    const normalized = raw.includes(' ') && !raw.includes('T') ? raw.replace(' ', 'T') : raw;
    const d = new Date(normalized);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  function _fmtDateTimeAr(value){
    const d = _parseDateSafe(value);
    return d ? d.toLocaleString('ar') : '—';
  }
  try {
    const ctx=document.getElementById('pnlChart').getContext('2d');
    new Chart(ctx,{type:'line',data:{
      labels: pnlLabels.length ? pnlLabels : Array.from({length:0},(_,i)=>i+1),
      datasets:[{label:'الربح المتراكم ($)',data:[],borderColor:'#f0b90b',backgroundColor:'rgba(240,185,11,0.08)',fill:true,tension:.3,pointRadius:3}]
    },options:{responsive:true,plugins:{legend:{labels:{color:'#eee'}}},scales:{x:{ticks:{color:'#888',maxTicksLimit:12}},y:{ticks:{color:'#888'}}}}});
    } catch(_chartErr){ console.warn('P&L chart init failed:', _chartErr); }

    // ── Strategy P&L Bar Chart ────────────────────────────────────────────────────
    try {
    const stratCtx = document.getElementById('stratChart').getContext('2d');
    new Chart(stratCtx, {
      type: 'bar',
      data: {
        labels: ['CEX', 'DEX', 'Perps', 'Triangular', 'Statistical'],
        datasets: [{
          label: 'P&L بالاستراتيجية ($)',
          data: [
            0.0000,
            0.0000,
            0.0000,
            0.0000,
            0.0000
          ],
          backgroundColor: ['#3498db','#9b59b6','#e67e22','#1abc9c','#e91e8c'],
          borderRadius: 6
        }]
      },
      options: {
        responsive: true,
        plugins: { legend: { labels: { color: '#eee' } } },
        scales: {
          x: { ticks: { color: '#888' } },
          y: { ticks: { color: '#888' } }
        }
      }
    });
    } catch(_chartErr){ console.warn('Strategy chart init failed:', _chartErr); }
  // ── Backtesting ──────────────────────────────────────────────────────────────
  async function runBacktest() {
    const capital  = parseFloat(document.getElementById('bt_capital').value)  || 1000;
    const frac     = parseFloat(document.getElementById('bt_frac').value)     || 0.10;
    const minnet   = parseFloat(document.getElementById('bt_minnet').value)   || 0;
    const days     = parseInt(document.getElementById('bt_days').value)       || 30;
    const from_ms  = Date.now() - days * 86400000;
    const body     = JSON.stringify({ initial_capital: capital, position_frac: frac, min_net_pct: minnet, from_ms, run_monte_carlo: true });
    const el       = document.getElementById('btResults');
    const grid     = document.getElementById('btMetricsGrid');
    const mc       = document.getElementById('btMC');
    grid.innerHTML = '<span style="color:#888">جارٍ التشغيل…</span>';
    el.style.display = 'block';
    mc.textContent   = '';
    try {
      const res  = await callAdminApi('/api/backtest', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
      const data = JSON.parse(res.text);
      const m    = data.metrics || {};
      const ret  = (data.return_pct || 0).toFixed(2);
      const retColor = parseFloat(ret) >= 0 ? '#2ecc71' : '#e74c3c';
      grid.innerHTML = `
        <div class="card"><div class="card-label">العائد</div><div class="card-value" style="color:${retColor}">${ret}%</div></div>
        <div class="card"><div class="card-label">رأس المال النهائي</div><div class="card-value">$${(data.final_equity||0).toFixed(2)}</div></div>
        <div class="card"><div class="card-label">الصفقات</div><div class="card-value">${m.total_trades||0}</div></div>
        <div class="card"><div class="card-label">Win Rate</div><div class="card-value">${((m.win_rate||0)*100).toFixed(1)}%</div></div>
        <div class="card"><div class="card-label">Sharpe</div><div class="card-value">${(m.sharpe||0).toFixed(2)}</div></div>
        <div class="card"><div class="card-label">Sortino</div><div class="card-value">${(m.sortino||0).toFixed(2)}</div></div>
        <div class="card"><div class="card-label">Max Drawdown</div><div class="card-value" style="color:#e74c3c">$${(m.max_drawdown_usd||0).toFixed(2)}</div></div>
        <div class="card"><div class="card-label">Profit Factor</div><div class="card-value">${isFinite(m.profit_factor)?((m.profit_factor||0).toFixed(2)):'∞'}</div></div>
      `;
      if (data.monte_carlo) {
        const mc_data = data.monte_carlo;
        mc.innerHTML  = `🎲 Monte Carlo (500 simulations) — P5: $${mc_data.p5?.toFixed(2)} | P50: $${mc_data.p50?.toFixed(2)} | P95: $${mc_data.p95?.toFixed(2)}`;
      }
    } catch(e) {
      grid.innerHTML = '<span style="color:#e74c3c">❌ ' + e.message + '</span>';
    }
  }

  async function loadBacktestRuns() {
    const panel = document.getElementById('btRunsPanel');
    const tbody = document.getElementById('btRunsBody');
    panel.style.display = 'block';
    tbody.innerHTML = '<tr><td colspan="5" style="color:#888;text-align:center">جارٍ التحميل…</td></tr>';
    try {
      const res  = await callAdminApi('/api/backtest/runs');
      const data = JSON.parse(res.text);
      const runs = data.runs || [];
      if (!runs.length) { tbody.innerHTML = '<tr><td colspan="5" style="color:#888;text-align:center">لا يوجد تاريخ اختبارات</td></tr>'; return; }
      tbody.innerHTML = runs.map(r => {
        const m    = r.metrics || {};
        const ret  = (r.return_pct || 0).toFixed(2);
        const date = _fmtDateTimeAr(r.created_at);
        const retColor = parseFloat(ret) >= 0 ? '#2ecc71' : '#e74c3c';
        return `<tr>
          <td style="font-size:.82em">${date}</td>
          <td>${m.total_trades||0}</td>
          <td style="color:${retColor}">${ret}%</td>
          <td>${(m.sharpe||0).toFixed(2)}</td>
          <td style="color:#e74c3c">$${(m.max_drawdown_usd||0).toFixed(2)}</td>
        </tr>`;
      }).join('');
    } catch(e) {
      tbody.innerHTML = `<tr><td colspan="5" style="color:#e74c3c">❌ ${e.message}</td></tr>`;
    }
  }

  // ── Load dynamic panels ──────────────────────────────────────────────────────
  async function loadBalances(){
    const el=document.getElementById('balancesContent');
    try{
      const res=await callAdminApi('/api/balances');
      const json=JSON.parse(res.text);
      const exchanges=json.data||[];
      const anyConfigured=exchanges.some(b=>b.configured&&!b.dataOnly);
      const items=exchanges.map(b=>{
        if (b.dataOnly) return `<div class="bal-card" style="opacity:.4;border-left:2px solid #888"><div class="bal-name">${b.exchange.toUpperCase()}</div><div class="bal-value" style="color:#888;font-size:.8em">${b.note||'Data only'}</div></div>`;
        if(!b.configured){
          const missingKeysList=(b.missing_keys||[]).join(', ');
          const hint=missingKeysList?`<div style="font-size:.72em;color:#e67e22;margin-top:4px;word-break:break-all">🔑 أضف: ${missingKeysList}</div>`:'';
          return `<div class="bal-card" style="border:1px solid #e67e22"><div class="bal-name">${b.exchange.toUpperCase()}</div><div class="bal-value" style="color:#888;font-size:.85em">غير مُهيأ</div>${hint}</div>`;
        }
        if (b.error) {
          const msg = String(b.error || 'Balance fetch failed').slice(0, 120);
          return `<div class="bal-card" style="border:1px solid #e67e22"><div class="bal-name">${b.exchange.toUpperCase()}</div><div class="bal-value" style="color:#e67e22;font-size:.82em">تعذر جلب الرصيد</div><div style="font-size:.72em;color:#888;margin-top:4px;word-break:break-word">${msg}</div></div>`;
        }
        const color=b.balance>0?'#2ecc71':'#888';
        return `<div class="bal-card"><div class="bal-name">${b.exchange.toUpperCase()}</div><div class="bal-value" style="color:${color}">$${Number(b.balance).toFixed(2)}</div></div>`;
      }).join('');
      const setupBanner=!anyConfigured
        ?`<div style="background:#c0392b;color:#fff;padding:10px 14px;border-radius:8px;margin-bottom:12px;font-size:.85em">
            ⚠️ <strong>لا توجد مفاتيح API مُعيَّنة — لن تعمل الصفقات الحقيقية.</strong><br>
            أضف أسرار المنصات باستخدام:<br>
            <code style="background:rgba(0,0,0,.3);padding:2px 5px;border-radius:4px">wrangler secret put MEXC_API_KEY</code> (وهكذا لكل مفتاح).<br>
            راجع <a href="/checklist" style="color:#f0b90b">قائمة الإعداد</a> لمزيد من التفاصيل.
           </div>`
        :``;
      el.innerHTML=setupBanner+(items||'<span style="color:#888">لا بيانات</span>');
    }catch(e){ el.innerHTML='<span style="color:#e74c3c">❌ '+e.message+'</span>'; }
  }
  async function loadCircuitBreaker(){
    const el=document.getElementById('cbContent');
    try{
      const { text } = await callAdminApi('/api/status');
      const json=JSON.parse(text);
      const cb=json.circuitBreaker||{};
      const active=['mexc','mexc_perp','binance_perp','binance','kucoin','bitget','bitmart','htx'];
      const dataOnly=['bybit','gateio','bybit_perp'];
      const items=[
        ...active.map(ex=>{
          const info=cb[ex];
          const open=info&&info.open&&(Date.now()-info.lastFailure)<300000;
          const failures=info?.failures||0;
          const cls=open?'cb-open':'cb-ok';
          const label=open?`🔴 مفتوح (${failures} أخطاء)`:`✅ سليم`;
          const isDataOnly=['binance_perp'].includes(ex);
          return `<div class="cb-card"${isDataOnly?' style="opacity:.75"':''}><div class="name">${ex.toUpperCase()}</div><div class="${cls}">${label}${isDataOnly?' <span style="font-size:.72em;color:#888">(feed)</span>':''}</div></div>`;
        }),
        ...dataOnly.map(ex=>`<div class="cb-card" style="opacity:.4"><div class="name">${ex.toUpperCase()}</div><div style="color:#888;font-size:.78em">📊 بيانات فقط</div></div>`)
      ].join('');
      el.innerHTML=items;
    }catch(e){ el.innerHTML='<span style="color:#e74c3c">❌ '+e.message+'</span>'; }
  }
  async function loadPerpsStatus(){
    const el=document.getElementById('perpsStatusContent');
    if(!el) return;
    try{
      const res=await callAdminApi('/api/perps');
      const json=JSON.parse(res.text);
      const exList=(json.exchangeStatus||[]).map(ex=>{
        const statusColor=ex.status==='ok'?'#2ecc71':'#e74c3c';
        const statusLabel=ex.status==='ok'?'✅ نشط':'🔴 مفتوح';
        return `<div class="bal-card"><div class="bal-name">${ex.exchange.toUpperCase()}</div><div style="color:${statusColor};font-size:.85em">${statusLabel}</div></div>`;
      }).join('');
      const mexcBadge=json.mexcFuturesConfigured
        ?'<span style="color:#2ecc71;font-weight:bold">✅ MEXC Futures مُهيأ</span>'
        :'<span style="color:#e74c3c;font-weight:bold">⚠️ MEXC Futures: أضف MEXC_API_KEY و MEXC_API_SECRET</span>';
      const perpOpp=json.lastPerpsOpp;
      const perpCard=perpOpp
        ?`<div style="margin-top:8px;font-size:.82em;color:#aaa">${perpOpp.symbol} |${perpOpp.direction} | صافي: <strong style="color:#2ecc71">${perpOpp.netPct.toFixed(4)}%</strong></div>`
        :'<div style="font-size:.82em;color:#888;margin-top:8px">لا توجد فرصة perp في آخر مسح</div>';
      el.innerHTML=`<div style="margin-bottom:10px">${mexcBadge}</div><div style="font-size:.78em;color:#888;margin-bottom:10px">${json.executionNote||''}</div><div class="bal-grid">${exList}</div>${perpCard}`;
    }catch(e){ el.innerHTML='<span style="color:#e74c3c">❌ '+e.message+'</span>'; }
  }
  async function loadExecutableIntegrationsStatus(){
    const el=document.getElementById('execIntegrationsResult');
    if(!el) return;
    el.style.display='block';
    el.textContent='جارٍ التحميل...';
    try{
      const res=await callAdminApi('/api/integrations/executive/status');
      const json=JSON.parse(res.text);
      const lines=(json.integrations||[]).map(item=>{
        const cfg=item.configured?'✅':'⚠️';
        const status=item.reachable===true?'متصل':(item.reachable===false?'غير متصل':'غير مفحوص');
        return `${cfg} ${item.integration.toUpperCase()} | configured=${item.configured?'yes':'no'} | status=${status}`;
      });
      el.textContent=lines.join('\n')||'لا توجد بيانات';
    }catch(e){
      el.textContent='❌ '+e.message;
    }
  }
  async function runExecutableIntegration(integration){
    setButtonsBusy(true);
    try{
      const res=await callAdminApi('/api/integrations/executive/execute',{
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({
          integration,
          payload:{ trigger:'dashboard', requested_at:new Date().toISOString() }
        })
      });
      const json=JSON.parse(res.text);
      const el=document.getElementById('execIntegrationsResult');
      if(el){
        el.style.display='block';
        el.textContent=JSON.stringify(json,null,2);
      }
    }catch(e){ alert('❌ '+e.message); }
    finally{ setButtonsBusy(false); }
  }
  async function runAllExecutableIntegrations(){
    if(!confirm('تشغيل التكاملات التنفيذية الأربعة الآن؟')) return;
    setButtonsBusy(true);
    try{
      const res=await callAdminApi('/api/integrations/executive/execute-all',{
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({
          defaultPayload:{ trigger:'dashboard_all', requested_at:new Date().toISOString() }
        })
      });
      const json=JSON.parse(res.text);
      const el=document.getElementById('execIntegrationsResult');
      if(el){
        el.style.display='block';
        el.textContent=JSON.stringify(json,null,2);
      }
    }catch(e){ alert('❌ '+e.message); }
    finally{ setButtonsBusy(false); }
  }
  const PLATFORM_REFRESH_MS = 30000;
  const PLATFORM_BACKOFF_BASE_MS = 2000;
  const PLATFORM_BACKOFF_MAX_MS = 30000;
  const _platformsState = {
    all: [],
    query: '',
    inFlight: false,
    retryCount: 0,
    retryTimer: null,
  };

  function _setPlatformsStatus(msg, color='#888'){
    const el = document.getElementById('platformsFetchStatus');
    if (!el) return;
    el.style.color = color;
    el.textContent = msg;
  }

  function _setPlatformsUpdatedAtLabel(value){
    const el = document.getElementById('platformsUpdatedAt');
    if (!el) return;
    el.textContent = 'آخر تحديث: ' + (value || '—');
  }

  function _renderPlatformsFromState(){
    const grid = document.getElementById('platformsGrid');
    if (!grid) return;
    const q = (_platformsState.query || '').trim().toLowerCase();
    const filtered = !q
      ? _platformsState.all
      : _platformsState.all.filter((p) => {
          const haystack = [
            p.name,
            p.type,
            p.executionMode,
            ...(p.strategies || []),
            p.configured ? 'configured' : 'unconfigured',
            p.configured ? 'مهيأ' : 'غير مهيأ',
          ].join(' ').toLowerCase();
          return haystack.includes(q);
        });

    grid.innerHTML = filtered.map(_renderPlatformCard).join('') ||
      '<span style="color:#888">لا توجد منصات مطابقة</span>';
  }

  function filterPlatformsGrid(){
    const input = document.getElementById('platformsSearch');
    _platformsState.query = input ? input.value : '';
    _renderPlatformsFromState();
  }

  function _schedulePlatformsRetry(){
    if (_platformsState.retryTimer) return;
    const delayMs = Math.min(
      PLATFORM_BACKOFF_BASE_MS * (2 ** Math.max(0, _platformsState.retryCount - 1)),
      PLATFORM_BACKOFF_MAX_MS
    );
    _setPlatformsStatus('⚠️ تعذر جلب المنصات. إعادة المحاولة خلال ' + Math.round(delayMs / 1000) + ' ثانية...', '#e67e22');
    _platformsState.retryTimer = setTimeout(() => {
      _platformsState.retryTimer = null;
      loadPlatformsGrid({ fromRetry: true });
    }, delayMs);
  }

  async function loadDynamic(){
    disableAdminUi();
    const results = await Promise.allSettled([
      loadBalances(),
      loadCircuitBreaker(),
      loadPerpsStatus(),
      loadExecutableIntegrationsStatus(),
      loadPlatformsGrid({ force: true }),
      loadFreeSources(),
      updateOpenSourceChartPrice(),
    ]);
    _logSettledFailures(results, 'dynamic-panels');
  }
  initOpenSourceChart().then(() => updateOpenSourceChartPrice()).catch((e) => {
    const meta = document.getElementById('ossChartMeta');
    if (meta) meta.textContent = '❌ تعذر تهيئة المخطط المفتوح المصدر: ' + (e.message || e);
  });
  loadDynamic();
  setInterval(() => updateOpenSourceChartPrice(), 15000);
  setInterval(() => loadFreeSources(), 60000);

  // ── Platform cards — dynamic refresh every 30 s ─────────────────────────────
  function _renderPlatformCard(p){
    const isConfigured = !!p.configured;
    const isDataOnly = !!p.dataOnly;
    const isWeb3 = p.type === 'web3';
    const borderColor  = isWeb3 ? '#3498db' : isDataOnly ? '#888' : (isConfigured ? '#2ecc71' : '#e67e22');
    const balLine      = isWeb3
      ? `<div style="font-size:.8em;color:#3498db;margin-top:4px">🌐 Web3 only</div>`
      : isDataOnly
        ? `<div style="font-size:.78em;color:#888;margin-top:4px">📊 بيانات فقط</div>`
      : isConfigured && p.error
        ? `<div style="font-size:.8em;color:#e67e22;margin-top:4px">❌ تعذر جلب الرصيد</div>`
      : isConfigured && p.balance != null
        ? `<div style="font-size:.88em;color:#2ecc71;margin-top:4px">$${Number(p.balance).toFixed(2)} USDT</div>`
        : isConfigured
          ? `<div style="font-size:.8em;color:#888;margin-top:4px">جارٍ جلب الرصيد…</div>`
          : `<div style="font-size:.72em;color:#e67e22;margin-top:4px">🔑 غير مُهيأ</div>`;
    const statusLabel = isWeb3
      ? `<span style="color:#3498db">✅ Web3</span>`
      : isDataOnly
        ? `<span style="color:#888">📊 بيانات فقط</span>`
      : isConfigured
        ? `<span style="color:#2ecc71">✅ مُهيأ</span>`
        : `<span style="color:#e67e22">⚠️ غير مُهيأ</span>`;
    const updatedLine = `<div style="font-size:.72em;color:#888;margin-top:4px">آخر تحديث: ${p._fetchedAt || '—'}</div>`;
    const safeData = JSON.stringify(p).replace(/'/g,"&#39;");
    return `<div class="bal-card" style="border:1px solid ${borderColor};cursor:pointer" onclick="showPlatformModal('${safeData}')">
      <div class="bal-name">${p.name.toUpperCase()}</div>
      <div style="font-size:.8em">${statusLabel}</div>
      ${balLine}
      ${updatedLine}
    </div>`;
  }

  async function loadPlatformsGrid(opts = {}){
    const grid = document.getElementById('platformsGrid');
    if (!grid) return;
    if (_platformsState.inFlight && !opts.force) return;
    _platformsState.inFlight = true;
    try {
      const res  = await callAdminApi('/api/platforms');
      const data = JSON.parse(res.text);
      if (!data || data.success !== true) {
        throw new Error('استجابة غير صالحة من /api/platforms');
      }
      const fetchedAt = new Date().toLocaleTimeString('ar');
      const platforms = Array.isArray(data.platforms) ? data.platforms : [];
      _platformsState.all = platforms.map((p) => ({ ...p, _fetchedAt: fetchedAt }));
      _platformsState.retryCount = 0;
      if (_platformsState.retryTimer) {
        clearTimeout(_platformsState.retryTimer);
        _platformsState.retryTimer = null;
      }
      _setPlatformsUpdatedAtLabel(fetchedAt);
      _setPlatformsStatus('✅ تم تحديث ' + platforms.length + ' منصة', '#2ecc71');
      _renderPlatformsFromState();
    } catch(e) {
      _platformsState.retryCount += 1;
      if (!_platformsState.all.length) {
        grid.innerHTML = `<span style="color:#e74c3c">❌ ${e.message}</span>`;
      }
      _setPlatformsStatus('❌ فشل التحديث: ' + e.message, '#e74c3c');
      _schedulePlatformsRetry();
    } finally {
      _platformsState.inFlight = false;
    }
  }
  setInterval(() => loadPlatformsGrid(), PLATFORM_REFRESH_MS);

  // ── Platform detail modal ────────────────────────────────────────────────────
  function showPlatformModal(rawJson){
    let p;
    try { p = typeof rawJson === 'string' ? JSON.parse(rawJson) : rawJson; } catch(_){ return; }
    const errText = p.error
      ? String(p.error).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')
      : '';
    const balText = p.type === 'web3'
      ? '🌐 Web3 — لا رصيد مركزي'
      : p.balance != null
        ? `$${Number(p.balance).toFixed(2)} USDT`
        : '—';
    const missingList = (p.missingKeys||[]).length
      ? `<ul style="margin:4px 0 0 16px;padding:0;color:#e67e22">${(p.missingKeys||[]).map(k=>`<li style="font-size:.82em">${k}</li>`).join('')}</ul>`
      : '<span style="color:#2ecc71;font-size:.82em">لا توجد مفاتيح ناقصة</span>';
    const stratList = (p.strategies||[]).map(s=>`<span style="background:#12161e;border-radius:4px;padding:2px 6px;font-size:.78em;margin:2px;display:inline-block">${s}</span>`).join(' ');
    document.getElementById('platformModalBody').innerHTML = `
      <h3 style="margin:0 0 14px;color:#f0b90b">${p.name.toUpperCase()} <span style="font-size:.7em;color:#888">${p.type}</span></h3>
      <table style="width:100%;border-collapse:collapse;font-size:.88em">
        <tr><td style="color:#888;padding:5px 0;width:140px">وضع التنفيذ</td><td><code>${p.executionMode}</code></td></tr>
        <tr><td style="color:#888;padding:5px 0">الحالة</td><td>${p.configured?'<span style="color:#2ecc71">✅ مُهيأ</span>':'<span style="color:#e67e22">⚠️ غير مُهيأ</span>'}</td></tr>
        <tr><td style="color:#888;padding:5px 0">آخر تحديث</td><td>${p._fetchedAt || '—'}</td></tr>
        <tr><td style="color:#888;padding:5px 0">رصيد USDT</td><td style="color:#2ecc71;font-weight:bold">${balText}</td></tr>
        ${errText ? `<tr><td style="color:#888;padding:5px 0">خطأ الرصيد</td><td style="color:#e67e22;font-size:.82em">${errText}</td></tr>` : ''}
        <tr><td style="color:#888;padding:5px 0">الاستراتيجيات</td><td>${stratList||'—'}</td></tr>
        <tr><td style="color:#888;padding:5px 0">مفاتيح ناقصة</td><td>${missingList}</td></tr>
        <tr><td style="color:#888;padding:5px 0;vertical-align:top">ملاحظات</td><td style="font-size:.82em;color:#ccc">${p.note||'—'}</td></tr>
      </table>
    `;
    document.getElementById('platformModal').style.display='flex';
  }
  function closePlatformModal(){
    document.getElementById('platformModal').style.display='none';
  }
  document.addEventListener('click', e=>{
    const modal = document.getElementById('platformModal');
    if (modal && e.target === modal) modal.style.display='none';
  });
  async function loadApiSnapshot(){
    const syncEl=document.getElementById('apiSyncStatus');
    const statusEl=document.getElementById('apiStatusCard');
    const tradesEl=document.getElementById('apiTradesCard');
    const pnlEl=document.getElementById('apiPnlCard');
    const reportEl=document.getElementById('apiReportCard');
    const logsEl=document.getElementById('apiLogsCard');
    try{
      const [statusSettle,tradesSettle,pnlSettle,reportSettle,logsSettle]=await Promise.allSettled([
        callAdminApi('/api/status'),
        callAdminApi('/api/trades?limit=20'),
        callAdminApi('/api/pnl'),
        callAdminApi('/api/report'),
        callAdminApi('/api/logs')
      ]);
      const statusOk = statusSettle.status === 'fulfilled';
      const tradesOk = tradesSettle.status === 'fulfilled';
      const pnlOk    = pnlSettle.status === 'fulfilled';
      const reportOk = reportSettle.status === 'fulfilled';
      const logsOk   = logsSettle.status === 'fulfilled';

      const statusJson = statusOk ? JSON.parse(statusSettle.value.text) : null;
      const tradesJson = tradesOk ? JSON.parse(tradesSettle.value.text) : null;
      const pnlJson    = pnlOk    ? JSON.parse(pnlSettle.value.text)    : null;
      const reportJson = reportOk ? JSON.parse(reportSettle.value.text) : null;
      const logsJson   = logsOk   ? JSON.parse(logsSettle.value.text)   : null;

      if (statusOk && statusJson) {
        const statusColor = statusJson.trading_enabled ? '#2ecc71' : '#e74c3c';
        const statusLabel = statusJson.trading_enabled ? '▶️ مفعّل' : '⏸️ متوقف';
        const modeLabel = statusJson.paper_trading !== false ? 'Paper' : 'Live';
        statusEl.innerHTML = 'الحالة: <strong style="color:' + statusColor + '">' + statusLabel + '</strong><br>الوضع: ' + modeLabel;
      } else {
        statusEl.textContent = 'خطأ';
      }

      const rows = Array.isArray(tradesJson?.data) ? tradesJson.data : [];
      tradesEl.textContent = tradesOk ? (rows.length + ' صفقة (آخر تحديث)') : 'خطأ';
      pnlEl.textContent = pnlOk ? (Object.keys(pnlJson?.data || {}).length + ' استراتيجيات') : 'خطأ';
      reportEl.textContent = reportOk
        ? ('WinRate ' + ((((reportJson?.data || {}).win_rate || 0) * 100).toFixed(1)) + '% | PF ' + ((reportJson?.data || {}).profit_factor ? Number((reportJson?.data || {}).profit_factor).toFixed(2) : '—'))
        : 'خطأ';
      if (logsOk) {
        const archiveCount = Array.isArray(logsJson?.objects) ? logsJson.objects.length : null;
        const adminCount = Array.isArray(logsJson?.data?.admin) ? logsJson.data.admin.length : 0;
        const botCount = Array.isArray(logsJson?.data?.bot) ? logsJson.data.bot.length : 0;
        logsEl.textContent = archiveCount != null ? (archiveCount + ' ملف') : ((adminCount + botCount) + ' حدث');
      } else {
        logsEl.textContent = 'خطأ';
      }

      const okCount = [statusOk, tradesOk, pnlOk, reportOk, logsOk].filter(Boolean).length;
      syncEl.style.color = okCount === 5 ? '#2ecc71' : (okCount > 0 ? '#f0b90b' : '#e74c3c');
      syncEl.textContent = okCount === 5
        ? '✅ الواجهة متصلة بنقاط API الخلفية.'
        : okCount > 0
          ? ('⚠️ مزامنة جزئية: ' + okCount + '/5 APIs متاحة.')
          : '❌ تعذر مزامنة الواجهة مع API.';

      const tbody=document.getElementById('recentTradesBody');
      if(tbody){
        tbody.innerHTML=rows.length?rows.map(t=>{
          const modeCell=t.mode==='live'
            ? '<span style="color:#e74c3c;font-weight:bold">LIVE</span>'
            : '<span style="color:#f0b90b;font-weight:bold">PAPER</span>';
          const parts=(t.strategy||'').split(':');
          const stratType=parts[0]?.toUpperCase()||'—';
          const stratDir=parts[1]||'';
          const pnlColor=Number(t.net_profit_percent)>=0?'#2ecc71':'#e74c3c';
          return `<tr>
            <td>${modeCell}</td>
            <td><span style="color:#3498db;font-weight:bold">${stratType}</span></td>
            <td style="font-size:.85em">${stratDir}</td>
            <td>$${Number(t.size_usd).toFixed(2)}</td>
            <td style="color:${pnlColor}">${Number(t.net_profit_percent).toFixed(4)}%</td>
            <td style="font-size:.82em">${_fmtDateTimeAr(t.created_at)}</td>
          </tr>`;
        }).join(''):'<tr><td colspan="6" style="text-align:center;padding:20px;color:#888">لا توجد صفقات مسجّلة</td></tr>';
      }
    }catch(e){
      syncEl.style.color='#e74c3c';
      syncEl.textContent='❌ تعذر مزامنة الواجهة مع API: '+e.message;
      [statusEl,tradesEl,pnlEl,reportEl,logsEl].forEach(el=>{ if(el) el.textContent='خطأ'; });
    }
  }
  loadApiSnapshot();

  // ── MetaMask / Web3 Wallet ────────────────────────────────────────────────────
  let w3account = null;

  async function connectWallet() {
    const statusEl   = document.getElementById('walletStatus');
    const connectedEl= document.getElementById('walletConnected');
    const metricsEl  = document.getElementById('walletMetrics');
    if (!window.ethereum) {
      alert('❌ MetaMask غير مثبّت. يرجى تثبيت إضافة MetaMask في المتصفح أو استخدام متصفح متوافق.');
      return;
    }
    try {
      statusEl.textContent = 'جارٍ الربط...';
      const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
      w3account = accounts[0];
      const balHex   = await window.ethereum.request({ method: 'eth_getBalance', params: [w3account, 'latest'] });
      const balEth   = (parseInt(balHex, 16) / 1e18).toFixed(4);
      const chainHex = await window.ethereum.request({ method: 'eth_chainId' });
      const chainId  = parseInt(chainHex, 16);
      const nets     = { 1: 'Ethereum', 10: 'Optimism', 42161: 'Arbitrum One', 137: 'Polygon', 8453: 'Base' };
      const netName  = nets[chainId] || `Chain ${chainId}`;
      statusEl.textContent = '';
      connectedEl.style.display = 'block';
      metricsEl.innerHTML = `
        <div class="card"><div class="card-label">العنوان</div><div style="font-size:.72em;word-break:break-all;color:#3498db">${w3account}</div></div>
        <div class="card"><div class="card-label">الشبكة</div><div class="card-value" style="color:#f0b90b">${netName}</div></div>
        <div class="card"><div class="card-label">رصيد ETH</div><div class="card-value" style="color:#2ecc71">${balEth} ETH</div></div>
      `;
      document.getElementById('w3network').value = chainId;
      window.ethereum.on('accountsChanged', (accs) => { w3account = accs[0]||null; if(!w3account) disconnectWallet(); });
      window.ethereum.on('chainChanged', () => connectWallet());
    } catch(e) {
      statusEl.textContent = '❌ ' + e.message;
    }
  }

  function disconnectWallet() {
    w3account = null;
    document.getElementById('walletConnected').style.display = 'none';
    document.getElementById('walletStatus').textContent = 'تم فصل المحفظة';
  }

  function _toDexPair(symbol){
    const normalized = String(symbol || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    const quotes = ['USDT', 'USDC', 'FDUSD', 'BUSD', 'DAI', 'TUSD', 'BTC', 'ETH'];
    for (const quote of quotes) {
      if (!normalized.endsWith(quote) || normalized.length <= quote.length) continue;
      const base = normalized.slice(0, -quote.length);
      const mappedQuote = (quote === 'USDT' || quote === 'USDC' || quote === 'FDUSD' || quote === 'BUSD' || quote === 'DAI' || quote === 'TUSD')
        ? 'USD'
        : quote;
      return base + '/' + mappedQuote;
    }
    return null;
  }

  async function loadWalletPairsCatalog(){
    const pairEl = document.getElementById('w3pair');
    if (!pairEl) return;
    try {
      const quotesRaw = String(document.getElementById('scanQuoteAssets')?.value || 'USDT,USDC,BTC,ETH');
      const quotes = encodeURIComponent(quotesRaw);
      const res = await callAdminApi('/api/symbols/catalog?includeMetaMask=true&maxMetaMask=20000&maxScan=500&quotes=' + quotes);
      const payload = JSON.parse(res.text);
      const preferred = Array.isArray(payload?.aggregate?.walletReadableCex) && payload.aggregate.walletReadableCex.length
        ? payload.aggregate.walletReadableCex
        : (Array.isArray(payload?.aggregate?.cexUnion) ? payload.aggregate.cexUnion : []);

      const top = preferred.slice(0, 300)
        .map(_toDexPair)
        .filter(Boolean);

      if (!top.length) return;
      const current = pairEl.value;
      pairEl.innerHTML = top.map((p) => '<option value="' + p + '">' + p + '</option>').join('');
      if (current && top.includes(current)) pairEl.value = current;
    } catch (e) {
      console.warn('[wallet-pairs] catalog load failed:', e.message || e);
    }
  }

  loadWalletPairsCatalog();

  async function signAndSendPerp(protocol) {
    const resultEl = document.getElementById('w3TxResult');
    if (!w3account) { alert('❌ ربط MetaMask أولاً'); return; }
    const size    = parseFloat(document.getElementById('w3size').value) || 100;
    const side    = document.getElementById('w3side').value;
    const pair    = document.getElementById('w3pair').value;
    const chainId = parseInt(document.getElementById('w3network').value);
    // Switch to target chain
    try {
      await window.ethereum.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: '0x' + chainId.toString(16) }]
      });
    } catch(switchErr) {
      if (switchErr.code !== 4902) {
        resultEl.style.color = '#e74c3c';
        resultEl.textContent = '❌ تعذّر التبديل للشبكة: ' + switchErr.message;
        return;
      }
    }
    resultEl.style.color = '#f0b90b';
    resultEl.textContent = '⏳ يُرجى تأكيد الصفقة في MetaMask...';
    try {
      // Build order intent with nonce + expiry to prevent replay attacks.
      // The signature is verified client-side only — no private key is sent to the server.
      const nonce  = crypto.getRandomValues(new Uint8Array(16));
      const nonceHex = Array.from(nonce).map(b=>b.toString(16).padStart(2,'0')).join('');
      const expiresAt = Date.now() + 5 * 60 * 1000; // 5 min expiry
      const intent = JSON.stringify({ protocol, pair, side, sizeUsd: size, account: w3account, chainId, nonce: nonceHex, expiresAt });
      const sig    = await window.ethereum.request({ method: 'personal_sign', params: [intent, w3account] });
      const protoLabel = protocol === 'gmx' ? 'GMX (Arbitrum)' : 'dYdX v4';
      resultEl.style.color = '#2ecc71';
      resultEl.innerHTML = `✅ تم توقيع أمر ${protoLabel}.<br>
        <span style="font-size:.78em;color:#aaa">
          Signature: ${sig.slice(0,30)}…<br>
          ادمج هذا التوقيع مع ${protoLabel} SDK لإتمام التنفيذ.
        </span>`;
    } catch(e) {
      resultEl.style.color = e.code === 4001 ? '#f0b90b' : '#e74c3c';
      resultEl.textContent = e.code === 4001 ? '⚠️ رفضت الصفقة في MetaMask' : '❌ ' + e.message;
    }
  }

  // ── AI Analysis ──────────────────────────────────────────────────────────────
  async function runAiAnalysis() {    const el = document.getElementById('aiResult');
    const opportunity = {
      symbol:    document.getElementById('ai_symbol').value.trim(),
      strategy:  document.getElementById('ai_strategy').value,
      direction: document.getElementById('ai_direction').value.trim(),
      buyPrice:  parseFloat(document.getElementById('ai_buyPrice').value) || 0,
      sellPrice: parseFloat(document.getElementById('ai_sellPrice').value) || 0,
      netPct:    parseFloat(document.getElementById('ai_netPct').value)   || 0,
    };
    if (!opportunity.symbol) { alert('❌ أدخل رمز الزوج أولاً'); return; }
    el.style.display = 'block';
    el.style.color = '#888';
    el.textContent = '⏳ جارٍ التحليل...';
    setButtonsBusy(true);
    try {
      const res  = await callAdminApi('/api/ai-analysis', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ opportunity }),
      });
      const data = JSON.parse(res.text);
      el.style.color = '#eee';
      el.innerHTML = `<strong style="color:#3498db">🤖 ${data.provider === 'github-models' ? 'GitHub Models (GPT-4.1)' : 'Cloudflare Workers AI'}:</strong><br><br>${(data.analysis || data.error || JSON.stringify(data)).replace(/\n/g,'<br>')}`;
    } catch(e) {
      el.style.color = '#e74c3c';
      el.textContent = '❌ ' + e.message;
    } finally { setButtonsBusy(false); }
  }

  // ── Bot Memory & Self-Learning ───────────────────────────────────────────────
  async function runSelfEvaluate() {
    const el = document.getElementById('selfEvalResult');
    el.style.display = 'block'; el.style.color = '#888'; el.textContent = '⏳ جارٍ التقييم الذاتي...';
    setButtonsBusy(true);
    try {
      const res  = await callAdminApi('/api/strategies/self-evaluate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      const data = JSON.parse(res.text);
      el.style.color = '#2ecc71';
      const recs = (data.recommendations || []).join('\n• ') || 'لا توجد توصيات';
      el.textContent = `✅ اكتمل التقييم الذاتي\nالنتيجة: ${data.score ?? '—'} | الحالة: ${data.status || '—'}\n\nالتوصيات:\n• ${recs}`;
    } catch(e) { el.style.color = '#e74c3c'; el.textContent = '❌ ' + e.message; }
    finally { setButtonsBusy(false); }
  }

  async function loadBotMemory() {
    const panel = document.getElementById('botMemoryPanel');
    const stats = document.getElementById('botMemoryStats');
    const recs  = document.getElementById('botMemoryRecommendations');
    panel.style.display = 'block';
    stats.innerHTML = '<span style="color:#888">⏳ جارٍ تحميل الذاكرة...</span>';
    try {
      const res  = await callAdminApi('/api/memory');
      const data = JSON.parse(res.text);
      const m    = data.memory || {};
      const weights = m.strategyWeights || {};
      const wKeys = Object.keys(weights);
      if (!data.hasData) {
        stats.innerHTML = '<span style="color:#888">لا توجد بيانات ذاكرة بعد — شغّل تقييماً ذاتياً لبدء التعلم.</span>';
        recs.innerHTML = '';
        return;
      }
      stats.innerHTML = wKeys.map(k => `
        <div class="card">
          <div class="card-label">🎯 ${k}</div>
          <div style="font-size:1.3em;font-weight:bold;color:${(weights[k]||1) >= 1 ? '#2ecc71' : '#e74c3c'}">${(weights[k] ?? 1).toFixed(2)}</div>
          <div style="font-size:.75em;color:#888">وزن الاستراتيجية</div>
        </div>
      `).join('') || '<span style="color:#888">لا توجد أوزان محفوظة بعد</span>';
      const recList = (m.recommendations || []);
      recs.innerHTML = recList.length
        ? '<strong style="color:#f0b90b">📋 آخر التوصيات:</strong><br>' + recList.map(r => '• ' + r).join('<br>')
        : '<span style="color:#888">لا توجد توصيات محفوظة</span>';
    } catch(e) {
      stats.innerHTML = '<span style="color:#e74c3c">❌ ' + e.message + '</span>';
    }
  }

  async function resetBotMemory() {
    if (!confirm('⚠️ هل أنت متأكد من مسح كامل ذاكرة البوت والتعلم المتراكم؟')) return;
    setButtonsBusy(true);
    try {
      await callAdminApi('/api/memory/reset', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      document.getElementById('botMemoryPanel').style.display = 'none';
      document.getElementById('selfEvalResult').style.display = 'none';
      alert('✅ تم مسح الذاكرة');
    } catch(e) { alert('❌ ' + e.message); }
    finally { setButtonsBusy(false); }
  }

  // ── Temporal Workflow ────────────────────────────────────────────────────────
  async function temporalStart() {
    const el = document.getElementById('temporalResult');
    el.style.display = 'block'; el.style.color = '#888'; el.textContent = '⏳ جارٍ التشغيل...';
    setButtonsBusy(true);
    try {
      const res  = await callAdminApi('/api/temporal/start', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      const data = JSON.parse(res.text);
      el.style.color = '#2ecc71';
      el.textContent = `✅ تم تشغيل Temporal\nWorkflow ID: ${data.workflowId || '—'}`;
    } catch(e) { el.style.color='#e74c3c'; el.textContent='❌ '+e.message; }
    finally { setButtonsBusy(false); }
  }
  async function temporalStop(force) {
    const el = document.getElementById('temporalResult');
    if (force && !confirm('⚠️ إنهاء فوري للجلسة؟')) return;
    el.style.display = 'block'; el.style.color = '#888'; el.textContent = '⏳ جارٍ الإيقاف...';
    setButtonsBusy(true);
    try {
      const res  = await callAdminApi('/api/temporal/stop', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ force }) });
      const data = JSON.parse(res.text);
      el.style.color = '#f0b90b';
      el.textContent = `✅ ${force ? 'تم الإنهاء الفوري' : 'تم الإيقاف الناعم'}\n${JSON.stringify(data.result || '', null, 2)}`;
    } catch(e) { el.style.color='#e74c3c'; el.textContent='❌ '+e.message; }
    finally { setButtonsBusy(false); }
  }
  async function temporalStatus() {
    const el = document.getElementById('temporalResult');
    el.style.display = 'block'; el.style.color = '#888'; el.textContent = '⏳ جارٍ الجلب...';
    try {
      const res  = await callAdminApi('/api/temporal/status');
      const data = JSON.parse(res.text);
      const st   = data.status || {};
      el.style.color = '#eee';
      el.textContent =
        `📊 الحالة: ${st.trading_enabled ? '▶️ مفعّل' : '⏸️ متوقف'} | وضع: ${st.paper_trading !== false ? 'Paper' : 'Live'}\n` +
        `الدورة: ${st.cycle_count ?? '—'} | آخر مسح: ${st.last_scan_at ? new Date(st.last_scan_at).toLocaleString('ar') : '—'}\n` +
        `Workflow: ${data.description?.workflowId ?? '—'} [${data.description?.status?.name ?? '—'}]`;
    } catch(e) { el.style.color='#e74c3c'; el.textContent='❌ '+e.message; }
  }
  async function temporalMode(paper) {
    const el = document.getElementById('temporalResult');
    el.style.display = 'block'; el.style.color = '#888'; el.textContent = '⏳ جارٍ التغيير...';
    setButtonsBusy(true);
    try {
      const res  = await callAdminApi('/api/temporal/mode', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ paper }) });
      const data = JSON.parse(res.text);
      el.style.color = '#2ecc71';
      el.textContent = `✅ تم التبديل إلى ${data.mode === 'paper' ? 'Paper' : 'Live'}`;
    } catch(e) { el.style.color='#e74c3c'; el.textContent='❌ '+e.message; }
    finally { setButtonsBusy(false); }
  }

  // ── R2 Log Archives ──────────────────────────────────────────────────────────
  async function loadLogArchives() {
    const panel  = document.getElementById('logsContent');
    const tbody  = document.getElementById('logsTableBody');
    const moreEl = document.getElementById('logsMore');
    panel.style.display = 'block';
    tbody.innerHTML = '<tr><td colspan="4" style="color:#888;text-align:center">جارٍ التحميل…</td></tr>';
    try {
      const res  = await callAdminApi('/api/logs/archives');
      const data = JSON.parse(res.text);
      const objs = data.objects || [];
      if (!objs.length) { tbody.innerHTML = '<tr><td colspan="4" style="color:#888;text-align:center">لا يوجد أرشيف</td></tr>'; return; }
      tbody.innerHTML = objs.map(o => {
        const kb   = (o.size / 1024).toFixed(1);
        const date = _fmtDateTimeAr(o.uploaded);
        const rows = o.customMetadata?.rows ?? '—';
        const key  = o.key || '';
        return `<tr>
          <td style="font-size:.8em;word-break:break-all">${key}</td>
          <td>${kb}</td>
          <td style="font-size:.82em">${date}</td>
          <td>${rows}</td>
        </tr>`;
      }).join('');
      moreEl.textContent = data.truncated ? `عرض أول 50 ملف — يوجد المزيد` : `إجمالي: ${objs.length} ملف`;
    } catch(e) {
      tbody.innerHTML = `<tr><td colspan="4" style="color:#e74c3c">❌ ${e.message}</td></tr>`;
    }
  }
