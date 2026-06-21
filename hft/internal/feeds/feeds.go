// Package feeds maintains a live, in-memory price book sourced from WebSocket
// streams on Binance, MEXC, and Bybit.  Each feed runs in its own goroutine
// and automatically reconnects on disconnect.
//
// Price consumers call book.Best(symbol) to get the current best bid/ask
// across all connected exchanges.
package feeds

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

// PriceSource represents a single exchange's last-known price for a symbol.
type PriceSource struct {
	Price    float64
	Exchange string
	Fee      float64 // taker fee fraction (e.g. 0.001 = 0.1%)
}

// PerpData is a PriceSource augmented with perpetuals-specific fields.
type PerpData struct {
	PriceSource
	FundingRate float64 // per 8-hour period; positive = longs pay shorts
}

// Book is a thread-safe in-memory price book.
type Book struct {
	mu    sync.RWMutex
	spot  map[string]map[string]PriceSource // symbol → exchange → price
	perps map[string]map[string]PerpData    // symbol → exchange → perp data
}

// NewBook creates an empty Book.
func NewBook() *Book {
	return &Book{
		spot:  make(map[string]map[string]PriceSource),
		perps: make(map[string]map[string]PerpData),
	}
}

// SetSpot records a spot price for the given exchange and symbol.
func (b *Book) SetSpot(symbol, exchange string, price, fee float64) {
	b.mu.Lock()
	defer b.mu.Unlock()
	if b.spot[symbol] == nil {
		b.spot[symbol] = make(map[string]PriceSource)
	}
	b.spot[symbol][exchange] = PriceSource{Price: price, Exchange: exchange, Fee: fee}
}

// SetPerp records a perpetuals price + funding rate.
func (b *Book) SetPerp(symbol, exchange string, price, fee, fundingRate float64) {
	b.mu.Lock()
	defer b.mu.Unlock()
	if b.perps[symbol] == nil {
		b.perps[symbol] = make(map[string]PerpData)
	}
	b.perps[symbol][exchange] = PerpData{
		PriceSource: PriceSource{Price: price, Exchange: exchange, Fee: fee},
		FundingRate: fundingRate,
	}
}

// SpotSources returns all spot price sources for the given symbol.
func (b *Book) SpotSources(symbol string) []PriceSource {
	b.mu.RLock()
	defer b.mu.RUnlock()
	m := b.spot[symbol]
	out := make([]PriceSource, 0, len(m))
	for _, s := range m {
		out = append(out, s)
	}
	return out
}

// BestPerp returns the perp data for the given exchange/symbol, or nil.
func (b *Book) BestPerp(symbol, exchange string) *PerpData {
	b.mu.RLock()
	defer b.mu.RUnlock()
	m := b.perps[symbol]
	if m == nil {
		return nil
	}
	p, ok := m[exchange]
	if !ok {
		return nil
	}
	return &p
}

// ─── Feed runners ─────────────────────────────────────────────────────────────

const (
	wsReadTimeout  = 60 * time.Second
	wsReconnectMin = 1 * time.Second
	wsReconnectMax = 30 * time.Second
	wsPingInterval = 10 * time.Second
)

// safeConn wraps *websocket.Conn with a write mutex. gorilla/websocket writes
// are not safe for concurrent use; the ping goroutine and the handler's
// subscribe writes would otherwise race.
type safeConn struct {
	*websocket.Conn
	writeMu sync.Mutex
}

func (s *safeConn) writeJSON(v any) error {
	s.writeMu.Lock()
	defer s.writeMu.Unlock()
	return s.WriteJSON(v)
}

func (s *safeConn) writeMessage(t int, data []byte) error {
	s.writeMu.Lock()
	defer s.writeMu.Unlock()
	if err := s.SetWriteDeadline(time.Now().Add(5 * time.Second)); err != nil {
		return err
	}
	return s.WriteMessage(t, data)
}

// RunBinance connects to the Binance combined stream for all symbols and keeps
// the price book updated.  It reconnects automatically on any error.
func RunBinance(ctx context.Context, book *Book, symbols []string) {
	streams := make([]string, 0, len(symbols)*2)
	for _, sym := range symbols {
		lower := strings.ToLower(sym)
		streams = append(streams, lower+"@bookTicker")
	}
	url := "wss://stream.binance.com/stream?streams=" + strings.Join(streams, "/")
	reconnect(ctx, feedSpec{
		name: "binance",
		url:  url,
		handler: func(conn *websocket.Conn, _ *safeConn) error {
			return readBinanceFeed(conn, book)
		},
	})
}

