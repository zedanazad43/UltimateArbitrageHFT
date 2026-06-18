// cmd/hft/main.go — HFT engine entry point.
//
// Start-up sequence:
//  1. Load config from environment variables.
//  2. Connect to PostgreSQL for trade logging.
//  3. Start WebSocket price feeds (Binance, MEXC, Bybit spot + perps).
//  4. Start arb-scan loop: evaluates all strategies every ScanInterval.
//  5. Execute the best opportunity when profitable and risk checks pass.
//  6. Expose Prometheus metrics on MetricsAddr.
//
// Graceful shutdown on SIGINT/SIGTERM: all goroutines receive context
// cancellation and the process exits once they finish.
package main

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/url"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promhttp"

	"github.com/zedanazad43/UltimateArbitrageHFT/hft/internal/config"
	"github.com/zedanazad43/UltimateArbitrageHFT/hft/internal/db"
	"github.com/zedanazad43/UltimateArbitrageHFT/hft/internal/executor"
	"github.com/zedanazad43/UltimateArbitrageHFT/hft/internal/feeds"
	"github.com/zedanazad43/UltimateArbitrageHFT/hft/internal/notify"
	"github.com/zedanazad43/UltimateArbitrageHFT/hft/internal/risk"
	"github.com/zedanazad43/UltimateArbitrageHFT/hft/internal/strategies/cex"
	"github.com/zedanazad43/UltimateArbitrageHFT/hft/internal/strategies/dex"
	"github.com/zedanazad43/UltimateArbitrageHFT/hft/internal/strategies/funding"
	"github.com/zedanazad43/UltimateArbitrageHFT/hft/internal/strategies/perps"
)

// ─── Symbols ──────────────────────────────────────────────────────────────────

var supportedSymbols = []string{
	// Top-cap majors
	"BTCUSDT", "ETHUSDT", "BNBUSDT", "SOLUSDT", "XRPUSDT",
	// Mid-cap with good liquidity
	"DOGEUSDT", "AVAXUSDT", "LINKUSDT", "UNIUSDT", "ADAUSDT",
	"DOTUSDT", "LTCUSDT", "TRXUSDT", "NEARUSDT", "MATICUSDT",
	// Trending layer-2 / ecosystem tokens
	"ARBUSDT", "OPUSDT", "APTUSDT", "SUIUSDT", "TONUSDT",
	// High-volume meme coins (larger inter-exchange spreads)
	"SHIBUSDT", "PEPEUSDT", "WIFUSDT", "FLOKIUSDT",
	// DeFi / infrastructure
	"INJUSDT", "TIAUSDT", "ATOMUSDT", "FILUSDT", "HBARUSDT",
}

// ─── Prometheus metrics ───────────────────────────────────────────────────────

var (
	tradesTotal = prometheus.NewCounterVec(prometheus.CounterOpts{
		Name: "hft_trades_total",
		Help: "Number of trades executed.",
	}, []string{"strategy", "mode"})

	profitPct = prometheus.NewHistogramVec(prometheus.HistogramOpts{
		Name:    "hft_trade_net_profit_pct",
		Help:    "Net profit percentage per trade.",
		Buckets: prometheus.DefBuckets,
	}, []string{"strategy"})

	scanLatency = prometheus.NewHistogram(prometheus.HistogramOpts{
		Name:    "hft_scan_latency_ms",
		Help:    "Time to complete one scan cycle (ms).",
		Buckets: []float64{1, 5, 10, 25, 50, 100, 250, 500, 1000},
	})
)

func init() {
	prometheus.MustRegister(tradesTotal, profitPct, scanLatency)
}

// ─── Circuit breaker (in-memory) ─────────────────────────────────────────────

type cbState struct {
	failures int
	lastFail time.Time
	open     bool
}

type circuitBreaker struct {
	states map[string]*cbState
}

func newCircuitBreaker() *circuitBreaker {
	return &circuitBreaker{states: make(map[string]*cbState)}
}

