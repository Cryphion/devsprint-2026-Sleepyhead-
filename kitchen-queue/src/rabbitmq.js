const amqp = require("amqplib");

const RABBITMQ_URL = process.env.RABBITMQ_URL || "amqp://guest:guest@rabbitmq:5672";
const QUEUE_NAME = "kitchen.orders";

let connection = null;
let publishChannel = null;
let isConnected = false;

// ── Connection ────────────────────────────────────────────────────────────────

/**
 * Connects to RabbitMQ with retry backoff.
 * Declares the queue as durable so messages survive a broker restart.
 */
async function connect(retries = 10, delayMs = 3000) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      connection = await amqp.connect(RABBITMQ_URL);
      publishChannel = await connection.createChannel();

      // durable: true — queue survives RabbitMQ restart
      await publishChannel.assertQueue(QUEUE_NAME, { durable: true });

      isConnected = true;
      console.log("[RabbitMQ] Connected and queue asserted:", QUEUE_NAME);

      // Auto-reconnect on unexpected close
      connection.on("close", () => {
        isConnected = false;
        console.warn("[RabbitMQ] Connection closed — reconnecting in 5s...");
        setTimeout(() => connect(), 5000);
      });

      connection.on("error", (err) => {
        console.error("[RabbitMQ] Connection error:", err.message);
      });

      return;
    } catch (err) {
      console.warn(
        `[RabbitMQ] Connect attempt ${attempt}/${retries} failed: ${err.message}`
      );
      if (attempt === retries) throw err;
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
}

// ── Publisher ─────────────────────────────────────────────────────────────────

/**
 * Publishes an order object to the kitchen queue.
 * persistent: true ensures the message survives a RabbitMQ restart.
 *
 * @param {object} order — { orderId, studentId, items, enqueuedAt }
 */
async function publishOrder(order) {
  if (!publishChannel) throw new Error("RabbitMQ channel not ready");

  const payload = Buffer.from(JSON.stringify(order));
  publishChannel.sendToQueue(QUEUE_NAME, payload, { persistent: true });
  console.log(`[RabbitMQ] Order ${order.orderId} published to queue`);
}

// ── Consumer ──────────────────────────────────────────────────────────────────

/**
 * Starts consuming messages from the kitchen queue.
 * Uses manual ACK — the message is only removed from the queue after
 * the handler completes successfully. If the worker crashes mid-cook,
 * RabbitMQ redelivers the message automatically.
 *
 * prefetch(1) ensures one order is processed at a time per worker instance.
 *
 * @param {function} handler — async (order) => void
 */
async function consumeOrders(handler) {
  // Dedicated channel for consuming — never share with publishing
  const consumeChannel = await connection.createChannel();
  await consumeChannel.assertQueue(QUEUE_NAME, { durable: true });

  // Only receive 1 message at a time — process fully before taking the next
  consumeChannel.prefetch(1);

  console.log("[RabbitMQ] Waiting for orders...");

  consumeChannel.consume(QUEUE_NAME, async (msg) => {
    if (!msg) return; // consumer cancelled

    let order;
    try {
      order = JSON.parse(msg.content.toString());
    } catch (err) {
      console.error("[RabbitMQ] Failed to parse message — discarding:", err.message);
      consumeChannel.nack(msg, false, false); // discard malformed message
      return;
    }

    try {
      await handler(order);
      // ACK only after successful processing
      consumeChannel.ack(msg);
    } catch (err) {
      console.error(`[RabbitMQ] Handler failed for order ${order?.orderId}:`, err.message);
      // NACK and requeue=false — prevents infinite retry loop on a broken order
      consumeChannel.nack(msg, false, false);
    }
  });
}

// ── Health ────────────────────────────────────────────────────────────────────

/**
 * Returns true if the RabbitMQ connection is active.
 */
function isHealthy() {
  return isConnected;
}

module.exports = { connect, publishOrder, consumeOrders, isHealthy };