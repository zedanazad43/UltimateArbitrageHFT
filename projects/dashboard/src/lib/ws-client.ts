// frontend/src/lib/ws-client.ts — WebSocket client for real-time data

type Listener = (data: any) => void;
type OutgoingMessage = Record<string, any>;

export class WebSocketClient {
  url: string;
  ws: WebSocket | null = null;
  reconnectAttempts = 0;
  maxReconnectAttempts = 10;
  reconnectDelay = 1000;
  listeners: Record<string, Listener[]> = {};
  isConnected = false;
  isConnecting = false;
  pendingMessages: OutgoingMessage[] = [];

  constructor(url: string = process.env.REACT_APP_WS_URL || "ws://localhost:8788") {
    this.url = url;
  }

  /**
   * Connect to WebSocket server
   */
  connect() {
    if (this.isConnecting || this.isConnected) return;

    this.isConnecting = true;
    this._connect();
  }

  /**
   * Establish WebSocket connection
   */
  _connect() {
    try {
      const ws = new WebSocket(this.url);
      this.ws = ws;

      ws.onopen = () => {
        this.isConnected = true;
        this.reconnectAttempts = 0;
        this.isConnecting = false;
        this._emit("connected", { url: this.url });

        // Send pending messages
        while (this.pendingMessages.length > 0) {
          const msg = this.pendingMessages.shift();
          if (msg) ws.send(JSON.stringify(msg));
        }
      };

      ws.onmessage = (event: MessageEvent) => {
        try {
          const data = JSON.parse(event.data);
          this._emit(data.type || "message", data);
        } catch (err) {
          this._emit("error", { message: "Failed to parse message" });
        }
      };

      ws.onclose = (event: CloseEvent) => {
        this.isConnected = false;
        this.isConnecting = false;
        this._emit("disconnected", { code: event.code, reason: event.reason });

        // Auto-reconnect with exponential backoff
        if (this.reconnectAttempts < this.maxReconnectAttempts) {
          const delay = Math.min(this.reconnectDelay * Math.pow(2, this.reconnectAttempts), 30000);
          this.reconnectAttempts++;

          console.log(`Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`);
          setTimeout(() => this._connect(), delay);
        } else {
          // Give up after max attempts so the UI can surface a persistent error.
          this._emit("reconnect_failed", { url: this.url, attempts: this.reconnectAttempts });
        }
      };

      ws.onerror = (event: Event) => {
        this._emit("error", { message: "WebSocket error", error: event });
      };
    } catch (err) {
      this.isConnecting = false;
      this._emit("error", {
        message: "Connection failed",
        error: (err as Error)?.message,
      });
    }
  }

  /**
   * Subscribe to channels
   */
  subscribe(channels: string | string[]) {
    this._send({
      type: "subscribe",
      channels: Array.isArray(channels) ? channels : [channels],
    });
  }

  /**
   * Unsubscribe from channels
   */
  unsubscribe(channels: string | string[]) {
    this._send({
      type: "unsubscribe",
      channels: Array.isArray(channels) ? channels : [channels],
    });
  }

  /**
   * Send command to server
   */
  sendCommand(command: string) {
    this._send({
      type: "command",
      command,
    });
  }

  /**
   * Ping server
   */
  ping() {
    this._send({ type: "ping" });
  }

  /**
   * Send message to server
   */
  _send(message: OutgoingMessage) {
    if (this.isConnected && this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    } else {
      // Queue message for later
      this.pendingMessages.push(message);
    }
  }

  /**
   * Register event listener
   */
  on(event: string, callback: Listener): () => void {
    if (!this.listeners[event]) {
      this.listeners[event] = [];
    }
    this.listeners[event].push(callback);

    // Return unsubscribe function
    return () => {
      this.listeners[event] = this.listeners[event].filter((cb) => cb !== callback);
    };
  }

  /**
   * Emit event to all listeners
   */
  _emit(event: string, data: any) {
    const callbacks = this.listeners[event] || [];
    callbacks.forEach((cb) => {
      try {
        cb(data);
      } catch (err) {
        console.error(`Error in ${event} listener:`, err);
      }
    });
  }

  /**
   * Disconnect
   */
  disconnect() {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.isConnected = false;
    this.reconnectAttempts = this.maxReconnectAttempts;
  }

  /**
   * Get connection status
   */
  getStatus() {
    return {
      isConnected: this.isConnected,
      isConnecting: this.isConnecting,
      reconnectAttempts: this.reconnectAttempts,
    };
  }
}

// Export singleton
export const wsClient = new WebSocketClient();