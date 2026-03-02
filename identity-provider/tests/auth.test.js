// identity-provider/__tests__/auth.test.js

// ── Mock pg BEFORE requiring server so pool.query never hits a real DB ──
jest.mock("pg", () => {
  const mClient = {
    query:   jest.fn().mockResolvedValue({ rows: [{ count: "1" }] }),
    release: jest.fn(),
  };
  const mPool = {
    query:   jest.fn().mockResolvedValue({ rows: [{ count: "1" }] }),
    connect: jest.fn().mockResolvedValue(mClient),
  };
  return { Pool: jest.fn(() => mPool) };
});

const request = require("supertest");
const jwt     = require("jsonwebtoken");
const { app, pool } = require("../server");   // ← destructure, not default import

const JWT_SECRET = process.env.JWT_SECRET || "iut_iftar_secret_key";

describe("Identity Provider", () => {

  // ── /health ─────────────────────────────────────────────────────
  test("GET /health returns 200", async () => {
    // pool.query is already mocked to resolve — simulates DB "connected"
    const res = await request(app).get("/health");
    expect(res.statusCode).toBe(200);
    expect(res.body.status).toBe("ok");
  });

  // ── /login ──────────────────────────────────────────────────────
  test("POST /login succeeds with valid credentials", async () => {
    const bcrypt = require("bcryptjs");
    const hash   = await bcrypt.hash("tonoy123", 10);

    // Make pool.query return a valid user row for this test
    pool.query.mockResolvedValueOnce({
      rows: [{
        id: 1,
        student_id:    "240041130",
        name:          "Tonoy",
        password_hash: hash,
        role:          "student",
      }],
    });

    const res = await request(app)
      .post("/login")
      .send({ student_id: "240041130", password: "tonoy123" }); // ← student_id not email

    expect(res.statusCode).toBe(200);
    expect(res.body.token).toBeDefined();
    expect(res.body.role).toBe("student");
  });

  test("POST /login fails with wrong password", async () => {
    const bcrypt = require("bcryptjs");
    const hash   = await bcrypt.hash("tonoy123", 10);

    pool.query.mockResolvedValueOnce({
      rows: [{
        id: 1,
        student_id:    "240041130",
        name:          "Tonoy",
        password_hash: hash,
        role:          "student",
      }],
    });

    const res = await request(app)
      .post("/login")
      .send({ student_id: "240041130", password: "wrongpassword" }); // ← student_id not email

    expect(res.statusCode).toBe(401);
  });

  test("POST /login fails with missing fields", async () => {
    const res = await request(app).post("/login").send({});
    expect(res.statusCode).toBe(400);
  });

  // ── /verify ─────────────────────────────────────────────────────
  test("GET /verify rejects request with no token", async () => {
    const res = await request(app).get("/verify");
    expect(res.statusCode).toBe(401);
  });

  test("GET /verify accepts a valid token", async () => {
    const token = jwt.sign(
      { id: 1, student_id: "240041130", name: "Tonoy", role: "student" },
      JWT_SECRET,
      { expiresIn: "1h" }
    );

    const res = await request(app)
      .get("/verify")
      .set("Authorization", `Bearer ${token}`);

    expect(res.statusCode).toBe(200);
    expect(res.body.valid).toBe(true);
    expect(res.body.user.student_id).toBe("240041130");
  });

  test("GET /verify rejects an expired token", async () => {
    const token = jwt.sign(
      { id: 1, student_id: "240041130", name: "Tonoy", role: "student" },
      JWT_SECRET,
      { expiresIn: "-1s" }   // already expired
    );

    const res = await request(app)
      .get("/verify")
      .set("Authorization", `Bearer ${token}`);

    expect(res.statusCode).toBe(401);
    expect(res.body.valid).toBe(false);
  });

});