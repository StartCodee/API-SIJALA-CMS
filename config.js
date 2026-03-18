require("dotenv").config();

function trimTrailingSlash(value) {
  return String(value || "").trim().replace(/\/+$/, "");
}

function normalizeList(value, fallback = []) {
  const source = String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

  return source.length > 0 ? source : fallback;
}

function toNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function toPositiveNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

const serverHost = String(process.env.SERVER_HOST || "localhost").trim();
const serverPort = toNumber(process.env.SERVER_PORT || process.env.PORT, 4100);

const publicBaseUrl = trimTrailingSlash(
  process.env.PUBLIC_BASE_URL || `http://${serverHost}:${serverPort}`
);
const ssoIssuer = trimTrailingSlash(process.env.AUTH_ISSUER || "http://localhost:9000");
const ssoInternalBaseUrl = trimTrailingSlash(
  process.env.SSO_INTERNAL_BASE_URL || ssoIssuer
);
const ssoInternalBaseUrls = Array.from(
  new Set(
    normalizeList(process.env.SSO_INTERNAL_BASE_URLS, [
      ssoInternalBaseUrl,
      ssoIssuer,
    ]).map((item) => trimTrailingSlash(item))
  )
);

module.exports = {
  port: serverPort,
  publicBaseUrl,
  frontendOrigin: trimTrailingSlash(
    process.env.FRONTEND_ORIGIN || "http://localhost:8080"
  ),
  corsAllowedOrigins: Array.from(
    new Set(
      normalizeList(process.env.CORS_ALLOWED_ORIGINS, [
        "http://localhost:8080",
        "http://127.0.0.1:8080",
        "http://localhost:5173",
        "http://127.0.0.1:5173",
      ]).map((item) => trimTrailingSlash(item))
    )
  ),
  ssoIssuer,
  ssoInternalBaseUrl,
  ssoInternalBaseUrls,
  ssoClientId: String(process.env.SSO_CLIENT_ID || "cms-dashboard").trim(),
  ssoClientSecret: String(
    process.env.SSO_CLIENT_SECRET || "cms-dashboard-secret"
  ).trim(),
  ssoAllowedClientIds: normalizeList(process.env.SSO_ALLOWED_CLIENT_IDS, [
    "cms-dashboard",
  ]),
  ssoServiceAuthSecret: String(
    process.env.SSO_SERVICE_AUTH_SECRET || "dev-sso-service-auth-secret"
  ).trim(),
  ssoInternalAuthPath: String(
    process.env.SSO_INTERNAL_AUTH_PATH || "/api/internal/login"
  ).trim(),
  ssoHttpTimeoutMs: toNumber(process.env.SSO_HTTP_TIMEOUT_MS, 6000),
  ssoScope: String(
    process.env.SSO_SCOPE || "openid email profile roles offline_access"
  ).trim(),
  authSessionSecret: String(
    process.env.AUTH_SESSION_SECRET ||
      "dev-cms-auth-session-secret-minimum-32-char"
  ).trim(),
  authJwtSecret: String(
    process.env.AUTH_JWT_SECRET ||
      "dev-cms-auth-jwt-secret-minimum-32-characters"
  ).trim(),
  authJwtAudience: String(
    process.env.AUTH_JWT_AUDIENCE || "sijala-cms-api"
  ).trim(),
  accessTokenTtlSeconds: toNumber(process.env.ACCESS_TOKEN_TTL_SECONDS, 900),
  refreshTokenTtlDays: toNumber(process.env.REFRESH_TOKEN_TTL_DAYS, 30),
  refreshCookieName: String(
    process.env.AUTH_REFRESH_COOKIE_NAME || "cms_refresh_token"
  ).trim(),
  cookieSecure:
    String(process.env.COOKIE_SECURE || "").trim().toLowerCase() === "true" ||
    process.env.NODE_ENV === "production",
  cookieSameSite: String(process.env.COOKIE_SAME_SITE || "lax").trim() || "lax",
  cookiePath: String(process.env.AUTH_REFRESH_COOKIE_PATH || "/api/auth").trim(),
  spotFeedFormat: String(process.env.SPOT_FEED_FORMAT || "auto").trim().toLowerCase(),
  spotFeedPollIntervalMs: Math.max(
    60 * 1000,
    toPositiveNumber(process.env.SPOT_FEED_POLL_INTERVAL_MS, 3 * 60 * 1000)
  ),
  spotFeedTimeoutMs: Math.max(
    3 * 1000,
    toPositiveNumber(process.env.SPOT_FEED_TIMEOUT_MS, 15 * 1000)
  ),
  trackerOnlineWindowMinutes: Math.max(
    1,
    toPositiveNumber(process.env.TRACKER_ONLINE_WINDOW_MINUTES, 10)
  ),
  nodeEnv: String(process.env.NODE_ENV || "development").trim(),
};
