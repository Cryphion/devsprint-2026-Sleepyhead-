// notification-service/src/auth.js
const jwt = require("jsonwebtoken");

/**
 * Verify a JWT token.
 * Returns the decoded payload on success, null on failure.
 * Used during the WebSocket upgrade handshake.
 */
function verifyToken(token) {
  if (!token) return null;
  try {
    return jwt.verify(token, process.env.JWT_SECRET);
  } catch {
    return null;
  }
}

module.exports = { verifyToken };