const (
	cbMaxFailures = 3
	cbResetWindow = 5 * time.Minute
)

func (cb *circuitBreaker) recordSuccess(exchange string) {
	if s := cb.states[exchange]; s != nil {
		s.failures = 0
		s.open = false
	}
}

func (cb *circuitBreaker) recordFailure(exchange string) {
	s := cb.states[exchange]
	if s == nil {
		s = &cbState{}
		cb.states[exchange] = s
	}
	if time.Since(s.lastFail) > cbResetWindow {
		s.failures = 0
		s.open = false
	}
	s.failures++
	s.lastFail = time.Now()
	if s.failures >= cbMaxFailures {
		s.open = true
		slog.Warn("circuit breaker OPEN", "exchange", exchange, "failures", s.failures)
	}
}

// ─── Engine ───────────────────────────────────────────────────────────────────

type engine struct {
	cfg      *config.Config
	book     *feeds.Book
	database *db.DB
	notifier *notify.Notifier
	cb       *circuitBreaker

	equity      float64 // tracks running P&L
	dailyPnL    float64
	dailyTrades int
	lastTrade   time.Time
}

func newEngine(cfg *config.Config, database *db.DB) *engine {
	return &engine{
		cfg:      cfg,
		book:     feeds.NewBook(),
		database: database,
		notifier: notify.New(cfg.TelegramBotToken, cfg.TelegramChatID),
		cb:       newCircuitBreaker(),
		equity:   cfg.InitialCapitalUSD,
	}
}

// scan evaluates all strategies across all symbols and returns the list of
// opportunities found, sorted by netPct descending.
func (e *engine) scan() []*cex.Opportunity {
	var oops []*cex.Opportunity

	for _, sym := range supportedSymbols {
		spotSources := e.book.SpotSources(sym)
		if len(spotSources) == 0 {
			continue
		}

		// CEX spatial arbitrage
		if o := cex.Scan(sym, spotSources, e.cfg.MaxSpreadPct); o != nil {
			oops = append(oops, o)
		}

		// Perps vs spot
		perpMEXC := e.book.BestPerp(sym, "mexc_perp")
		perpBybit := e.book.BestPerp(sym, "bybit_perp")
		perpSource := perpMEXC
		if perpSource == nil {
			perpSource = perpBybit
		}
		if o := perps.Scan(sym, spotSources, perpSource, e.cfg.MaxSpreadPct); o != nil {
			oops = append(oops, o)
		}

		// Funding-rate harvest (prefer Bybit — has fundingRate field)
		if o := funding.Scan(sym, spotSources, perpBybit, e.cfg.MaxSpreadPct); o != nil {
			oops = append(oops, o.Opportunity)
		}
	}

	// DEX cross-chain scan
	if dexOpp, err := dex.Scan(e.cfg.AlchemyAPIKey); err == nil && dexOpp != nil {
		oops = append(oops, dexOpp)
	}

	return oops
}

// best returns the opportunity with the highest netPct, or nil.
func best(oops []*cex.Opportunity) *cex.Opportunity {
	var b *cex.Opportunity
	for _, o := range oops {
		if b == nil || o.NetPct > b.NetPct {
			b = o
		}
	}
	return b
}

// copyHeader copies all headers from src to dst.
func copyHeader(dst, src http.Header) {
	for k, vv := range src {
		for _, v := range vv {
			dst.Add(k, v)
		}
	}
}

