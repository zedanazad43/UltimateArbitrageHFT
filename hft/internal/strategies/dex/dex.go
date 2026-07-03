// Package dex implements the DEX cross-chain arbitrage strategy.
// It compares token prices between Ethereum mainnet (via Alchemy) and BSC
// (via PancakeSwap) for multiple token pairs, returning the best opportunity
// when the net spread after bridge/gas costs exceeds zero.
package dex

import (
	"encoding/json"
	"fmt"
	"io"
	"math"
	"net/http"
	"strconv"
	"sync"

	"github.com/zedanazad43/UltimateArbitrageHFT/hft/internal/strategies/cex"
)

const (
	minSpreadPct  = 0.5 // minimum gross spread to consider
	bridgeCostPct = 0.2 // estimated bridge + gas cost (percentage of trade size)
)

// token defines a cross-chain arbitrage pair.
// alchemySymbol is the symbol used in the Alchemy Prices API (ETH, BTC, BNB).
// bscAddress is the BEP-20 token address on BSC used to query PancakeSwap.
type token struct {
	symbol        string // opportunity symbol (e.g. ETHUSDT)
	alchemySymbol string
	bscAddress    string
}

// dexTokens lists all token pairs scanned for ETH↔BSC cross-chain arbitrage.
//
// BSC addresses:
//
//	WETH:  0x2170ed0880ac9a755fd29b2688956bd959f933f8 (Binance-Peg ETH)
//	BTC:   0x7130d2a12b9bcbfae4f2634d864a1ee1ce3ead9c (Binance-Peg BTC)
//	WBNB:  0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c
var dexTokens = []token{
	{
		symbol:        "ETHUSDT",
		alchemySymbol: "ETH",
		bscAddress:    "0x2170ed0880ac9a755fd29b2688956bd959f933f8",
	},
	{
		symbol:        "BTCUSDT",
		alchemySymbol: "BTC",
		bscAddress:    "0x7130d2a12b9bcbfae4f2634d864a1ee1ce3ead9c",
	},
	{
		symbol:        "BNBUSDT",
		alchemySymbol: "BNB",
		bscAddress:    "0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c",
	},
}

// alchemyBaseURL and pancakeBaseURL are package-level vars so tests can
// substitute httptest servers without touching production code paths.
var (
	alchemyBaseURL = "https://api.g.alchemy.com/prices/v1"
	pancakeBaseURL = "https://api.pancakeswap.info/api/v2/tokens"
)

// Scan fetches prices for all supported tokens from Ethereum (Alchemy) and BSC
// (PancakeSwap) concurrently, then returns the cross-chain DEX arbitrage
// opportunity with the highest net profit, or nil when none are actionable.
//
// alchemyKey may be a raw API key or a full Alchemy endpoint URL.
func Scan(alchemyKey string) (*cex.Opportunity, error) {
	if alchemyKey == "" {
		return nil, nil
	}

	type result struct {
		opp *cex.Opportunity
		err error
	}

	ch := make(chan result, len(dexTokens))
	var wg sync.WaitGroup

	for _, t := range dexTokens {
		wg.Add(1)
		go func(tok token) {
			defer wg.Done()
			opp, err := scanPair(alchemyKey, tok)
			ch <- result{opp, err}
		}(t)
	}

	wg.Wait()
	close(ch)

	// Select the opportunity with the highest netPct.
	var best *cex.Opportunity
	var firstErr error
	for r := range ch {
		if r.err != nil && firstErr == nil {
			firstErr = r.err
		}
		if r.opp == nil {
			continue
		}
		if best == nil || r.opp.NetPct > best.NetPct {
			best = r.opp
		}
	}
	if best != nil {
		return best, nil
	}
	// Return the first error only when all pairs failed (no opportunity surfaced).
	return nil, firstErr
}

