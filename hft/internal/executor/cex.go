// Package executor handles order placement on CEX exchanges (MEXC, Binance).
// Each function signs and submits a market order using the exchange's REST API.
package executor

import (
	"bytes"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"sort"
	"strconv"
	"strings"
	"time"
)

var httpClient = OptimizedHTTPClient()

// OrderResult holds the exchange's response to an order placement.
type OrderResult struct {
	OrderID  string
	Exchange string
	Symbol   string
	Side     string
	Raw      json.RawMessage
}

// ─── HMAC helpers ─────────────────────────────────────────────────────────────

func hmacHex(secret, message string) string {
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte(message))
	return hex.EncodeToString(mac.Sum(nil))
}

// ─── MEXC Spot ────────────────────────────────────────────────────────────────

// PlaceMEXCSpotOrder places a market order on MEXC spot.
// side: "BUY" | "SELL"
// quantity is the base asset amount.
func PlaceMEXCSpotOrder(apiKey, apiSecret, symbol, side string, quantity float64) (*OrderResult, error) {
	if apiKey == "" || apiSecret == "" {
		return nil, fmt.Errorf("mexc: missing API credentials")
	}
	ts := strconv.FormatInt(time.Now().UnixMilli(), 10)
	params := map[string]string{
		"symbol":    symbol,
		"side":      strings.ToUpper(side),
		"type":      "MARKET",
		"quantity":  strconv.FormatFloat(quantity, 'f', -1, 64),
		"timestamp": ts,
	}
	sorted := sortedQuery(params)
	params["signature"] = hmacHex(apiSecret, sorted)

	body := url.Values{}
	for k, v := range params {
		body.Set(k, v)
	}

	req, _ := http.NewRequest("POST", "https://api.mexc.com/api/v3/order", strings.NewReader(body.Encode()))
	req.Header.Set("X-MEXC-APIKEY", apiKey)
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")

	resp, err := httpClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer func() { _ = resp.Body.Close() }()
	raw, _ := io.ReadAll(resp.Body)

	var result map[string]any
	if err := json.Unmarshal(raw, &result); err != nil {
		return nil, err
	}
	if code, ok := result["code"]; ok {
		return nil, fmt.Errorf("mexc spot error %v: %v", code, result["msg"])
	}
	ordID := fmt.Sprintf("%v", result["orderId"])
	return &OrderResult{OrderID: ordID, Exchange: "mexc", Symbol: symbol, Side: side, Raw: raw}, nil
}

// ─── MEXC Futures ─────────────────────────────────────────────────────────────

// PlaceMEXCFuturesOrder places a futures (perpetuals) market order on MEXC.
// side: "LONG" | "SHORT"
func PlaceMEXCFuturesOrder(apiKey, apiSecret, symbol, side string, quantity float64, leverage int) (*OrderResult, error) {
	if apiKey == "" || apiSecret == "" {
		return nil, fmt.Errorf("mexc_perp: missing API credentials")
	}
	perpSymbol := strings.Replace(symbol, "USDT", "_USDT", 1)
	recvWindow := 5000
	ts := time.Now().UnixMilli()
	sideCode := 2 // 2 = open short
	if strings.ToUpper(side) == "LONG" {
		sideCode = 1
	}

	orderBody := map[string]any{
		"symbol":   perpSymbol,
		"side":     sideCode,
		"openType": 1,
		"type":     5,
		"vol":      quantity,
		"leverage": leverage,
	}
	bodyBytes, _ := json.Marshal(orderBody)
	rawSig := fmt.Sprintf("%d%s%d%s", ts, apiKey, recvWindow, string(bodyBytes))
	sig := hmacHex(apiSecret, rawSig)

	req, _ := http.NewRequest("POST", "https://contract.mexc.com/api/v1/private/order/submit", bytes.NewReader(bodyBytes))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("ApiKey", apiKey)
	req.Header.Set("Request-Time", strconv.FormatInt(ts, 10))
	req.Header.Set("Signature", sig)
	req.Header.Set("recv-window", strconv.Itoa(recvWindow))

	resp, err := httpClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer func() { _ = resp.Body.Close() }()
	raw, _ := io.ReadAll(resp.Body)

	var result struct {
		Success bool            `json:"success"`
		Message string          `json:"message"`
		Data    json.RawMessage `json:"data"`
	}
	if err := json.Unmarshal(raw, &result); err != nil {
		return nil, err
	}
	if !result.Success {
		return nil, fmt.Errorf("mexc futures error: %s", result.Message)
	}
	return &OrderResult{Exchange: "mexc_perp", Symbol: symbol, Side: side, Raw: raw}, nil
}

