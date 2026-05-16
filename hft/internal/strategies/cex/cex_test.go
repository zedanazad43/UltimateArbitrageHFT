package cex

import (
	"testing"

	"github.com/zedanazad43/UltimateArbitrageHFT/hft/internal/feeds"
)

func makeSources(prices ...float64) []feeds.PriceSource {
	exchanges := []string{"binance", "mexc", "bybit", "okx"}
	out := make([]feeds.PriceSource, len(prices))
	for i, p := range prices {
		out[i] = feeds.PriceSource{
			Price:    p,
			Exchange: exchanges[i%len(exchanges)],
			Fee:      0.001, // 0.1% taker fee
		}
	}
	return out
}

func TestScan_NilOnInsufficientSources(t *testing.T) {
	cases := [][]feeds.PriceSource{
		nil,
		{},
		{{Price: 100, Exchange: "binance", Fee: 0.001}},
	}
	for _, sources := range cases {
		if got := Scan("BTCUSDT", sources, 10); got != nil {
			t.Errorf("Scan with %d sources: expected nil, got %+v", len(sources), got)
		}
	}
}

func TestScan_NilOnZeroPrice(t *testing.T) {
	sources := makeSources(0, 100)
	if got := Scan("BTCUSDT", sources, 10); got != nil {
		t.Errorf("expected nil on zero price, got %+v", got)
	}
}

func TestScan_SpreadGuardTrips(t *testing.T) {
	// maxSpreadPct = 1, observed spread = 5% → guard should trip → nil
	sources := makeSources(100, 105)
	if got := Scan("BTCUSDT", sources, 1.0); got != nil {
		t.Errorf("spread guard should have triggered, got %+v", got)
	}
}

func TestScan_ProfitableOpportunity(t *testing.T) {
	// buy at 100 (mexc), sell at 100.5 (binance) → gross = 0.5%
	// net after 2x fee (0.1% each side) = 0.5 - 0.2 = 0.3%
	// safetyFactor = 0.3/0.5 = 0.6 ≥ minSafetyFactor(0.4) → should find opp
	sources := []feeds.PriceSource{
		{Price: 100.5, Exchange: "binance", Fee: 0.001},
		{Price: 100.0, Exchange: "mexc", Fee: 0.001},
	}
	got := Scan("BTCUSDT", sources, 5.0)
	if got == nil {
		t.Fatal("expected opportunity, got nil")
	}
	if got.Symbol != "BTCUSDT" {
		t.Errorf("Symbol: want BTCUSDT got %q", got.Symbol)
	}
	if got.BuyExchange != "mexc" {
		t.Errorf("BuyExchange: want mexc got %q", got.BuyExchange)
	}
	if got.SellExchange != "binance" {
		t.Errorf("SellExchange: want binance got %q", got.SellExchange)
	}
	if got.NetPct <= 0 {
		t.Errorf("NetPct should be positive, got %v", got.NetPct)
	}
	if got.SafetyFactor < minSafetyFactor {
		t.Errorf("SafetyFactor %v below minSafetyFactor %v", got.SafetyFactor, minSafetyFactor)
	}
	if got.Strategy != "cex" {
		t.Errorf("Strategy: want cex got %q", got.Strategy)
	}
}

func TestScan_SelectsBestOpportunity(t *testing.T) {
	// Three sources: small spread between binance/bybit, bigger spread between mexc/bybit
	sources := []feeds.PriceSource{
		{Price: 100.0, Exchange: "binance", Fee: 0.001},
		{Price: 99.5, Exchange: "mexc", Fee: 0.001},   // cheapest → buy here
		{Price: 100.5, Exchange: "bybit", Fee: 0.001}, // most expensive → sell here
	}
	got := Scan("ETHUSDT", sources, 10.0)
	if got == nil {
		t.Fatal("expected opportunity, got nil")
	}
	// Best: buy mexc (99.5), sell bybit (100.5) → gross = 1%
	if got.BuyExchange != "mexc" {
		t.Errorf("BuyExchange: want mexc got %q", got.BuyExchange)
	}
	if got.SellExchange != "bybit" {
		t.Errorf("SellExchange: want bybit got %q", got.SellExchange)
	}
}

func TestScan_SafetyFactorBelowThreshold(t *testing.T) {
	// Gross spread 0.1% but fees eat it → safetyFactor < 0.4 → no opportunity
	sources := []feeds.PriceSource{
		{Price: 100.1, Exchange: "binance", Fee: 0.001},
		{Price: 100.0, Exchange: "mexc", Fee: 0.001},
	}
	// net = 0.1 - 0.2 = -0.1 → negative → no opportunity
	got := Scan("BTCUSDT", sources, 5.0)
	if got != nil {
		t.Errorf("expected nil (safety factor too low), got %+v", got)
	}
}

func TestScan_IsNotPerp(t *testing.T) {
	sources := []feeds.PriceSource{
		{Price: 102.0, Exchange: "binance", Fee: 0.001},
		{Price: 100.0, Exchange: "mexc", Fee: 0.001},
	}
	got := Scan("BTCUSDT", sources, 10.0)
	if got == nil {
		t.Fatal("expected opportunity")
	}
	if got.IsPerp {
		t.Error("CEX spot scan should set IsPerp=false")
	}
}
