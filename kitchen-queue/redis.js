const Redis = require("ioredis");
let client = null;

function getRedis() {
  if (!client) {
    client = new Redis(process.env.REDIS_URL || "redis://redis:6379");
    client.on("error", (err) => console.error("Redis error:", err.message));
  }
  return client;
}

module.exports = { getRedis };