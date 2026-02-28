const { consumeOrders } = require("./rabbitmq");
const { isAlreadyProcessed, markProcessing, markDone } = require("./idempotency");
const { notify } = require("./notify");
const { recordSuccess, recordFailure } = require("./metrics");

const PREP_TIME_MIN = parseInt(process.env.PREP_TIME_MIN_MS || "3000");
const PREP_TIME_MAX = parseInt(process.env.PREP_TIME_MAX_MS || "7000");

/**
 * Returns a random integer between min and max (inclusive).
 */
function randomBetween(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/**
 * Simulates cooking delay.
 */
function simulateCooking(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Processes a single order end-to-end.
 * Called by the RabbitMQ consumer for each delivered message.
 * Throws on failure so the consumer can NACK appropriately.
 *
 * @param {object} order — { orderId, studentId, items, enqueuedAt }
 */
async function processOrder(order) {
  const { orderId } = order;
  const startTime = Date.now();

  console.log(`[Worker] Received order ${orderId}`);

  // ── Idempotency check ──────────────────────────────────────────────────────
  // Handles the case where RabbitMQ redelivers a message after a crash.
  // If already processing/done — ACK and skip to avoid double-cooking.
  const alreadyHandled = await isAlreadyProcessed(orderId);
  if (alreadyHandled) {
    console.log(`[Worker] Order ${orderId} already processed — skipping duplicate.`);
    return; // worker returns cleanly → consumer sends ACK
  }

  // Mark BEFORE doing any work — crash-safe flag in Redis
  await markProcessing(orderId);

  // ── Notify: order acknowledged by kitchen ──────────────────────────────────
  await notify(orderId, "In Kitchen");

  // ── Simulate cooking ───────────────────────────────────────────────────────
  const prepTime = randomBetween(PREP_TIME_MIN, PREP_TIME_MAX);
  console.log(`[Worker] Cooking order ${orderId} for ${prepTime}ms...`);
  await simulateCooking(prepTime);

  // ── Mark done & notify ready ───────────────────────────────────────────────
  await markDone(orderId);
  await notify(orderId, "Ready");

  const elapsed = Date.now() - startTime;
  recordSuccess(elapsed);
  console.log(`[Worker] Order ${orderId} ready in ${elapsed}ms`);
}

/**
 * Starts the RabbitMQ consumer.
 * RabbitMQ uses a push model — no while(true) loop needed.
 * Messages are delivered to the handler as they arrive.
 * Manual ACK in rabbitmq.js ensures fault-tolerant delivery.
 */
async function startWorker() {
  console.log("[Worker] Kitchen worker starting — subscribing to RabbitMQ...");

  await consumeOrders(async (order) => {
    try {
      await processOrder(order);
    } catch (err) {
      recordFailure();
      console.error(`[Worker] Failed processing order ${order?.orderId}:`, err.message);
      // Notify frontend so the student isn't left waiting
      await notify(order?.orderId, "Failed").catch(() => {});
      // Re-throw so rabbitmq.js sends a NACK
      throw err;
    }
  });
}

module.exports = { startWorker, processOrder };