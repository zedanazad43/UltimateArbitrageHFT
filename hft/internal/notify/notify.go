// Package notify sends Telegram alert messages.
package notify

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"time"
)

// Notifier sends messages to a Telegram chat.
type Notifier struct {
	token   string
	chatID  string
	client  *http.Client
	baseURL string // overridable in tests; defaults to telegramBaseURL
}

// telegramBaseURL is the base URL for the Telegram Bot API.
// Tests may override this to point at an httptest server.
var telegramBaseURL = "https://api.telegram.org"
// New creates a Notifier. Returns nil when token or chatID are empty so
// callers can guard with a nil check.
func New(token, chatID string) *Notifier {
	if token == "" || chatID == "" {
		return nil
	}
	return &Notifier{
		token:   token,
		chatID:  chatID,
		client:  &http.Client{Timeout: 10 * time.Second},
		baseURL: telegramBaseURL,
	}
}

// Send posts a Markdown-formatted message to the configured Telegram chat.
// Errors are logged but not returned — alerts are best-effort.
func (n *Notifier) Send(msg string) {
	if n == nil {
		return
	}
	body, _ := json.Marshal(map[string]any{
		"chat_id":    n.chatID,
		"text":       msg,
		"parse_mode": "Markdown",
	})
	url := fmt.Sprintf("%s/bot%s/sendMessage", n.baseURL, n.token)
	resp, err := n.client.Post(url, "application/json", bytes.NewReader(body))
	if err != nil {
		slog.Error("telegram send failed", "err", err)
		return
	}
	defer func() { _ = resp.Body.Close() }()
	if _, err := io.Copy(io.Discard, resp.Body); err != nil {
		slog.Warn("telegram response drain failed", "err", err)
	}
}

// Sendf is a convenience wrapper for formatted messages.
func (n *Notifier) Sendf(format string, args ...any) {
	n.Send(fmt.Sprintf(format, args...))
}
