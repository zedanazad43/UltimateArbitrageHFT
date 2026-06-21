// Package executor — Gateio spot order placement.
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
	"strconv"
	"time"
)

// PlaceGateioSpotOrder places a market order on Gateio spot.
// symbol format: "BTC_USDT" (base_quote)
func PlaceGateioSpotOrder(apiKey, apiSecret, passphrase, symbol, side string, quantity float64) (*OrderResult, error) {
	if apiKey == "" || apiSecret == "" {
		return nil, fmt.Errorf("gateio: missing API credentials")
	}

	timestamp := strconv.FormatInt(time.Now().Unix(), 10)
	body := map[string]any{
		"text":          "c-order-" + strconv.FormatInt(time.Now().UnixNano(), 10),
		"side":          side, // buy | sell
		"type":          "market",
		"currency_pair": symbol,
		"amount":        strconv.FormatFloat(quantity, 'f', -1, 64),
	}

	bodyBytes, _ := json.Marshal(body)
	bodyStr := string(bodyBytes)

	// Signature = HMAC-SHA256(secret, timestamp + method + request_path + body)
	payload := timestamp + "POST" + "/api/v4/spot/orders" + bodyStr
	mac := hmac.New(sha256.New, []byte(apiSecret))
	mac.Write([]byte(payload))
	signature := hex.EncodeToString(mac.Sum(nil))

	req, _ := http.NewRequest("POST", "https://api.gateio.ws/api/v4/spot/orders", bytes.NewReader(bodyBytes))
	req.Header.Set("Accept", "application/json")
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Gate-Api-Key", apiKey)
	req.Header.Set("X-Gate-Api-Timestamp", timestamp)
	req.Header.Set("X-Gate-Api-Signature", signature)

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
	if errMsg, ok := result["message"]; ok && errMsg != "" {
		return nil, fmt.Errorf("gateio error: %v", errMsg)
	}

	ordID := fmt.Sprintf("%v", result["id"])
	return &OrderResult{OrderID: ordID, Exchange: "gateio", Symbol: symbol, Side: side, Raw: raw}, nil
}
