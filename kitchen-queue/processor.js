// kitchen-service/src/processor.js
const axios = require("axios");
const { getRedis } = require("./redis");
const metrics = require("./metrics");

const NOTIFICATION_URL = process.env.NOTIFICATION_URL || "http://notification-service:3000";
const COOKING_TIME_MIN = parseInt(process.env.COOKING_TIME_MIN || "3000");
const COOKING_TIME_MAX = parseInt(process.env.COOKING_TIME_MAX || "7000");

/**
 * Full order processing pipeline:
 * 1. Idempotency check  — skip if already processed
 * 2. Notify COOKING     — user sees "Preparing your order"
 * 3. Simulate cooking   — 3–7 second delay
 * 4. Notify READY       — user sees "Your order is ready!"
 * 5. Mark done          — store in Redis to prevent re-processing
 */
async function processOrder(order) {
  const redis = getRedis();
  const idempotencyKey = `processed:${order.id}`;

  // ── 1. Idempotency Check ────────────────────────────────────
  const alreadyDone = await redis.get(idempotencyKey);
  if (alreadyDone) {
    console.log(`Order ${order.id} already processed — skipping`);
    return; // ack without re-processing
  }

  const startTime = Date.now();

  // ── 2. Notify: COOKING ──────────────────────────────────────
  await notify(order, "COOKING", "Your order is being prepared 🍽️");

  // ── 3. Simulate Cooking ─────────────────────────────────────
  const cookingTime = randomBetween(COOKING_TIME_MIN, COOKING_TIME_MAX);
  console.log(`Cooking order=${order.id} for ${cookingTime}ms`);
  await sleep(cookingTime);

  // ── 4. Notify: READY ────────────────────────────────────────
  await notify(order, "READY", "Your order is ready for pickup! 🎉");

  // ── 5. Mark as Done (idempotency — 24hr TTL) ─────────────────
  await redis.set(idempotencyKey, "done", { EX: 86400 });

  // ── 6. Track Metrics ─────────────────────────────────────────
  const duration = (Date.now() - startTime) / 1000;
  metrics.cookingDuration.observe(duration);

  console.log(`Order ${order.id} completed in ${duration.toFixed(2)}s`);
}

async function notify(order, status, detail) {
  try {
    await axios.post(`${NOTIFICATION_URL}/notify`, {
      userId:  order.userId,
      orderId: order.id,
      status,
      detail
    });
  } catch (err) {
    // Notification failure must NOT fail the order processing
    // The order is still cooked — we just couldn't push the update
    console.warn(`Notification failed for order=${order.id} status=${status}: ${err.message}`);
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function randomBetween(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

module.exports = { processOrder };
