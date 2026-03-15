const express = require("express");
const config = require("../config");
const authService = require("../services/authService");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();

function wantsCookieAuth(req) {
  return String(req.get("x-auth-mode") || "").trim().toLowerCase() === "cookie";
}

function readRefreshToken(req) {
  const tokenFromBody = req.body && typeof req.body.refreshToken === "string"
    ? req.body.refreshToken.trim()
    : "";
  if (tokenFromBody) {
    return { token: tokenFromBody, source: "body" };
  }

  const tokenFromHeader = typeof req.get("x-refresh-token") === "string"
    ? req.get("x-refresh-token").trim()
    : "";
  if (tokenFromHeader) {
    return { token: tokenFromHeader, source: "header" };
  }

  const tokenFromCookie = req.cookies?.[config.refreshCookieName];
  if (typeof tokenFromCookie === "string" && tokenFromCookie.trim()) {
    return { token: tokenFromCookie.trim(), source: "cookie" };
  }

  return { token: null, source: "none" };
}

function buildRefreshCookieOptions() {
  return {
    httpOnly: true,
    secure: config.cookieSecure,
    sameSite: config.cookieSameSite,
    path: config.cookiePath,
    maxAge: config.refreshTokenTtlDays * 24 * 60 * 60 * 1000,
  };
}

function writeRefreshCookie(res, refreshToken) {
  res.cookie(config.refreshCookieName, refreshToken, buildRefreshCookieOptions());
}

function clearRefreshCookie(res) {
  res.clearCookie(config.refreshCookieName, {
    httpOnly: true,
    secure: config.cookieSecure,
    sameSite: config.cookieSameSite,
    path: config.cookiePath,
  });
}

function extractRequestOrigin(req) {
  const forwardedOrigin = req.get("x-forwarded-origin");
  if (forwardedOrigin) return forwardedOrigin;

  const directOrigin = req.get("origin");
  if (directOrigin) return directOrigin;

  return null;
}

function sendAuthSession(req, res, session, options = {}) {
  const cookieMode = options.forceCookieMode === true || wantsCookieAuth(req);

  if (cookieMode) {
    writeRefreshCookie(res, session.refreshToken);
    const { refreshToken, ...payload } = session;
    res.json(payload);
    return;
  }

  res.json(session);
}

router.use((_req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  next();
});

router.post("/login", async (req, res, next) => {
  try {
    const session = await authService.loginLocal(
      req.body?.usernameOrEmail,
      req.body?.password
    );
    sendAuthSession(req, res, session);
  } catch (error) {
    next(error);
  }
});

router.get("/sso/login-url", async (req, res, next) => {
  try {
    const payload = await authService.buildSsoLoginUrl({
      requestOrigin: extractRequestOrigin(req),
    });
    res.json(payload);
  } catch (error) {
    next(error);
  }
});

router.get("/sso/start", async (req, res, next) => {
  try {
    const payload = await authService.buildSsoLoginUrl({
      requestOrigin: extractRequestOrigin(req),
    });
    res.redirect(302, payload.authorizeUrl);
  } catch (error) {
    next(error);
  }
});

router.get("/sso/logout-url", async (req, res, next) => {
  try {
    const payload = await authService.buildSsoLogoutUrl({
      requestOrigin: extractRequestOrigin(req),
    });
    res.json(payload);
  } catch (error) {
    next(error);
  }
});

router.post("/sso/exchange", async (req, res, next) => {
  try {
    const session = await authService.exchangeSsoAuthorizationCode(
      req.body?.code,
      req.body?.state
    );
    sendAuthSession(req, res, session);
  } catch (error) {
    next(error);
  }
});

router.post("/refresh", async (req, res, next) => {
  try {
    const tokenResult = readRefreshToken(req);
    const session = await authService.refreshSession(tokenResult.token);
    sendAuthSession(req, res, session, {
      forceCookieMode: tokenResult.source === "cookie",
    });
  } catch (error) {
    next(error);
  }
});

router.post("/logout", async (req, res, next) => {
  try {
    const tokenResult = readRefreshToken(req);
    if (tokenResult.token) {
      await authService.revokeRefreshToken(tokenResult.token);
    }

    if (wantsCookieAuth(req) || tokenResult.source === "cookie") {
      clearRefreshCookie(res);
    }

    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

router.get("/me", requireAuth, (req, res) => {
  res.json(req.auth);
});

module.exports = router;
