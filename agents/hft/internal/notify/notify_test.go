package notify

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestNew_NilOnEmptyCredentials(t *testing.T) {
	cases := []struct {
		token, chatID string
	}{
		{"", ""},
		{"token", ""},
		{"", "12345"},
	}
	for _, c := range cases {
		if n := New(c.token, c.chatID); n != nil {
			t.Errorf("New(%q, %q) = non-nil, want nil", c.token, c.chatID)
		}
	}
}

func TestNew_NonNilWithValidCredentials(t *testing.T) {
	n := New("mytoken", "123456")
	if n == nil {
		t.Error("New with valid credentials should return non-nil Notifier")
	}
}

func TestSend_NilNotifierNoPanic(t *testing.T) {
	var n *Notifier
	// Must not panic
	n.Send("hello")
	n.Sendf("hello %s", "world")
}

func TestSend_PostsCorrectPayload(t *testing.T) {
	var capturedBody []byte
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		capturedBody, _ = io.ReadAll(r.Body)
		w.WriteHeader(http.StatusOK)
	}))
	defer srv.Close()

	// Temporarily override base URL to point at test server
	orig := telegramBaseURL
	telegramBaseURL = srv.URL
	defer func() { telegramBaseURL = orig }()

	n := New("testtoken", "99999")
	n.Send("*alert* price spike")

	if len(capturedBody) == 0 {
		t.Fatal("expected HTTP POST body, got nothing")
	}
	var payload map[string]any
	if err := json.Unmarshal(capturedBody, &payload); err != nil {
		t.Fatalf("invalid JSON body: %v", err)
	}
	if payload["chat_id"] != "99999" {
		t.Errorf("chat_id: want %q got %v", "99999", payload["chat_id"])
	}
	if payload["text"] != "*alert* price spike" {
		t.Errorf("text: unexpected %v", payload["text"])
	}
	if payload["parse_mode"] != "Markdown" {
		t.Errorf("parse_mode: want Markdown got %v", payload["parse_mode"])
	}
}

func TestSendf_FormatsMessage(t *testing.T) {
	var capturedBody []byte
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		capturedBody, _ = io.ReadAll(r.Body)
		w.WriteHeader(http.StatusOK)
	}))
	defer srv.Close()

	orig := telegramBaseURL
	telegramBaseURL = srv.URL
	defer func() { telegramBaseURL = orig }()

	n := New("tok", "42")
	n.Sendf("profit: %.2f%%", 1.25)

	var payload map[string]any
	if err := json.Unmarshal(capturedBody, &payload); err != nil {
		t.Fatalf("invalid JSON: %v", err)
	}
	if payload["text"] != "profit: 1.25%" {
		t.Errorf("unexpected text: %v", payload["text"])
	}
}

func TestSend_ServerError_NoPanic(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
	}))
	defer srv.Close()

	orig := telegramBaseURL
	telegramBaseURL = srv.URL
	defer func() { telegramBaseURL = orig }()

	n := New("tok", "42")
	// Should log error but not panic
	n.Send("test message")
}
