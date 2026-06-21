package executor

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
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

// htxSign builds the HTX (Huobi) v1 signature.
// preHash = method + "\n" + host + "\n" + path + "\n" + sortedQuery
// signature = base64(HMAC_SHA256(secret, preHash))
func htxSign(secret, method, host, path, sortedQuery string) string {
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte(strings.ToUpper(method) + "\n" + host + "\n" + path + "\n" + sortedQuery))
	return base64.StdEncoding.EncodeToString(mac.Sum(nil))
}

// htxSortedQuery returns URL-encoded params sorted alphabetically.
func htxSortedQuery(params map[string]string) string {
	keys := make([]string, 0, len(params))
	for k := range params {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	parts := make([]string, 0, len(keys))
	for _, k := range keys {
		parts = append(parts, url.QueryEscape(k)+"="+url.QueryEscape(params[k]))
	}
	return strings.Join(parts, "&")
}

// htxSymbol: HTX uses lowercase like "btcusdt".
func htxSymbol(s string) string { return strings.ToLower(s) }

// PlaceHTXSpotOrder places a market order on HTX spot.
// side: "BUY" | "SELL". HTX market BUY uses amount in quote; SELL uses amount in base.
// accountID must be set via HTX_ACCOUNT_ID env var (spot account id from /v1/account/accounts).
func PlaceHTXSpotOrder(apiKey, apiSecret, accountID, symbol, side string, quantity, sizeUSD float64) (*OrderResult, error) {
	if apiKey == "" || apiSecret == "" {
		return nil, fmt.Errorf("htx: missing API credentials")
	}
	if accountID == "" {
		return nil, fmt.Errorf("htx: missing account id (HTX_ACCOUNT_ID)")
	}

	host := "api.huobi.pro"
	path := "/v1/order/orders/place"
	method := "POST"

	signParams := map[string]string{
		"AccessKeyId":      apiKey,
		"SignatureMethod":  "HmacSHA256",
		"SignatureVersion": "2",
		"Timestamp":        time.Now().UTC().Format("2006-01-02T15:04:05"),
	}
	sortedQ := htxSortedQuery(signParams)
	sig := htxSign(apiSecret, method, host, path, sortedQ)

	orderType := "buy-market"
	amount := sizeUSD
	if strings.ToUpper(side) == "SELL" {
		orderType = "sell-market"
		amount = quantity
	}
	orderBody := map[string]any{
		"account-id": accountID,
		"symbol":     htxSymbol(symbol),
		"type":       orderType,
		"amount":     strconv.FormatFloat(amount, 'f', -1, 64),
	}
	bodyBytes, _ := json.Marshal(orderBody)

	endpoint := "https://" + host + path + "?" + sortedQ + "&Signature=" + url.QueryEscape(sig)
	req, _ := http.NewRequest(method, endpoint, strings.NewReader(string(bodyBytes)))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")

	resp, err := httpClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer func() { _ = resp.Body.Close() }()
	raw, _ := io.ReadAll(resp.Body)

	var result struct {
		Status  string `json:"status"`
		ErrCode string `json:"err-code"`
		ErrMsg  string `json:"err-msg"`
		Data    string `json:"data"`
	}
	if err := json.Unmarshal(raw, &result); err != nil {
		return nil, err
	}
	if result.Status != "ok" {
		return nil, fmt.Errorf("htx error %s: %s", result.ErrCode, result.ErrMsg)
	}
	return &OrderResult{OrderID: result.Data, Exchange: "htx", Symbol: symbol, Side: side, Raw: raw}, nil
}
