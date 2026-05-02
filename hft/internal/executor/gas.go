// gas.go — EIP-1559 gas oracle
// Subscribes to new block headers to track the current base fee and recommends
// maxFeePerGas / maxPriorityFeePerGas values for on-chain transactions.
package executor

import (
	"context"
	"log/slog"
	"math/big"
	"sync"
	"sync/atomic"
	"time"

	"github.com/ethereum/go-ethereum/core/types"
	"github.com/ethereum/go-ethereum/ethclient"
)

// GasOracle tracks the latest on-chain gas prices.
type GasOracle struct {
	// baseFeeWei holds the last observed base fee (atomic int64, storing Gwei*1e9).
	baseFeeWei atomic.Int64
	// minPriorityFeeGwei is the minimum tip to include (default 1 Gwei).
	minPriorityFeeGwei int64

	mu      sync.RWMutex
	lastAt  time.Time
}

// NewGasOracle creates a GasOracle with the given minimum priority fee (in Gwei).
func NewGasOracle(minPriorityGwei int64) *GasOracle {
	g := &GasOracle{minPriorityFeeGwei: minPriorityGwei}
	g.baseFeeWei.Store(20 * 1e9) // 20 Gwei default
	return g
}

// Run subscribes to new block headers on the given client and updates the
// oracle on every block.  It reconnects automatically on errors.
func (g *GasOracle) Run(ctx context.Context, client *ethclient.Client) {
	headers := make(chan *types.Header, 4)
	sub, err := client.SubscribeNewHead(ctx, headers)
	if err != nil {
		slog.Warn("gas oracle: subscribe failed, polling instead", "err", err)
		go g.poll(ctx, client)
		return
	}
	go func() {
		for {
			select {
			case <-ctx.Done():
				sub.Unsubscribe()
				return
			case err := <-sub.Err():
				slog.Warn("gas oracle: subscription error, polling", "err", err)
				go g.poll(ctx, client)
				return
			case header := <-headers:
				if header.BaseFee != nil {
					g.baseFeeWei.Store(header.BaseFee.Int64())
					g.mu.Lock()
					g.lastAt = time.Now()
					g.mu.Unlock()
				}
			}
		}
	}()
}

func (g *GasOracle) poll(ctx context.Context, client *ethclient.Client) {
	for {
		select {
		case <-ctx.Done():
			return
		case <-time.After(12 * time.Second): // ~1 block
		}
		block, err := client.BlockByNumber(ctx, nil)
		if err != nil || block == nil || block.BaseFee() == nil {
			continue
		}
		g.baseFeeWei.Store(block.BaseFee().Int64())
		g.mu.Lock()
		g.lastAt = time.Now()
		g.mu.Unlock()
	}
}

// SuggestFeeCap returns EIP-1559 maxFeePerGas and maxPriorityFeePerGas values
// as *big.Int (in wei).
//
// maxFeePerGas = 2 × baseFee + priorityFee
// (2× multiplier ensures inclusion even when the base fee rises by 12.5% per block)
func (g *GasOracle) SuggestFeeCap() (maxFeePerGas, priorityFee *big.Int) {
	baseFee := new(big.Int).SetInt64(g.baseFeeWei.Load())
	prio := new(big.Int).SetInt64(g.minPriorityFeeGwei * 1e9) // Gwei → wei

	// maxFee = 2 * baseFee + priorityFee
	maxFee := new(big.Int).Mul(baseFee, big.NewInt(2))
	maxFee.Add(maxFee, prio)
	return maxFee, prio
}

// BaseFeeGwei returns the current base fee in Gwei (human-readable).
func (g *GasOracle) BaseFeeGwei() float64 {
	return float64(g.baseFeeWei.Load()) / 1e9
}

// GasCostUSD estimates the USD cost of a swap that uses gasUnits gas,
// given the current ETH price in USD.
//
//	gasUnits: e.g. 100_000 for a Uniswap V3 swap
//	ethUSD:   current ETH price
func (g *GasOracle) GasCostUSD(gasUnits int64, ethUSD float64) float64 {
	maxFee, prio := g.SuggestFeeCap()
	// effective fee = min(maxFee, baseFee + prio)
	baseFee := new(big.Int).SetInt64(g.baseFeeWei.Load())
	effective := new(big.Int).Add(baseFee, prio)
	if effective.Cmp(maxFee) > 0 {
		effective = maxFee
	}
	weiCost := new(big.Int).Mul(effective, big.NewInt(gasUnits))
	ethCost := new(big.Float).Quo(
		new(big.Float).SetInt(weiCost),
		new(big.Float).SetFloat64(1e18),
	)
	ethF, _ := ethCost.Float64()
	return ethF * ethUSD
}
