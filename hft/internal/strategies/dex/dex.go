// Package dex implements the DEX cross-chain arbitrage strategy.
// It compares ETH prices between Ethereum mainnet (via Alchemy) and BSC
// (via PancakeSwap), returning an opportunity when the net spread after
// bridge/gas costs exceeds zero.
package dex

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strconv"

	"github.com/zedanazad43/UltimateArbitrageHFT/hft/internal/strategies/cex"
)

const (
	wethBSCAddress = "0x2170ed0880ac9a755fd29b2688956bd959f933f8"
	minSpreadPct   = 0.5  // minimum gross spread to consider
	bridgeCostPct  = 0.2  // estimated bridge + gas cost
)

// Scan fetches ETH prices from Ethereum (Alchemy) and BSC (PancakeSwap) and
// returns a cross-chain DEX arbitrage opportunity, or nil.
//
// alchemyKey may be a raw API key or a full Alchemy endpoint URL.
func Scan(alchemyKey string) (*cex.Opportunity, error) {
	if alchemyKey == "" {
		return nil, nil
	}

	type result struct {
		price float64
		err   error
	}

	ethCh := make(chan result, 1)
	bscCh := make(chan result, 1)

	go func() {
		p, err := getAlchemyETHPrice(alchemyKey)
		ethCh <- result{p, err}
	}()
	go func() {
		p, err := getPancakePrice(wethBSCAddress)
		bscCh <- result{p, err}
	}()

	ethRes := <-ethCh
	bscRes := <-bscCh

	if ethRes.err != nil || bscRes.err != nil {
		return nil, fmt.Errorf("dex scan: eth=%v bsc=%v", ethRes.err, bscRes.err)
	}
	ethPrice, bscPrice := ethRes.price, bscRes.price
	if ethPrice <= 0 || bscPrice <= 0 {
		return nil, nil
	}

	spreadPct := ((bscPrice - ethPrice) / ethPrice) * 100
	absSpread := spreadPct
	if absSpread < 0 {
		absSpread = -absSpread
	}
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
		Symbol:       "ETHUSDT",
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

// getAlchemyETHPrice fetches the current ETH/USD price via the Alchemy Prices API.
func getAlchemyETHPrice(apiKey string) (float64, error) {
	// Accept a full URL or a bare API key.
	key := apiKey
	if len(key) > 40 && key[:4] == "http" {
		parts := splitLast(key, "/")
		key = parts[1]
	}
	url := fmt.Sprintf("https://api.g.alchemy.com/prices/v1/%s/tokens/by-symbol?symbols[]=ETH", key)
	resp, err := http.Get(url)
	if err != nil {
		return 0, err
	}
	defer resp.Body.Close()
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
		return 0, fmt.Errorf("alchemy: missing price in response")
	}
	return strconv.ParseFloat(result.Data[0].Prices[0].Value, 64)
}

// getPancakePrice fetches a token price from PancakeSwap's info API.
func getPancakePrice(tokenAddress string) (float64, error) {
	url := "https://api.pancakeswap.info/api/v2/tokens/" + tokenAddress
	resp, err := http.Get(url)
	if err != nil {
		return 0, err
	}
	defer resp.Body.Close()
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
