const crypto = require("crypto");
const db = require("../db");
const config = require("../config");

let metadataCache = null;
let metadataExpiresAt = 0;
let jwksCache = null;
let jwksCacheUrl = null;
let josePromise = null;
let activeSsoBaseUrl = null;

function getJose() {
  if (!josePromise) {
    josePromise = import("jose");
  }
  return josePromise;
}

function createError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function randomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString("base64url");
}

function hashToken(token) {
  return crypto.createHash("sha256").update(String(token || "")).digest("hex");
}

function createPkceCodeVerifier() {
  return randomToken(48);
}

function toPkceCodeChallenge(verifier) {
  return crypto
    .createHash("sha256")
    .update(verifier)
    .digest("base64url");
}

function signState(payload) {
  const serialized = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = crypto
    .createHmac("sha256", config.authSessionSecret)
    .update(serialized)
    .digest("base64url");
  return `${serialized}.${signature}`;
}

function verifyState(state) {
  const [serialized, signature] = String(state || "").trim().split(".");
  if (!serialized || !signature) {
    throw createError(400, "State login SSO tidak valid.");
  }

  const expected = crypto
    .createHmac("sha256", config.authSessionSecret)
    .update(serialized)
    .digest("base64url");

  const providedBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  if (
    providedBuffer.length !== expectedBuffer.length ||
    !crypto.timingSafeEqual(providedBuffer, expectedBuffer)
  ) {
    throw createError(400, "State login SSO tidak valid.");
  }

  try {
    const payload = JSON.parse(
      Buffer.from(serialized, "base64url").toString("utf8")
    );
    const issuedAt = Number(payload?.iat || 0);
    const maxAgeSeconds = 10 * 60;
    if (!issuedAt || Date.now() / 1000 - issuedAt > maxAgeSeconds) {
      throw new Error("expired");
    }
    return payload;
  } catch {
    throw createError(400, "State login SSO tidak valid.");
  }
}

function normalizeList(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => String(item || "").trim())
    .filter((item) => item.length > 0);
}

function getSsoBaseCandidates() {
  return Array.from(
    new Set(
      [
        activeSsoBaseUrl,
        ...(Array.isArray(config.ssoInternalBaseUrls)
          ? config.ssoInternalBaseUrls
          : []),
        config.ssoInternalBaseUrl,
        config.ssoIssuer,
      ].filter((item) => Boolean(item && String(item).trim()))
    )
  );
}

function toSsoInternalUrl(targetUrl, baseUrl) {
  const target = new URL(targetUrl, `${config.ssoIssuer}/`);
  const internalBase = new URL(
    baseUrl ||
      activeSsoBaseUrl ||
      config.ssoInternalBaseUrls[0] ||
      config.ssoInternalBaseUrl ||
      config.ssoIssuer
  );

  target.protocol = internalBase.protocol;
  target.hostname = internalBase.hostname;
  target.port = internalBase.port;
  return target.toString();
}

function toSsoPublicUrl(targetUrl) {
  const target = new URL(targetUrl, `${config.ssoIssuer}/`);
  const publicBase = new URL(config.ssoIssuer);
  target.protocol = publicBase.protocol;
  target.hostname = publicBase.hostname;
  target.port = publicBase.port;
  return target.toString();
}

function isRetryableSsoConnectionError(error) {
  if (!(error instanceof Error)) return false;
  if (error.name === "AbortError") return true;
  if (error instanceof TypeError) return true;

  const cause = error.cause;
  if (!cause || typeof cause !== "object") return false;

  const code = cause.code;
  if (typeof code !== "string") return false;

  return ["ENOTFOUND", "EAI_AGAIN", "ECONNREFUSED", "ETIMEDOUT", "ECONNRESET"].includes(code);
}

async function fetchWithTimeout(url, init) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.ssoHttpTimeoutMs);

  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchFromSso(targetUrl, init, options = {}) {
  const retryableStatuses = options.retryableStatuses || [];
  let lastNetworkError = null;
  let lastResponse = null;

  for (const baseUrl of getSsoBaseCandidates()) {
    const resolvedUrl = toSsoInternalUrl(targetUrl, baseUrl);

    try {
      const response = await fetchWithTimeout(resolvedUrl, init);
      if (response.ok) {
        activeSsoBaseUrl = new URL(resolvedUrl).origin;
        return response;
      }

      if (retryableStatuses.includes(response.status)) {
        lastResponse = response;
        continue;
      }

      activeSsoBaseUrl = new URL(resolvedUrl).origin;
      return response;
    } catch (error) {
      if (!isRetryableSsoConnectionError(error)) {
        throw error;
      }

      lastNetworkError = error;
    }
  }

  if (lastResponse) {
    return lastResponse;
  }

  const detail = lastNetworkError?.message
    ? ` (${lastNetworkError.message})`
    : "";
  throw createError(502, `Tidak dapat menghubungi SSO.${detail}`);
}

