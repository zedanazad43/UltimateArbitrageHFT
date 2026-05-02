// Package perps implements the perpetuals-vs-spot arbitrage strategy.
// When a perpetual's price diverges from spot (e.g. due to high funding),
// a delta-neutral position (long spot + short perp) captures the spread.
package perps

import (
	"strings"

	"github.com/zedanazad43/UltimateArbitrageHFT/hft/internal/feeds"
	"github.com/zedanazad43/UltimateArbitrageHFT/hft/internal/strategies/cex"
)

const minSafetyFactor = 0.4

// Scan evaluates all spot sources against a single perp source and returns
// the most profitable direction (spot→perp or perp→spot).
func Scan(symbol string, spotSources []feeds.PriceSource, perpSource *feeds.PerpData, maxSpreadPct float64) *cex.Opportunity {
	if perpSource == nil || len(spotSources) == 0 {
		return nil
	}

	// Spread guard across all sources (spot + perp).
	priceMin, priceMax := perpSource.Price, perpSource.Price
	for _, s := range spotSources {
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
	spread := ((priceMax - priceMin) / priceMin) * 100
	if spread > maxSpreadPct {
		return nil
	}

	perpPS := feeds.PriceSource{
		Price:    perpSource.Price,
		Exchange: perpSource.Exchange,
		Fee:      perpSource.Fee,
	}

	var best *cex.Opportunity
	for _, spot := range spotSources {
		for _, pair := range [][2]feeds.PriceSource{{spot, perpPS}, {perpPS, spot}} {
			buy, sell := pair[0], pair[1]
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
				best = &cex.Opportunity{
					Strategy:     "perps",
					Symbol:       symbol,
					BuyExchange:  buy.Exchange,
					SellExchange: sell.Exchange,
					BuyPrice:     buy.Price,
					SellPrice:    sell.Price,
					GrossPct:     grossPct,
					NetPct:       netPct,
					SafetyFactor: safetyFactor,
					Direction:    strings.ToUpper(buy.Exchange) + "→" + strings.ToUpper(sell.Exchange),
					IsPerp:       true,
				}
			}
		}
	}
	return best
}
