const express = require("express");
const jwt = require("jsonwebtoken");
const dotenv = require("dotenv");
const bcrypt = require("bcryptjs");
const cors = require("cors");
const rateLimit = require("express-rate-limit");
const { Pool } = require("pg");

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3001;
const JWT_SECRET = process.env.JWT_SECRET || "iut_iftar_secret_key";
const RATE_LIMIT_MAX = parseInt(process.env.RATE_LIMIT_MAX) || 3;
const RATE_LIMIT_WINDOW_MS = parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 60000;

// ─────────────────────────────────────────
// PostgreSQL connection
// ─────────────────────────────────────────
const pool = new Pool({
  host:     process.env.DB_HOST     || "localhost",
  port:     parseInt(process.env.DB_PORT) || 5432,
  user:     process.env.DB_USER     || "cafeteria",
  password: process.env.DB_PASSWORD || "secret",
  database: process.env.DB_NAME     || "identity_db",
});

// Create table + seed users on startup
async function initDB() {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS students (
        id          SERIAL PRIMARY KEY,
        student_id  VARCHAR(50) UNIQUE NOT NULL,
        name        VARCHAR(100) NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        role        VARCHAR(20) DEFAULT 'student',
        created_at  TIMESTAMP DEFAULT NOW()
      );
    `);

    // Seed only if table is empty
    const { rows } = await client.query("SELECT COUNT(*) FROM students");
    if (parseInt(rows[0].count) === 0) {
      const seeds = [
        { student_id: "240041130", name: "Tonoy",  password: "tonoy123",  role: "student" },
        { student_id: "240041132", name: "Sabin",  password: "sabin123",  role: "student" },
        { student_id: "240041121", name: "Sakib",  password: "sakib123",  role: "student" },
        { student_id: "admin001",     name: "Admin",  password: "admin123",  role: "admin"   },
      ];

      for (const s of seeds) {
        const hash = await bcrypt.hash(s.password, 10);
        await client.query(
          "INSERT INTO students (student_id, name, password_hash, role) VALUES ($1, $2, $3, $4)",
          [s.student_id, s.name, hash, s.role]
        );
      }
      console.log("[DB] Seeded default students");
      console.log("     220042001 / tonoy123");
      console.log("     220042002 / sabin123");
      console.log("     220042003 / sakib123");
      console.log("     admin     / admin123");
    }

    console.log("[DB] PostgreSQL ready");
  } finally {
    client.release();
  }
}

// ─────────────────────────────────────────
// Metrics counters
// ─────────────────────────────────────────
const metrics = {
  totalRequests: 0,
  loginSuccess:  0,
  loginFailure:  0,
  verifySuccess: 0,
  verifyFailure: 0,
  errors:        0,
  responseTimes: [],  // stores last 100 response times (ms)
};

app.use((req, res, next) => {
  metrics.totalRequests++;
  const start = Date.now();
  res.on("finish", () => {
    const duration = Date.now() - start;
    metrics.responseTimes.push(duration);
    if (metrics.responseTimes.length > 100) metrics.responseTimes.shift();
    if (res.statusCode >= 500) metrics.errors++;
  });
  next();
});

// ─────────────────────────────────────────
// Rate Limiter — 3 attempts per student_id per minute
// ─────────────────────────────────────────
const loginLimiter = rateLimit({
  windowMs: RATE_LIMIT_WINDOW_MS,
  max: RATE_LIMIT_MAX,
  keyGenerator: (req) => req.body?.student_id || req.ip,
  handler: (req, res) => {
    metrics.loginFailure++;
    res.status(429).json({
      message: `Too many login attempts. Try again after ${RATE_LIMIT_WINDOW_MS / 1000} seconds.`,
    });
  },
});

// ─────────────────────────────────────────
// ROUTES
// ─────────────────────────────────────────

app.get("/", (req, res) => {
  res.json({ service: "Identity Provider", status: "running" });
});

// ── Health ──────────────────────────────
app.get("/health", async (req, res) => {
  try {
    await pool.query("SELECT 1");
    res.status(200).json({
      status: "ok",
      service: "identity-provider",
      db: "connected",
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    res.status(503).json({
      status: "unhealthy",
      service: "identity-provider",
      db: "disconnected",
      error: err.message,
    });
  }
});

// ── Metrics ─────────────────────────────
app.get("/metrics", (req, res) => {
  const times = metrics.responseTimes;
  const avgLatency =
    times.length > 0
      ? Math.round(times.reduce((a, b) => a + b, 0) / times.length)
      : 0;

  res.status(200).json({
    service: "identity-provider",
    totalRequests: metrics.totalRequests,
    loginSuccess:  metrics.loginSuccess,
    loginFailure:  metrics.loginFailure,
    verifySuccess: metrics.verifySuccess,
    verifyFailure: metrics.verifyFailure,
    errors:        metrics.errors,
    avgLatencyMs:  avgLatency,
    timestamp:     new Date().toISOString(),
  });
});

// ── Login ────────────────────────────────
// Body: { student_id, password }
// Response: { message, token, name, role }
app.post("/login", loginLimiter, async (req, res) => {
  const { student_id, password } = req.body;

  if (!student_id || !password) {
    metrics.loginFailure++;
    return res.status(400).json({ message: "student_id and password are required" });
  }

  try {
    const { rows } = await pool.query(
      "SELECT * FROM students WHERE student_id = $1",
      [student_id]
    );

    const user = rows[0];
    if (!user) {
      metrics.loginFailure++;
      return res.status(401).json({ message: "Invalid credentials" });
    }

    const isMatch = await bcrypt.compare(password, user.password_hash);
    if (!isMatch) {
      metrics.loginFailure++;
      return res.status(401).json({ message: "Invalid credentials" });
    }

    const token = jwt.sign(
      { id: user.id, student_id: user.student_id, name: user.name, role: user.role },
      JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || "1h" }
    );

    metrics.loginSuccess++;
    res.json({
      message: "Login successful",
      token,
      name: user.name,
      role: user.role,
      student_id: user.student_id,
    });

  } catch (err) {
    console.error("[login] DB error:", err.message);
    res.status(500).json({ message: "Internal server error" });
  }
});

// ── Verify ───────────────────────────────
// Used by Order Gateway to validate tokens.
// Expects:  Authorization: Bearer <token>
app.get("/verify", (req, res) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    metrics.verifyFailure++;
    return res.status(401).json({ message: "No token provided" });
  }

  const token = authHeader.split(" ")[1];

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    metrics.verifySuccess++;
    res.status(200).json({
      valid: true,
      user: {
        id:         decoded.id,
        student_id: decoded.student_id,
        name:       decoded.name,
        role:       decoded.role,
      },
    });
  } catch (err) {
    metrics.verifyFailure++;
    res.status(401).json({ valid: false, message: "Invalid or expired token" });
  }
});

// ── Register (admin/seeding use only) ───
// Body: { student_id, name, password, role }
app.post("/register", async (req, res) => {
  const { student_id, name, password, role } = req.body;
  if (!student_id || !name || !password) {
    return res.status(400).json({ message: "student_id, name, password required" });
  }
  try {
    const hash = await bcrypt.hash(password, 10);
    await pool.query(
      "INSERT INTO students (student_id, name, password_hash, role) VALUES ($1, $2, $3, $4)",
      [student_id, name, hash, role || "student"]
    );
    res.status(201).json({ message: "Student registered" });
  } catch (err) {
    if (err.code === "23505") return res.status(409).json({ message: "Student ID already exists" });
    res.status(500).json({ message: err.message });
  }
});

// ─────────────────────────────────────────
// Start
// ─────────────────────────────────────────
if (require.main === module) {
  initDB()
    .then(() => {
      app.listen(PORT, () => {
        console.log(`[identity-provider] running on port ${PORT}`);
      });
    })
    .catch((err) => {
      console.error("[DB] Failed to initialize:", err.message);
      console.log("[DB] Retrying in 5s...");
      setTimeout(() => initDB().then(() => app.listen(PORT)), 5000);
    });
}

module.exports = { app, pool };