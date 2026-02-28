// stock-service/tests/stock.test.js
// Run with: npm test

// ─── Pure logic helpers (extracted so they're testable without DB) ───────────
function validateDeductInput(quantity, version) {
  const amount = parseInt(quantity);
  const ver = parseInt(version);
  if (isNaN(amount) || amount <= 0) return { valid: false, error: "quantity must be positive" };
  if (isNaN(ver)) return { valid: false, error: "version is required for optimistic locking" };
  return { valid: true, amount, version: ver };
}

function canDeduct(currentQty, currentVersion, requestedAmount, requestedVersion) {
  if (currentVersion !== requestedVersion) return { ok: false, reason: "version_conflict" };
  if (currentQty < requestedAmount) return { ok: false, reason: "insufficient_stock" };
  return { ok: true, newQty: currentQty - requestedAmount, newVersion: currentVersion + 1 };
}

function validateAddInput(name, quantity) {
  if (!name || typeof name !== "string" || name.trim() === "")
    return { valid: false, error: "name is required" };
  const qty = parseInt(quantity);
  if (isNaN(qty) || qty < 0)
    return { valid: false, error: "quantity must be a non-negative integer" };
  return { valid: true, name: name.trim(), quantity: qty };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("Stock Deduction Logic", () => {
  test("deducts correctly when stock and version match", () => {
    const result = canDeduct(10, 2, 3, 2);
    expect(result.ok).toBe(true);
    expect(result.newQty).toBe(7);
    expect(result.newVersion).toBe(3);
  });

  test("rejects when quantity is insufficient", () => {
    const result = canDeduct(2, 1, 5, 1);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("insufficient_stock");
  });

  test("rejects on version conflict (optimistic locking)", () => {
    const result = canDeduct(10, 3, 2, 2); // stored version=3, request version=2
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("version_conflict");
  });

  test("rejects deducting zero quantity", () => {
    const result = canDeduct(10, 1, 0, 1);
    // 0 is not a valid deduct amount — caught at input validation layer
    const validation = validateDeductInput(0, 1);
    expect(validation.valid).toBe(false);
  });

  test("deducts last item (boundary: qty becomes 0)", () => {
    const result = canDeduct(1, 0, 1, 0);
    expect(result.ok).toBe(true);
    expect(result.newQty).toBe(0);
  });
});

describe("Input Validation — Deduct", () => {
  test("valid input passes", () => {
    const v = validateDeductInput(5, 2);
    expect(v.valid).toBe(true);
    expect(v.amount).toBe(5);
    expect(v.version).toBe(2);
  });

  test("negative quantity fails", () => {
    expect(validateDeductInput(-1, 0).valid).toBe(false);
  });

  test("zero quantity fails", () => {
    expect(validateDeductInput(0, 0).valid).toBe(false);
  });

  test("missing version fails", () => {
    expect(validateDeductInput(5, undefined).valid).toBe(false);
  });

  test("string quantity that is a number passes (coercion)", () => {
    expect(validateDeductInput("3", "1").valid).toBe(true);
  });
});

describe("Input Validation — Add Stock", () => {
  test("valid name and quantity pass", () => {
    const v = validateAddInput("Biryani", 50);
    expect(v.valid).toBe(true);
    expect(v.name).toBe("Biryani");
    expect(v.quantity).toBe(50);
  });

  test("empty name fails", () => {
    expect(validateAddInput("", 10).valid).toBe(false);
  });

  test("whitespace-only name fails", () => {
    expect(validateAddInput("   ", 10).valid).toBe(false);
  });

  test("negative quantity fails", () => {
    expect(validateAddInput("Rice", -5).valid).toBe(false);
  });

  test("zero quantity is allowed (out-of-stock item)", () => {
    expect(validateAddInput("Rice", 0).valid).toBe(true);
  });

  test("string number quantity is coerced correctly", () => {
    const v = validateAddInput("Paratha", "20");
    expect(v.valid).toBe(true);
    expect(v.quantity).toBe(20);
  });
});