async function readSsoErrorPayload(response) {
  try {
    const payload = await response.json();
    return payload && typeof payload === "object" ? payload : {};
  } catch {
    return {};
  }
}

function resolveFrontendOrigin(requestOrigin) {
  const candidate = String(requestOrigin || "").trim();
  if (!candidate) return config.frontendOrigin;

  try {
    const parsed = new URL(candidate);
    return `${parsed.protocol}//${parsed.host}`;
  } catch {
    return config.frontendOrigin;
  }
}

function resolveCallbackUrl(requestOrigin) {
  return `${resolveFrontendOrigin(requestOrigin)}/auth/callback`;
}

function resolvePostLogoutRedirectUrl(requestOrigin) {
  return `${resolveFrontendOrigin(requestOrigin)}/login`;
}

function buildProfile(user) {
  const roles = normalizeList(user.roles);
  const apps = normalizeList(user.apps);
  const role = user.isSuperAdmin ? "super_admin" : roles[0] || "viewer";
  const fullName = String(user.name || user.fullName || user.email || "Pengguna").trim();

  return {
    sub: String(user.sub || "").trim(),
    email: String(user.email || "").trim(),
    fullName,
    name: fullName,
    role,
    roles,
    apps,
    isSuperAdmin: Boolean(user.isSuperAdmin),
  };
}

function ensureCmsAccess(claims) {
  const roles = normalizeList(claims.roles);
  const apps = normalizeList(claims.apps);
  const isSuperAdmin =
    claims.is_super_admin === true ||
    roles.includes("super_admin") ||
    roles.includes("superadmin");

  if (!isSuperAdmin && !apps.includes(config.ssoClientId)) {
    throw createError(
      403,
      "Akun ini belum memiliki akses ke SIJALA CMS."
    );
  }

  return buildProfile({
    sub: claims.sub,
    email: claims.email,
    name: claims.name,
    roles,
    apps,
    isSuperAdmin,
  });
}

async function getSsoMetadata() {
  if (metadataCache && metadataExpiresAt > Date.now()) {
    return metadataCache;
  }

  const discoveryUrl = new URL(
    "/.well-known/openid-configuration",
    `${config.ssoIssuer}/`
  ).toString();
  const response = await fetchFromSso(
    discoveryUrl,
    {
      method: "GET",
    },
    {
      retryableStatuses: [404, 502, 503, 504],
    }
  );

  if (!response.ok) {
    throw createError(502, "Tidak dapat menghubungi SSO.");
  }

  metadataCache = await response.json();
  metadataExpiresAt = Date.now() + 5 * 60 * 1000;
  return metadataCache;
}

async function getSsoJwks() {
  const metadata = await getSsoMetadata();
  const jwksUrl = toSsoInternalUrl(
    String(metadata.jwks_uri),
    activeSsoBaseUrl || undefined
  );

  if (jwksCache && jwksCacheUrl === jwksUrl) {
    return jwksCache;
  }

  const { createRemoteJWKSet } = await getJose();
  jwksCache = createRemoteJWKSet(new URL(jwksUrl));
  jwksCacheUrl = jwksUrl;
  return jwksCache;
}

async function verifySsoIdToken(idToken, expectedNonce) {
  const metadata = await getSsoMetadata();
  const { jwtVerify } = await getJose();
  const jwks = await getSsoJwks();

  let verified;
  try {
    verified = await jwtVerify(idToken, jwks, {
      issuer: config.ssoIssuer,
      audience: config.ssoClientId,
      algorithms: ["RS256"],
    });
  } catch {
    throw createError(401, "Token SSO tidak valid.");
  }

  const claims = verified.payload || {};
  if (String(claims.nonce || "") !== String(expectedNonce || "")) {
    throw createError(401, "Nonce login SSO tidak valid.");
  }

  return claims;
}

async function signAccessToken(user) {
  const { SignJWT } = await getJose();
  const profile = buildProfile(user);

  return new SignJWT({
    sub: profile.sub,
    email: profile.email,
    name: profile.fullName,
    role: profile.role,
    roles: profile.roles,
    apps: profile.apps,
    is_super_admin: profile.isSuperAdmin,
    typ: "access",
  })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setIssuer(config.publicBaseUrl)
    .setAudience(config.authJwtAudience)
    .setIssuedAt()
    .setExpirationTime(`${config.accessTokenTtlSeconds}s`)
    .sign(Buffer.from(config.authJwtSecret));
}

