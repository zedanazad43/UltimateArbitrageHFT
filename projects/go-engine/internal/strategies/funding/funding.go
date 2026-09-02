// Package funding implements the funding-rate harvest strategy.
// When a perpetual's 8-hour funding rate is large enough to cover round-trip
// fees, holding a delta-neutral position (long spot + short perp, or vice-versa)
// generates risk-free yield.
package funding

import (
	"fmt"
	"math"

	"github.com/zedanazad43/UltimateArbitrageHFT/hft/internal/feeds"
	"github.com/zedanazad43/UltimateArbitrageHFT/hft/internal/strategies/cex"
)

const (
	// minFundingRate is the minimum |fundingRate| to consider.
	// 0.0001 = 0.01% per 8-hour period ≈ 10.95% APY.
	minFundingRate = 0.0001
	// maxFundingRate caps rates that are likely to revert before settlement.
	maxFundingRate = 0.01
	// maxDivergencePct caps the spot-vs-perp price divergence.
	maxDivergencePct = 2.0
)

// Opportunity extends cex.Opportunity with funding-specific fields.
type Opportunity struct {
	*cex.Opportunity
	FundingRate    float64
	PerpSide       string // "LONG" or "SHORT"
	FundingHarvest bool
}

// Scan evaluates whether a funding-rate harvest trade is worthwhile.
// It returns nil when there is no actionable opportunity.
func Scan(symbol string, spotSources []feeds.PriceSource, perpData *feeds.PerpData, maxSpreadPct float64) *Opportunity {
	if perpData == nil || len(spotSources) == 0 {
		return nil
	}

	fundingRate := perpData.FundingRate
	absFunding := math.Abs(fundingRate)

	if absFunding < minFundingRate || absFunding > maxFundingRate {
		return nil
	}

	// Use cheapest spot source.
	bestSpot := spotSources[0]
	for _, s := range spotSources[1:] {
		if s.Price < bestSpot.Price {
			bestSpot = s
		}
	}

	// Reject if spot and perp price diverge suspiciously.
	divergencePct := math.Abs(perpData.Price-bestSpot.Price) / bestSpot.Price * 100
	limit := math.Min(maxSpreadPct, maxDivergencePct)
	if divergencePct > limit {
		return nil
	}

	// P&L per period = |fundingRate| - round-trip taker fees (enter + exit, both legs).
	roundTripFeePct := (bestSpot.Fee + perpData.Fee) * 2 * 100
	fundingPct := absFunding * 100
	netPct := fundingPct - roundTripFeePct

	if netPct <= 0 || fundingPct == 0 {
		return nil
	}
	safetyFactor := netPct / fundingPct

	// Positive funding → shorts receive payment → go long spot + short perp.
	// Negative funding → longs receive payment  → go short spot + long perp.
	receiveFunding := fundingRate >= 0
	perpSide := "LONG"
	if receiveFunding {
		perpSide = "SHORT"
	}
	buyExchange, sellExchange := perpData.Exchange, bestSpot.Exchange
	buyPrice, sellPrice := perpData.Price, bestSpot.Price
	if receiveFunding {
		buyExchange, sellExchange = bestSpot.Exchange, perpData.Exchange
		buyPrice, sellPrice = bestSpot.Price, perpData.Price
	}

	return &Opportunity{
		Opportunity: &cex.Opportunity{
			Strategy:     "funding",
			Symbol:       symbol,
			BuyExchange:  buyExchange,
			SellExchange: sellExchange,
			BuyPrice:     buyPrice,
			SellPrice:    sellPrice,
			GrossPct:     fundingPct,
			NetPct:       netPct,
			SafetyFactor: safetyFactor,
			Direction:    fmt.Sprintf("SPOT→%s %s (funding harvest)", perpData.Exchange, perpSide),
			IsPerp:       true,
		},
		FundingRate:    fundingRate,
		PerpSide:       perpSide,
		FundingHarvest: true,
	}
}
