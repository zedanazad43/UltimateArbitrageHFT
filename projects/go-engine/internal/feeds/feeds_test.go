package feeds

import (
	"io"
	"net/http"
	"strings"
	"testing"
	"time"
)

type feedRoundTripFunc func(*http.Request) (*http.Response, error)

func (f feedRoundTripFunc) RoundTrip(req *http.Request) (*http.Response, error) {
	return f(req)
}

func TestBookSpotSourcesAndPerpLookup(t *testing.T) {
	book := NewBook()

	book.SetSpot("BTCUSDT", "binance", 100.0, 0.001)
	book.SetSpot("BTCUSDT", "mexc", 101.0, 0.0005)
	book.SetPerp("BTCUSDT", "bybit_perp", 102.0, 0.0006, 0.0001)

	sources := book.SpotSources("BTCUSDT")
	if len(sources) != 2 {
		t.Fatalf("expected 2 spot sources, got %d", len(sources))
	}

	perp := book.BestPerp("BTCUSDT", "bybit_perp")
	if perp == nil {
		t.Fatal("expected perp data, got nil")
	}
	if perp.Price != 102.0 {
		t.Fatalf("unexpected perp price: got %.4f", perp.Price)
	}
	if perp.FundingRate != 0.0001 {
		t.Fatalf("unexpected funding rate: got %.6f", perp.FundingRate)
	}

	missing := book.BestPerp("ETHUSDT", "bybit_perp")
	if missing != nil {
		t.Fatal("expected nil for missing symbol")
	}
}

func TestMinDuration(t *testing.T) {
	a := 2 * time.Second
	b := 5 * time.Second
	if got := min(a, b); got != a {
		t.Fatalf("min(%s, %s) = %s, want %s", a, b, got, a)
	}
	if got := min(b, a); got != a {
		t.Fatalf("min(%s, %s) = %s, want %s", b, a, got, a)
	}
}

func TestFetchMEXCSpotREST_Success(t *testing.T) {
	origTransport := http.DefaultTransport
	t.Cleanup(func() { http.DefaultTransport = origTransport })

	http.DefaultTransport = feedRoundTripFunc(func(req *http.Request) (*http.Response, error) {
		if req.URL.Host != "api.mexc.com" {
			t.Fatalf("unexpected host: %s", req.URL.Host)
		}
		return &http.Response{
			StatusCode: 200,
			Body:       io.NopCloser(strings.NewReader(`{"price":"123.45"}`)),
			Header:     make(http.Header),
		}, nil
	})

	price, err := FetchMEXCSpotREST("BTCUSDT")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if price.Price != 123.45 {
		t.Fatalf("unexpected price: %.2f", price.Price)
	}
}

func TestFetchBinanceSpotREST_InvalidPrice(t *testing.T) {
	origTransport := http.DefaultTransport
	t.Cleanup(func() { http.DefaultTransport = origTransport })

	http.DefaultTransport = feedRoundTripFunc(func(req *http.Request) (*http.Response, error) {
		if req.URL.Host != "api.binance.com" {
			t.Fatalf("unexpected host: %s", req.URL.Host)
		}
		return &http.Response{
			StatusCode: 200,
			Body:       io.NopCloser(strings.NewReader(`{"price":"bad"}`)),
			Header:     make(http.Header),
		}, nil
	})

	_, err := FetchBinanceSpotREST("BTCUSDT")
	if err == nil {
		t.Fatal("expected error for invalid price")
	}
}
