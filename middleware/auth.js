const authService = require("../services/authService");

function extractBearerToken(req) {
  const headerValue = req.headers.authorization;
  if (!headerValue) return null;

  const [scheme, token] = String(headerValue).trim().split(/\s+/);
  if (!scheme || !token || scheme.toLowerCase() !== "bearer") {
    return null;
  }

  return token;
}

async function requireAuth(req, _res, next) {
  try {
    const token = extractBearerToken(req);
    req.auth = await authService.authenticateAccessToken(token);
    next();
  } catch (error) {
    next(error);
  }
}

module.exports = {
  requireAuth,
};
