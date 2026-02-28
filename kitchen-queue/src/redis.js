const Redis = require("ioredis");

// Single client — only used for idempotency state (get/set).
// All message passing is handled by RabbitMQ (see rabbitmq.js).
const client = new Redis(process.env.REDIS_URL || "redis://localhost:6379", {
  maxRetriesPerRequest: 3,
  retryStrategy: (times) => Math.min(times * 200, 2000),
  lazyConnect: false,
});

client.on("error", (err) => console.error("[Redis] client error:", err.message));

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Generic key getter.
 */
async function get(key) {
  return client.get(key);
}

/**
 * Generic key setter with optional TTL (seconds).
 */
async function set(key, value, ttlSeconds = null) {
  if (ttlSeconds) {
    await client.set(key, value, "EX", ttlSeconds);
  } else {
    await client.set(key, value);
  }
}

/**
 * Returns true if Redis is reachable.
 */
async function isHealthy() {
  try {
    const pong = await client.ping();
    return pong === "PONG";
  } catch {
    return false;
  }
}

module.exports = { client, get, set, isHealthy };