// Package executor — HTTP connection pooling for CEX API clients.
package executor

import (
	"crypto/tls"
	"net"
	"net/http"
	"time"
)

// OptimizedHTTPClient creates an HTTP client with tuned connection pooling
// and timeouts optimized for high-throughput trading.
func OptimizedHTTPClient() *http.Client {
	transport := &http.Transport{
		// Connection pooling
		MaxIdleConns:          200,
		MaxIdleConnsPerHost:   50,
		MaxConnsPerHost:       100,
		IdleConnTimeout:       90 * time.Second,
		DialContext:           (&net.Dialer{Timeout: 3 * time.Second, KeepAlive: 30 * time.Second}).DialContext,
		TLSHandshakeTimeout:   5 * time.Second,
		ExpectContinueTimeout: 1 * time.Second,
		// TLS config
		TLSClientConfig: &tls.Config{
			InsecureSkipVerify: false,
		},
	}

	return &http.Client{
		Transport: transport,
		Timeout:   15 * time.Second,
	}
}

// ExchangeTimeout returns a tuned timeout for the given exchange.
// Some exchanges are slower than others; adjust accordingly.
func ExchangeTimeout(exchange string) time.Duration {
	switch exchange {
	case "binance", "kucoin":
		return 5 * time.Second // Fast, low-latency
	case "mexc", "bybit":
		return 8 * time.Second // Moderate latency
	case "coinbase", "kraken":
		return 10 * time.Second // Higher latency
	default:
		return 10 * time.Second
	}
}
