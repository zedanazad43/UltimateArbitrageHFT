package db

import (
	"context"
	"os"
	"testing"
)

// These are integration tests that require a live PostgreSQL instance.
// Set TEST_DB_DSN to run them, e.g.:
//
//	TEST_DB_DSN="postgres://user:pass@localhost:5432/testdb" go test ./internal/db/...
func requireDSN(t *testing.T) string {
	t.Helper()
	dsn := os.Getenv("TEST_DB_DSN")
	if dsn == "" {
		t.Skip("set TEST_DB_DSN to run database integration tests")
	}
	return dsn
}

func TestOpen_InvalidDSN(t *testing.T) {
	_, err := Open(context.Background(), "postgres://invalid-host:5432/db?connect_timeout=1")
	if err == nil {
		t.Fatal("expected error opening DB with invalid DSN, got nil")
	}
}

func TestOpen_MigrationAndClose(t *testing.T) {
	dsn := requireDSN(t)
	ctx := context.Background()
	db, err := Open(ctx, dsn)
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	defer db.Close()
}

func TestLogTrade_RoundTrip(t *testing.T) {
	dsn := requireDSN(t)
	ctx := context.Background()
	db, err := Open(ctx, dsn)
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	defer db.Close()

	trade := TradeRecord{
		Strategy:         "cex",
		Symbol:           "BTCUSDT",
		BuyExchange:      "binance",
		SellExchange:     "mexc",
		Direction:        "BUY_BINANCE",
		SizeUSD:          500.0,
		NetProfitPercent: 0.25,
		Mode:             "paper",
	}
	if err := db.LogTrade(ctx, trade); err != nil {
		t.Fatalf("LogTrade: %v", err)
	}

	records, err := db.RecentTrades(ctx, 1)
	if err != nil {
		t.Fatalf("RecentTrades: %v", err)
	}
	if len(records) == 0 {
		t.Fatal("expected at least one trade record")
	}
	got := records[0]
	if got.Strategy != trade.Strategy {
		t.Errorf("Strategy: want %q got %q", trade.Strategy, got.Strategy)
	}
	if got.Symbol != trade.Symbol {
		t.Errorf("Symbol: want %q got %q", trade.Symbol, got.Symbol)
	}
	if got.SizeUSD != trade.SizeUSD {
		t.Errorf("SizeUSD: want %v got %v", trade.SizeUSD, got.SizeUSD)
	}
	if got.Mode != trade.Mode {
		t.Errorf("Mode: want %q got %q", trade.Mode, got.Mode)
	}
}

func TestLogTrade_WithTxHash(t *testing.T) {
	dsn := requireDSN(t)
	ctx := context.Background()
	db, err := Open(ctx, dsn)
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	defer db.Close()

	trade := TradeRecord{
		Strategy:         "dex",
		Symbol:           "ETHUSDT",
		BuyExchange:      "ethereum",
		SellExchange:     "bsc",
		Direction:        "ETH→BSC",
		SizeUSD:          1000.0,
		NetProfitPercent: 0.80,
		Mode:             "live",
		TxHash:           "0xdeadbeef",
		GasUsedGwei:      45.5,
	}
	if err := db.LogTrade(ctx, trade); err != nil {
		t.Fatalf("LogTrade with tx_hash: %v", err)
	}
}

func TestLogBotEvent(t *testing.T) {
	dsn := requireDSN(t)
	ctx := context.Background()
	db, err := Open(ctx, dsn)
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	defer db.Close()

	// Should not panic or return error (errors are logged internally)
	db.LogBotEvent(ctx, "start", "engine started in paper mode")
	db.LogBotEvent(ctx, "error", "connection timeout")
}

func TestRecentTrades_LimitRespected(t *testing.T) {
	dsn := requireDSN(t)
	ctx := context.Background()
	db, err := Open(ctx, dsn)
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	defer db.Close()

	// Insert 3 trades then request only 2
	for i := 0; i < 3; i++ {
		_ = db.LogTrade(ctx, TradeRecord{
			Strategy: "cex", Symbol: "XRPUSDT",
			SizeUSD: float64(100 * (i + 1)), NetProfitPercent: 0.1, Mode: "paper",
		})
	}
	records, err := db.RecentTrades(ctx, 2)
	if err != nil {
		t.Fatalf("RecentTrades: %v", err)
	}
	if len(records) > 2 {
		t.Errorf("expected at most 2 records, got %d", len(records))
	}
}

// Unit tests for unexported helpers — no DB required.

func TestNullStr(t *testing.T) {
	if nullStr("") != nil {
		t.Error("empty string should be nil")
	}
	if nullStr("abc") != "abc" {
		t.Error("non-empty string should pass through")
	}
}

func TestNullFloat(t *testing.T) {
	if nullFloat(0) != nil {
		t.Error("zero float should be nil")
	}
	v := nullFloat(3.14)
	if v != 3.14 {
		t.Errorf("non-zero float should pass through, got %v", v)
	}
}
