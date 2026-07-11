package executor

import (
	"io"
	"net/http"
	"strings"
	"testing"
)

type roundTripFunc func(*http.Request) (*http.Response, error)

func (f roundTripFunc) RoundTrip(req *http.Request) (*http.Response, error) {
	return f(req)
}

func stubHTTPClient(fn roundTripFunc) *http.Client {
	return &http.Client{Transport: fn}
}

func TestHMACHex_KnownVector(t *testing.T) {
	got := hmacHex("secret", "message")
	want := "8b5f48702995c1598c573db1e21866a9b825d4a794d169d7060a03605796360b"
	if got != want {
		t.Fatalf("hmacHex mismatch: got %s want %s", got, want)
	}
}

func TestSortedQuery_DeterministicOrder(t *testing.T) {
	params := map[string]string{
		"z": "9",
		"a": "1",
		"m": "5",
	}
	got := sortedQuery(params)
	want := "a=1&m=5&z=9"
	if got != want {
		t.Fatalf("sortedQuery mismatch: got %q want %q", got, want)
	}
}

func TestCapitalise(t *testing.T) {
	tests := []struct {
		in   string
		want string
	}{
		{in: "buy", want: "Buy"},
		{in: "SELL", want: "Sell"},
		{in: "", want: ""},
	}

	for _, tc := range tests {
		if got := capitalise(tc.in); got != tc.want {
			t.Fatalf("capitalise(%q) = %q, want %q", tc.in, got, tc.want)
		}
	}
}

func TestPlaceMEXCSpotOrder_MissingCredentials(t *testing.T) {
	_, err := PlaceMEXCSpotOrder("", "", "BTCUSDT", "BUY", 1)
	if err == nil {
		t.Fatal("expected error for missing credentials")
	}
}

func TestPlaceMEXCSpotOrder_Success(t *testing.T) {
	origClient := httpClient
	t.Cleanup(func() { httpClient = origClient })

	httpClient = stubHTTPClient(func(req *http.Request) (*http.Response, error) {
		if req.URL.String() != "https://api.mexc.com/api/v3/order" {
			t.Fatalf("unexpected URL: %s", req.URL.String())
		}
		if req.Method != http.MethodPost {
			t.Fatalf("unexpected method: %s", req.Method)
		}
		return &http.Response{
			StatusCode: 200,
			Body:       io.NopCloser(strings.NewReader(`{"orderId":12345}`)),
			Header:     make(http.Header),
		}, nil
	})

	res, err := PlaceMEXCSpotOrder("key", "secret", "BTCUSDT", "BUY", 1)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if res.OrderID != "12345" {
		t.Fatalf("unexpected order id: %s", res.OrderID)
	}
}

func TestPlaceMEXCSpotOrder_APIError(t *testing.T) {
	origClient := httpClient
	t.Cleanup(func() { httpClient = origClient })

	httpClient = stubHTTPClient(func(req *http.Request) (*http.Response, error) {
		return &http.Response{
			StatusCode: 400,
			Body:       io.NopCloser(strings.NewReader(`{"code":-1013,"msg":"invalid quantity"}`)),
			Header:     make(http.Header),
		}, nil
	})

	_, err := PlaceMEXCSpotOrder("key", "secret", "BTCUSDT", "BUY", 1)
	if err == nil {
		t.Fatal("expected API error")
	}
	if !strings.Contains(err.Error(), "mexc spot error") {
		t.Fatalf("unexpected error text: %v", err)
	}
}