// ─── Binance Spot ─────────────────────────────────────────────────────────────

// PlaceBinanceSpotOrder places a market order on Binance spot.
// For BUY orders, sizeUSD is used (quoteOrderQty); SELL uses quantity.
func PlaceBinanceSpotOrder(apiKey, apiSecret, symbol, side string, quantity, sizeUSD float64) (*OrderResult, error) {
	if apiKey == "" || apiSecret == "" {
		return nil, fmt.Errorf("binance: missing API credentials")
	}
	ts := strconv.FormatInt(time.Now().UnixMilli(), 10)
	params := map[string]string{
		"symbol":    symbol,
		"side":      strings.ToUpper(side),
		"type":      "MARKET",
		"timestamp": ts,
	}
	if strings.ToUpper(side) == "BUY" {
		params["quoteOrderQty"] = strconv.FormatFloat(sizeUSD, 'f', 2, 64)
	} else {
		params["quantity"] = strconv.FormatFloat(quantity, 'f', -1, 64)
	}
	sorted := sortedQuery(params)
	params["signature"] = hmacHex(apiSecret, sorted)

	body := url.Values{}
	for k, v := range params {
		body.Set(k, v)
	}

	req, _ := http.NewRequest("POST", "https://api.binance.com/api/v3/order", strings.NewReader(body.Encode()))
	req.Header.Set("X-MBX-APIKEY", apiKey)
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")

	resp, err := httpClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer func() { _ = resp.Body.Close() }()
	raw, _ := io.ReadAll(resp.Body)

	var result map[string]any
	if err := json.Unmarshal(raw, &result); err != nil {
		return nil, err
	}
	if code, ok := result["code"]; ok {
		return nil, fmt.Errorf("binance spot error %v: %v", code, result["msg"])
	}
	ordID := fmt.Sprintf("%v", result["orderId"])
	return &OrderResult{OrderID: ordID, Exchange: "binance", Symbol: symbol, Side: side, Raw: raw}, nil
}

// ─── Bybit Spot ───────────────────────────────────────────────────────────────

// PlaceBybitSpotOrder places a market order on Bybit spot (V5 API).
func PlaceBybitSpotOrder(apiKey, apiSecret, symbol, side string, quantity float64) (*OrderResult, error) {
	if apiKey == "" || apiSecret == "" {
		return nil, fmt.Errorf("bybit: missing API credentials")
	}
	ts := strconv.FormatInt(time.Now().UnixMilli(), 10)
	recvWindow := "5000"

	orderBody := map[string]any{
		"category":  "spot",
		"symbol":    symbol,
		"side":      capitalise(side),
		"orderType": "Market",
		"qty":       strconv.FormatFloat(quantity, 'f', -1, 64),
	}
	bodyBytes, _ := json.Marshal(orderBody)

	// Bybit V5 signature: timestamp + apiKey + recvWindow + body
	rawSig := ts + apiKey + recvWindow + string(bodyBytes)
	sig := hmacHex(apiSecret, rawSig)

	req, _ := http.NewRequest("POST", "https://api.bybit.com/v5/order/create", bytes.NewReader(bodyBytes))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-BAPI-API-KEY", apiKey)
	req.Header.Set("X-BAPI-SIGN", sig)
	req.Header.Set("X-BAPI-TIMESTAMP", ts)
	req.Header.Set("X-BAPI-RECV-WINDOW", recvWindow)

	resp, err := httpClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer func() { _ = resp.Body.Close() }()
	raw, _ := io.ReadAll(resp.Body)

	var result struct {
		RetCode int             `json:"retCode"`
		RetMsg  string          `json:"retMsg"`
		Result  json.RawMessage `json:"result"`
	}
	if err := json.Unmarshal(raw, &result); err != nil {
		return nil, err
	}
	if result.RetCode != 0 {
		return nil, fmt.Errorf("bybit error %d: %s", result.RetCode, result.RetMsg)
	}
	var inner struct {
		OrderID string `json:"orderId"`
	}
	if err := json.Unmarshal(result.Result, &inner); err != nil {
		return nil, err
	}
	return &OrderResult{OrderID: inner.OrderID, Exchange: "bybit", Symbol: symbol, Side: side, Raw: raw}, nil
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

func sortedQuery(params map[string]string) string {
	keys := make([]string, 0, len(params))
	for k := range params {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	parts := make([]string, 0, len(keys))
	for _, k := range keys {
		parts = append(parts, k+"="+params[k])
	}
	return strings.Join(parts, "&")
}

func capitalise(s string) string {
	if s == "" {
		return s
	}
	return strings.ToUpper(s[:1]) + strings.ToLower(s[1:])
}
