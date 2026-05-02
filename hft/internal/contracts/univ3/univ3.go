// Package univ3 provides a minimal ABI binding for the Uniswap V3 SwapRouter02
// exactInputSingle function.
//
// Contract address (mainnet & Arbitrum):
//
//	SwapRouter02: 0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45
//
// Gas: ~80k–100k per swap — one of the cheapest single-hop DEX paths.
package univ3

import (
	"math/big"
	"strings"

	"github.com/ethereum/go-ethereum/accounts/abi"
	"github.com/ethereum/go-ethereum/common"
)

// MainnetRouter is the SwapRouter02 address on Ethereum mainnet.
var MainnetRouter = common.HexToAddress("0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45")

// ArbitrumRouter is the SwapRouter02 address on Arbitrum One.
var ArbitrumRouter = common.HexToAddress("0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45")

// ExactInputSingleParams mirrors the Solidity struct passed to exactInputSingle.
type ExactInputSingleParams struct {
	TokenIn           common.Address
	TokenOut          common.Address
	Fee               uint32  // pool fee tier: 100, 500, 3000, or 10000
	Recipient         common.Address
	AmountIn          *big.Int
	AmountOutMinimum  *big.Int
	SqrtPriceLimitX96 *big.Int
}

// swapABI is the minimal ABI for exactInputSingle.
var swapABI abi.ABI

func init() {
	const abiJSON = `[{
		"inputs":[{
			"components":[
				{"internalType":"address","name":"tokenIn","type":"address"},
				{"internalType":"address","name":"tokenOut","type":"address"},
				{"internalType":"uint24","name":"fee","type":"uint24"},
				{"internalType":"address","name":"recipient","type":"address"},
				{"internalType":"uint256","name":"amountIn","type":"uint256"},
				{"internalType":"uint256","name":"amountOutMinimum","type":"uint256"},
				{"internalType":"uint160","name":"sqrtPriceLimitX96","type":"uint160"}
			],
			"internalType":"struct IV3SwapRouter.ExactInputSingleParams",
			"name":"params",
			"type":"tuple"
		}],
		"name":"exactInputSingle",
		"outputs":[{"internalType":"uint256","name":"amountOut","type":"uint256"}],
		"stateMutability":"payable",
		"type":"function"
	}]`
	var err error
	swapABI, err = abi.JSON(strings.NewReader(abiJSON))
	if err != nil {
		panic("univ3: ABI parse error: " + err.Error())
	}
}

// EncodeExactInputSingle returns the ABI-encoded calldata for an
// exactInputSingle swap.  Pass the result as CallData in DEXSwapParams.
func EncodeExactInputSingle(p ExactInputSingleParams) ([]byte, error) {
	if p.AmountIn == nil {
		p.AmountIn = new(big.Int)
	}
	if p.AmountOutMinimum == nil {
		p.AmountOutMinimum = new(big.Int)
	}
	if p.SqrtPriceLimitX96 == nil {
		p.SqrtPriceLimitX96 = new(big.Int)
	}
	return swapABI.Pack("exactInputSingle", p)
}
