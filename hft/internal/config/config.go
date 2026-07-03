// Package config loads all runtime configuration from environment variables.
// Set variables in a .env file (loaded by the shell) or inject them as
// container environment variables at deployment time.
package config

import (
	"fmt"
	"os"
	"strconv"
	"strings"
	"time"
)

// Config holds every tunable parameter for the HFT engine.
type Config struct {
	// ── CEX API credentials ──────────────────────────────────────────────────
	MEXCAPIKey    string
	MEXCAPISecret string

	BinanceAPIKey    string
	BinanceAPISecret string

	BybitAPIKey    string
	BybitAPISecret string

	KuCoinAPIKey     string
	KuCoinSecretKey  string
	KuCoinPassphrase string

	// ── EVM / on-chain ───────────────────────────────────────────────────────
	// WalletPrivateKey is the hex-encoded private key (no 0x prefix) used to
	// sign on-chain transactions.
	WalletPrivateKey string

	// ETHRPCURL is the primary WebSocket/HTTPS endpoint for Ethereum mainnet.
	// Example: wss://eth-mainnet.g.alchemy.com/v2/<key>
	ETHRPCURL string

	// ArbitrumRPCURL is the primary endpoint for Arbitrum One (L2).
	ArbitrumRPCURL string

	// FlashbotsRelayURL is the Flashbots relay endpoint.
	// Default: https://relay.flashbots.net
	FlashbotsRelayURL string

	// FlashbotsSigningKey is a SEPARATE key used only to sign bundle submission
	// requests to the relay (does not need ETH balance).
	FlashbotsSigningKey string

	// ── DEX / price APIs ─────────────────────────────────────────────────────
	AlchemyAPIKey string
	ZeroXAPIKey   string

	// ── PostgreSQL ───────────────────────────────────────────────────────────
	// PostgresDSN is the full connection string, e.g.:
	// postgres://user:pass@localhost:5432/hft?sslmode=disable
	PostgresDSN string

	// ── Telegram ─────────────────────────────────────────────────────────────
	TelegramBotToken string
	TelegramChatID   string

	// ── Trading parameters ───────────────────────────────────────────────────
	PaperTrading        bool
	TradingEnabled      bool
	InitialCapitalUSD   float64
	MaxDailyLossUSD     float64
	MinSecondsBetweenTx int
	MaxPerTradeLossPct  float64
	MaxSpreadPct        float64
	WinRate             float64
	RiskRewardRatio     float64

	// ── Engine tuning ────────────────────────────────────────────────────────
	// ScanInterval controls how often the arb engine re-evaluates opportunities
	// from the cached price book when live WebSocket feeds are connected.
	ScanInterval time.Duration

	// MaxGasCostPct: skip a DEX trade if estimated gas cost exceeds this
	// fraction of expected profit (e.g. 0.30 = skip when gas > 30% of profit).
	MaxGasCostPct float64

	// MinNetProfitPct: floor below which no trade is executed (default 0.05%).
	MinNetProfitPct float64

	// ── Engine API server ─────────────────────────────────────────────────────
	// APIAddr is the HTTP listen address for the engine's REST API.
	// The CF Worker can call /api/scan and /api/execute on this address.
	// Default: :8080
	APIAddr string

	// EngineSecret is the Bearer token that clients must supply in the
	// Authorization header to call the engine API.  Leave blank to disable auth.
	EngineSecret string

	// Prometheus metrics HTTP listen address.
	MetricsAddr string
}

