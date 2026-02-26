// kitchen-service/src/rabbitmq.js
const amqp = require("amqplib");

const RABBITMQ_URL = process.env.RABBITMQ_URL || "amqp://guest:guest@rabbitmq:5672";

// Queue and exchange names — shared constants
const QUEUE = {
  ORDERS:      "kitchen.orders",       // main work queue
  DEAD_LETTER: "kitchen.orders.dlq"    // failed orders land here
};

const EXCHANGE = {
  DEAD_LETTER: "kitchen.dlx"           // dead-letter exchange
};

let connection = null;
let channel = null;

/**
 * Connect to RabbitMQ with exponential backoff.
 * Sets up:
 *  - A dead-letter exchange (DLX)
 *  - The dead-letter queue (DLQ)
 *  - The main kitchen.orders queue (wired to DLX on rejection)
 */
async function connect(retries = 10, delay = 3000) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      console.log(`RabbitMQ: connecting (attempt ${attempt}/${retries})...`);
      connection = await amqp.connect(RABBITMQ_URL);
      channel = await connection.createChannel();

      // ── Dead-Letter Exchange ───────────────────────────────────
      await channel.assertExchange(EXCHANGE.DEAD_LETTER, "direct", { durable: true });

      // ── Dead-Letter Queue ──────────────────────────────────────
      await channel.assertQueue(QUEUE.DEAD_LETTER, { durable: true });
      await channel.bindQueue(QUEUE.DEAD_LETTER, EXCHANGE.DEAD_LETTER, QUEUE.ORDERS);

      // ── Main Orders Queue ──────────────────────────────────────
      // Messages that are nack'd (rejected) are routed to the DLQ.
      await channel.assertQueue(QUEUE.ORDERS, {
        durable: true,          // survives RabbitMQ restart
        arguments: {
          "x-dead-letter-exchange":    EXCHANGE.DEAD_LETTER,
          "x-dead-letter-routing-key": QUEUE.ORDERS,
          "x-message-ttl":             60000 * 30  // 30 min TTL
        }
      });

      // Only pull 1 message at a time — fair dispatch
      channel.prefetch(1);

      console.log("RabbitMQ connected ✅");

      // Auto-reconnect on unexpected close
      connection.on("close", () => {
        console.warn("RabbitMQ connection closed — reconnecting...");
        setTimeout(() => connect(), delay);
      });

      connection.on("error", (err) => {
        console.error("RabbitMQ connection error:", err.message);
      });

      return channel;

    } catch (err) {
      console.error(`RabbitMQ attempt ${attempt} failed: ${err.message}`);
      if (attempt === retries) throw new Error("RabbitMQ: max retries exceeded");
      await new Promise(r => setTimeout(r, delay * attempt)); // backoff
    }
  }
}

function getChannel() {
  return channel;
}

function getQueues() {
  return QUEUE;
}

module.exports = { connect, getChannel, getQueues };
