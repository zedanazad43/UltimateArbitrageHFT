package executor

import (
	"strings"
	"testing"
)

func TestKuCoinSign(t *testing.T) {
	sig := kucoinSign("secret", "1700000000000", "POST", "/api/v1/orders", `{"x":1}`)
	if sig == "" {
		t.Fatal("kucoin signature empty")
	}
	sig2 := kucoinSign("secret", "1700000000000", "POST", "/api/v1/orders", `{"x":1}`)
	if sig != sig2 {
		t.Fatal("kucoin signature not deterministic")
	}
	if sig == kucoinSign("other", "1700000000000", "POST", "/api/v1/orders", `{"x":1}`) {
		t.Fatal("kucoin signature should differ for different secret")
	}
}

func TestKuCoinPassphrase(t *testing.T) {
	p := kucoinPassphrase("secret", "myPass")
	if p == "" {
		t.Fatal("passphrase empty")
	}
	if p == kucoinPassphrase("other", "myPass") {
		t.Fatal("passphrase should depend on secret")
	}
}

func TestKuCoinSymbol(t *testing.T) {
	cases := map[string]string{
		"BTCUSDT": "BTC-USDT",
		"ETHUSDC": "ETH-USDC",
		"SOLUSD":  "SOL-USD",
		"ADABTC":  "ADA-BTC",
	}
	for in, want := range cases {
		if got := kucoinSymbol(in); got != want {
			t.Errorf("kucoinSymbol(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestKuCoinMissingCreds(t *testing.T) {
	_, err := PlaceKuCoinSpotOrder("", "secret", "pass", "BTCUSDT", "BUY", 0.001, 50)
	if err == nil || !strings.Contains(err.Error(), "missing API credentials") {
		t.Fatalf("expected missing creds error, got %v", err)
	}
}
