package dex

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
)

// alchemyResponse builds a minimal valid Alchemy Prices API JSON response.
func alchemyResponse(price string) []byte {
	b, _ := json.Marshal(map[string]any{
		"data": []any{
			map[string]any{
				"prices": []any{
					map[string]any{"value": price},
				},
			},
		},
	})
	return b
}

// pancakeResponse builds a minimal valid PancakeSwap API JSON response.
func pancakeResponse(price string) []byte {
	b, _ := json.Marshal(map[string]any{
		"data": map[string]any{"price": price},
	})
	return b
}

func TestScan_EmptyKey_ReturnsNil(t *testing.T) {
	opp, err := Scan("")
	if opp != nil || err != nil {
		t.Errorf("Scan(\"\") = (%v, %v), want (nil, nil)", opp, err)
	}
}

func TestScan_NoOpportunity_BelowMinSpread(t *testing.T) {
	// Prices almost identical → spread < 0.5% → no opportunity
	alchemySrv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write(alchemyResponse("3000.00"))
	}))
	defer alchemySrv.Close()

	pancakeSrv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write(pancakeResponse("3001.00")) // 0.033% spread — below 0.5%
	}))
	defer pancakeSrv.Close()

	origAlch := alchemyBaseURL
	origPanc := pancakeBaseURL
	alchemyBaseURL = alchemySrv.URL
	pancakeBaseURL = pancakeSrv.URL
	defer func() {
		alchemyBaseURL = origAlch
		pancakeBaseURL = origPanc
	}()

	opp, err := Scan("fakeapikey")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if opp != nil {
		t.Errorf("expected no opportunity (spread too small), got %+v", opp)
	}
}

func TestScan_ProfitableOpportunity(t *testing.T) {
	// BSC price 3% higher than ETH → net spread = 3 - 0.2 = 2.8%
	alchemySrv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write(alchemyResponse("3000.00"))
	}))
	defer alchemySrv.Close()

	pancakeSrv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write(pancakeResponse("3090.00")) // 3% above ETH price
	}))
	defer pancakeSrv.Close()

	origAlch := alchemyBaseURL
	origPanc := pancakeBaseURL
	alchemyBaseURL = alchemySrv.URL
	pancakeBaseURL = pancakeSrv.URL
	defer func() {
		alchemyBaseURL = origAlch
		pancakeBaseURL = origPanc
	}()

	opp, err := Scan("fakeapikey")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if opp == nil {
		t.Fatal("expected a profitable opportunity, got nil")
	}
	if opp.Strategy != "dex" {
		t.Errorf("Strategy: want dex got %q", opp.Strategy)
	}
	if opp.NetPct <= 0 {
		t.Errorf("NetPct should be positive, got %v", opp.NetPct)
	}
	if opp.SafetyFactor <= 0 || opp.SafetyFactor > 1 {
		t.Errorf("SafetyFactor should be in (0,1], got %v", opp.SafetyFactor)
	}
}

func TestScan_HTTPError_ReturnsError(t *testing.T) {
	// Alchemy returns 500 with invalid JSON
	alchemySrv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
		_, _ = fmt.Fprint(w, "server error")
	}))
	defer alchemySrv.Close()

	pancakeSrv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
		_, _ = fmt.Fprint(w, "server error")
	}))
	defer pancakeSrv.Close()

	origAlch := alchemyBaseURL
	origPanc := pancakeBaseURL
	alchemyBaseURL = alchemySrv.URL
	pancakeBaseURL = pancakeSrv.URL
	defer func() {
		alchemyBaseURL = origAlch
		pancakeBaseURL = origPanc
	}()

	opp, err := Scan("fakeapikey")
	// All pairs fail → should surface error with no opportunity
	if opp != nil {
		t.Errorf("expected nil opportunity on error, got %+v", opp)
	}
	if err == nil {
		t.Error("expected non-nil error when all HTTP calls fail")
	}
}

func TestSplitLast_Normal(t *testing.T) {
	got := splitLast("https://example.com/path/key", "/")
	if got[0] != "https://example.com/path" || got[1] != "key" {
		t.Errorf("unexpected split: %v", got)
	}
}

func TestSplitLast_NoSep(t *testing.T) {
	got := splitLast("nodivider", "/")
	if got[0] != "nodivider" || got[1] != "" {
		t.Errorf("unexpected split: %v", got)
	}
}

func TestSplitLast_TrailingSep(t *testing.T) {
	got := splitLast("a/b/c/", "/")
	if got[0] != "a/b/c" || got[1] != "" {
		t.Errorf("unexpected split: %v", got)
	}
}