// execute performs (or paper-simulates) a trade for the given opportunity.
func (e *engine) execute(ctx context.Context, opp *cex.Opportunity) {
	// ── Guard rails ────────────────────────────────────────────────────────
	if opp.NetPct < e.cfg.MinNetProfitPct {
		return
	}
	if e.dailyPnL <= -e.cfg.MaxDailyLossUSD {
		slog.Warn("daily loss cap reached — skipping")
		return
	}
	if time.Since(e.lastTrade) < time.Duration(e.cfg.MinSecondsBetweenTx)*time.Second {
		return
	}

	// ── Position sizing ────────────────────────────────────────────────────
	leverage := 1.0
	if opp.IsPerp {
		leverage = risk.CalculateAdaptiveLeverage(e.equity, opp.NetPct, e.cfg.InitialCapitalUSD)
	}
	sizeUSD := risk.CalculatePositionSize(e.equity, e.cfg.WinRate, e.cfg.RiskRewardRatio)
	notionalUSD := sizeUSD * leverage

	mode := "paper"
	if !e.cfg.PaperTrading && e.cfg.TradingEnabled {
		mode = "live"
	}

	slog.Info("trade",
		"strategy", opp.Strategy,
		"symbol", opp.Symbol,
		"direction", opp.Direction,
		"netPct", fmt.Sprintf("%.4f%%", opp.NetPct),
		"sizeUSD", fmt.Sprintf("$%.2f", sizeUSD),
		"leverage", leverage,
		"mode", mode,
	)

	if mode == "live" {
		e.executeLive(ctx, opp, sizeUSD, notionalUSD)
	}

	// ── Simulate P&L ───────────────────────────────────────────────────────
	profitUSD := notionalUSD * (opp.NetPct / 100)
	e.equity += profitUSD
	e.dailyPnL += profitUSD
	e.dailyTrades++
	e.lastTrade = time.Now()

	// ── Record metrics ─────────────────────────────────────────────────────
	tradesTotal.With(prometheus.Labels{"strategy": opp.Strategy, "mode": mode}).Inc()
	profitPct.With(prometheus.Labels{"strategy": opp.Strategy}).Observe(opp.NetPct)

	// ── Log to DB ──────────────────────────────────────────────────────────
	if e.database != nil {
		_ = e.database.LogTrade(ctx, db.TradeRecord{
			Strategy:         opp.Strategy,
			Symbol:           opp.Symbol,
			BuyExchange:      opp.BuyExchange,
			SellExchange:     opp.SellExchange,
			Direction:        opp.Direction,
			SizeUSD:          sizeUSD,
			NetProfitPercent: opp.NetPct,
			Mode:             mode,
		})
	}

	// ── Telegram alert ────────────────────────────────────────────────────
	e.notifier.Sendf(
		"🎯 *%s* [%s] %s\nnet `%.4f%%`  size `$%.2f`  mode `%s`",
		strings.ToUpper(opp.Strategy), opp.Symbol, opp.Direction,
		opp.NetPct, sizeUSD, mode,
	)
}

// executeLive places real orders on the appropriate exchanges.
func (e *engine) executeLive(ctx context.Context, opp *cex.Opportunity, sizeUSD, notionalUSD float64) {
	qty := sizeUSD / opp.BuyPrice // base asset quantity

	switch strings.ToLower(opp.BuyExchange) {
	case "mexc":
		if _, err := executor.PlaceMEXCSpotOrder(
			e.cfg.MEXCAPIKey, e.cfg.MEXCAPISecret,
			opp.Symbol, "BUY", qty,
		); err != nil {
			slog.Error("mexc buy order failed", "err", err)
			e.cb.recordFailure("mexc")
			return
		}
		e.cb.recordSuccess("mexc")
	case "binance":
		if _, err := executor.PlaceBinanceSpotOrder(
			e.cfg.BinanceAPIKey, e.cfg.BinanceAPISecret,
			opp.Symbol, "BUY", qty, sizeUSD,
		); err != nil {
			slog.Error("binance buy order failed", "err", err)
			e.cb.recordFailure("binance")
			return
		}
		e.cb.recordSuccess("binance")
	case "bybit":
		if _, err := executor.PlaceBybitSpotOrder(
			e.cfg.BybitAPIKey, e.cfg.BybitAPISecret,
			opp.Symbol, "BUY", qty,
		); err != nil {
			slog.Error("bybit buy order failed", "err", err)
			e.cb.recordFailure("bybit")
			return
		}
		e.cb.recordSuccess("bybit")
	}

	sellQty := notionalUSD / opp.SellPrice
	switch strings.ToLower(opp.SellExchange) {
	case "mexc":
		if _, err := executor.PlaceMEXCSpotOrder(
			e.cfg.MEXCAPIKey, e.cfg.MEXCAPISecret,
			opp.Symbol, "SELL", sellQty,
		); err != nil {
			slog.Error("mexc sell order failed", "err", err)
		}
	case "binance":
		if _, err := executor.PlaceBinanceSpotOrder(
			e.cfg.BinanceAPIKey, e.cfg.BinanceAPISecret,
			opp.Symbol, "SELL", sellQty, notionalUSD,
		); err != nil {
			slog.Error("binance sell order failed", "err", err)
		}
	case "bybit":
		if _, err := executor.PlaceBybitSpotOrder(
			e.cfg.BybitAPIKey, e.cfg.BybitAPISecret,
			opp.Symbol, "SELL", sellQty,
		); err != nil {
			slog.Error("bybit sell order failed", "err", err)
		}
	}
}

