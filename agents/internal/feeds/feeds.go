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
	wsReadTimeout  = 30 * time.Second
	wsReconnectMin = 1 * time.Second
	wsReconnectMax = 30 * time.Second
	wsPingInterval = 10 * time.Second
)

// RunBinance connects to the Binance combined stream for all symbols and keeps
// the price book updated.  It reconnects automatically on any error.
func RunBinance(ctx context.Context, book *Book, symbols []string) {
	streams := make([]string, 0, len(symbols)*2)
	for _, sym := range symbols {
		lower := strings.ToLower(sym)
		streams = append(streams, lower+"@bookTicker")
	}
	url := "wss://stream.binance.com/stream?streams=" + strings.Join(streams, "/")
	reconnect(ctx, "binance", url, func(conn *websocket.Conn) error {
		return readBinanceFeed(conn, book)
	})
}

type binanceStreamMsg struct {
	Stream string `json:"stream"`
	Data   struct {
		Symbol   string `json:"s"`
		BestBid  string `json:"b"`
		BestAsk  string `json:"a"`
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
	reconnect(ctx, "mexc", url, func(conn *websocket.Conn) error {
		// One subscription covers all symbols via the mini-tickers stream.
		if len(symbols) > 0 {
			sub := map[string]any{
				"method": "SUBSCRIPTION",
				"params": []string{"spot@public.miniTickers.v3.api@UTC+8"},
			}
			_ = conn.WriteJSON(sub)
		}
		return readMEXCFeed(conn, book)
	})
}

type mexcMiniTicker struct {
	Symbol string `json:"s"`
	Close  string `json:"c"`
}

type mexcMsg struct {
	Channel string           `json:"c"`
	Data    []mexcMiniTicker `json:"d"`
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
		for _, ticker := range m.Data {
			price, err := strconv.ParseFloat(ticker.Close, 64)
			if err != nil || price <= 0 {
				continue
			}
			book.SetSpot(ticker.Symbol, "mexc", price, 0.0005)
		}
	}
}

// RunBybit connects to the Bybit V5 public spot stream.
func RunBybit(ctx context.Context, book *Book, symbols []string) {
	const url = "wss://stream.bybit.com/v5/public/spot"
	reconnect(ctx, "bybit", url, func(conn *websocket.Conn) error {
		args := make([]string, 0, len(symbols))
		for _, sym := range symbols {
			args = append(args, "tickers."+sym)
		}
		sub := map[string]any{"op": "subscribe", "args": args}
		if err := conn.WriteJSON(sub); err != nil {
			return err
		}
		return readBybitFeed(conn, book)
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
	reconnect(ctx, "bybit_perp", url, func(conn *websocket.Conn) error {
		args := make([]string, 0, len(symbols))
		for _, sym := range symbols {
			args = append(args, "tickers."+sym)
		}
		sub := map[string]any{"op": "subscribe", "args": args}
		if err := conn.WriteJSON(sub); err != nil {
			return err
		}
		return readBybitPerpsFeed(conn, book)
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

// reconnect dials url, runs handler(conn), and reconnects with exponential
// back-off on any error until ctx is cancelled.
func reconnect(ctx context.Context, name, url string, handler func(*websocket.Conn) error) {
	backoff := wsReconnectMin
	dialer := websocket.Dialer{
		HandshakeTimeout: 10 * time.Second,
	}
	for {
		select {
		case <-ctx.Done():
			return
		default:
		}

		conn, _, err := dialer.DialContext(ctx, url, nil)
		if err != nil {
			slog.Error("ws dial failed", "feed", name, "err", err)
			sleep(ctx, backoff)
			backoff = min(backoff*2, wsReconnectMax)
			continue
		}
		slog.Info("ws connected", "feed", name)
		backoff = wsReconnectMin

		// Send periodic pings to keep the connection alive.
		go func() {
			ticker := time.NewTicker(wsPingInterval)
			defer ticker.Stop()
			for {
				select {
				case <-ctx.Done():
					return
				case <-ticker.C:
					if err := conn.SetWriteDeadline(time.Now().Add(5 * time.Second)); err != nil {
						return
					}
					if err := conn.WriteMessage(websocket.PingMessage, nil); err != nil {
						return
					}
				}
			}
		}()

		if err := handler(conn); err != nil {
			slog.Warn("ws feed error, reconnecting", "feed", name, "err", err)
		}
		_ = conn.Close()
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
