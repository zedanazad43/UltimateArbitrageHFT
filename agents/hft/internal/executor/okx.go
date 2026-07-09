// Package executor — OKX spot order placement.
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
	"time"
)

// PlaceOKXSpotOrder places a market order on OKX spot.
// symbol format: "BTC-USDT" (base-quote)
func PlaceOKXSpotOrder(apiKey, apiSecret, passphrase, symbol, side string, quantity float64) (*OrderResult, error) {
	if apiKey == "" || apiSecret == "" {
		return nil, fmt.Errorf("okx: missing API credentials")
	}

	// OKX uses nano timestamp
	timestamp := time.Now().UTC().Format("2006-01-02T15:04:05.000Z07:00")

	body := map[string]any{
		"instId":  symbol,
		"ordType": "market",
		"side":    side, // buy | sell
		"sz":      fmt.Sprintf("%.8f", quantity),
	}
	bodyBytes, _ := json.Marshal(body)
	bodyStr := string(bodyBytes)

	// Signature = HMAC-SHA256(secret, timestamp + method + request_path + body)
	payload := timestamp + "POST" + "/api/v5/trade/order" + bodyStr
	mac := hmac.New(sha256.New, []byte(apiSecret))
	mac.Write([]byte(payload))
	signature := base64.StdEncoding.EncodeToString(mac.Sum(nil))

	req, _ := http.NewRequest("POST", "https://www.okx.com/api/v5/trade/order", bytes.NewReader(bodyBytes))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("OK-ACCESS-KEY", apiKey)
	req.Header.Set("OK-ACCESS-TIMESTAMP", timestamp)
	req.Header.Set("OK-ACCESS-PASSPHRASE", passphrase)
	req.Header.Set("OK-ACCESS-SIGN", signature)

	resp, err := httpClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer func() { _ = resp.Body.Close() }()
	raw, _ := io.ReadAll(resp.Body)

	var result struct {
		Code string           `json:"code"`
		Msg  string           `json:"msg"`
		Data []map[string]any `json:"data"`
	}
	if err := json.Unmarshal(raw, &result); err != nil {
		return nil, err
	}
	if result.Code != "0" {
		return nil, fmt.Errorf("okx error %s: %s", result.Code, result.Msg)
	}

	var ordID string
	if len(result.Data) > 0 {
		if id, ok := result.Data[0]["ordId"]; ok {
			ordID = fmt.Sprintf("%v", id)
		}
	}

	return &OrderResult{OrderID: ordID, Exchange: "okx", Symbol: symbol, Side: side, Raw: raw}, nil
}
