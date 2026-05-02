// Package risk implements position sizing and leverage calculation.
// All logic is ported directly from the original JavaScript risk.js.
package risk

import "math"

const (
	baseCapitalUSD            = 1000.0
	basePositionUSD           = 200.0
	maxPositionUSD            = 2000.0
	maxLeverage               = 20.0
	maxPositionEquityFraction = 0.20
)

// CalculateAdaptiveLeverage returns the leverage to apply for a perp trade.
// Base 3x, grows logarithmically with capital, capped at maxLeverage (20x).
// Also scales with the observed net profit margin.
func CalculateAdaptiveLeverage(equity, netProfitPct, initialCapital float64) float64 {
	if initialCapital <= 0 {
		initialCapital = baseCapitalUSD
	}
	growthFactor := math.Max(1, equity/initialCapital)
	baseLev := 3.0 + math.Floor(math.Log2(growthFactor)*3)
	marginScale := math.Min(2.0, netProfitPct/0.05) // 0.05% as reference
	leverage := math.Round(baseLev * math.Max(0.5, marginScale))
	return math.Max(2, math.Min(maxLeverage, leverage))
}

// CalculatePositionSize returns the USDT position size for a trade using a
// Kelly-adjusted, auto-compounding formula.  The result is capped at
// maxPositionEquityFraction of equity to bound tail risk.
func CalculatePositionSize(equity, winRate, riskRewardRatio float64) float64 {
	gf := math.Log(1+equity/baseCapitalUSD) / math.Log(2)
	logSize := math.Min(maxPositionUSD, basePositionUSD*(1+gf))

	var kellyFraction float64
	if winRate > 0.5 && riskRewardRatio > 1 {
		kellyFraction = winRate - (1-winRate)/riskRewardRatio
		kellyFraction = math.Max(0, math.Min(0.25, kellyFraction))
	}
	kellySize := equity * kellyFraction * 0.2 // 20% Kelly fraction
	raw := logSize
	if kellySize > 0 {
		raw = math.Min(logSize, kellySize)
	}
	// Hard cap: never risk more than maxPositionEquityFraction of equity.
	return math.Min(raw, equity*maxPositionEquityFraction)
}

// MaxPositionEquityFraction is exported so callers can reference the constant.
const MaxPositionEquityFraction = maxPositionEquityFraction
