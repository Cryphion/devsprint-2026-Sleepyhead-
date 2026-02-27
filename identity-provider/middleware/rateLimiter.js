// identity-provider/middleware/rateLimiter.js
// Limits login attempts per student ID using Redis as the sliding counter.
// Config via env: RATE_LIMIT_MAX (default 3), RATE_LIMIT_WINDOW_MS (default 60000)

const RATE_LIMIT_MAX = parseInt(process.env.RATE_LIMIT_MAX || "3");
const RATE_LIMIT_WINDOW_SECONDS = Math.floor(
  parseInt(process.env.RATE_LIMIT_WINDOW_MS || "60000") / 1000
);

/**
 * Creates a rate limiter middleware that uses Redis to track attempts.
 * @param {import("ioredis").Redis} redis - shared Redis client instance
 */
function createRateLimiter(redis) {
  return async function rateLimiter(req, res, next) {
    // Key off the student ID in the request body (login endpoint)
    const studentId = req.body?.studentId || req.body?.username || req.ip;
    const key = `ratelimit:login:${studentId}`;

    try {
      // Atomically increment and set TTL on first hit
      const attempts = await redis.incr(key);

      if (attempts === 1) {
        // First attempt in this window — set expiry
        await redis.expire(key, RATE_LIMIT_WINDOW_SECONDS);
      }

      // Set headers so the client knows their current state
      res.setHeader("X-RateLimit-Limit", RATE_LIMIT_MAX);
      res.setHeader("X-RateLimit-Remaining", Math.max(0, RATE_LIMIT_MAX - attempts));

      if (attempts > RATE_LIMIT_MAX) {
        const ttl = await redis.ttl(key);
        res.setHeader("Retry-After", ttl);
        return res.status(429).json({
          message: `Too many login attempts. Try again in ${ttl} seconds.`,
          retryAfter: ttl,
        });
      }

      next();
    } catch (err) {
      // Redis down → fail open (don't block logins over a cache outage)
      console.error("[RateLimiter] Redis error, failing open:", err.message);
      next();
    }
  };
}

module.exports = { createRateLimiter };