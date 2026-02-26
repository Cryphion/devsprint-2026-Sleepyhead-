// kitchen-service/src/routes.js
const express = require("express");
const router = express.Router();
const { getChannel, getQueues } = require("./rabbitmq");
const metrics = require("./metrics");

/**
 * POST /process
 * Called by the Order Gateway after stock is decremented.
 * Pushes the order onto the RabbitMQ queue and returns 202 immediately.
 * The actual cooking happens asynchronously in worker.js.
 */
router.post("/process", async (req, res) => {
  const { itemId, quantity, user } = req.body;

  if (!itemId || !quantity || !user) {
    return res.status(400).json({ message: "itemId, quantity, and user are required" });
  }

  const order = {
    id:        `order_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    userId:    user,
    itemId,
    quantity,
    createdAt: new Date().toISOString()
  };

  try {
    const channel = getChannel();
    if (!channel) throw new Error("RabbitMQ not ready");

    const QUEUE = getQueues();

    // Publish to RabbitMQ — persistent so it survives broker restart
    channel.sendToQueue(
      QUEUE.ORDERS,
      Buffer.from(JSON.stringify(order)),
      {
        persistent: true,
        contentType: "application/json",
        headers: { "x-retry-count": 0 }
      }
    );

    metrics.queuedOrders++;
    metrics.enqueuedOrders.inc();

    console.log(`Order enqueued: ${order.id}`);

    // ✅ Instant acknowledgement — Gateway doesn't wait for cooking
    return res.status(202).json({
      message: "Order accepted",
      orderId: order.id
    });

  } catch (err) {
    console.error("Failed to enqueue order:", err.message);
    return res.status(503).json({ message: "Kitchen unavailable — try again" });
  }
});

module.exports = router;
