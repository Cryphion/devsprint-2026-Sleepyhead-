// tests/unit/gateway.unit.test.js
// Run via: npm test
// Pure unit tests — no network, no Redis, no external services needed

const jwt = require("jsonwebtoken");

const JWT_SECRET = "test-secret-key";

// ─────────────────────────────────────────
// Helpers (mirrors logic in index.js)
// These are extracted as pure functions so they can be unit tested
// without spinning up Express. If you refactor index.js to export
// these functions, you can import them directly instead.
// ─────────────────────────────────────────

function validateAuthHeader(authHeader, secret) {
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return { valid: false, reason: "Missing token" };
  }
  const token = authHeader.split(" ")[1];
  try {
    const decoded = jwt.verify(token, secret);
    return { valid: true, decoded };
  } catch {
    return { valid: false, reason: "Invalid token" };
  }
}

function validateOrderInput({ itemId, quantity }) {
  if (!itemId || typeof itemId !== "string" || itemId.trim() === "") {
    return { valid: false, reason: "itemId is required" };
  }
  if (!quantity || typeof quantity !== "number" || quantity <= 0 || !Number.isInteger(quantity)) {
    return { valid: false, reason: "quantity must be a positive integer" };
  }
  return { valid: true };
}

function checkCachedStock(cachedValue, requestedQuantity) {
  if (cachedValue === null) return { allowed: true }; // cache miss → let through
  const stock = parseInt(cachedValue, 10);
  if (stock < requestedQuantity) {
    return { allowed: false, reason: "Insufficient stock (cache)" };
  }
  return { allowed: true };
}

// ─────────────────────────────────────────
// TESTS
// ─────────────────────────────────────────

describe("Auth Middleware — validateAuthHeader()", () => {
  it("rejects when Authorization header is missing", () => {
    const result = validateAuthHeader(undefined, JWT_SECRET);
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/missing token/i);
  });

  it("rejects when header does not start with Bearer", () => {
    const result = validateAuthHeader("Token abc123", JWT_SECRET);
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/missing token/i);
  });

  it("rejects a tampered / invalid token", () => {
    const result = validateAuthHeader("Bearer fake.token.value", JWT_SECRET);
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/invalid token/i);
  });

  it("rejects an expired token", () => {
    const expired = jwt.sign({ id: "user_1" }, JWT_SECRET, { expiresIn: "0s" });
    const result = validateAuthHeader(`Bearer ${expired}`, JWT_SECRET);
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/invalid token/i);
  });

  it("accepts a valid token and returns decoded payload", () => {
    const token = jwt.sign({ id: "user_123", role: "student" }, JWT_SECRET, { expiresIn: "1h" });
    const result = validateAuthHeader(`Bearer ${token}`, JWT_SECRET);
    expect(result.valid).toBe(true);
    expect(result.decoded.id).toBe("user_123");
    expect(result.decoded.role).toBe("student");
  });
});

describe("Order Validation — validateOrderInput()", () => {
  it("rejects when itemId is missing", () => {
    const result = validateOrderInput({ quantity: 2 });
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/itemId/i);
  });

  it("rejects when itemId is an empty string", () => {
    const result = validateOrderInput({ itemId: "   ", quantity: 2 });
    expect(result.valid).toBe(false);
  });

  it("rejects when quantity is missing", () => {
    const result = validateOrderInput({ itemId: "item_001" });
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/quantity/i);
  });

  it("rejects when quantity is zero", () => {
    const result = validateOrderInput({ itemId: "item_001", quantity: 0 });
    expect(result.valid).toBe(false);
  });

  it("rejects when quantity is negative", () => {
    const result = validateOrderInput({ itemId: "item_001", quantity: -5 });
    expect(result.valid).toBe(false);
  });

  it("rejects when quantity is a float", () => {
    const result = validateOrderInput({ itemId: "item_001", quantity: 1.5 });
    expect(result.valid).toBe(false);
  });

  it("accepts a valid order payload", () => {
    const result = validateOrderInput({ itemId: "item_001", quantity: 3 });
    expect(result.valid).toBe(true);
  });
});

describe("Stock Deduction — checkCachedStock()", () => {
  it("allows order when cache is empty (cache miss)", () => {
    const result = checkCachedStock(null, 5);
    expect(result.allowed).toBe(true);
  });

  it("allows order when cached stock is sufficient", () => {
    const result = checkCachedStock("100", 10);
    expect(result.allowed).toBe(true);
  });

  it("allows order when cached stock exactly equals requested quantity", () => {
    const result = checkCachedStock("5", 5);
    expect(result.allowed).toBe(true);
  });

  it("rejects order when cached stock is insufficient", () => {
    const result = checkCachedStock("3", 10);
    expect(result.allowed).toBe(false);
    expect(result.reason).toMatch(/insufficient stock/i);
  });

  it("rejects order when cached stock is zero", () => {
    const result = checkCachedStock("0", 1);
    expect(result.allowed).toBe(false);
  });
});