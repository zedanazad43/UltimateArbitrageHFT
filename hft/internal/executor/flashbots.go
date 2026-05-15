// flashbots.go — Flashbots MEV protection for on-chain DEX trades.
//
// Three layers of protection are implemented:
//
//  1. Flashbots Protect RPC (passive) — configured by pointing ETHRPCURL to
//     https://rpc.flashbots.net; transactions submitted via the standard
//     eth_sendRawTransaction endpoint are automatically routed privately.
//
//  2. eth_sendBundle — atomic bundle submission to the Flashbots relay.
//     Used for DEX swaps that require an approve + swap sequence.
//
//  3. MEV-Share hints — optional sharing of partial tx data so searchers
//     can backrun (earning a kickback) without front-running.
//
// Reference: https://docs.flashbots.net/flashbots-auction/searchers/advanced/rpc-endpoint
package executor

import (
	"bytes"
	"context"
	"crypto/ecdsa"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"math/big"
	"net/http"
	"time"

	"github.com/ethereum/go-ethereum/accounts/abi/bind"
	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/core/types"
	"github.com/ethereum/go-ethereum/crypto"
	"github.com/ethereum/go-ethereum/ethclient"
)

// FlashbotsClient submits transaction bundles to the Flashbots relay.
type FlashbotsClient struct {
	relayURL   string
	signingKey *ecdsa.PrivateKey
	httpClient *http.Client
	ethClient  *ethclient.Client
	chainID    *big.Int
}

// NewFlashbotsClient creates a FlashbotsClient.
//
//   - relayURL: e.g. "https://relay.flashbots.net"
//   - signingKeyHex: hex-encoded private key for signing bundle requests
//     (separate from the wallet key; does not need ETH).
//   - ethClient: connected go-ethereum client.
//   - chainID: mainnet=1, arbitrum=42161, etc.
func NewFlashbotsClient(relayURL, signingKeyHex string, ethClient *ethclient.Client, chainID *big.Int) (*FlashbotsClient, error) {
	key, err := crypto.HexToECDSA(signingKeyHex)
	if err != nil {
		return nil, fmt.Errorf("flashbots: invalid signing key: %w", err)
	}
	return &FlashbotsClient{
		relayURL:   relayURL,
		signingKey: key,
		httpClient: &http.Client{Timeout: 15 * time.Second},
		ethClient:  ethClient,
		chainID:    chainID,
	}, nil
}

// Bundle is an ordered sequence of signed raw transactions.
type Bundle struct {
	// SignedTxs are hex-encoded signed raw transactions (with "0x" prefix).
	SignedTxs []string
	// TargetBlock is the block number the bundle should land in.
	TargetBlock uint64
}

// BundleResult is the Flashbots relay response.
type BundleResult struct {
	BundleHash string
}

// SendBundle submits a bundle to the Flashbots relay using eth_sendBundle.
// It signs the request body with the signing key so the relay can identify
// the searcher (required by the API).
func (f *FlashbotsClient) SendBundle(ctx context.Context, b Bundle) (*BundleResult, error) {
	blockHex := fmt.Sprintf("0x%x", b.TargetBlock)
	params := []any{map[string]any{
		"txs":         b.SignedTxs,
		"blockNumber": blockHex,
	}}

	payload := map[string]any{
		"jsonrpc": "2.0",
		"id":      1,
		"method":  "eth_sendBundle",
		"params":  params,
	}
	bodyBytes, err := json.Marshal(payload)
	if err != nil {
		return nil, err
	}

	// Sign the payload body hash with the signing key.
	bodyHash := crypto.Keccak256Hash(bodyBytes)
	sig, err := crypto.Sign(bodyHash.Bytes(), f.signingKey)
	if err != nil {
		return nil, fmt.Errorf("flashbots: sign error: %w", err)
	}
	signerAddr := crypto.PubkeyToAddress(f.signingKey.PublicKey)
	flashbotsSignature := fmt.Sprintf("%s:0x%x", signerAddr.Hex(), sig)

	req, err := http.NewRequestWithContext(ctx, "POST", f.relayURL, bytes.NewReader(bodyBytes))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Flashbots-Signature", flashbotsSignature)

	resp, err := f.httpClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer func() { _ = resp.Body.Close() }()
	body, _ := io.ReadAll(resp.Body)

	var result struct {
		Result struct {
			BundleHash string `json:"bundleHash"`
		} `json:"result"`
		Error *struct {
			Code    int    `json:"code"`
			Message string `json:"message"`
		} `json:"error"`
	}
	if err := json.Unmarshal(body, &result); err != nil {
		return nil, fmt.Errorf("flashbots: decode response: %w", err)
	}
	if result.Error != nil {
		return nil, fmt.Errorf("flashbots relay error %d: %s", result.Error.Code, result.Error.Message)
	}
	slog.Info("flashbots bundle submitted", "hash", result.Result.BundleHash, "targetBlock", b.TargetBlock)
	return &BundleResult{BundleHash: result.Result.BundleHash}, nil
}

