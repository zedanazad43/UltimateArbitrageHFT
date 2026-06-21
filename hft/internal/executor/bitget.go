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
)

// bitgetSign builds the Bitget v2 signature.
// preHash = timestamp + method + requestPath + body
// signature = base64(HMAC_SHA256(secret, preHash))
func bitgetSign(secret, ts, method, requestPath, body string) string {
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte(ts + strings.ToUpper(method) + requestPath + body))
	return base64.StdEncoding.EncodeToString(mac.Sum(nil))
}

// bitgetSymbol normalises BTCUSDT → BTCUSDT_SPBL (Bitget legacy) or returns as-is for v2.
// v2 endpoints use plain BTCUSDT, so we pass through.
func bitgetSymbol(s string) string { return strings.ToUpper(s) }

// PlaceBitgetSpotOrder places a market order on Bitget spot (v2 API).
// side: "BUY" | "SELL". For BUY, size is in quote (USDT). For SELL, size is in base.
func PlaceBitgetSpotOrder(apiKey, apiSecret, apiPassword, symbol, side string, quantity, sizeUSD float64) (*OrderResult, error) {
	if apiKey == "" || apiSecret == "" || apiPassword == "" {
		return nil, fmt.Errorf("bitget: missing API credentials")
	}
	ts := strconv.FormatInt(time.Now().UnixMilli(), 10)
	requestPath := "/api/v2/spot/trade/place-order"

	orderBody := map[string]any{
		"symbol":    bitgetSymbol(symbol),
		"side":      strings.ToLower(side),
		"orderType": "market",
		"force":     "gtc",
	}
	if strings.ToUpper(side) == "BUY" {
		orderBody["size"] = strconv.FormatFloat(sizeUSD, 'f', 2, 64)
	} else {
		orderBody["size"] = strconv.FormatFloat(quantity, 'f', -1, 64)
	}
	bodyBytes, _ := json.Marshal(orderBody)
	sig := bitgetSign(apiSecret, ts, "POST", requestPath, string(bodyBytes))

	req, _ := http.NewRequest("POST", "https://api.bitget.com"+requestPath, bytes.NewReader(bodyBytes))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("ACCESS-KEY", apiKey)
	req.Header.Set("ACCESS-SIGN", sig)
	req.Header.Set("ACCESS-TIMESTAMP", ts)
	req.Header.Set("ACCESS-PASSPHRASE", apiPassword)
	req.Header.Set("locale", "en-US")

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
		return nil, err
	}
	if result.Code != "00000" {
		return nil, fmt.Errorf("bitget error %s: %s", result.Code, result.Msg)
	}
	var inner struct {
		OrderID string `json:"orderId"`
	}
	_ = json.Unmarshal(result.Data, &inner)
	return &OrderResult{OrderID: inner.OrderID, Exchange: "bitget", Symbol: symbol, Side: side, Raw: raw}, nil
}
