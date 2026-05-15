package executor

import "testing"

func TestHMACHex_KnownVector(t *testing.T) {
	got := hmacHex("secret", "message")
	want := "8b5f48702995c1598c573db1e21866a9b825d4a794d169d7060a03605796360b"
	if got != want {
		t.Fatalf("hmacHex mismatch: got %s want %s", got, want)
	}
}

func TestSortedQuery_DeterministicOrder(t *testing.T) {
	params := map[string]string{
		"z": "9",
		"a": "1",
		"m": "5",
	}
	got := sortedQuery(params)
	want := "a=1&m=5&z=9"
	if got != want {
		t.Fatalf("sortedQuery mismatch: got %q want %q", got, want)
	}
}

func TestCapitalise(t *testing.T) {
	tests := []struct {
		in   string
		want string
	}{
		{in: "buy", want: "Buy"},
		{in: "SELL", want: "Sell"},
		{in: "", want: ""},
	}

	for _, tc := range tests {
		if got := capitalise(tc.in); got != tc.want {
			t.Fatalf("capitalise(%q) = %q, want %q", tc.in, got, tc.want)
		}
	}
}
