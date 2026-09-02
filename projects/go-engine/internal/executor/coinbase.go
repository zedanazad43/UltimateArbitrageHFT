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

// coinbaseSign builds the Coinbase Advanced Trade legacy HMAC signature.
// preHash = timestamp + method + path + body
// signature = hex(HMAC_SHA256(secret_bytes, preHash))
// Note: secret is the raw API secret string (NOT base64-decoded for legacy v3).
func coinbaseSign(secret, ts, method, path, body string) string {
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte(ts + strings.ToUpper(method) + path + body))
	return fmt.Sprintf("%x", mac.Sum(nil))
}

// coinbaseProduct: BTCUSDT → BTC-USDT (Coinbase uses dash-separated product IDs).
func coinbaseProduct(symbol string) string {
	s := strings.ToUpper(symbol)
	for _, quote := range []string{"USDT", "USDC", "USD", "BTC", "ETH"} {
		if strings.HasSuffix(s, quote) && len(s) > len(quote) {
			return s[:len(s)-len(quote)] + "-" + quote
		}
	}
	return s
}

// PlaceCoinbaseSpotOrder places a market order on Coinbase Advanced Trade (v3).
// side: "BUY" | "SELL". For BUY, sizeUSD is quote_size; for SELL, quantity is base_size.
func PlaceCoinbaseSpotOrder(apiKey, apiSecret, symbol, side string, quantity, sizeUSD float64) (*OrderResult, error) {
	if apiKey == "" || apiSecret == "" {
		return nil, fmt.Errorf("coinbase: missing API credentials")
	}
	// Sanity check: legacy v3 expects raw secret (often base64-looking). Ensure it isn't empty.
	if _, err := base64.StdEncoding.DecodeString(apiSecret); err != nil && len(apiSecret) < 32 {
		return nil, fmt.Errorf("coinbase: invalid API secret format")
	}

	ts := strconv.FormatInt(time.Now().Unix(), 10) // seconds, not millis
	path := "/api/v3/brokerage/orders"

	marketConfig := map[string]string{}
	if strings.ToUpper(side) == "BUY" {
		marketConfig["quote_size"] = strconv.FormatFloat(sizeUSD, 'f', 2, 64)
	} else {
		marketConfig["base_size"] = strconv.FormatFloat(quantity, 'f', -1, 64)
	}
	orderBody := map[string]any{
		"client_order_id": uuid.New().String(),
		"product_id":      coinbaseProduct(symbol),
		"side":            strings.ToUpper(side),
		"order_configuration": map[string]any{
			"market_market_ioc": marketConfig,
		},
	}
	bodyBytes, _ := json.Marshal(orderBody)
	sig := coinbaseSign(apiSecret, ts, "POST", path, string(bodyBytes))

	req, _ := http.NewRequest("POST", "https://api.coinbase.com"+path, bytes.NewReader(bodyBytes))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("CB-ACCESS-KEY", apiKey)
	req.Header.Set("CB-ACCESS-SIGN", sig)
	req.Header.Set("CB-ACCESS-TIMESTAMP", ts)

	resp, err := httpClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer func() { _ = resp.Body.Close() }()
	raw, _ := io.ReadAll(resp.Body)

	var result struct {
		Success         bool   `json:"success"`
		FailureReason   string `json:"failure_reason"`
		OrderID         string `json:"order_id"`
		SuccessResponse struct {
			OrderID string `json:"order_id"`
		} `json:"success_response"`
		ErrorResponse struct {
			Error   string `json:"error"`
			Message string `json:"message"`
		} `json:"error_response"`
	}
	if err := json.Unmarshal(raw, &result); err != nil {
		return nil, fmt.Errorf("coinbase decode: %w (body: %s)", err, string(raw))
	}
	if !result.Success {
		return nil, fmt.Errorf("coinbase error: %s %s", result.ErrorResponse.Error, result.ErrorResponse.Message)
	}
	orderID := result.SuccessResponse.OrderID
	if orderID == "" {
		orderID = result.OrderID
	}
	return &OrderResult{OrderID: orderID, Exchange: "coinbase", Symbol: symbol, Side: side, Raw: raw}, nil
}
