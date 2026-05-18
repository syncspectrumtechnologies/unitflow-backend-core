const jwt = require("jsonwebtoken");
const axios = require("axios");
const prisma = require("../config/db");
const { env } = require("../config/env");
const { signToken, expiryDateFromNow } = require("../utils/jwt");

const roleCache = new Map();
const runtimeSessionValidationCache = new Map();

function getRoleCacheKey(company_id, user_id) {
  return `${company_id}:${user_id}`;
}

async function getUserRoles(company_id, user) {
  const ttlMs = Number(process.env.ROLE_CACHE_TTL_MS || 30_000);
  const cacheKey = getRoleCacheKey(company_id, user.id);
  const cached = roleCache.get(cacheKey);
  if (cached && cached.expires_at > Date.now()) {
    return cached.roles;
  }

  const roleRows = await prisma.userRoleMap.findMany({
    where: { company_id, user_id: user.id },
    include: { role: { select: { name: true, is_active: true } } }
  });

  let roles = roleRows
    .filter((row) => row.role?.is_active)
    .map((row) => row.role?.name)
    .filter(Boolean);

  if (!user.is_admin && roles.length === 0) roles = ["STAFF"];

  roleCache.set(cacheKey, { roles, expires_at: Date.now() + ttlMs });
  return roles;
}

async function touchSessionIfNeeded(session) {
  if (!session) return;
  const intervalMs = Number(process.env.SESSION_TOUCH_INTERVAL_MS || 60_000);
  const cutoff = new Date(Date.now() - intervalMs);
  if (session.last_seen_at && new Date(session.last_seen_at) >= cutoff) return;

  await prisma.userSession.updateMany({
    where: { id: session.id, last_seen_at: { lt: cutoff } },
    data: { last_seen_at: new Date() }
  });
}

function getRefreshThresholdSeconds() {
  const raw = Number(process.env.JWT_REFRESH_THRESHOLD_SECONDS || 1800);
  return Number.isFinite(raw) && raw >= 0 ? raw : 1800;
}

function getRemainingTokenSeconds(decoded) {
  if (!decoded?.exp) return Number.POSITIVE_INFINITY;
  return Number(decoded.exp) - Math.floor(Date.now() / 1000);
}

function buildRefreshResponse(token, expiresIn, expiresAt, jti) {
  return {
    token,
    jti,
    expires_in: expiresIn,
    expires_at: expiresAt.toISOString()
  };
}

async function loadActiveUser(decoded) {
  const companyId = decoded.company_id || decoded.tenant_id;
  if (!decoded.user_id || !companyId) return null;

  const user = await prisma.user.findFirst({
    where: {
      id: decoded.user_id,
      company_id: companyId,
      status: "ACTIVE",
      company: { is: { is_active: true } }
    },
    select: {
      id: true,
      company_id: true,
      is_admin: true,
      email: true,
      name: true,
      status: true
    }
  });

  if (!user) return null;
  const roles = await getUserRoles(user.company_id, user);

  return {
    id: user.id,
    company_id: user.company_id,
    is_admin: user.is_admin,
    email: user.email,
    name: user.name,
    roles,
    role: decoded.role || (user.is_admin ? "ADMIN" : roles[0] || "STAFF"),
    jti: decoded.jti || null,
    device_id: decoded.device_id || null,
    account_id: decoded.account_id || null,
    plan: decoded.plan || null,
    token_source: decoded.token_type === "runtime" ? "platform" : "core"
  };
}

function verifyPlatformRuntimeToken(token) {
  const verifyOptions = {};
  if (env.platformRuntimeJwtIssuer) verifyOptions.issuer = env.platformRuntimeJwtIssuer;
  if (env.platformRuntimeJwtAudience) verifyOptions.audience = env.platformRuntimeJwtAudience;
  return jwt.verify(token, env.platformRuntimeJwtSecret, verifyOptions);
}

function platformClient() {
  return axios.create({
    baseURL: env.platformApiBaseUrl,
    timeout: 7000,
    headers: {
      "X-Platform-Api-Key": process.env.PLATFORM_INTERNAL_API_KEY,
      "Content-Type": "application/json"
    }
  });
}

