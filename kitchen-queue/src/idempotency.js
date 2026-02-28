const { get, set } = require("./redis");

const STATE_PROCESSING = "processing";
const STATE_DONE = "done";

// TTL of 24 hours — keeps Redis clean while covering any realistic order window
const TTL_SECONDS = 60 * 60 * 24;

/**
 * Key pattern: order:{orderId}:state
 */
function stateKey(orderId) {
  return `order:${orderId}:state`;
}

/**
 * Returns true if the order has already been picked up (processing or done).
 * Judges WILL ask about this — it prevents double-cooking on service restart.
 */
async function isAlreadyProcessed(orderId) {
  const state = await get(stateKey(orderId));
  return state === STATE_PROCESSING || state === STATE_DONE;
}

/**
 * Mark order as processing BEFORE doing any work.
 * If the service crashes mid-cook, this flag survives in Redis
 * and prevents a duplicate run when the worker restarts.
 */
async function markProcessing(orderId) {
  await set(stateKey(orderId), STATE_PROCESSING, TTL_SECONDS);
}

/**
 * Mark order as fully done after cooking completes.
 */
async function markDone(orderId) {
  await set(stateKey(orderId), STATE_DONE, TTL_SECONDS);
}

/**
 * Returns the raw state string for an order, or null if unknown.
 * Useful for status queries and testing.
 */
async function getOrderState(orderId) {
  return get(stateKey(orderId));
}

module.exports = { isAlreadyProcessed, markProcessing, markDone, getOrderState };