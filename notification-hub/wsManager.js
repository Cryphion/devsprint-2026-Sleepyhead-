"use strict";

/**
 * wsManager
 * ---------
 * Maintains a registry of active WebSocket connections keyed by studentId.
 * The client must send an initial JSON registration message:
 *   { "type": "register", "studentId": "220041xxx" }
 *
 * After registration, any call to send(studentId, payload) will push a
 * JSON message to that specific client's socket.
 */

const clients = new Map(); // studentId → WebSocket

let metrics; // injected after metrics module is ready

function setMetrics(m) {
  metrics = m;
}

/**
 * Register a new WebSocket connection.
 * Called once per incoming WS connection from index.js.
 */
function register(ws) {
  ws.isAlive = true;

  ws.on("pong", () => {
    ws.isAlive = true;
  });

  ws.on("message", (raw) => {
    try {
      const msg = JSON.parse(raw);

      if (msg.type === "register" && msg.studentId) {
        // Remove any stale connection for the same student
        const existing = clients.get(msg.studentId);
        if (existing && existing !== ws) {
          existing.terminate();
        }

        clients.set(msg.studentId, ws);
        ws.studentId = msg.studentId;

        ws.send(
          JSON.stringify({
            type: "registered",
            studentId: msg.studentId,
            message: "Connected to Notification Hub",
          })
        );

        if (metrics) metrics.incrementConnected();
        console.log(`[WS] Student registered: ${msg.studentId}`);
      }
    } catch (err) {
      console.error("[WS] Invalid message received:", err.message);
    }
  });

  ws.on("close", () => {
    if (ws.studentId) {
      clients.delete(ws.studentId);
      if (metrics) metrics.decrementConnected();
      console.log(`[WS] Student disconnected: ${ws.studentId}`);
    }
  });

  ws.on("error", (err) => {
    console.error(`[WS] Error for ${ws.studentId || "unknown"}:`, err.message);
  });
}

/**
 * Push a JSON payload to a specific student's WebSocket.
 * Returns true if delivered, false if student not connected.
 */
function send(studentId, payload) {
  const ws = clients.get(studentId);

  if (!ws || ws.readyState !== 1 /* OPEN */) {
    console.warn(`[WS] No active connection for studentId: ${studentId}`);
    return false;
  }

  try {
    ws.send(JSON.stringify(payload));
    return true;
  } catch (err) {
    console.error(`[WS] Failed to send to ${studentId}:`, err.message);
    return false;
  }
}

/**
 * Broadcast a message to ALL connected clients.
 * Used for system-wide announcements (e.g., cafeteria closing).
 */
function broadcast(payload) {
  const message = JSON.stringify(payload);
  let count = 0;

  clients.forEach((ws) => {
    if (ws.readyState === 1 /* OPEN */) {
      ws.send(message);
      count++;
    }
  });

  return count;
}

/** Returns count of currently connected clients (for metrics). */
function connectedCount() {
  return clients.size;
}

/**
 * Heartbeat — ping all connections every 30s.
 * Terminates dead sockets to free memory.
 */
function startHeartbeat(wss) {
  const interval = setInterval(() => {
    wss.clients.forEach((ws) => {
      if (!ws.isAlive) {
        if (ws.studentId) clients.delete(ws.studentId);
        return ws.terminate();
      }
      ws.isAlive = false;
      ws.ping();
    });
  }, 30_000);

  wss.on("close", () => clearInterval(interval));
}

module.exports = { register, send, broadcast, connectedCount, startHeartbeat, setMetrics };