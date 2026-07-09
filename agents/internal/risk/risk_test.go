package risk

import (
	"math"
	"testing"
)

func TestCalculateAdaptiveLeverage_Base(t *testing.T) {
	// equity == initialCapital → growthFactor = 1 → log2(1)=0 → baseLev=3
	// netProfitPct = 0.05 → marginScale = 1 → leverage = round(3*1) = 3
	got := CalculateAdaptiveLeverage(1000, 0.05, 1000)
	if got != 3 {
		t.Errorf("expected leverage 3 at baseline, got %v", got)
	}
}

func TestCalculateAdaptiveLeverage_Growth(t *testing.T) {
	// equity 2x → growthFactor=2 → log2(2)=1 → baseLev=3+floor(3)=6
	// netProfitPct = 0.10 → marginScale = min(2, 0.10/0.05) = 2
	// leverage = round(6 * max(0.5, 2)) = round(12) = 12
	got := CalculateAdaptiveLeverage(2000, 0.10, 1000)
	if got != 12 {
		t.Errorf("expected leverage 12 at 2x growth, got %v", got)
	}
}

func TestCalculateAdaptiveLeverage_Cap(t *testing.T) {
	// Very large equity should be capped at maxLeverage (20)
	got := CalculateAdaptiveLeverage(1_000_000, 0.50, 1000)
	if got > maxLeverage {
		t.Errorf("leverage %v exceeds maxLeverage %v", got, maxLeverage)
	}
}

func TestCalculateAdaptiveLeverage_Floor(t *testing.T) {
	// Even with zero profit margin, floor is 2
	got := CalculateAdaptiveLeverage(1000, 0, 1000)
	if got < 2 {
		t.Errorf("leverage %v below minimum of 2", got)
	}
}

func TestCalculateAdaptiveLeverage_ZeroInitialCapital(t *testing.T) {
	// initialCapital=0 → falls back to baseCapitalUSD (1000)
	// Should not panic or return NaN
	got := CalculateAdaptiveLeverage(1000, 0.05, 0)
	if math.IsNaN(got) || math.IsInf(got, 0) {
		t.Errorf("expected finite leverage, got %v", got)
	}
	if got < 2 || got > maxLeverage {
		t.Errorf("leverage %v out of valid range [2, %v]", got, maxLeverage)
	}
}

func TestCalculatePositionSize_Basic(t *testing.T) {
	// With equity=1000, winRate=0.6, rr=2 → should return a positive size
	got := CalculatePositionSize(1000, 0.6, 2.0)
	if got <= 0 {
		t.Errorf("expected positive position size, got %v", got)
	}
}

func TestCalculatePositionSize_CapAtEquityFraction(t *testing.T) {
	// Large equity: position must not exceed maxPositionEquityFraction of equity
	equity := 100_000.0
	got := CalculatePositionSize(equity, 0.7, 3.0)
	cap := equity * MaxPositionEquityFraction
	if got > cap+1e-9 {
		t.Errorf("position %v exceeds equity cap %v", got, cap)
	}
}

func TestCalculatePositionSize_PoorWinRate(t *testing.T) {
	// winRate ≤ 0.5 → Kelly fraction = 0 → position uses logSize path only
	got := CalculatePositionSize(1000, 0.40, 1.5)
	if got <= 0 {
		t.Errorf("expected positive position size for logSize path, got %v", got)
	}
}

func TestCalculatePositionSize_RRBelow1(t *testing.T) {
	// riskRewardRatio ≤ 1 → Kelly fraction = 0 → uses logSize only
	got := CalculatePositionSize(1000, 0.65, 0.8)
	if got <= 0 {
		t.Errorf("expected positive position size, got %v", got)
	}
}

func TestCalculatePositionSize_NeverNegative(t *testing.T) {
	cases := [][3]float64{
		{0, 0, 0},
		{500, 0.3, 0.5},
		{1e6, 0.99, 10},
	}
	for _, c := range cases {
		got := CalculatePositionSize(c[0], c[1], c[2])
		if got < 0 {
			t.Errorf("equity=%v wr=%v rr=%v → negative size %v", c[0], c[1], c[2], got)
		}
	}
}

func TestMaxPositionEquityFraction_Exported(t *testing.T) {
	if MaxPositionEquityFraction != maxPositionEquityFraction {
		t.Error("exported constant mismatch")
	}
	if MaxPositionEquityFraction <= 0 || MaxPositionEquityFraction >= 1 {
		t.Errorf("unexpected equity fraction %v", MaxPositionEquityFraction)
	}
}
