// Package db handles PostgreSQL trade logging.
// It uses pgx/v5 for low-level connection pooling and prepared statements.
package db

import (
	"context"
	"log/slog"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// DB wraps a pgx connection pool.
type DB struct {
	pool *pgxpool.Pool
}

// Open creates a connection pool and ensures all required tables exist.
func Open(ctx context.Context, dsn string) (*DB, error) {
	cfg, err := pgxpool.ParseConfig(dsn)
	if err != nil {
		return nil, err
	}
	cfg.MaxConns = 8
	cfg.MinConns = 1
	cfg.MaxConnLifetime = 30 * time.Minute

	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		return nil, err
	}
	d := &DB{pool: pool}
	if err := d.migrate(ctx); err != nil {
		pool.Close()
		return nil, err
	}
	return d, nil
}

// Close shuts down the connection pool.
func (d *DB) Close() {
	d.pool.Close()
}

// migrate creates all required tables and indexes if they do not yet exist.
func (d *DB) migrate(ctx context.Context) error {
	_, err := d.pool.Exec(ctx, `
		CREATE TABLE IF NOT EXISTS trades (
			id                  BIGSERIAL PRIMARY KEY,
			strategy            TEXT    NOT NULL,
			symbol              TEXT    NOT NULL DEFAULT '',
			buy_exchange        TEXT    NOT NULL DEFAULT '',
			sell_exchange       TEXT    NOT NULL DEFAULT '',
			direction           TEXT    NOT NULL DEFAULT '',
			size_usd            NUMERIC NOT NULL,
			net_profit_percent  NUMERIC NOT NULL,
			mode                TEXT    NOT NULL DEFAULT 'paper',
			tx_hash             TEXT,
			gas_used_gwei       NUMERIC,
			created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
		);
		CREATE INDEX IF NOT EXISTS idx_trades_created_at ON trades(created_at DESC);
		CREATE INDEX IF NOT EXISTS idx_trades_strategy   ON trades(strategy);
		CREATE INDEX IF NOT EXISTS idx_trades_mode       ON trades(mode);

		CREATE TABLE IF NOT EXISTS bot_events (
			id         BIGSERIAL PRIMARY KEY,
			event_type TEXT    NOT NULL,
			details    TEXT,
			created_at TIMESTAMPTZ NOT NULL DEFAULT now()
		);
		CREATE INDEX IF NOT EXISTS idx_bot_events_created_at ON bot_events(created_at DESC);
	`)
	return err
}

// TradeRecord is the data logged for each executed (or paper) trade.
type TradeRecord struct {
	Strategy         string
	Symbol           string
	BuyExchange      string
	SellExchange     string
	Direction        string
	SizeUSD          float64
	NetProfitPercent float64
	Mode             string  // "paper" | "live"
	TxHash           string  // on-chain hash for DEX trades
	GasUsedGwei      float64
}

// LogTrade inserts a trade record into the database.
func (d *DB) LogTrade(ctx context.Context, t TradeRecord) error {
	_, err := d.pool.Exec(ctx, `
		INSERT INTO trades
			(strategy, symbol, buy_exchange, sell_exchange, direction,
			 size_usd, net_profit_percent, mode, tx_hash, gas_used_gwei)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
		t.Strategy, t.Symbol, t.BuyExchange, t.SellExchange, t.Direction,
		t.SizeUSD, t.NetProfitPercent, t.Mode,
		nullStr(t.TxHash), nullFloat(t.GasUsedGwei),
	)
	if err != nil {
		slog.Error("db: LogTrade failed", "err", err)
	}
	return err
}

// LogBotEvent records a non-trade engine event (start, stop, error, etc.).
func (d *DB) LogBotEvent(ctx context.Context, eventType, details string) {
	if _, err := d.pool.Exec(ctx,
		`INSERT INTO bot_events (event_type, details) VALUES ($1, $2)`,
		eventType, details,
	); err != nil {
		slog.Error("db: LogBotEvent failed", "err", err)
	}
}

// RecentTrades returns the n most recent trade records.
func (d *DB) RecentTrades(ctx context.Context, n int) ([]TradeRecord, error) {
	rows, err := d.pool.Query(ctx, `
		SELECT strategy, symbol, buy_exchange, sell_exchange, direction,
		       size_usd, net_profit_percent, mode, COALESCE(tx_hash,''), COALESCE(gas_used_gwei,0)
		FROM trades
		ORDER BY created_at DESC
		LIMIT $1`, n)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []TradeRecord
	for rows.Next() {
		var t TradeRecord
		if err := rows.Scan(
			&t.Strategy, &t.Symbol, &t.BuyExchange, &t.SellExchange, &t.Direction,
			&t.SizeUSD, &t.NetProfitPercent, &t.Mode, &t.TxHash, &t.GasUsedGwei,
		); err != nil {
			return nil, err
		}
		out = append(out, t)
	}
	return out, rows.Err()
}

func nullStr(s string) any {
	if s == "" {
		return nil
	}
	return s
}

func nullFloat(f float64) any {
	if f == 0 {
		return nil
	}
	return f
}
