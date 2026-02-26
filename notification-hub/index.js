// notification-service/src/index.js
require("dotenv").config();
const express = require("express");
const http = require("http");
const WebSocket = require("ws");
const redis = require("./redis");
const notifyRoutes = require("./routes/notify");
const metrics = require("./metrics");
const { verifyToken } = require("./auth");

const app = express();
const server = http.createServer(app);

// ── WebSocket Server (attached to same HTTP server) ─────────────
const wss = new WebSocket.Server({ noServer: true });

// Map: userId → Set of WebSocket clients
// One user can have multiple tabs open — all get the update.
const userSockets = new Map();

// ── WebSocket Upgrade Handshake ─────────────────────────────────
// Client connects with: ws://host:3000?token=<JWT>
server.on("upgrade", (req, socket, head) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const token = url.searchParams.get("token");

  const user = verifyToken(token);
  if (!user) {
    socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
    socket.destroy();
    return;
  }

  wss.handleUpgrade(req, socket, head, (ws) => {
    ws.userId = user.id;
    wss.emit("connection", ws, req);
  });
});

// ── WebSocket Connection Handler ────────────────────────────────
wss.on("connection", (ws) => {
  const userId = ws.userId;
  console.log(`WS connected: user=${userId}`);
  metrics.activeConnections.inc();

  // Register this socket under the user's ID
  if (!userSockets.has(userId)) userSockets.set(userId, new Set());
  userSockets.get(userId).add(ws);

  // Send a welcome/ack message
  ws.send(JSON.stringify({ type: "CONNECTED", userId, timestamp: new Date().toISOString() }));

  // Handle client messages (optional ping/pong keepalive)
  ws.on("message", (data) => {
    try {
      const msg = JSON.parse(data);
      if (msg.type === "PING") ws.send(JSON.stringify({ type: "PONG" }));
    } catch {
      // ignore malformed messages
    }
  });

  ws.on("close", () => {
    metrics.activeConnections.dec();
    const sockets = userSockets.get(userId);
    if (sockets) {
      sockets.delete(ws);
      if (sockets.size === 0) userSockets.delete(userId);
    }
    console.log(`WS disconnected: user=${userId}`);
  });

  ws.on("error", (err) => {
    console.error(`WS error for user=${userId}:`, err.message);
  });
});

// ── Helper: push event to all sockets for a user ────────────────
function pushToUser(userId, payload) {
  const sockets = userSockets.get(userId);
  if (!sockets || sockets.size === 0) return;

  const message = JSON.stringify(payload);
  for (const ws of sockets) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(message);
    }
  }
}

// ── HTTP Middleware ──────────────────────────────────────────────
app.use(express.json());
app.use((req, res, next) => { metrics.requestCounter.inc(); next(); });
app.use("/notify", notifyRoutes(pushToUser));

// ── Health ───────────────────────────────────────────────────────
app.get("/health", async (req, res) => {
  try {
    await redis.ping();
    res.status(200).json({
      status: "ok",
      redis: "connected",
      activeConnections: wss.clients.size
    });
  } catch {
    res.status(503).json({ status: "degraded", redis: "disconnected" });
  }
});

// ── Metrics ──────────────────────────────────────────────────────
app.get("/metrics", async (req, res) => {
  res.set("Content-Type", metrics.register.contentType);
  res.end(await metrics.register.metrics());
});

// ── Redis Subscriber: relay events from Kitchen/Gateway ─────────
async function startRedisSubscriber() {
  const subscriber = redis.duplicate();
  await subscriber.connect();

  await subscriber.subscribe("order-events", async (message) => {
    try {
      const event = JSON.parse(message);
      const { userId, orderId, status, detail } = event;

      // Push to all open WebSocket connections for this user
      pushToUser(userId, {
        type: "ORDER_UPDATE",
        orderId,
        status,
        detail,
        timestamp: new Date().toISOString()
      });

      // Persist last 20 notifications per user
      const key = `notifications:${userId}`;
      await redis.lPush(key, JSON.stringify({ orderId, status, detail, timestamp: Date.now() }));
      await redis.lTrim(key, 0, 19);

      metrics.notificationsSent.inc({ status });
      console.log(`Pushed → user=${userId} orderId=${orderId} status=${status}`);
    } catch (err) {
      console.error("Failed to process event:", err.message);
      metrics.notificationsFailed.inc();
    }
  });

  console.log("Redis subscriber listening on: order-events");
}

startRedisSubscriber();

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Notification Hub (WebSocket) running on :${PORT}`));
