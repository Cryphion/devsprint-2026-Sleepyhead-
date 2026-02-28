"use strict";

/**
 * metrics.js
 * ----------
 * In-memory metrics store for the Notification Hub.
 * Exposes a /metrics route (JSON + Prometheus text format).
 *
 * Tracked values:
 *   - total_pushes          : successful WS messages sent
 *   - failed_pushes         : push attempts where student had no connection
 *   - connected_clients     : current active WebSocket connections
 *   - total_events_received : Redis pub/sub messages consumed
 */

const { Router } = require("express");
const { connectedCount } = require("./wsManager");

const state = {
  total_pushes: 0,
  failed_pushes: 0,
  total_events_received: 0,
  connected_clients: 0,
  start_time: Date.now(),
};

// ── Mutators ──────────────────────────────────────────────────────────────────

function incrementPush(success) {
  if (success) state.total_pushes++;
  else state.failed_pushes++;
}

function incrementEventsReceived() {
  state.total_events_received++;
}

function incrementConnected() {
  state.connected_clients++;
}

function decrementConnected() {
  if (state.connected_clients > 0) state.connected_clients--;
}

// ── Express Route ─────────────────────────────────────────────────────────────

const router = Router();

router.get("/metrics", (req, res) => {
  const accept = req.headers["accept"] || "";

  const snapshot = {
    ...state,
    connected_clients: connectedCount(), // live count from wsManager
    uptime_seconds: Math.floor((Date.now() - state.start_time) / 1000),
  };

  // Prometheus text format if requested
  if (accept.includes("text/plain")) {
    const lines = [
      `# HELP notification_hub_total_pushes Total WebSocket pushes sent`,
      `# TYPE notification_hub_total_pushes counter`,
      `notification_hub_total_pushes ${snapshot.total_pushes}`,
      ``,
      `# HELP notification_hub_failed_pushes Pushes with no active client`,
      `# TYPE notification_hub_failed_pushes counter`,
      `notification_hub_failed_pushes ${snapshot.failed_pushes}`,
      ``,
      `# HELP notification_hub_connected_clients Current WebSocket connections`,
      `# TYPE notification_hub_connected_clients gauge`,
      `notification_hub_connected_clients ${snapshot.connected_clients}`,
      ``,
      `# HELP notification_hub_total_events_received Redis pub/sub events consumed`,
      `# TYPE notification_hub_total_events_received counter`,
      `notification_hub_total_events_received ${snapshot.total_events_received}`,
      ``,
      `# HELP notification_hub_uptime_seconds Service uptime in seconds`,
      `# TYPE notification_hub_uptime_seconds gauge`,
      `notification_hub_uptime_seconds ${snapshot.uptime_seconds}`,
    ];
    res.set("Content-Type", "text/plain; version=0.0.4");
    return res.send(lines.join("\n"));
  }

  res.json(snapshot);
});

module.exports = {
  router,
  incrementPush,
  incrementEventsReceived,
  incrementConnected,
  decrementConnected,
};