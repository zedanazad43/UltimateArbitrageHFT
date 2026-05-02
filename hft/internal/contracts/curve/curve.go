// Package curve provides a minimal ABI binding for Curve Finance StableSwap
// pools (the exchange function).
//
// Curve StableSwap pools use the least gas (~60k–80k) for stablecoin swaps
// (USDC/USDT/DAI), making them the preferred venue for stablecoin arbitrage legs.
//
// Common mainnet Curve pool addresses:
//
//	3pool (DAI/USDC/USDT):   0xbEbc44782C7dB0a1A60Cb6fe97d0b483032FF1C7
//	USDC/USDT (2pool):       0xD51a44d3FaE010294C616388b506AcdA1bfAAE46
package curve

import (
	"math/big"
	"strings"

	"github.com/ethereum/go-ethereum/accounts/abi"
	"github.com/ethereum/go-ethereum/common"
)

// Pool3 is the Curve 3pool (DAI/USDC/USDT) address on mainnet.
var Pool3 = common.HexToAddress("0xbEbc44782C7dB0a1A60Cb6fe97d0b483032FF1C7")

// Token indices within the 3pool.
const (
	IndexDAI  = 0
	IndexUSDC = 1
	IndexUSDT = 2
)

var exchangeABI abi.ABI

func init() {
	const abiJSON = `[{
		"name":"exchange",
		"type":"function",
		"stateMutability":"nonpayable",
		"inputs":[
			{"name":"i","type":"int128"},
			{"name":"j","type":"int128"},
			{"name":"dx","type":"uint256"},
			{"name":"min_dy","type":"uint256"}
		],
		"outputs":[{"name":"","type":"uint256"}]
	}]`
	var err error
	exchangeABI, err = abi.JSON(strings.NewReader(abiJSON))
	if err != nil {
		panic("curve: ABI parse error: " + err.Error())
	}
}

// EncodeExchange returns the ABI-encoded calldata for a Curve exchange call.
//
//	i:     source token index (IndexDAI / IndexUSDC / IndexUSDT)
//	j:     destination token index
//	dx:    amount of source token to swap (in token decimals)
//	minDy: minimum acceptable output (slippage guard); pass big.NewInt(0) to disable
func EncodeExchange(i, j int64, dx, minDy *big.Int) ([]byte, error) {
	if minDy == nil {
		minDy = new(big.Int)
	}
	return exchangeABI.Pack("exchange", big.NewInt(i), big.NewInt(j), dx, minDy)
}
