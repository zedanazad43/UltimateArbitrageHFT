package executor

import (
	"bytes"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"
)

// kucoinSign builds the KuCoin v2 request signature.
// preHash = timestamp + method + endpoint + body
// signature = base64(HMAC_SHA256(secret, preHash))
func kucoinSign(secret, ts, method, endpoint, body string) string {
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte(ts + strings.ToUpper(method) + endpoint + body))
	return base64.StdEncoding.EncodeToString(mac.Sum(nil))
}

// kucoinPassphrase encodes the API passphrase per v2 spec:
// base64(HMAC_SHA256(secret, passphrase))
func kucoinPassphrase(secret, passphrase string) string {
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte(passphrase))
	return base64.StdEncoding.EncodeToString(mac.Sum(nil))
}

// kucoinSymbol: BTCUSDT → BTC-USDT.
func kucoinSymbol(symbol string) string {
	s := strings.ToUpper(symbol)
	for _, quote := range []string{"USDT", "USDC", "USD", "BTC", "ETH"} {
		if strings.HasSuffix(s, quote) && len(s) > len(quote) {
			return s[:len(s)-len(quote)] + "-" + quote
		}
	}
	return s
}

// PlaceKuCoinSpotOrder places a market order on KuCoin spot.
// side: "BUY" | "SELL". For BUY, sizeUSD is funds (quote). For SELL, quantity is size (base).
func PlaceKuCoinSpotOrder(apiKey, apiSecret, passphrase, symbol, side string, quantity, sizeUSD float64) (*OrderResult, error) {
	if apiKey == "" || apiSecret == "" || passphrase == "" {
		return nil, fmt.Errorf("kucoin: missing API credentials")
	}
	ts := strconv.FormatInt(time.Now().UnixMilli(), 10)
	endpoint := "/api/v1/orders"

	orderBody := map[string]any{
		"clientOid": uuid.New().String(),
		"side":      strings.ToLower(side),
		"symbol":    kucoinSymbol(symbol),
		"type":      "market",
	}
	if strings.ToUpper(side) == "BUY" {
		orderBody["funds"] = strconv.FormatFloat(sizeUSD, 'f', 4, 64)
	} else {
		orderBody["size"] = strconv.FormatFloat(quantity, 'f', -1, 64)
	}
	bodyBytes, _ := json.Marshal(orderBody)
	sig := kucoinSign(apiSecret, ts, "POST", endpoint, string(bodyBytes))
	signedPass := kucoinPassphrase(apiSecret, passphrase)

	req, _ := http.NewRequest("POST", "https://api.kucoin.com"+endpoint, bytes.NewReader(bodyBytes))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("KC-API-KEY", apiKey)
	req.Header.Set("KC-API-SIGN", sig)
	req.Header.Set("KC-API-TIMESTAMP", ts)
	req.Header.Set("KC-API-PASSPHRASE", signedPass)
	req.Header.Set("KC-API-KEY-VERSION", "2")

	resp, err := httpClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer func() { _ = resp.Body.Close() }()
	raw, _ := io.ReadAll(resp.Body)

	var result struct {
		Code string          `json:"code"`
		Msg  string          `json:"msg"`
		Data json.RawMessage `json:"data"`
	}
	if err := json.Unmarshal(raw, &result); err != nil {
		return nil, fmt.Errorf("kucoin decode: %w (body: %s)", err, string(raw))
	}
	if result.Code != "200000" {
		return nil, fmt.Errorf("kucoin error %s: %s", result.Code, result.Msg)
	}
	var inner struct {
		OrderID string `json:"orderId"`
	}
	_ = json.Unmarshal(result.Data, &inner)
	return &OrderResult{OrderID: inner.OrderID, Exchange: "kucoin", Symbol: symbol, Side: side, Raw: raw}, nil
}