async function validateRuntimeSessionWithPlatform(jti, touch = true) {
  const cacheKey = `${jti}:${touch ? "touch" : "no-touch"}`;
  const ttlMs = env.runtimeSessionValidationCacheMs;
  const cached = runtimeSessionValidationCache.get(cacheKey);
  if (cached && cached.expires_at > Date.now()) return cached.value;

  const res = await platformClient().post("/internal/runtime-sessions/validate", { jti, touch });
  const value = res.data;
  runtimeSessionValidationCache.set(cacheKey, { value, expires_at: Date.now() + ttlMs });
  return value;
}

async function authenticateCoreToken(token, { touchSession = true } = {}) {
  if (!env.allowDirectCoreLogin) return null;

  const decoded = jwt.verify(token, process.env.JWT_SECRET);
  const user = await loadActiveUser(decoded);
  if (!user) return null;

  let session = null;
  if (decoded.jti) {
    session = await prisma.userSession.findFirst({
      where: {
        company_id: user.company_id,
        user_id: user.id,
        token_jti: decoded.jti,
        revoked_at: null,
        expires_at: { gt: new Date() }
      },
      select: { id: true, token_jti: true, last_seen_at: true, expires_at: true }
    });

    if (!session) return null;
    if (touchSession) await touchSessionIfNeeded(session);
  }

  return {
    user,
    token_source: "core",
    session,
    decoded,
    token
  };
}

async function authenticatePlatformRuntimeToken(token) {
  const decoded = verifyPlatformRuntimeToken(token);
  if (decoded.token_type !== "runtime") return null;
  if (!decoded.jti) return null;

  try {
    const validation = await validateRuntimeSessionWithPlatform(decoded.jti, true);
    if (!validation?.valid) return null;
  } catch (_error) {
    return null;
  }

  const user = await loadActiveUser(decoded);
  if (!user) return null;

  return {
    user,
    token_source: "platform",
    session: null,
    decoded,
    token
  };
}

async function refreshCoreSessionAuth(auth, { force = false } = {}) {
  if (!auth || auth.token_source !== "core" || !auth.user || !auth.session?.id || !auth.session?.token_jti) {
    return null;
  }

  const shouldRefresh = force || getRemainingTokenSeconds(auth.decoded) <= getRefreshThresholdSeconds();
  if (!shouldRefresh) return null;

  const now = new Date();
  const { token, jti, expiresIn } = signToken({
    user_id: auth.user.id,
    company_id: auth.user.company_id,
    is_admin: auth.user.is_admin
  }, {
    jti: auth.session.token_jti
  });
  const expiresAt = expiryDateFromNow(expiresIn, now);

  const updated = await prisma.userSession.updateMany({
    where: {
      id: auth.session.id,
      company_id: auth.user.company_id,
      user_id: auth.user.id,
      token_jti: auth.session.token_jti,
      revoked_at: null,
      expires_at: { gt: now }
    },
    data: {
      last_seen_at: now,
      expires_at: expiresAt
    }
  });

  if (!updated.count) return null;

  const refreshed = buildRefreshResponse(token, expiresIn, expiresAt, jti);
  auth.session.last_seen_at = now;
  auth.session.expires_at = expiresAt;
  auth.refreshed_token = refreshed;
  return refreshed;
}

async function authenticateRequestToken(token, { touchSession = true, autoRefresh = true } = {}) {
  const decoded = jwt.decode(token) || {};
  let auth = null;

  if (decoded.token_type === "runtime") {
    try {
      auth = await authenticatePlatformRuntimeToken(token);
    } catch (_error) {
      return null;
    }
  } else {
    try {
      auth = await authenticateCoreToken(token, { touchSession });
    } catch (_error) {
      return null;
    }
  }

  if (!auth) return null;

  if (autoRefresh && auth.token_source === "core") {
    await refreshCoreSessionAuth(auth, { force: false });
  }

  return auth;
}

async function authenticateToken(token, { touchSession = true } = {}) {
  const auth = await authenticateRequestToken(token, { touchSession, autoRefresh: false });
  return auth?.user || null;
}

module.exports = {
  authenticateToken,
  authenticateRequestToken,
  refreshCoreSessionAuth,
  getUserRoles,
  verifyPlatformRuntimeToken
};