async function cleanupRefreshTokens(executor = db) {
  await executor.query(
    `
      DELETE FROM auth_refresh_tokens
      WHERE expires_at < NOW()
         OR (revoked_at IS NOT NULL AND revoked_at < NOW() - INTERVAL '30 days')
    `
  );
}

async function storeRefreshToken(user, refreshToken, executor = db) {
  const expiresAt = new Date(
    Date.now() + config.refreshTokenTtlDays * 24 * 60 * 60 * 1000
  );

  await executor.query(
    `
      INSERT INTO auth_refresh_tokens (
        id,
        user_sub,
        user_email,
        user_name,
        user_roles,
        user_apps,
        is_super_admin,
        token_hash,
        expires_at
      ) VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7, $8, $9)
    `,
    [
      randomToken(12),
      user.sub,
      user.email,
      user.fullName,
      JSON.stringify(user.roles),
      JSON.stringify(user.apps),
      user.isSuperAdmin,
      hashToken(refreshToken),
      expiresAt,
    ]
  );
}

async function issueSession(user, executor = db) {
  await cleanupRefreshTokens(executor);

  const accessToken = await signAccessToken(user);
  const refreshToken = randomToken(48);
  await storeRefreshToken(user, refreshToken, executor);

  return {
    accessToken,
    refreshToken,
    tokenType: "Bearer",
    expiresIn: config.accessTokenTtlSeconds,
    user: buildProfile(user),
  };
}

function userFromRefreshRow(row) {
  return buildProfile({
    sub: row.user_sub,
    email: row.user_email,
    name: row.user_name,
    roles: row.user_roles,
    apps: row.user_apps,
    isSuperAdmin: row.is_super_admin,
  });
}

async function authenticateViaSsoCredentials(usernameOrEmail, password) {
  const endpoint = new URL(
    config.ssoInternalAuthPath,
    `${config.ssoIssuer}/`
  ).toString();

  const response = await fetchFromSso(
    endpoint,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-service-secret": config.ssoServiceAuthSecret,
      },
      body: JSON.stringify({
        usernameOrEmail,
        password,
        appClientId: config.ssoClientId,
        allowedClientIds: config.ssoAllowedClientIds,
      }),
    },
    {
      retryableStatuses: [401, 404, 502, 503, 504],
    }
  );

  if (response.status === 401) {
    const errorPayload = await readSsoErrorPayload(response);
    if (errorPayload.error === "invalid_service_secret") {
      throw createError(502, "Konfigurasi integrasi SSO CMS tidak valid.");
    }

    throw createError(
      401,
      errorPayload.message || "Email/username atau password salah."
    );
  }

  if (response.status === 403) {
    const errorPayload = await readSsoErrorPayload(response);
    throw createError(
      403,
      errorPayload.message || "Akun ini belum memiliki akses ke SIJALA CMS."
    );
  }

  if (!response.ok) {
    const text = await response.text();
    throw createError(502, `Gagal validasi login ke SSO (${response.status}): ${text}`);
  }

  const rawBody = await response.json().catch(() => null);
  const user = rawBody?.user;

  if (!user || !user.id || !user.email) {
    throw createError(502, "Respons login SSO tidak valid.");
  }

  return ensureCmsAccess({
    sub: user.id,
    email: user.email,
    name: user.fullName || user.name || user.email,
    roles: Array.isArray(user.roles) ? user.roles : [],
    apps: Array.isArray(user.appClientIds) ? user.appClientIds : [],
    is_super_admin: Boolean(user.isSuperAdmin),
  });
}

async function buildSsoLoginUrl({ requestOrigin }) {
  const metadata = await getSsoMetadata();
  const nonce = randomToken(16);
  const codeVerifier = createPkceCodeVerifier();
  const redirectUri = resolveCallbackUrl(requestOrigin);
  const state = signState({
    nonce,
    codeVerifier,
    redirectUri,
    iat: Math.floor(Date.now() / 1000),
  });

  const authorizeUrl = new URL(
    toSsoPublicUrl(String(metadata.authorization_endpoint))
  );
  authorizeUrl.searchParams.set("response_type", "code");
  authorizeUrl.searchParams.set("client_id", config.ssoClientId);
  authorizeUrl.searchParams.set("redirect_uri", redirectUri);
  authorizeUrl.searchParams.set("scope", config.ssoScope);
  authorizeUrl.searchParams.set("nonce", nonce);
  authorizeUrl.searchParams.set("state", state);
  authorizeUrl.searchParams.set("code_challenge_method", "S256");
  authorizeUrl.searchParams.set(
    "code_challenge",
    toPkceCodeChallenge(codeVerifier)
  );

  return {
    authorizeUrl: authorizeUrl.toString(),
    state,
  };
}

