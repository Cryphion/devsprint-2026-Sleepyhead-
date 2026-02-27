// mocks/stock-mock.js
// Minimal mock for Stock Service — used only in CI integration tests

const http = require("http");

const stock = { item_001: 100, item_002: 50 };

const server = http.createServer((req, res) => {
  let body = "";
  req.on("data", (chunk) => (body += chunk));
  req.on("end", () => {
    // Health check
    if (req.method === "GET" && req.url === "/health") {
      res.writeHead(200);
      return res.end("OK");
    }

    // Decrement stock
    if (req.method === "POST" && req.url === "/decrement") {
      try {
        const { itemId, quantity } = JSON.parse(body);

        if (!stock[itemId] || stock[itemId] < quantity) {
          res.writeHead(400, { "Content-Type": "application/json" });
          return res.end(JSON.stringify({ error: "Insufficient stock" }));
        }

        stock[itemId] -= quantity;
        res.writeHead(200, { "Content-Type": "application/json" });
        return res.end(JSON.stringify({ remaining: stock[itemId] }));
      } catch {
        res.writeHead(500);
        return res.end("Error");
      }
    }

    res.writeHead(404);
    res.end("Not Found");
  });
});

server.listen(3002, () => console.log("Stock mock running on :3002"));
