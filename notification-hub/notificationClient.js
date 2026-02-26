// frontend/notificationClient.js
// Pure browser WebSocket client — no libraries needed.
// Usage: new OrderNotificationClient(userId, jwtToken, onUpdate).connect()

const NOTIFICATION_HUB_URL = "ws://localhost:3000";

class OrderNotificationClient {
  constructor(userId, token, onUpdate) {
    this.userId = userId;
    this.token = token;
    this.onUpdate = onUpdate;
    this.ws = null;
    this.pingInterval = null;
    this.reconnectDelay = 1000;
    this.maxReconnectDelay = 30000;
  }

  connect() {
    // JWT is passed as a query param during the WS upgrade handshake
    const url = `${NOTIFICATION_HUB_URL}?token=${this.token}`;
    this.ws = new WebSocket(url);

    this.ws.onopen = () => {
      console.log("✅ Connected to Notification Hub");
      this.reconnectDelay = 1000; // reset on success

      // Start ping/pong keepalive every 25s
      this.pingInterval = setInterval(() => {
        if (this.ws.readyState === WebSocket.OPEN) {
          this.ws.send(JSON.stringify({ type: "PING" }));
        }
      }, 25000);

      // Fetch any missed notifications (e.g. after page refresh)
      this._loadHistory();
    };

    this.ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);

        if (msg.type === "PONG") return; // keepalive, ignore
        if (msg.type === "CONNECTED") {
          console.log(`Subscribed as user: ${msg.userId}`);
          return;
        }
        if (msg.type === "ORDER_UPDATE") {
          this.onUpdate(msg);
        }
      } catch (err) {
        console.warn("Received non-JSON message:", event.data);
      }
    };

    this.ws.onclose = (event) => {
      console.warn(`WebSocket closed (code=${event.code}). Reconnecting in ${this.reconnectDelay}ms...`);
      clearInterval(this.pingInterval);

      // Exponential backoff reconnect
      setTimeout(() => {
        this.reconnectDelay = Math.min(this.reconnectDelay * 2, this.maxReconnectDelay);
        this.connect();
      }, this.reconnectDelay);
    };

    this.ws.onerror = (err) => {
      console.error("WebSocket error:", err.message || err);
    };
  }

  async _loadHistory() {
    try {
      const res = await fetch(`http://localhost:3000/notify/history/${this.userId}`);
      const { notifications } = await res.json();
      notifications.forEach((n) => this.onUpdate({ ...n, type: "ORDER_UPDATE", fromHistory: true }));
    } catch (err) {
      console.warn("Could not load notification history:", err.message);
    }
  }

  disconnect() {
    clearInterval(this.pingInterval);
    if (this.ws) this.ws.close(1000, "Client disconnected");
  }
}

// ── Usage ──────────────────────────────────────────────────────
// const client = new OrderNotificationClient(
//   "user_123",
//   "eyJhbGciOiJIUzI1NiJ9...",  // JWT from login
//   (event) => {
//     console.log(`Order ${event.orderId} → ${event.status}`);
//     document.getElementById("status").innerText = event.status;
//   }
// );
// client.connect();
