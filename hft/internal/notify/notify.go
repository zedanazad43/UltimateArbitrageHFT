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
	token  string
	chatID string
	client *http.Client
}

// New creates a Notifier. Returns nil when token or chatID are empty so
// callers can guard with a nil check.
func New(token, chatID string) *Notifier {
	if token == "" || chatID == "" {
		return nil
	}
	return &Notifier{
		token:  token,
		chatID: chatID,
		client: &http.Client{Timeout: 10 * time.Second},
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
	url := fmt.Sprintf("https://api.telegram.org/bot%s/sendMessage", n.token)
	resp, err := n.client.Post(url, "application/json", bytes.NewReader(body))
	if err != nil {
		slog.Error("telegram send failed", "err", err)
		return
	}
	defer resp.Body.Close()
	io.Copy(io.Discard, resp.Body)
}

// Sendf is a convenience wrapper for formatted messages.
func (n *Notifier) Sendf(format string, args ...any) {
	n.Send(fmt.Sprintf(format, args...))
}