type binanceStreamMsg struct {
	Stream string `json:"stream"`
	Data   struct {
		Symbol  string `json:"s"`
		BestBid string `json:"b"`
		BestAsk string `json:"a"`
	} `json:"data"`
}

func readBinanceFeed(conn *websocket.Conn, book *Book) error {
	for {
		if err := conn.SetReadDeadline(time.Now().Add(wsReadTimeout)); err != nil {
			return err
		}
		_, msg, err := conn.ReadMessage()
		if err != nil {
			return err
		}
		var m binanceStreamMsg
		if err := json.Unmarshal(msg, &m); err != nil {
			continue
		}
		bid, err1 := strconv.ParseFloat(m.Data.BestBid, 64)
		ask, err2 := strconv.ParseFloat(m.Data.BestAsk, 64)
		if err1 != nil || err2 != nil || bid <= 0 || ask <= 0 {
			continue
		}
		mid := (bid + ask) / 2
		book.SetSpot(m.Data.Symbol, "binance", mid, 0.001)
	}
}

// RunMEXC connects to the MEXC WebSocket spot stream.
func RunMEXC(ctx context.Context, book *Book, symbols []string) {
	const url = "wss://wbs.mexc.com/ws"
	reconnect(ctx, feedSpec{
		name: "mexc",
		url:  url,
		subscribe: func(sc *safeConn) error {
			if len(symbols) == 0 {
				return nil
			}
			// Per-symbol bookTicker pushes on every top-of-book change,
			// keeping the socket active even on quiet markets.
			params := make([]string, 0, len(symbols))
			for _, sym := range symbols {
				params = append(params, "spot@public.bookTicker.v3.api@"+strings.ToUpper(sym))
			}
			return sc.writeJSON(map[string]any{
				"method": "SUBSCRIPTION",
				"params": params,
			})
		},
		handler: func(conn *websocket.Conn, _ *safeConn) error {
			return readMEXCFeed(conn, book)
		},
		pingPayload: []byte(`{"method":"PING"}`),
		pingEvery:   20 * time.Second,
	})
}

type mexcBookTicker struct {
	BidPrice string `json:"b"`
	AskPrice string `json:"a"`
}

type mexcMsg struct {
	Channel string         `json:"c"`
	Symbol  string         `json:"s"`
	Data    mexcBookTicker `json:"d"`
}

func readMEXCFeed(conn *websocket.Conn, book *Book) error {
	for {
		if err := conn.SetReadDeadline(time.Now().Add(wsReadTimeout)); err != nil {
			return err
		}
		_, msg, err := conn.ReadMessage()
		if err != nil {
			return err
		}
		var m mexcMsg
		if err := json.Unmarshal(msg, &m); err != nil {
			continue
		}
		if !strings.Contains(m.Channel, "bookTicker") || m.Symbol == "" {
			continue
		}
		bid, err1 := strconv.ParseFloat(m.Data.BidPrice, 64)
		ask, err2 := strconv.ParseFloat(m.Data.AskPrice, 64)
		if err1 != nil || err2 != nil || bid <= 0 || ask <= 0 {
			continue
		}
		book.SetSpot(m.Symbol, "mexc", (bid+ask)/2, 0.0005)
	}
}

// RunBybit connects to the Bybit V5 public spot stream.
func RunBybit(ctx context.Context, book *Book, symbols []string) {
	const url = "wss://stream.bybit.com/v5/public/spot"
	reconnect(ctx, feedSpec{
		name: "bybit",
		url:  url,
		subscribe: func(sc *safeConn) error {
			args := make([]string, 0, len(symbols))
			for _, sym := range symbols {
				args = append(args, "tickers."+sym)
			}
			return sc.writeJSON(map[string]any{"op": "subscribe", "args": args})
		},
		handler: func(conn *websocket.Conn, _ *safeConn) error {
			return readBybitFeed(conn, book)
		},
		pingPayload: []byte(`{"op":"ping"}`),
		pingEvery:   20 * time.Second,
	})
}

type bybitTickerData struct {
	Symbol    string `json:"symbol"`
	LastPrice string `json:"lastPrice"`
}

type bybitMsg struct {
	Topic string          `json:"topic"`
	Data  bybitTickerData `json:"data"`
}

