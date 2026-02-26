// kitchen-service/src/metrics.js
const client = require("prom-client");

const register = new client.Registry();
client.collectDefaultMetrics({ register });

// In-memory counters (also exposed via /health)
let queuedOrders   = 0;
let processedCount = 0;

const requestCounter = new client.Counter({
  name: "kitchen_http_requests_total",
  help: "Total HTTP requests to Kitchen Service"
});

const enqueuedOrders = new client.Counter({
  name: "kitchen_orders_enqueued_total",
  help: "Total orders pushed to RabbitMQ"
});

const processedOrders = new client.Counter({
  name: "kitchen_orders_processed_total",
  help: "Total orders successfully cooked"
});

const failedOrders = new client.Counter({
  name: "kitchen_orders_failed_total",
  help: "Total orders that failed processing"
});

const deadLetteredOrders = new client.Counter({
  name: "kitchen_orders_dead_lettered_total",
  help: "Total orders sent to Dead Letter Queue"
});

const cookingDuration = new client.Histogram({
  name: "kitchen_cooking_duration_seconds",
  help: "Time taken to process (cook) an order",
  buckets: [1, 2, 3, 4, 5, 6, 7, 8, 10]
});

register.registerMetric(requestCounter);
register.registerMetric(enqueuedOrders);
register.registerMetric(processedOrders);
register.registerMetric(failedOrders);
register.registerMetric(deadLetteredOrders);
register.registerMetric(cookingDuration);

module.exports = {
  register,
  requestCounter,
  enqueuedOrders,
  processedOrders,
  failedOrders,
  deadLetteredOrders,
  cookingDuration,
  // mutable counters for /health endpoint
  get queuedOrders()   { return queuedOrders; },
  set queuedOrders(v)  { queuedOrders = v; },
  get processedCount() { return processedCount; },
  set processedCount(v){ processedCount = v; }
};
