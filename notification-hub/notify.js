// notification-service/src/routes/notify.js
const express = require("express");
const redis = require("../redis");

const VALID_STATUSES = ["QUEUED", "COOKING", "READY", "FAILED", "CANCELLED"];

module.exports = function (pushToUser) {
  const router = express.Router();

  // ── POST /notify
  // Called by Kitchen Service when an order status changes.
  // Publishes to Redis so ALL horizontal instances relay it.
  router.post("/", async (req, res) => {
    const { userId, orderId, status, detail } = req.body;

    if (!userId || !orderId || !status) {
      return res.status(400).json({ message: "userId, orderId, and status are required" });
    }

    if (!VALID_STATUSES.includes(status)) {
      return res.status(400).json({
        message: `Invalid status. Must be one of: ${VALID_STATUSES.join(", ")}`
      });
    }

    // Publish to Redis pub/sub — all instances (if scaled) will relay this
    await redis.publish("order-events", JSON.stringify({ userId, orderId, status, detail }));

    return res.status(202).json({ message: "Notification dispatched" });
  });

  // ── GET /notify/history/:userId
  // Frontend fetches this on reconnect to catch up on missed events
  router.get("/history/:userId", async (req, res) => {
    const { userId } = req.params;
    const raw = await redis.lRange(`notifications:${userId}`, 0, 19);
    const notifications = raw.map((n) => JSON.parse(n));
    return res.json({ userId, notifications });
  });

  return router;
};
