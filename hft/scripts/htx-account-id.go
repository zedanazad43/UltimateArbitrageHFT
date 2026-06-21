package main

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"sort"
	"strings"
	"time"
)

func main() {
	key := os.Getenv("HTX_API_KEY")
	secret := os.Getenv("HTX_API_SECRET")
	if key == "" || secret == "" {
		fmt.Println("set HTX_API_KEY and HTX_API_SECRET")
		os.Exit(1)
	}
	host := "api.huobi.pro"
	path := "/v1/account/accounts"
	method := "GET"
	params := map[string]string{
		"AccessKeyId":      key,
		"SignatureMethod":  "HmacSHA256",
		"SignatureVersion": "2",
		"Timestamp":        time.Now().UTC().Format("2006-01-02T15:04:05"),
	}
	keys := make([]string, 0, len(params))
	for k := range params {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	parts := make([]string, 0, len(keys))
	for _, k := range keys {
		parts = append(parts, url.QueryEscape(k)+"="+url.QueryEscape(params[k]))
	}
	sortedQ := strings.Join(parts, "&")
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte(method + "\n" + host + "\n" + path + "\n" + sortedQ))
	sig := base64.StdEncoding.EncodeToString(mac.Sum(nil))
	endpoint := "https://" + host + path + "?" + sortedQ + "&Signature=" + url.QueryEscape(sig)
	resp, err := http.Get(endpoint)
	if err != nil {
		fmt.Println("error:", err)
		os.Exit(1)
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)
	fmt.Println(string(body))
}
