// Package triangular implements triangular arbitrage detection across CEX.
// Example: BTC → ETH → USD → BTC via three trades on different pairs.
package triangular

import (
	"github.com/zedanazad43/UltimateArbitrageHFT/hft/internal/feeds"
)

// Opportunity represents a triangular arb opportunity.
type Opportunity struct {
	Path       [3]string  // [BASE, QUOTE1, QUOTE2] e.g., [BTC, ETH, USD]
	Exchanges  [3]string  // [Ex1, Ex2, Ex3]
	Prices     [3]float64 // Entry prices for each leg
	GrossPct   float64    // Gross profit % before fees
	NetPct     float64    // Net profit % after fees
	StartAsset float64    // Initial amount to trade
	EndAsset   float64    // Final amount after all legs
}

// Scan evaluates all possible triangular paths and returns profitable ones.
func Scan(spotSources map[string][]feeds.PriceSource, maxSpreadPct float64) []*Opportunity {
	// For now, return empty as a placeholder.
	// Full implementation would:
	// 1. Enumerate all symbol triplets
	// 2. For each triplet, find best prices across exchanges
	// 3. Simulate execution path
	// 4. Filter by profitability
	return nil
}