func readBybitFeed(conn *websocket.Conn, book *Book) error {
	for {
		if err := conn.SetReadDeadline(time.Now().Add(wsReadTimeout)); err != nil {
			return err
		}
		_, msg, err := conn.ReadMessage()
		if err != nil {
			return err
		}
		var m bybitMsg
		if err := json.Unmarshal(msg, &m); err != nil {
			continue
		}
		if !strings.HasPrefix(m.Topic, "tickers.") {
			continue
		}
		price, err := strconv.ParseFloat(m.Data.LastPrice, 64)
		if err != nil || price <= 0 {
			continue
		}
		book.SetSpot(m.Data.Symbol, "bybit", price, 0.001)
	}
}

// RunBybitPerps connects to Bybit's linear (perpetuals) stream and keeps perp
// data (price + funding rate) updated in the book.
func RunBybitPerps(ctx context.Context, book *Book, symbols []string) {
	const url = "wss://stream.bybit.com/v5/public/linear"
	reconnect(ctx, feedSpec{
		name: "bybit_perp",
		url:  url,
		subscribe: func(sc *safeConn) error {
			args := make([]string, 0, len(symbols))
			for _, sym := range symbols {
				args = append(args, "tickers."+sym)
			}
			return sc.writeJSON(map[string]any{"op": "subscribe", "args": args})
		},
		handler: func(conn *websocket.Conn, _ *safeConn) error {
			return readBybitPerpsFeed(conn, book)
		},
		pingPayload: []byte(`{"op":"ping"}`),
		pingEvery:   20 * time.Second,
	})
}

type bybitPerpTickerData struct {
	Symbol      string `json:"symbol"`
	LastPrice   string `json:"lastPrice"`
	FundingRate string `json:"fundingRate"`
}

type bybitPerpMsg struct {
	Topic string              `json:"topic"`
	Data  bybitPerpTickerData `json:"data"`
}

func readBybitPerpsFeed(conn *websocket.Conn, book *Book) error {
	for {
		if err := conn.SetReadDeadline(time.Now().Add(wsReadTimeout)); err != nil {
			return err
		}
		_, msg, err := conn.ReadMessage()
		if err != nil {
			return err
		}
		var m bybitPerpMsg
		if err := json.Unmarshal(msg, &m); err != nil {
			continue
		}
		if !strings.HasPrefix(m.Topic, "tickers.") {
			continue
		}
		price, err1 := strconv.ParseFloat(m.Data.LastPrice, 64)
		fundingRate, err2 := strconv.ParseFloat(m.Data.FundingRate, 64)
		if err1 != nil || price <= 0 {
			continue
		}
		if err2 != nil {
			fundingRate = 0
		}
		book.SetPerp(m.Data.Symbol, "bybit_perp", price, 0.0006, fundingRate)
	}
}

// RunMEXCPerpsREST polls MEXC's perpetuals REST endpoint for symbols that
// are not yet available on a WebSocket stream.
func RunMEXCPerpsREST(ctx context.Context, book *Book, symbols []string, interval time.Duration) {
	for {
		select {
		case <-ctx.Done():
			return
		case <-time.After(interval):
		}
		for _, sym := range symbols {
			go func(symbol string) {
				perpSymbol := strings.Replace(symbol, "USDT", "_USDT", 1)
				url := "https://contract.mexc.com/api/v1/contract/ticker?symbol=" + perpSymbol
				resp, err := http.Get(url)
				if err != nil || resp.StatusCode != 200 {
					if resp != nil {
						_ = resp.Body.Close()
					}
					return
				}
				defer func() { _ = resp.Body.Close() }()
				body, _ := io.ReadAll(resp.Body)
				var result struct {
					Success bool `json:"success"`
					Data    struct {
						LastPrice string `json:"lastPrice"`
					} `json:"data"`
				}
				if err := json.Unmarshal(body, &result); err != nil || !result.Success {
					return
				}
				price, err := strconv.ParseFloat(result.Data.LastPrice, 64)
				if err != nil || price <= 0 {
					return
				}
				book.SetPerp(symbol, "mexc_perp", price, 0.0002, 0)
			}(sym)
		}
	}
}

// ─── WebSocket reconnect helper ───────────────────────────────────────────────

// feedSpec configures one ws feed for reconnect.
type feedSpec struct {
	name        string
	url         string
	subscribe   func(c *safeConn) error                     // optional: send subscribe frame
	handler     func(c *websocket.Conn, sc *safeConn) error // read loop
	pingPayload []byte                                      // if non-nil, sent as app-level TextMessage; else protocol ping
	pingEvery   time.Duration                               // 0 → wsPingInterval
}

