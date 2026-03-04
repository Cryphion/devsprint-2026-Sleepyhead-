// mocks/kitchen-mock.js
// Minimal mock for Kitchen Service — used only in CI integration tests
// Implements the endpoint the order-gateway actually calls:
//   POST /order  → { status: "queued" }

const http = require("http");

const server = http.createServer((req, res) => {
  let body = "";
  req.on("data", (chunk) => (body += chunk));
  req.on("end", () => {

    // GET /health
    if (req.method === "GET" && req.url === "/health") {
      res.writeHead(200);
      return res.end("OK");
    }

    // POST /order  ← gateway calls this (not /process)
    if (req.method === "POST" && req.url === "/order") {
      res.writeHead(202, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ status: "queued" }));
    }

    // Keep /process as an alias for backward compatibility
    if (req.method === "POST" && req.url === "/process") {
      res.writeHead(202, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ status: "queued" }));
    }

    res.writeHead(404);
    res.end("Not Found");
  });
});

server.listen(3003, () => console.log("Kitchen mock running on :3003"));