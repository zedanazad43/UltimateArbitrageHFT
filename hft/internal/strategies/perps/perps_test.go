package perps

import (
	"testing"

	"github.com/zedanazad43/UltimateArbitrageHFT/hft/internal/feeds"
)

func TestScan_NilGuards(t *testing.T) {
	if got := Scan("BTCUSDT", nil, nil, 5.0); got != nil {
		t.Errorf("expected nil when inputs nil, got %+v", got)
	}
	if got := Scan("BTCUSDT", []feeds.PriceSource{}, &feeds.PerpData{}, 5.0); got != nil {
		t.Errorf("expected nil when spot empty, got %+v", got)
	}
}

func TestScan_SpreadGuardRejects(t *testing.T) {
	spots := []feeds.PriceSource{{Price: 100, Exchange: "binance", Fee: 0.001}}
	perp := &feeds.PerpData{PriceSource: feeds.PriceSource{Price: 106, Exchange: "bybit", Fee: 0.001}}

	if got := Scan("BTCUSDT", spots, perp, 3.0); got != nil {
		t.Errorf("expected nil due to spread guard, got %+v", got)
	}
}

func TestScan_RejectsNonPositiveNet(t *testing.T) {
	spots := []feeds.PriceSource{{Price: 100, Exchange: "binance", Fee: 0.001}}
	// gross = 0.1%, total fee = 0.2% => net <= 0
	perp := &feeds.PerpData{PriceSource: feeds.PriceSource{Price: 100.1, Exchange: "bybit", Fee: 0.001}}

	if got := Scan("BTCUSDT", spots, perp, 5.0); got != nil {
		t.Errorf("expected nil when net<=0, got %+v", got)
	}
}

func TestScan_ReturnsBestDirection(t *testing.T) {
	spots := []feeds.PriceSource{
		{Price: 100, Exchange: "binance", Fee: 0.001},
		{Price: 101, Exchange: "mexc", Fee: 0.001},
	}
	perp := &feeds.PerpData{PriceSource: feeds.PriceSource{Price: 103, Exchange: "bybit", Fee: 0.001}}

	got := Scan("ETHUSDT", spots, perp, 10.0)
	if got == nil {
		t.Fatal("expected opportunity, got nil")
	}
	if got.Strategy != "perps" {
		t.Errorf("Strategy: want perps got %q", got.Strategy)
	}
	if !got.IsPerp {
		t.Error("IsPerp should be true")
	}
	// Best should buy cheapest (binance 100) and sell highest (bybit 103)
	if got.BuyExchange != "binance" || got.SellExchange != "bybit" {
		t.Errorf("unexpected legs: buy=%s sell=%s", got.BuyExchange, got.SellExchange)
	}
	if got.NetPct <= 0 {
		t.Errorf("NetPct should be positive, got %v", got.NetPct)
	}
	if got.SafetyFactor < minSafetyFactor {
		t.Errorf("SafetyFactor %v below min %v", got.SafetyFactor, minSafetyFactor)
	}
}

func TestScan_PerpToSpotDirection(t *testing.T) {
	// Perp is cheaper than spot -> buy perp / sell spot should be chosen.
	spots := []feeds.PriceSource{{Price: 105, Exchange: "binance", Fee: 0.001}}
	perp := &feeds.PerpData{PriceSource: feeds.PriceSource{Price: 100, Exchange: "bybit", Fee: 0.001}}

	got := Scan("BTCUSDT", spots, perp, 10.0)
	if got == nil {
		t.Fatal("expected opportunity")
	}
	if got.BuyExchange != "bybit" || got.SellExchange != "binance" {
		t.Errorf("unexpected direction: buy=%s sell=%s", got.BuyExchange, got.SellExchange)
	}
}

func TestScan_RejectsZeroOrNegativeMinPrice(t *testing.T) {
	spots := []feeds.PriceSource{{Price: 0, Exchange: "binance", Fee: 0.001}}
	perp := &feeds.PerpData{PriceSource: feeds.PriceSource{Price: 100, Exchange: "bybit", Fee: 0.001}}

	if got := Scan("BTCUSDT", spots, perp, 10.0); got != nil {
		t.Errorf("expected nil with invalid min price, got %+v", got)
	}
}
