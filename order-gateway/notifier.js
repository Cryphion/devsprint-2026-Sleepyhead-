"use strict";

/**
 * notifier.js — Order Gateway
 * ----------------------------
 * Same Redis publish pattern as kitchen-queue/notify.js.
 * Fires the early status steps: "Pending" and "Stock Verified".
 */

const Redis = require("ioredis");

const REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";
const CHANNEL   = "order_updates";

const publisher = new Redis(REDIS_URL, {
  lazyConnect: false,
  retryStrategy(times) {
    return Math.min(times * 200, 5000);
  },
});

publisher.on("connect", () => console.log("[Notifier] Redis publisher connected"));
publisher.on("error",   (err) => console.warn("[Notifier] Redis error:", err.message));

async function publish({ orderId, studentId, status }) {
  try {
    await publisher.publish(CHANNEL, JSON.stringify({
      orderId, studentId, status,
      timestamp: new Date().toISOString(),
    }));
    console.log(`[Notifier] ${orderId} → "${status}" for ${studentId}`);
  } catch (err) {
    console.warn(`[Notifier] Publish failed for ${orderId}: ${err.message}`);
  }
}

module.exports = { publish };