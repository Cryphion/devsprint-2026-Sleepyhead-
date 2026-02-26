const express = require("express");
const jwt = require("jsonwebtoken");
const dotenv = require("dotenv");
const bcrypt = require("bcryptjs");
const cors = require("cors");
const rateLimit = require("express-rate-limit");

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3001;
const JWT_SECRET = process.env.JWT_SECRET || "iut_iftar_secret_key";
const RATE_LIMIT_MAX = parseInt(process.env.RATE_LIMIT_MAX) || 3;
const RATE_LIMIT_WINDOW_MS = parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 60000;

// ─────────────────────────────────────────
// Metrics counters
// ─────────────────────────────────────────
const metrics = {
  totalRequests: 0,
  loginSuccess: 0,
  loginFailure: 0,
  verifySuccess: 0,
  verifyFailure: 0,
  errors: 0,
  responseTimes: [],  // stores last 100 response times (ms)
};

// Middleware to count requests and track latency
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
// Rate Limiter — 3 login attempts per minute per IP
// (uses RATE_LIMIT_MAX and RATE_LIMIT_WINDOW_MS from .env)
// ─────────────────────────────────────────
const loginLimiter = rateLimit({
  windowMs: RATE_LIMIT_WINDOW_MS,
  max: RATE_LIMIT_MAX,
  keyGenerator: (req) => req.body?.email || req.ip, // rate limit per student email
  handler: (req, res) => {
    metrics.loginFailure++;
    res.status(429).json({
      message: `Too many login attempts. Try again after ${RATE_LIMIT_WINDOW_MS / 1000} seconds.`,
    });
  },
});

// ─────────────────────────────────────────
// In-memory users (replace with DB later)
// ─────────────────────────────────────────
const users = [
  {
    id: 1,
    name: "Tonoy",
    email: "tonoy@iut-dhaka.edu",
    password: bcrypt.hashSync("tonoy123", 10),
  },
  {
    id: 2,
    name: "Sabin",
    email: "sabin@iut-dhaka.edu",
    password: bcrypt.hashSync("sabin123", 10),
  },
  {
    id: 3,
    name: "Sakib",
    email: "sakib@iut-dhaka.edu",
    password: bcrypt.hashSync("sakib123", 10),
  },
];

// ─────────────────────────────────────────
// ROUTES
// ─────────────────────────────────────────

// Root
app.get("/", (req, res) => {
  res.json({ service: "Identity Provider", status: "running" });
});

// ── Health ──────────────────────────────
// Returns 200 if service is up, 503 if something critical is down.
// Other services (order-gateway) depend on this to start.
app.get("/health", (req, res) => {
  // For now we have no external dependencies (no DB/Redis connected in code).
  // When you add Postgres/Redis, check their connection here and return 503 if down.
  res.status(200).json({
    status: "ok",
    service: "identity-provider",
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
  });
});

// ── Metrics ─────────────────────────────
// Machine-readable data for the admin monitoring dashboard.
app.get("/metrics", (req, res) => {
  const times = metrics.responseTimes;
  const avgLatency =
    times.length > 0
      ? Math.round(times.reduce((a, b) => a + b, 0) / times.length)
      : 0;

  res.status(200).json({
    service: "identity-provider",
    totalRequests: metrics.totalRequests,
    loginSuccess: metrics.loginSuccess,
    loginFailure: metrics.loginFailure,
    verifySuccess: metrics.verifySuccess,
    verifyFailure: metrics.verifyFailure,
    errors: metrics.errors,
    avgLatencyMs: avgLatency,
    timestamp: new Date().toISOString(),
  });
});

// ── Login ────────────────────────────────
// Rate limited to RATE_LIMIT_MAX attempts per student email per window.
app.post("/login", loginLimiter, async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    metrics.loginFailure++;
    return res.status(400).json({ message: "Email and password required" });
  }

  const user = users.find((u) => u.email === email);
  if (!user) {
    metrics.loginFailure++;
    return res.status(401).json({ message: "Invalid credentials" });
  }

  const isMatch = await bcrypt.compare(password, user.password);
  if (!isMatch) {
    metrics.loginFailure++;
    return res.status(401).json({ message: "Invalid credentials" });
  }

  const token = jwt.sign(
    { id: user.id, email: user.email, name: user.name },
    JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || "1h" }
  );

  metrics.loginSuccess++;
  res.json({ message: "Login successful", token, name: user.name });
});

// ── Verify ───────────────────────────────
// Used by other services (Order Gateway) to validate a JWT
// without sharing the secret — they just call this endpoint.
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
        id: decoded.id,
        email: decoded.email,
        name: decoded.name,
      },
    });
  } catch (err) {
    metrics.verifyFailure++;
    res.status(401).json({ valid: false, message: "Invalid or expired token" });
  }
});

// ─────────────────────────────────────────
// Start
// ─────────────────────────────────────────
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Identity Provider running on port ${PORT}`);
  });
}

module.exports = app;