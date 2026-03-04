"use strict";

/**
 * notify.js — Kitchen Queue
 * --------------------------
 * Publishes order status updates directly to the Redis "order_updates" channel.
 * The Notification Hub's subscriber.js picks this up and pushes the update
 * to the student's browser via WebSocket — no direct HTTP call needed.
 *
 * This decouples the kitchen worker from the notification-hub entirely:
 * if the hub is down, cooking still completes and the message is dropped
 * gracefully rather than crashing the worker.
 */

const Redis = require("ioredis");

const REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";
const CHANNEL   = "order_updates";

const publisher = new Redis(REDIS_URL, {
  lazyConnect: false,
  retryStrategy(times) {
    const delay = Math.min(times * 200, 5000);
    console.log(`[Notify] Redis reconnect attempt #${times} in ${delay}ms`);
    return delay;
  },
});

publisher.on("connect", () => console.log("[Notify] Redis publisher connected"));
publisher.on("error",   (err) => console.warn("[Notify] Redis error:", err.message));

/**
 * Publish an order status update.
 * Fails silently — a Redis blip must never crash the kitchen worker.
 *
 * @param {string} orderId
 * @param {string} studentId  — routes the push to the correct WebSocket client
 * @param {string} status     — "In Kitchen" | "Ready" | "Failed"
 */
async function notify(orderId, studentId, status) {
  try {
    await publisher.publish(
      CHANNEL,
      JSON.stringify({
        orderId,
        studentId,
        status,
        timestamp: new Date().toISOString(),
      })
    );
    console.log(`[Notify] Published → order ${orderId} "${status}" for student ${studentId}`);
  } catch (err) {
    // Non-fatal — order processing continues even if notification fails
    console.warn(`[Notify] Could not publish for order ${orderId}: ${err.message}`);
  }
}

module.exports = { notify };