package funding

import (
	"math"
	"testing"

	"github.com/zedanazad43/UltimateArbitrageHFT/hft/internal/feeds"
)

func TestScan_NilGuards(t *testing.T) {
	if got := Scan("BTCUSDT", nil, nil, 1.0); got != nil {
		t.Errorf("expected nil when inputs are nil, got %+v", got)
	}
	if got := Scan("BTCUSDT", []feeds.PriceSource{}, &feeds.PerpData{}, 1.0); got != nil {
		t.Errorf("expected nil when spotSources empty, got %+v", got)
	}
	if got := Scan("BTCUSDT", []feeds.PriceSource{{Price: 100, Exchange: "binance", Fee: 0.001}}, nil, 1.0); got != nil {
		t.Errorf("expected nil when perpData nil, got %+v", got)
	}
}

func TestScan_FundingRateBounds(t *testing.T) {
	spot := []feeds.PriceSource{{Price: 100, Exchange: "binance", Fee: 0.001}}

	belowMin := &feeds.PerpData{PriceSource: feeds.PriceSource{Price: 100, Exchange: "bybit", Fee: 0.001}, FundingRate: minFundingRate * 0.5}
	if got := Scan("BTCUSDT", spot, belowMin, 2.0); got != nil {
		t.Errorf("expected nil below min funding, got %+v", got)
	}

	aboveMax := &feeds.PerpData{PriceSource: feeds.PriceSource{Price: 100, Exchange: "bybit", Fee: 0.001}, FundingRate: maxFundingRate * 1.1}
	if got := Scan("BTCUSDT", spot, aboveMax, 2.0); got != nil {
		t.Errorf("expected nil above max funding, got %+v", got)
	}
}

func TestScan_DivergenceGuard(t *testing.T) {
	spot := []feeds.PriceSource{{Price: 100, Exchange: "binance", Fee: 0.001}}
	perp := &feeds.PerpData{PriceSource: feeds.PriceSource{Price: 103, Exchange: "bybit", Fee: 0.001}, FundingRate: 0.001}

	// divergence=3%, limit=min(maxSpreadPct=1, maxDivergencePct=2)=1 -> reject
	if got := Scan("BTCUSDT", spot, perp, 1.0); got != nil {
		t.Errorf("expected nil due to divergence guard, got %+v", got)
	}
}

func TestScan_RejectsWhenNetNonPositive(t *testing.T) {
	spot := []feeds.PriceSource{{Price: 100, Exchange: "binance", Fee: 0.001}}
	// funding 0.01% ; round-trip fees = (0.1%+0.1%)*2 = 0.4% -> net negative
	perp := &feeds.PerpData{PriceSource: feeds.PriceSource{Price: 100, Exchange: "bybit", Fee: 0.001}, FundingRate: minFundingRate}
	if got := Scan("BTCUSDT", spot, perp, 2.0); got != nil {
		t.Errorf("expected nil when net<=0, got %+v", got)
	}
}

func TestScan_PositiveFunding_BuildsOpportunity(t *testing.T) {
	spots := []feeds.PriceSource{
		{Price: 101, Exchange: "binance", Fee: 0.0008},
		{Price: 100, Exchange: "mexc", Fee: 0.0005}, // cheapest should be selected
	}
	perp := &feeds.PerpData{PriceSource: feeds.PriceSource{Price: 100.2, Exchange: "bybit", Fee: 0.0005}, FundingRate: 0.005}

	got := Scan("ETHUSDT", spots, perp, 2.0)
	if got == nil {
		t.Fatal("expected opportunity, got nil")
	}
	if got.Strategy != "funding" {
		t.Errorf("Strategy: want funding got %q", got.Strategy)
	}
	if got.PerpSide != "SHORT" {
		t.Errorf("PerpSide for positive funding: want SHORT got %q", got.PerpSide)
	}
	if !got.FundingHarvest {
		t.Error("FundingHarvest should be true")
	}
	if got.BuyExchange != "mexc" || got.SellExchange != "bybit" {
		t.Errorf("unexpected legs: buy=%s sell=%s", got.BuyExchange, got.SellExchange)
	}
	if got.NetPct <= 0 {
		t.Errorf("NetPct should be positive, got %v", got.NetPct)
	}
	if got.SafetyFactor <= 0 || got.SafetyFactor > 1 {
		t.Errorf("SafetyFactor should be in (0,1], got %v", got.SafetyFactor)
	}
}

func TestScan_NegativeFunding_BuildsOpportunity(t *testing.T) {
	spots := []feeds.PriceSource{{Price: 100, Exchange: "binance", Fee: 0.0005}}
	perp := &feeds.PerpData{PriceSource: feeds.PriceSource{Price: 99.8, Exchange: "bybit", Fee: 0.0005}, FundingRate: -0.004}

	got := Scan("BTCUSDT", spots, perp, 2.0)
	if got == nil {
		t.Fatal("expected opportunity, got nil")
	}
	if got.PerpSide != "LONG" {
		t.Errorf("PerpSide for negative funding: want LONG got %q", got.PerpSide)
	}
	if got.BuyExchange != "bybit" || got.SellExchange != "binance" {
		t.Errorf("unexpected legs: buy=%s sell=%s", got.BuyExchange, got.SellExchange)
	}
	if math.Abs(got.FundingRate-(-0.004)) > 1e-12 {
		t.Errorf("FundingRate mismatch: got %v", got.FundingRate)
	}
}
