"use strict";

/**
 * subscriber.js
 * -------------
 * Subscribes to the Redis "order_updates" channel.
 *
 * Kitchen Queue publishes messages in this shape:
 * {
 *   "orderId":   "uuid-xxx",
 *   "studentId": "220041xxx",
 *   "status":    "In Kitchen" | "Ready" | "Failed",
 *   "timestamp": "2026-02-28T17:30:00.000Z"
 * }
 *
 * On each message this module:
 *   1. Parses the JSON payload
 *   2. Looks up the student's active WebSocket via wsManager
 *   3. Pushes the status update to their browser in real-time
 *   4. Records metrics
 */

const Redis = require("ioredis");
const wsManager = require("./wsManager");
const metrics = require("./metrics");

const CHANNEL = "order_updates";

/**
 * Creates a *dedicated* Redis subscriber connection.
 * ioredis requires a separate client instance for pub/sub
 * because a subscribed client cannot issue regular commands.
 */
function createSubscriber(redisUrl) {
  const sub = new Redis(redisUrl, {
    lazyConnect: false,
    retryStrategy(times) {
      const delay = Math.min(times * 200, 5000);
      console.log(`[Subscriber] Redis reconnect attempt #${times} in ${delay}ms`);
      return delay;
    },
  });

  sub.on("connect", () => {
    console.log("[Subscriber] Connected to Redis — subscribing to:", CHANNEL);
  });

  sub.on("error", (err) => {
    console.error("[Subscriber] Redis error:", err.message);
  });

  sub.subscribe(CHANNEL, (err, count) => {
    if (err) {
      console.error("[Subscriber] Failed to subscribe:", err.message);
      return;
    }
    console.log(`[Subscriber] Subscribed to ${count} channel(s): ${CHANNEL}`);
  });

  sub.on("message", (channel, rawMessage) => {
    if (channel !== CHANNEL) return;

    metrics.incrementEventsReceived();

    let payload;
    try {
      payload = JSON.parse(rawMessage);
    } catch (err) {
      console.error("[Subscriber] Malformed message — not JSON:", rawMessage);
      return;
    }

    const { orderId, studentId, status, timestamp } = payload;

    if (!studentId || !status) {
      console.warn("[Subscriber] Missing studentId or status in payload:", payload);
      return;
    }

    console.log(`[Subscriber] Order ${orderId} → ${status} for student ${studentId}`);

    // Push to the student's WebSocket
    const delivered = wsManager.send(studentId, {
      type: "order_update",
      orderId,
      studentId,
      status,
      timestamp: timestamp || new Date().toISOString(),
    });

    metrics.incrementPush(delivered);

    if (!delivered) {
      // Student may have closed the tab — not an error, just log it
      console.warn(
        `[Subscriber] Student ${studentId} has no active WS connection. Update dropped.`
      );
    }
  });

  return sub;
}

module.exports = { createSubscriber };