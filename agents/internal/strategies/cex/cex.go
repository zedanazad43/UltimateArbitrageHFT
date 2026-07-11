// Package cex implements the CEX spatial arbitrage strategy.
// It finds the best buy/sell pair across multiple exchange price sources for
// a given symbol, applying spread guards and safety-factor checks ported
// directly from the original JavaScript implementation.
package cex

import (
	"strings"

	"github.com/zedanazad43/UltimateArbitrageHFT/hft/internal/feeds"
)

const minSafetyFactor = 0.4 // net/gross must be ≥ 40%

// Opportunity represents a single CEX arbitrage opportunity.
type Opportunity struct {
	Strategy     string
	Symbol       string
	BuyExchange  string
	SellExchange string
	BuyPrice     float64
	SellPrice    float64
	GrossPct     float64
	NetPct       float64
	SafetyFactor float64
	Direction    string
	IsPerp       bool
}

// Scan finds the highest net-profit CEX arbitrage opportunity for the given
// symbol across all provided price sources.  Returns nil when there is no
// profitable opportunity or when the spread guard trips.
//
// maxSpreadPct is a volatility guard: if the observed spread across all
// sources exceeds this value the scan is skipped (stale or erroneous data).
func Scan(symbol string, sources []feeds.PriceSource, maxSpreadPct float64) *Opportunity {
	if len(sources) < 2 {
		return nil
	}

	// Compute observed spread for the volatility guard.
	priceMin, priceMax := sources[0].Price, sources[0].Price
	for _, s := range sources[1:] {
		if s.Price < priceMin {
			priceMin = s.Price
		}
		if s.Price > priceMax {
			priceMax = s.Price
		}
	}
	if priceMin <= 0 {
		return nil
	}
	observedSpread := ((priceMax - priceMin) / priceMin) * 100
	if observedSpread > maxSpreadPct {
		return nil
	}

	var best *Opportunity
	for i := range sources {
		for j := range sources {
			if i == j {
				continue
			}
			buy := sources[i]
			sell := sources[j]
			if sell.Price <= buy.Price {
				continue
			}
			grossPct := ((sell.Price - buy.Price) / buy.Price) * 100
			totalFeePct := (buy.Fee + sell.Fee) * 100
			netPct := grossPct - totalFeePct
			if netPct <= 0 {
				continue
			}
			safetyFactor := netPct / grossPct
			if safetyFactor < minSafetyFactor {
				continue
			}
			if best == nil || netPct > best.NetPct {
				best = &Opportunity{
					Strategy:     "cex",
					Symbol:       symbol,
					BuyExchange:  buy.Exchange,
					SellExchange: sell.Exchange,
					BuyPrice:     buy.Price,
					SellPrice:    sell.Price,
					GrossPct:     grossPct,
					NetPct:       netPct,
					SafetyFactor: safetyFactor,
					Direction:    strings.ToUpper(buy.Exchange) + "→" + strings.ToUpper(sell.Exchange),
					IsPerp:       false,
				}
			}
		}
	}
	return best
}
