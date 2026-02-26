// notification-service/src/metrics.js
const client = require("prom-client");

const register = new client.Registry();
client.collectDefaultMetrics({ register });

const requestCounter = new client.Counter({
  name: "notification_http_requests_total",
  help: "Total HTTP requests received by Notification Hub"
});

const notificationsSent = new client.Counter({
  name: "notifications_sent_total",
  help: "Total WebSocket notifications pushed to clients",
  labelNames: ["status"]
});

const notificationsFailed = new client.Counter({
  name: "notifications_failed_total",
  help: "Total notification dispatch failures"
});

const activeConnections = new client.Gauge({
  name: "notification_active_ws_connections",
  help: "Current number of active WebSocket connections"
});

register.registerMetric(requestCounter);
register.registerMetric(notificationsSent);
register.registerMetric(notificationsFailed);
register.registerMetric(activeConnections);

module.exports = { register, requestCounter, notificationsSent, notificationsFailed, activeConnections };
