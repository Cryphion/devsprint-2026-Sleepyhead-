// mocks/stock-mock.js
// Minimal mock for Stock Service — used only in CI integration tests
// Implements the endpoints the order-gateway actually calls:
//   GET   /api/stocks/:id         → { id, name, quantity, price, version }
//   PUT   /api/stocks/:id         → updated item
//   PATCH /api/stocks/:id/deduct  → deducted item, or 409/422 on conflict

const http = require("http");

const stock = {
  item_001: { id: "item_001", name: "Beguni", quantity: 100, price: 10, version: 1 },
  item_002: { id: "item_002", name: "Samosa", quantity:  50, price: 10, version: 1 },
};

const server = http.createServer((req, res) => {
  let body = "";
  req.on("data", (chunk) => (body += chunk));
  req.on("end", () => {

    // GET /health
    if (req.method === "GET" && req.url === "/health") {
      res.writeHead(200);
      return res.end("OK");
    }

    // GET /api/stocks  (list)
    if (req.method === "GET" && req.url === "/api/stocks") {
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify(Object.values(stock)));
    }

    // GET /api/stocks/:id
    if (req.method === "GET" && /^\/api\/stocks\/[^/]+$/.test(req.url)) {
      const id = req.url.split("/").pop();
      const item = stock[id];
      if (!item) { res.writeHead(404); return res.end("Not found"); }
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify(item));
    }

    // PUT /api/stocks/:id  (admin quantity update)
    if (req.method === "PUT" && /^\/api\/stocks\/[^/]+$/.test(req.url)) {
      const id = req.url.split("/").pop();
      const item = stock[id];
      if (!item) { res.writeHead(404); return res.end("Not found"); }
      try {
        const { quantity } = JSON.parse(body);
        item.quantity = quantity;
        item.version++;
        res.writeHead(200, { "Content-Type": "application/json" });
        return res.end(JSON.stringify(item));
      } catch { res.writeHead(400); return res.end("Bad request"); }
    }

    // PATCH /api/stocks/:id/deduct  (optimistic-lock deduction)
    if (req.method === "PATCH" && req.url.endsWith("/deduct")) {
      const id = req.url.split("/")[3]; // /api/stocks/:id/deduct
      const item = stock[id];
      if (!item) { res.writeHead(404); return res.end("Not found"); }
      try {
        const { quantity, version } = JSON.parse(body);
        if (version !== undefined && version !== item.version) {
          res.writeHead(409, { "Content-Type": "application/json" });
          return res.end(JSON.stringify({ error: "Version conflict" }));
        }
        if (item.quantity < quantity) {
          res.writeHead(422, { "Content-Type": "application/json" });
          return res.end(JSON.stringify({ error: "Insufficient stock" }));
        }
        item.quantity -= quantity;
        item.version++;
        res.writeHead(200, { "Content-Type": "application/json" });
        return res.end(JSON.stringify(item));
      } catch { res.writeHead(500); return res.end("Error"); }
    }

    res.writeHead(404);
    res.end("Not Found");
  });
});

server.listen(3002, () => console.log("Stock mock running on :3002"));