async function requestSsoToken(body) {
  const metadata = await getSsoMetadata();
  const basicAuth = Buffer.from(
    `${config.ssoClientId}:${config.ssoClientSecret}`
  ).toString("base64");

  const response = await fetchFromSso(
    String(metadata.token_endpoint),
    {
      method: "POST",
      headers: {
        authorization: `Basic ${basicAuth}`,
        "content-type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams(body).toString(),
    },
    {
      retryableStatuses: [404, 502, 503, 504],
    }
  );

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw createError(
      502,
      String(payload.error_description || payload.error || "Gagal menghubungi SSO.")
    );
  }

  return payload;
}

async function loginLocal(usernameOrEmail, password) {
  const normalizedIdentifier = String(usernameOrEmail || "").trim();
  const normalizedPassword = String(password || "");

  if (!normalizedIdentifier || !normalizedPassword) {
    throw createError(400, "Email/username dan password wajib diisi.");
  }

  const user = await authenticateViaSsoCredentials(
    normalizedIdentifier,
    normalizedPassword
  );
  return issueSession(user);
}

async function exchangeSsoAuthorizationCode(code, state) {
  const normalizedCode = String(code || "").trim();
  if (!normalizedCode) {
    throw createError(400, "Code SSO wajib diisi.");
  }

  const statePayload = verifyState(state);
  const tokenSet = await requestSsoToken({
    grant_type: "authorization_code",
    code: normalizedCode,
    redirect_uri: statePayload.redirectUri,
    code_verifier: statePayload.codeVerifier,
  });

  const claims = await verifySsoIdToken(tokenSet.id_token, statePayload.nonce);
  const user = ensureCmsAccess(claims);
  return issueSession(user);
}

async function refreshSession(refreshToken) {
  const normalizedToken = String(refreshToken || "").trim();
  if (!normalizedToken) {
    throw createError(401, "Refresh token tidak ditemukan.");
  }

  const tokenHash = hashToken(normalizedToken);
  const client = await db.connect();

  try {
    await client.query("BEGIN");

    const result = await client.query(
      `
        SELECT *
        FROM auth_refresh_tokens
        WHERE token_hash = $1
        FOR UPDATE
        LIMIT 1
      `,
      [tokenHash]
    );

    const tokenRow = result.rows[0];
    if (
      !tokenRow ||
      tokenRow.revoked_at ||
      new Date(tokenRow.expires_at).getTime() <= Date.now()
    ) {
      throw createError(401, "Refresh token tidak valid atau sudah kedaluwarsa.");
    }

    await client.query(
      `
        UPDATE auth_refresh_tokens
        SET revoked_at = COALESCE(revoked_at, NOW())
        WHERE id = $1
      `,
      [tokenRow.id]
    );

    const session = await issueSession(userFromRefreshRow(tokenRow), client);
    await client.query("COMMIT");
    return session;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function revokeRefreshToken(refreshToken) {
  const normalizedToken = String(refreshToken || "").trim();
  if (!normalizedToken) return;

  await db.query(
    `
      UPDATE auth_refresh_tokens
      SET revoked_at = COALESCE(revoked_at, NOW())
      WHERE token_hash = $1
    `,
    [hashToken(normalizedToken)]
  );
}

async function authenticateAccessToken(accessToken) {
  const token = String(accessToken || "").trim();
  if (!token) {
    throw createError(401, "Token autentikasi tidak ditemukan.");
  }

  const { jwtVerify } = await getJose();

  let verified;
  try {
    verified = await jwtVerify(token, Buffer.from(config.authJwtSecret), {
      issuer: config.publicBaseUrl,
      audience: config.authJwtAudience,
      algorithms: ["HS256"],
    });
  } catch {
    throw createError(401, "Token autentikasi tidak valid atau sudah kedaluwarsa.");
  }

  const claims = verified.payload || {};
  if (claims.typ !== "access") {
    throw createError(401, "Token autentikasi tidak valid.");
  }

  return buildProfile({
    sub: claims.sub,
    email: claims.email,
    name: claims.name,
    roles: claims.roles,
    apps: claims.apps,
    isSuperAdmin: claims.is_super_admin,
  });
}

async function buildSsoLogoutUrl({ requestOrigin }) {
  const logoutUrl = new URL("/logout", `${config.ssoIssuer}/`);
  logoutUrl.searchParams.set(
    "post_logout_redirect_uri",
    resolvePostLogoutRedirectUrl(requestOrigin)
  );

  return {
    logoutUrl: logoutUrl.toString(),
  };
}

module.exports = {
  loginLocal,
  buildSsoLoginUrl,
  buildSsoLogoutUrl,
  exchangeSsoAuthorizationCode,
  refreshSession,
  revokeRefreshToken,
  authenticateAccessToken,
  createError,
};