// reconnect dials url, sends subscribe (if any), starts the ping ticker, runs
// the read handler, and reconnects with exponential back-off on any error
// until ctx is cancelled.
func reconnect(ctx context.Context, spec feedSpec) {
	backoff := wsReconnectMin
	dialer := websocket.Dialer{HandshakeTimeout: 10 * time.Second}
	interval := spec.pingEvery
	if interval <= 0 {
		interval = wsPingInterval
	}
	for {
		select {
		case <-ctx.Done():
			return
		default:
		}

		rawConn, _, err := dialer.DialContext(ctx, spec.url, nil)
		if err != nil {
			slog.Error("ws dial failed", "feed", spec.name, "err", err)
			sleep(ctx, backoff)
			backoff = min(backoff*2, wsReconnectMax)
			continue
		}
		sc := &safeConn{Conn: rawConn}
		slog.Info("ws connected", "feed", spec.name)
		backoff = wsReconnectMin

		if spec.subscribe != nil {
			if err := spec.subscribe(sc); err != nil {
				slog.Warn("ws subscribe failed", "feed", spec.name, "err", err)
				_ = rawConn.Close()
				sleep(ctx, backoff)
				backoff = min(backoff*2, wsReconnectMax)
				continue
			}
		}

		pingDone := make(chan struct{})
		go func() {
			ticker := time.NewTicker(interval)
			defer ticker.Stop()
			for {
				select {
				case <-ctx.Done():
					return
				case <-pingDone:
					return
				case <-ticker.C:
					var werr error
					if spec.pingPayload != nil {
						werr = sc.writeMessage(websocket.TextMessage, spec.pingPayload)
					} else {
						werr = sc.writeMessage(websocket.PingMessage, nil)
					}
					if werr != nil {
						return
					}
				}
			}
		}()

		if err := spec.handler(rawConn, sc); err != nil {
			slog.Warn("ws feed error, reconnecting", "feed", spec.name, "err", err)
		}
		close(pingDone)
		_ = rawConn.Close()
		sleep(ctx, backoff)
		backoff = min(backoff*2, wsReconnectMax)
	}
}

func sleep(ctx context.Context, d time.Duration) {
	select {
	case <-ctx.Done():
	case <-time.After(d):
	}
}

// FetchMEXCSpotREST fetches a single MEXC spot price via REST (cold-start
// fallback used when the WebSocket feed has not yet received a tick).
func FetchMEXCSpotREST(symbol string) (PriceSource, error) {
	url := fmt.Sprintf("https://api.mexc.com/api/v3/ticker/price?symbol=%s", symbol)
	resp, err := http.Get(url)
	if err != nil {
		return PriceSource{}, err
	}
	defer func() { _ = resp.Body.Close() }()
	body, _ := io.ReadAll(resp.Body)
	var result struct {
		Price string `json:"price"`
	}
	if err := json.Unmarshal(body, &result); err != nil {
		return PriceSource{}, err
	}
	price, err := strconv.ParseFloat(result.Price, 64)
	if err != nil || price <= 0 {
		return PriceSource{}, fmt.Errorf("invalid price %q", result.Price)
	}
	return PriceSource{Price: price, Exchange: "mexc", Fee: 0.0005}, nil
}

// FetchBinanceSpotREST fetches a single Binance spot price via REST.
func FetchBinanceSpotREST(symbol string) (PriceSource, error) {
	url := fmt.Sprintf("https://api.binance.com/api/v3/ticker/price?symbol=%s", symbol)
	resp, err := http.Get(url)
	if err != nil {
		return PriceSource{}, err
	}
	defer func() { _ = resp.Body.Close() }()
	body, _ := io.ReadAll(resp.Body)
	var result struct {
		Price string `json:"price"`
	}
	if err := json.Unmarshal(body, &result); err != nil {
		return PriceSource{}, err
	}
	price, err := strconv.ParseFloat(result.Price, 64)
	if err != nil || price <= 0 {
		return PriceSource{}, fmt.Errorf("invalid price %q", result.Price)
	}
	return PriceSource{Price: price, Exchange: "binance", Fee: 0.001}, nil
}

func min(a, b time.Duration) time.Duration {
	if a < b {
		return a
	}
	return b
}
