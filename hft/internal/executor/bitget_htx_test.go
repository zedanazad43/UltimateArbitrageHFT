package executor

import (
	"strings"
	"testing"
)

func TestBitgetSign(t *testing.T) {
	// Known-input check: deterministic output for fixed inputs.
	sig := bitgetSign("secret", "1700000000000", "POST", "/api/v2/spot/trade/place-order", `{"symbol":"BTCUSDT"}`)
	if sig == "" {
		t.Fatal("bitget signature empty")
	}
	// Same inputs → same output.
	sig2 := bitgetSign("secret", "1700000000000", "POST", "/api/v2/spot/trade/place-order", `{"symbol":"BTCUSDT"}`)
	if sig != sig2 {
		t.Fatal("bitget signature not deterministic")
	}
	// Different secret → different output.
	sig3 := bitgetSign("other", "1700000000000", "POST", "/api/v2/spot/trade/place-order", `{"symbol":"BTCUSDT"}`)
	if sig == sig3 {
		t.Fatal("bitget signature should differ for different secret")
	}
}

func TestBitgetMissingCreds(t *testing.T) {
	_, err := PlaceBitgetSpotOrder("", "secret", "pass", "BTCUSDT", "BUY", 0.001, 50)
	if err == nil || !strings.Contains(err.Error(), "missing API credentials") {
		t.Fatalf("expected missing creds error, got %v", err)
	}
}

func TestHTXSign(t *testing.T) {
	sig := htxSign("secret", "POST", "api.huobi.pro", "/v1/order/orders/place", "AccessKeyId=key&SignatureMethod=HmacSHA256")
	if sig == "" {
		t.Fatal("htx signature empty")
	}
}

func TestHTXSortedQuery(t *testing.T) {
	got := htxSortedQuery(map[string]string{"b": "2", "a": "1", "c": "3"})
	want := "a=1&b=2&c=3"
	if got != want {
		t.Fatalf("htx sorted query: got %q want %q", got, want)
	}
}

func TestHTXMissingCreds(t *testing.T) {
	_, err := PlaceHTXSpotOrder("", "s", "acc", "BTCUSDT", "BUY", 0.001, 50)
	if err == nil || !strings.Contains(err.Error(), "missing API credentials") {
		t.Fatalf("expected missing creds error, got %v", err)
	}
	_, err = PlaceHTXSpotOrder("k", "s", "", "BTCUSDT", "BUY", 0.001, 50)
	if err == nil || !strings.Contains(err.Error(), "account id") {
		t.Fatalf("expected missing account id error, got %v", err)
	}
}
