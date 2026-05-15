package feeds

import (
	"testing"
	"time"
)

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