// scanPair evaluates a single token pair for a cross-chain DEX opportunity.
func scanPair(alchemyKey string, tok token) (*cex.Opportunity, error) {
	type priceResult struct {
		price float64
		err   error
	}

	ethCh := make(chan priceResult, 1)
	bscCh := make(chan priceResult, 1)

	go func() {
		p, err := getAlchemyPrice(alchemyKey, tok.alchemySymbol)
		ethCh <- priceResult{p, err}
	}()
	go func() {
		p, err := getPancakePrice(tok.bscAddress)
		bscCh <- priceResult{p, err}
	}()

	ethRes := <-ethCh
	bscRes := <-bscCh

	if ethRes.err != nil || bscRes.err != nil {
		return nil, fmt.Errorf("dex %s: eth=%v bsc=%v", tok.symbol, ethRes.err, bscRes.err)
	}
	ethPrice, bscPrice := ethRes.price, bscRes.price
	if ethPrice <= 0 || bscPrice <= 0 {
		return nil, nil
	}

	spreadPct := ((bscPrice - ethPrice) / ethPrice) * 100
	absSpread := math.Abs(spreadPct)
	if absSpread < minSpreadPct {
		return nil, nil
	}
	netPct := absSpread - bridgeCostPct
	if netPct <= 0 {
		return nil, nil
	}

	buyOnEth := spreadPct > 0 // BSC higher → buy on ETH, sell on BSC
	buyExchange, sellExchange := "bsc", "ethereum"
	buyPrice, sellPrice := bscPrice, ethPrice
	direction := "BSC→ETH"
	if buyOnEth {
		buyExchange, sellExchange = "ethereum", "bsc"
		buyPrice, sellPrice = ethPrice, bscPrice
		direction = "ETH→BSC"
	}

	return &cex.Opportunity{
		Strategy:     "dex",
		Symbol:       tok.symbol,
		BuyExchange:  buyExchange,
		SellExchange: sellExchange,
		BuyPrice:     buyPrice,
		SellPrice:    sellPrice,
		GrossPct:     absSpread,
		NetPct:       netPct,
		SafetyFactor: netPct / absSpread,
		Direction:    direction,
		IsPerp:       false,
	}, nil
}

// getAlchemyPrice fetches the current price of a token via the Alchemy Prices API.
// alchemyKey may be a raw API key or a full Alchemy endpoint URL.
func getAlchemyPrice(apiKey, symbol string) (float64, error) {
	key := apiKey
	if len(key) > 40 && key[:4] == "http" {
		parts := splitLast(key, "/")
		key = parts[1]
	}
	url := fmt.Sprintf("%s/%s/tokens/by-symbol?symbols[]=%s", alchemyBaseURL, key, symbol)
	resp, err := http.Get(url) //nolint:noctx // best-effort; timeouts handled by engine
	if err != nil {
		return 0, err
	}
	defer func() { _ = resp.Body.Close() }()
	body, _ := io.ReadAll(resp.Body)
	var result struct {
		Data []struct {
			Prices []struct {
				Value string `json:"value"`
			} `json:"prices"`
		} `json:"data"`
	}
	if err := json.Unmarshal(body, &result); err != nil {
		return 0, err
	}
	if len(result.Data) == 0 || len(result.Data[0].Prices) == 0 {
		return 0, fmt.Errorf("alchemy: missing price for %s", symbol)
	}
	return strconv.ParseFloat(result.Data[0].Prices[0].Value, 64)
}

// getPancakePrice fetches a token price from PancakeSwap's info API.
func getPancakePrice(tokenAddress string) (float64, error) {
	url := pancakeBaseURL + "/" + tokenAddress
	resp, err := http.Get(url) //nolint:noctx
	if err != nil {
		return 0, err
	}
	defer func() { _ = resp.Body.Close() }()
	body, _ := io.ReadAll(resp.Body)
	var result struct {
		Data struct {
			Price string `json:"price"`
		} `json:"data"`
	}
	if err := json.Unmarshal(body, &result); err != nil {
		return 0, err
	}
	return strconv.ParseFloat(result.Data.Price, 64)
}

func splitLast(s, sep string) [2]string {
	i := len(s) - 1
	for i >= 0 && string(s[i]) != sep {
		i--
	}
	if i < 0 {
		return [2]string{s, ""}
	}
	return [2]string{s[:i], s[i+1:]}
}

