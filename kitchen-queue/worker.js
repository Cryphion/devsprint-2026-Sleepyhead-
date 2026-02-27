// kitchen-service/src/worker.js
const { connect, getChannel, getQueues } = require("./rabbitmq");
const { processOrder } = require("./processor");
const metrics = require("./metrics");

const MAX_RETRIES = 3; // before sending to DLQ

async function startWorker() {
  const channel = await connect();
  const QUEUE = getQueues();

  console.log(`Kitchen worker listening on queue: ${QUEUE.ORDERS}`);

  channel.consume(QUEUE.ORDERS, async (msg) => {
    if (!msg) return; // consumer cancelled

    let order;
    try {
      order = JSON.parse(msg.content.toString());
    } catch {
      // Unparseable message — send to DLQ immediately, don't requeue
      console.error("Invalid message format — discarding to DLQ");
      channel.nack(msg, false, false);
      metrics.failedOrders.inc();
      return;
    }

    const retryCount = (msg.properties.headers?.["x-retry-count"] || 0);
    console.log(`Processing order=${order.id} attempt=${retryCount + 1}`);

    try {
      await processOrder(order);

      // ✅ Success — ack the message (removes from queue)
      channel.ack(msg);
      metrics.processedOrders.inc();
      metrics.processedCount++;

    } catch (err) {
      console.error(`Order ${order.id} failed: ${err.message}`);

      if (retryCount < MAX_RETRIES) {
        // Re-publish with incremented retry count header
        const headers = { ...msg.properties.headers, "x-retry-count": retryCount + 1 };
        channel.nack(msg, false, false); // remove original
        
        // Re-queue with delay simulation (in production use a delay exchange)
        setTimeout(() => {
          getChannel().sendToQueue(
            QUEUE.ORDERS,
            msg.content,
            { persistent: true, headers }
          );
        }, 2000 * (retryCount + 1)); // 2s, 4s, 6s backoff

        console.warn(`Order ${order.id} requeued (retry ${retryCount + 1}/${MAX_RETRIES})`);
      } else {
        // Max retries exceeded — nack without requeue → goes to DLQ
        console.error(`Order ${order.id} sent to Dead Letter Queue after ${MAX_RETRIES} retries`);
        channel.nack(msg, false, false);
        metrics.deadLetteredOrders.inc();
        metrics.failedOrders.inc();
      }
    }
  });
}

module.exports = { startWorker };