// SimulateBundle calls eth_callBundle to check if the bundle would succeed
// and estimates the profit.  Returns the simulation result JSON.
func (f *FlashbotsClient) SimulateBundle(ctx context.Context, b Bundle, stateBlockNumber uint64) (json.RawMessage, error) {
	params := []any{map[string]any{
		"txs":              b.SignedTxs,
		"blockNumber":      fmt.Sprintf("0x%x", b.TargetBlock),
		"stateBlockNumber": fmt.Sprintf("0x%x", stateBlockNumber),
	}}
	payload := map[string]any{
		"jsonrpc": "2.0",
		"id":      1,
		"method":  "eth_callBundle",
		"params":  params,
	}
	bodyBytes, _ := json.Marshal(payload)

	bodyHash := crypto.Keccak256Hash(bodyBytes)
	sig, err := crypto.Sign(bodyHash.Bytes(), f.signingKey)
	if err != nil {
		return nil, err
	}
	signerAddr := crypto.PubkeyToAddress(f.signingKey.PublicKey)
	flashbotsSignature := fmt.Sprintf("%s:0x%x", signerAddr.Hex(), sig)

	req, _ := http.NewRequestWithContext(ctx, "POST", f.relayURL, bytes.NewReader(bodyBytes))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Flashbots-Signature", flashbotsSignature)

	resp, err := f.httpClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer func() { _ = resp.Body.Close() }()
	body, _ := io.ReadAll(resp.Body)

	var raw map[string]json.RawMessage
	if err := json.Unmarshal(body, &raw); err != nil {
		return nil, err
	}
	return raw["result"], nil
}

// BuildSignedTx creates and signs an EIP-1559 transaction using the provided
// wallet key, then returns the hex-encoded raw transaction.
//
// This is a convenience helper used to prepare individual txs for a bundle.
func BuildSignedTx(ctx context.Context, client *ethclient.Client, walletKey *ecdsa.PrivateKey, chainID *big.Int,
	to common.Address, value *big.Int, data []byte, gas uint64, maxFeePerGas, maxPriorityFeePerGas *big.Int) (string, error) {

	auth, err := bind.NewKeyedTransactorWithChainID(walletKey, chainID)
	if err != nil {
		return "", err
	}

	nonce, err := client.PendingNonceAt(ctx, auth.From)
	if err != nil {
		return "", fmt.Errorf("nonce: %w", err)
	}

	tx := types.NewTx(&types.DynamicFeeTx{
		ChainID:   chainID,
		Nonce:     nonce,
		To:        &to,
		Value:     value,
		Gas:       gas,
		GasFeeCap: maxFeePerGas,
		GasTipCap: maxPriorityFeePerGas,
		Data:      data,
	})

	signed, err := types.SignTx(tx, types.LatestSignerForChainID(chainID), walletKey)
	if err != nil {
		return "", fmt.Errorf("sign: %w", err)
	}

	var buf bytes.Buffer
	if err := signed.EncodeRLP(&buf); err != nil {
		return "", err
	}
	return fmt.Sprintf("0x%x", buf.Bytes()), nil
}

// ─── DEX swap via Flashbots ───────────────────────────────────────────────────

// DEXSwapParams holds the parameters for a single DEX swap submission.
type DEXSwapParams struct {
	// WalletKey is the private key for signing the swap transaction.
	WalletKey *ecdsa.PrivateKey
	// RouterAddress is the DEX router contract (Uniswap V3 SwapRouter02, etc.)
	RouterAddress common.Address
	// CallData is the ABI-encoded call (e.g. exactInputSingle).
	CallData []byte
	// Value is the ETH value to send with the swap (0 for ERC-20 swaps).
	Value *big.Int
	// GasLimit is the upper bound on gas usage.
	GasLimit uint64
	// MaxFeePerGas and MaxPriorityFeePerGas are the EIP-1559 fee fields.
	MaxFeePerGas         *big.Int
	MaxPriorityFeePerGas *big.Int
}

// SubmitDEXSwap builds a single-tx bundle and submits it to Flashbots.
// It targets the next block (pendingBlockNumber + 1).
func (f *FlashbotsClient) SubmitDEXSwap(ctx context.Context, p DEXSwapParams) (*BundleResult, error) {
	header, err := f.ethClient.HeaderByNumber(ctx, nil)
	if err != nil {
		return nil, fmt.Errorf("get header: %w", err)
	}
	targetBlock := header.Number.Uint64() + 1

	rawTx, err := BuildSignedTx(
		ctx, f.ethClient, p.WalletKey, f.chainID,
		p.RouterAddress, p.Value, p.CallData,
		p.GasLimit, p.MaxFeePerGas, p.MaxPriorityFeePerGas,
	)
	if err != nil {
		return nil, err
	}

	return f.SendBundle(ctx, Bundle{
		SignedTxs:   []string{rawTx},
		TargetBlock: targetBlock,
	})
}