// Load reads all configuration from environment variables and returns a fully
// populated Config.  Missing required fields are collected and returned as a
// single validation error.
func Load() (*Config, error) {
	c := &Config{
		// CEX credentials
		MEXCAPIKey:    os.Getenv("MEXC_API_KEY"),
		MEXCAPISecret: os.Getenv("MEXC_API_SECRET"),

		BinanceAPIKey:    os.Getenv("BINANCE_API_KEY"),
		BinanceAPISecret: os.Getenv("BINANCE_API_SECRET"),

		BybitAPIKey:    os.Getenv("BYBIT_API_KEY"),
		BybitAPISecret: os.Getenv("BYBIT_API_SECRET"),

		KuCoinAPIKey:     os.Getenv("KUCOIN_API_KEY"),
		KuCoinSecretKey:  os.Getenv("KUCOIN_SECRET_KEY"),
		KuCoinPassphrase: os.Getenv("KUCOIN_PASSPHRASE"),

		// EVM
		WalletPrivateKey:    os.Getenv("WALLET_PRIVATE_KEY"),
		ETHRPCURL:           envOr("ETH_RPC_URL", "https://rpc.flashbots.net"),
		ArbitrumRPCURL:      envOr("ARBITRUM_RPC_URL", "https://arb1.arbitrum.io/rpc"),
		FlashbotsRelayURL:   envOr("FLASHBOTS_RELAY_URL", "https://relay.flashbots.net"),
		FlashbotsSigningKey: os.Getenv("FLASHBOTS_SIGNING_KEY"),

		// Price APIs
		AlchemyAPIKey: os.Getenv("ALCHEMY_API_KEY"),
		ZeroXAPIKey:   os.Getenv("ZEROX_API_KEY"),

		// Database
		PostgresDSN: envOr("POSTGRES_DSN", "postgres://hft:hft@localhost:5432/hft?sslmode=disable"),

		// Telegram
		TelegramBotToken: os.Getenv("TELEGRAM_BOT_TOKEN"),
		TelegramChatID:   os.Getenv("TELEGRAM_CHAT_ID"),

		// Trading parameters
		PaperTrading:        envBool("PAPER_TRADING", true),
		TradingEnabled:      envBool("TRADING_ENABLED", false),
		InitialCapitalUSD:   envFloat("INITIAL_CAPITAL_USD", 1000),
		MaxDailyLossUSD:     envFloat("MAX_DAILY_LOSS_USD", 25),
		MinSecondsBetweenTx: envInt("MIN_SECONDS_BETWEEN_TX", 30),
		MaxPerTradeLossPct:  envFloat("MAX_PER_TRADE_LOSS_PCT", 0.02),
		MaxSpreadPct:        envFloat("MAX_SPREAD_PCT", 5.0),
		WinRate:             envFloat("WIN_RATE", 0.55),
		RiskRewardRatio:     envFloat("RISK_REWARD_RATIO", 2.0),

		// Engine tuning
		ScanInterval:    time.Duration(envInt("SCAN_INTERVAL_MS", 500)) * time.Millisecond,
		MaxGasCostPct:   envFloat("MAX_GAS_COST_PCT", 0.30),
		MinNetProfitPct: envFloat("MIN_NET_PROFIT_PCT", 0.05),
		MetricsAddr:     envOr("METRICS_ADDR", ":9090"),

		// API server
		APIAddr:      envOr("API_ADDR", ":8080"),
		EngineSecret: os.Getenv("HFT_ENGINE_SECRET"),
	}

	var missing []string
	// At minimum one CEX credential pair is required to trade.
	hasCEX := (c.MEXCAPIKey != "" && c.MEXCAPISecret != "") ||
		(c.BinanceAPIKey != "" && c.BinanceAPISecret != "")
	if !hasCEX && c.TradingEnabled && !c.PaperTrading {
		missing = append(missing, "at least one of (MEXC_API_KEY+MEXC_API_SECRET) or (BINANCE_API_KEY+BINANCE_API_SECRET)")
	}
	if len(missing) > 0 {
		return nil, fmt.Errorf("config: missing required environment variables: %s", strings.Join(missing, ", "))
	}
	return c, nil
}

func envOr(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func envBool(key string, fallback bool) bool {
	v := os.Getenv(key)
	if v == "" {
		return fallback
	}
	b, err := strconv.ParseBool(v)
	if err != nil {
		return fallback
	}
	return b
}

func envFloat(key string, fallback float64) float64 {
	v := os.Getenv(key)
	if v == "" {
		return fallback
	}
	f, err := strconv.ParseFloat(v, 64)
	if err != nil {
		return fallback
	}
	return f
}

func envInt(key string, fallback int) int {
	v := os.Getenv(key)
	if v == "" {
		return fallback
	}
	i, err := strconv.Atoi(v)
	if err != nil {
		return fallback
	}
	return i
}