// run starts the scan loop.
func (e *engine) run(ctx context.Context) {
	// Warm up: wait a couple of seconds for WS feeds to populate the book.
	slog.Info("engine: warming up price book…")
	time.Sleep(2 * time.Second)

	ticker := time.NewTicker(e.cfg.ScanInterval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			slog.Info("engine: shutting down")
			return
		case <-ticker.C:
		}

		start := time.Now()
		oops := e.scan()
		elapsed := float64(time.Since(start).Milliseconds())
		scanLatency.Observe(elapsed)

		if b := best(oops); b != nil {
			e.execute(ctx, b)
		}
	}
}

// ─── API server ───────────────────────────────────────────────────────────────
//
// The HTTP API allows the Cloudflare Worker (and other clients) to:
//   GET  /api/health  — liveness / readiness check (no auth required)
//   GET  /api/scan    — returns the best current opportunity from the price book
//   POST /api/execute — executes a trade (paper or live, per engine config)
//
// All /api/scan and /api/execute requests must include:
//   Authorization: Bearer <HFT_ENGINE_SECRET>
// (when HFT_ENGINE_SECRET is set; leave blank to disable auth in dev).

type apiOpportunity struct {
	Strategy     string  `json:"Strategy"`
	Symbol       string  `json:"Symbol"`
	BuyExchange  string  `json:"BuyExchange"`
	SellExchange string  `json:"SellExchange"`
	BuyPrice     float64 `json:"BuyPrice"`
	SellPrice    float64 `json:"SellPrice"`
	GrossPct     float64 `json:"GrossPct"`
	NetPct       float64 `json:"NetPct"`
	SafetyFactor float64 `json:"SafetyFactor"`
	Direction    string  `json:"Direction"`
	IsPerp       bool    `json:"IsPerp"`
}

type executeRequest struct {
	Opportunity *apiOpportunity `json:"opportunity"`
	SizeUSD     float64         `json:"size_usd"`
}

