package executor

import (
	"strings"
	"testing"
)

func TestCoinbaseSign(t *testing.T) {
	sig := coinbaseSign("secret", "1700000000", "POST", "/api/v3/brokerage/orders", `{"x":1}`)
	if sig == "" {
		t.Fatal("coinbase signature empty")
	}
	sig2 := coinbaseSign("secret", "1700000000", "POST", "/api/v3/brokerage/orders", `{"x":1}`)
	if sig != sig2 {
		t.Fatal("coinbase signature not deterministic")
	}
	if sig == coinbaseSign("other", "1700000000", "POST", "/api/v3/brokerage/orders", `{"x":1}`) {
		t.Fatal("coinbase signature should differ for different secret")
	}
	// hex output, 64 chars
	if len(sig) != 64 {
		t.Fatalf("expected 64-char hex, got %d (%q)", len(sig), sig)
	}
}

func TestCoinbaseProduct(t *testing.T) {
	cases := map[string]string{
		"BTCUSDT": "BTC-USDT",
		"ETHUSDC": "ETH-USDC",
		"SOLUSD":  "SOL-USD",
		"ADABTC":  "ADA-BTC",
	}
	for in, want := range cases {
		if got := coinbaseProduct(in); got != want {
			t.Errorf("coinbaseProduct(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestCoinbaseMissingCreds(t *testing.T) {
	_, err := PlaceCoinbaseSpotOrder("", "secret", "BTCUSDT", "BUY", 0.001, 50)
	if err == nil || !strings.Contains(err.Error(), "missing API credentials") {
		t.Fatalf("expected missing creds error, got %v", err)
	}
}
