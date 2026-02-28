/**
 * In-memory metrics store.
 * Resets on service restart — good enough for hackathon scale.
 * For production you'd persist these to Redis or push to Prometheus.
 */

let totalProcessed = 0;
let totalFailures = 0;
let totalLatencyMs = 0;

/**
 * Call this after a successful cook cycle.
 * @param {number} latencyMs - Total time from queue pop to "Ready" in ms
 */
function recordSuccess(latencyMs) {
  totalProcessed += 1;
  totalLatencyMs += latencyMs;
}

/**
 * Call this when an order fails during processing.
 */
function recordFailure() {
  totalFailures += 1;
}

/**
 * Returns a snapshot of current metrics.
 * Exposed on GET /metrics for the admin dashboard and Prometheus scraping.
 */
function getMetrics() {
  const avgLatencyMs =
    totalProcessed > 0
      ? Math.round(totalLatencyMs / totalProcessed)
      : 0;

  return {
    totalProcessed,
    totalFailures,
    avgLatencyMs,
    uptime: Math.floor(process.uptime()),
  };
}

/**
 * Resets all counters — used in tests to get a clean slate.
 */
function resetMetrics() {
  totalProcessed = 0;
  totalFailures = 0;
  totalLatencyMs = 0;
}

module.exports = { recordSuccess, recordFailure, getMetrics, resetMetrics };