// newAPIServer builds the HTTP mux for the engine REST API.
func newAPIServer(eng *engine, secret string) *http.Server {
	mux := http.NewServeMux()

	// ── Auth middleware ───────────────────────────────────────────────────────
	requireAuth := func(next http.HandlerFunc) http.HandlerFunc {
		return func(w http.ResponseWriter, r *http.Request) {
			if secret != "" {
				got := r.Header.Get("Authorization")
				if got != "Bearer "+secret {
					w.Header().Set("Content-Type", "application/json")
					w.WriteHeader(http.StatusUnauthorized)
					_, _ = fmt.Fprintln(w, `{"error":"Unauthorized"}`)
					return
				}
			}
			next(w, r)
		}
	}

	writeJSON := func(w http.ResponseWriter, code int, v any) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(code)
		if err := json.NewEncoder(w).Encode(v); err != nil {
			slog.Error("api: json encode error", "err", err)
		}
	}

	// ── GET /api/health ───────────────────────────────────────────────────────
	mux.HandleFunc("/api/health", func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, http.StatusOK, map[string]any{
			"status":       "ok",
			"paper":        eng.cfg.PaperTrading,
			"trading":      eng.cfg.TradingEnabled,
			"equity_usd":   eng.equity,
			"daily_pnl":    eng.dailyPnL,
			"daily_trades": eng.dailyTrades,
			"timestamp_ms": time.Now().UnixMilli(),
		})
	})

	// ── GET /api/scan ─────────────────────────────────────────────────────────
	mux.HandleFunc("/api/scan", requireAuth(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "method not allowed"})
			return
		}
		oops := eng.scan()
		b := best(oops)
		if b == nil {
			writeJSON(w, http.StatusOK, map[string]any{"opportunity": nil})
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{
			"opportunity": apiOpportunity{
				Strategy:     b.Strategy,
				Symbol:       b.Symbol,
				BuyExchange:  b.BuyExchange,
				SellExchange: b.SellExchange,
				BuyPrice:     b.BuyPrice,
				SellPrice:    b.SellPrice,
				GrossPct:     b.GrossPct,
				NetPct:       b.NetPct,
				SafetyFactor: b.SafetyFactor,
				Direction:    b.Direction,
				IsPerp:       b.IsPerp,
			},
		})
	}))

	// ── POST /api/execute ─────────────────────────────────────────────────────
	mux.HandleFunc("/api/execute", requireAuth(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "method not allowed"})
			return
		}
		var req executeRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.Opportunity == nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid request body"})
			return
		}
		o := req.Opportunity
		opp := &cex.Opportunity{
			Strategy:     o.Strategy,
			Symbol:       o.Symbol,
			BuyExchange:  o.BuyExchange,
			SellExchange: o.SellExchange,
			BuyPrice:     o.BuyPrice,
			SellPrice:    o.SellPrice,
			GrossPct:     o.GrossPct,
			NetPct:       o.NetPct,
			SafetyFactor: o.SafetyFactor,
			Direction:    o.Direction,
			IsPerp:       o.IsPerp,
		}
		eng.execute(r.Context(), opp)
		writeJSON(w, http.StatusOK, map[string]bool{"success": true})
	}))

	// ── GET/POST /proxy?target=<url> ─────────────────────────────────────────
	// Forwards requests through Railway's egress IP (not blocked by exchanges).
	mux.HandleFunc("/proxy", func(w http.ResponseWriter, r *http.Request) {
		target := r.URL.Query().Get("target")
		if target == "" {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "missing ?target="})
			return
		}
		targetURL, err := url.Parse(target)
		if err != nil || (targetURL.Scheme != "http" && targetURL.Scheme != "https") {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid target URL"})
			return
		}
		allowed := map[string]bool{
			"api.binance.com": true, "api1.binance.com": true, "api2.binance.com": true, "api3.binance.com": true,
			"api.bitget.com": true, "capi.bitget.com": true, "api.kucoin.com": true,
			"api.mexc.com": true, "contract.mexc.com": true, "api.bybit.com": true,
			"api.htx.com": true, "api-cloud.bitmart.com": true,
		}
		if !allowed[targetURL.Host] {
			writeJSON(w, http.StatusForbidden, map[string]string{"error": "host not allowed: " + targetURL.Host})
			return
		}
		proxyReq, err := http.NewRequestWithContext(r.Context(), r.Method, target, r.Body)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}
		copyHeader(proxyReq.Header, r.Header)
		proxyReq.Header.Set("User-Agent", "UltimateArbitrageHFT-Proxy/1.0")
		proxyReq.Header.Del("Host")
		proxyReq.Header.Del("Cf-Connecting-Ip")
		proxyReq.Header.Del("Cf-Ipcountry")
		proxyReq.Header.Del("Cf-Ray")
		proxyReq.Header.Del("X-Forwarded-For")
		proxyReq.Header.Del("X-Real-Ip")
		resp, err := http.DefaultClient.Do(proxyReq)
		if err != nil {
			writeJSON(w, http.StatusBadGateway, map[string]string{"error": err.Error()})
			return
		}
		defer resp.Body.Close()
		copyHeader(w.Header(), resp.Header)
		w.Header().Set("X-Proxy-By", "railway-hft")
		w.WriteHeader(resp.StatusCode)
		io.Copy(w, resp.Body)
	})

	return &http.Server{
		Addr:         eng.cfg.APIAddr,
		Handler:      mux,
		ReadTimeout:  10 * time.Second,
		WriteTimeout: 30 * time.Second,
	}
}

