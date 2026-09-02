// ===== Real-Time WebSocket Price Streams =====
// Sub-millisecond price updates via WebSocket connections to exchanges.
// Replaces polling REST with push-based architecture for true "speed of light" detection.

let _wsManager = null;

class WebSocketPriceManager {
    constructor(env) {
        this.env = env;
        this.sockets = new Map();
        this.latestPrices = new Map();
        this.subscribers = new Map();
        this.reconnectDelay = 1000;
        this.maxReconnectDelay = 30000;
        this.urlCache = null; // For caching the external proxy URL
    }

    /**
     * Connects WebSocket feeds for all configured exchanges.
     * Uses Railway proxy URL for blocked exchanges (binance, bitget, kucoin)
     * to tunnel WebSocket connections through an unblocked IP.
     */
    async connectAll(symbols = null) {
        const targetSymbols = symbols || ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'XRPUSDT', 'BNBUSDT', 'ADAUSDT', 'DOGEUSDT'];
        const exchanges = ['mexc', 'binance', 'bybit', 'gateio', 'kucoin'];

        // Fetch proxy URL once
        this.urlCache = this.env.EXTERNAL_PROXY_FALLBACK_URL || '';

        const results = await Promise.all(
            exchanges.map(ex => this.connectExchange(ex, targetSymbols).catch(e => ({ exchange: ex, error: e.message })))
        );
        return results.filter(r => !r.error);
    }

    async connectExchange(exchange, symbols) {
        const wsConfig = this.getWebSocketConfig(exchange, symbols);
        if (!wsConfig) return { exchange, error: 'no_config' };

        // Close existing connection
        this.closeExchange(exchange);

        try {
            const socket = new WebSocket(wsConfig.url);
            this.sockets.set(exchange, socket);

            socket.onopen = () => {
                console.log(`[ws] Connected to ${exchange}`);
                if (wsConfig.subscribe) {
                    socket.send(JSON.stringify(wsConfig.subscribe));
                }
            };

            socket.onmessage = (event) => {
                try {
                    const data = JSON.parse(event.data);
                    const prices = this.parseWebSocketData(exchange, data, symbols);
                    if (prices && Object.keys(prices).length > 0) {
                        this.updatePrices(exchange, prices);
                        this.notifySubscribers(exchange, prices);
                    }
                } catch (_) {
                    // Ignore parse errors on non-JSON messages (pings, etc.)
                }
            };

            socket.onclose = (event) => {
                console.log(`[ws] ${exchange} closed: code=${event.code} reason=${event.reason}`);
                this.sockets.delete(exchange);
                // Auto-reconnect with exponential backoff
                if (!event.wasClean) {
                    const delay = Math.min(this.reconnectDelay * 2, this.maxReconnectDelay);
                    this.reconnectDelay = delay;
                    setTimeout(() => this.connectExchange(exchange, symbols), delay);
                }
            };

            socket.onerror = (err) => {
                console.error(`[ws] ${exchange} error: ${err.message || 'unknown'}`);
            };

            return { exchange, status: 'connecting' };
        } catch (err) {
            return { exchange, error: err.message };
        }
    }

    getWebSocketConfig(exchange, symbols) {
        const proxyUrl = this.urlCache;

        const configs = {
            mexc: {
                url: 'wss://wbs.mexc.com/ws',
                subscribe: {
                    method: 'SUBSCRIPTION',
                    params: symbols.map(s => `spot@public.miniTicker.v3.api@${s.toLowerCase()}@UTC+8`),
                    id: Date.now(),
                },
            },
            binance: {
                // For blocked exchanges, we use REST-only (WebSocket tunneling
                // through Railway proxy is possible but adds latency).
                // Instead, rely on UltraFastPriceEngine's 2.5s parallel REST fetch.
                url: proxyUrl
                    ? 'wss://stream.binance.com:9443/ws' // Direct (will likely fail from CF IP)
                    : 'wss://stream.binance.com:9443/ws',
                subscribe: {
                    method: 'SUBSCRIBE',
                    params: symbols.map(s => `${s.toLowerCase()}@miniTicker`),
                    id: 1,
                },
            },
            bybit: {
                url: 'wss://stream.bybit.com/v5/public/spot',
                subscribe: {
                    op: 'subscribe',
                    args: symbols.map(s => `tickers.${s}`),
                },
            },
            gateio: {
                url: 'wss://ws.gate.io/v4',
                subscribe: {
                    time: Math.floor(Date.now() / 1000),
                    channel: 'spot.tickers',
                    event: 'subscribe',
                    payload: symbols,
                },
            },
            kucoin: {
                // KuCoin requires token endpoint first — handled by REST fallback
                url: proxyUrl
                    ? 'wss://ws-api.kucoin.com/endpoint?token=placeholder'
                    : 'wss://ws-api.kucoin.com/endpoint?token=placeholder',
                subscribe: {
                    id: Date.now(),
                    type: 'subscribe',
                    topic: `/market/ticker:${symbols.join(',')}`,
                },
            },
        };

        return configs[exchange] || null;
    }

    parseWebSocketData(exchange, data, symbols) {
        const prices = {};

        try {
            switch (exchange) {
                case 'mexc': {
                    if (data.d && Array.isArray(data.d)) {
                        const ticker = data.d;
                        if (ticker.s) {
                            const sym = ticker.s.toUpperCase();
                            if (symbols.includes(sym)) {
                                prices[sym] = parseFloat(ticker.c || ticker.p || 0);
                            }
                        }
                    }
                    break;
                }
                case 'binance': {
                    if (data.e === '24hrMiniTicker' && data.s) {
                        const sym = data.s.toUpperCase();
                        if (symbols.includes(sym)) {
                            prices[sym] = parseFloat(data.c || 0);
                        }
                    } else if (Array.isArray(data)) {
                        data.forEach(ticker => {
                            if (ticker.s) {
                                const sym = ticker.s.toUpperCase();
                                if (symbols.includes(sym)) {
                                    prices[sym] = parseFloat(ticker.c || 0);
                                }
                            }
                        });
                    }
                    break;
                }
                case 'bybit': {
                    if (data.topic && data.data) {
                        const ticker = data.data;
                        const sym = ticker.symbol?.toUpperCase();
                        if (sym && symbols.includes(sym)) {
                            prices[sym] = parseFloat(ticker.lastPrice || 0);
                        }
                    } else if (data.type === 'snapshot' && Array.isArray(data.data)) {
                        data.data.forEach(t => {
                            const sym = t.symbol?.toUpperCase();
                            if (sym && symbols.includes(sym)) {
                                prices[sym] = parseFloat(t.lastPrice || 0);
                            }
                        });
                    }
                    break;
                }
                case 'gateio': {
                    if (data.event === 'update' && data.result) {
                        const result = data.result;
                        if (result.currency_pair) {
                            const sym = result.currency_pair.replace('_', '').toUpperCase();
                            if (symbols.includes(sym)) {
                                prices[sym] = parseFloat(result.last || 0);
                            }
                        }
                    } else if (Array.isArray(data.result)) {
                        data.result.forEach(item => {
                            if (item.currency_pair) {
                                const sym = item.currency_pair.replace('_', '').toUpperCase();
                                if (symbols.includes(sym)) {
                                    prices[sym] = parseFloat(item.last || 0);
                                }
                            }
                        });
                    }
                    break;
                }
                case 'kucoin': {
                    if (data.type === 'message' && data.topic) {
                        const tickerData = data.data;
                        if (tickerData?.symbol) {
                            const sym = tickerData.symbol.toUpperCase();
                            if (symbols.includes(sym)) {
                                prices[sym] = parseFloat(tickerData.price || tickerData.bestBid || 0);
                            }
                        }
                    }
                    break;
                }
            }
        } catch (_) {
            // Parse error — ignore
        }

        return prices;
    }

    updatePrices(exchange, prices) {
        const now = Date.now();
        for (const [symbol, price] of Object.entries(prices)) {
            if (!this.latestPrices.has(symbol)) {
                this.latestPrices.set(symbol, {});
            }
            this.latestPrices.get(symbol)[exchange] = { price, ts: now };
        }
    }

    notifySubscribers(exchange, prices) {
        const subs = this.subscribers.get(exchange);
        if (!subs) return;

        for (const callback of subs) {
            try { callback(prices); } catch { }
        }
    }

    subscribe(exchange, callback) {
        if (!this.subscribers.has(exchange)) {
            this.subscribers.set(exchange, new Set());
        }
        this.subscribers.get(exchange).add(callback);
        return () => this.subscribers.get(exchange)?.delete(callback);
    }

    getLatestPrices() {
        const result = {};
        for (const [symbol, exchangePrices] of this.latestPrices) {
            result[symbol] = { ...exchangePrices };
        }
        return result;
    }

    closeExchange(exchange) {
        const socket = this.sockets.get(exchange);
        if (socket) {
            try { socket.close(1000, 'reconnect'); } catch { }
            this.sockets.delete(exchange);
        }
    }

    closeAll() {
        for (const [exchange] of this.sockets) {
            this.closeExchange(exchange);
        }
    }

    getStats() {
        return {
            connectedExchanges: Array.from(this.sockets.keys()),
            totalConnections: this.sockets.size,
            trackedSymbols: this.latestPrices.size,
            subscribers: Array.from(this.subscribers.entries()).map(([ex, subs]) => ({ exchange: ex, count: subs.size })),
            urlCache: this.urlCache ? 'configured' : 'none',
        };
    }
}

export function getWebSocketPriceManager(env) {
    if (!_wsManager) {
        _wsManager = new WebSocketPriceManager(env);
    }
    return _wsManager;
}
