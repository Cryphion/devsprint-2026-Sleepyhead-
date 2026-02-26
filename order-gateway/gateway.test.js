// gateway-service/tests/integration/gateway.test.js
// Run via: npm run test:integration
// Requires GATEWAY_URL and JWT_SECRET env vars

const axios = require("axios");
const jwt = require("jsonwebtoken");

const GATEWAY_URL = process.env.GATEWAY_URL || "http://localhost:5000";
const JWT_SECRET = process.env.JWT_SECRET || "test-secret-key";

// Helper: generate a valid test token
function generateToken(payload = { id: "user_123", role: "student" }) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: "1h" });
}

describe("Order Gateway — Integration Tests", () => {

  // ── Health ──────────────────────────────────────
  describe("GET /health", () => {
    it("returns 200 when all dependencies are up", async () => {
      const res = await axios.get(`${GATEWAY_URL}/health`);
      expect(res.status).toBe(200);
    });
  });

  // ── Metrics ─────────────────────────────────────
  describe("GET /metrics", () => {
    it("exposes Prometheus metrics", async () => {
      const res = await axios.get(`${GATEWAY_URL}/metrics`);
      expect(res.status).toBe(200);
      expect(res.data).toContain("gateway_requests_total");
    });
  });

  // ── Auth ─────────────────────────────────────────
  describe("POST /orders — Auth", () => {
    it("rejects requests with no token (401)", async () => {
      try {
        await axios.post(`${GATEWAY_URL}/orders`, { itemId: "item_001", quantity: 1 });
        fail("Expected 401");
      } catch (err) {
        expect(err.response.status).toBe(401);
        expect(err.response.data.message).toMatch(/missing token/i);
      }
    });

    it("rejects requests with a tampered token (401)", async () => {
      try {
        await axios.post(
          `${GATEWAY_URL}/orders`,
          { itemId: "item_001", quantity: 1 },
          { headers: { Authorization: "Bearer fake.token.value" } }
        );
        fail("Expected 401");
      } catch (err) {
        expect(err.response.status).toBe(401);
        expect(err.response.data.message).toMatch(/invalid token/i);
      }
    });
  });

  // ── Order Flow ───────────────────────────────────
  describe("POST /orders — Happy Path", () => {
    it("accepts a valid order with sufficient stock", async () => {
      const token = generateToken();
      const res = await axios.post(
        `${GATEWAY_URL}/orders`,
        { itemId: "item_001", quantity: 1 },
        { headers: { Authorization: `Bearer ${token}` } }
      );
      expect(res.status).toBe(200);
      expect(res.data.message).toBe("Order accepted");
    });
  });

  describe("POST /orders — Edge Cases", () => {
    it("rejects order if cached stock is insufficient (400)", async () => {
      // First drain most stock
      const token = generateToken();
      for (let i = 0; i < 5; i++) {
        await axios.post(
          `${GATEWAY_URL}/orders`,
          { itemId: "item_002", quantity: 10 },
          { headers: { Authorization: `Bearer ${token}` } }
        ).catch(() => {}); // some may fail — that's fine
      }

      // Now try to over-order
      try {
        await axios.post(
          `${GATEWAY_URL}/orders`,
          { itemId: "item_002", quantity: 999 },
          { headers: { Authorization: `Bearer ${token}` } }
        );
        fail("Expected 400 or 500");
      } catch (err) {
        expect([400, 500]).toContain(err.response.status);
      }
    });
  });
});