// ─── main ─────────────────────────────────────────────────────────────────────

func main() {
	slog.SetDefault(slog.New(slog.NewTextHandler(os.Stdout, &slog.HandlerOptions{
		Level: slog.LevelInfo,
	})))

	cfg, err := config.Load()
	if err != nil {
		slog.Error("config error", "err", err)
		os.Exit(1)
	}

	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer cancel()

	// ── Database ──────────────────────────────────────────────────────────
	var database *db.DB
	if cfg.PostgresDSN != "" {
		database, err = db.Open(ctx, cfg.PostgresDSN)
		if err != nil {
			slog.Warn("db: could not connect, trade logging disabled", "err", err)
		} else {
			defer database.Close()
			slog.Info("db: connected")
		}
	}

	eng := newEngine(cfg, database)

	// ── WebSocket price feeds ─────────────────────────────────────────────
	slog.Info("feeds: starting WebSocket connections…")
	go feeds.RunBinance(ctx, eng.book, supportedSymbols)
	go feeds.RunMEXC(ctx, eng.book, supportedSymbols)
	go feeds.RunBybit(ctx, eng.book, supportedSymbols)
	go feeds.RunBybitPerps(ctx, eng.book, supportedSymbols)
	go feeds.RunMEXCPerpsREST(ctx, eng.book, supportedSymbols, 3*time.Second)

	// ── Prometheus metrics server ─────────────────────────────────────────
	go func() {
		mux := http.NewServeMux()
		mux.Handle("/metrics", promhttp.Handler())
		mux.HandleFunc("/healthz", func(w http.ResponseWriter, _ *http.Request) {
			w.WriteHeader(http.StatusOK)
			_, _ = fmt.Fprintln(w, "ok")
		})
		srv := &http.Server{Addr: cfg.MetricsAddr, Handler: mux}
		slog.Info("metrics server", "addr", cfg.MetricsAddr)
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			slog.Error("metrics server error", "err", err)
		}
	}()

	// ── Engine API server (used by the CF Worker for scan + execute) ──────
	go func() {
		apiSrv := newAPIServer(eng, cfg.EngineSecret)
		slog.Info("engine API server", "addr", cfg.APIAddr, "auth", cfg.EngineSecret != "")
		if err := apiSrv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			slog.Error("engine API server error", "err", err)
		}
	}()

	// Start-up notification
	eng.notifier.Sendf("🚀 HFT engine started — paper=%v trading=%v equity=$%.2f",
		cfg.PaperTrading, cfg.TradingEnabled, eng.equity)

	slog.Info("engine: starting scan loop",
		"interval", cfg.ScanInterval,
		"paper", cfg.PaperTrading,
		"trading", cfg.TradingEnabled,
		"equity", fmt.Sprintf("$%.2f", eng.equity),
	)

	eng.run(ctx)

	eng.notifier.Sendf("🛑 HFT engine stopped — equity=$%.2f dailyPnL=$%.2f trades=%d",
		eng.equity, eng.dailyPnL, eng.dailyTrades)
	slog.Info("engine: stopped",
		"equity", fmt.Sprintf("$%.2f", eng.equity),
		"dailyPnL", fmt.Sprintf("$%.2f", eng.dailyPnL),
		"trades", eng.dailyTrades,
	)
}
