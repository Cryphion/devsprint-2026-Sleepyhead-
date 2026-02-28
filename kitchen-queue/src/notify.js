const axios = require("axios");

const NOTIFICATION_HUB_URL =
  process.env.NOTIFICATION_HUB_URL || "http://notification-hub:3004";

/**
 * Sends an order status update to the Notification Hub.
 * The hub then pushes it to the student's browser via WebSocket.
 *
 * Fails silently with a logged warning — a dead notification hub
 * must never crash the kitchen worker or block order processing.
 *
 * @param {string} orderId
 * @param {string} status  — "In Kitchen" | "Ready" | "Failed"
 */
async function notify(orderId, status) {
  try {
    await axios.post(
      `${NOTIFICATION_HUB_URL}/notify`,
      { orderId, status },
      { timeout: 3000 } // don't wait forever if hub is slow/down
    );
    console.log(`[Notify] Order ${orderId} → "${status}" sent to hub`);
  } catch (err) {
    // Log but swallow — notification failure is non-fatal
    console.warn(
      `[Notify] Could not reach notification-hub for order ${orderId}: ${err.message}`
    );
  }
}

module.exports = { notify };