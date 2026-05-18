const crypto = require("crypto");

function parseBool(value, fallback = false) {
  if (value === undefined || value === null || value === "") return fallback;
  const normalized = String(value).trim().toLowerCase();
  return ["1", "true", "yes", "y", "on"].includes(normalized);
}

function parseIntEnv(value, fallback) {
  const parsed = Number.parseInt(String(value ?? "").trim(), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseList(value) {
  if (!value) return [];
  return String(value)
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeNodeEnv(value) {
  const v = String(value || "development").trim().toLowerCase();
  if (["production", "test", "development"].includes(v)) return v;
  return "development";
}

const nodeEnv = normalizeNodeEnv(process.env.NODE_ENV);
const serviceName = process.env.SERVICE_NAME || "unitflow-core-api";
const runtimeMode = process.env.RUNTIME_MODE || "saas-shared";
const allowDirectCoreLoginDefault = nodeEnv !== "production";

const env = {
  nodeEnv,
  isProduction: nodeEnv === "production",
  isTest: nodeEnv === "test",
  serviceName,
  appName: process.env.APP_NAME || "UnitFlow",
  port: parseIntEnv(process.env.PORT, 4000),
  logLevel: process.env.LOG_LEVEL || (nodeEnv === "production" ? "info" : "debug"),
  requestIdHeader: process.env.REQUEST_ID_HEADER || "x-request-id",
  requestLogAll: parseBool(process.env.LOG_ALL_REQUESTS, false),
  slowRequestMs: parseIntEnv(process.env.SLOW_REQUEST_MS, 750),
  compressionThresholdBytes: parseIntEnv(process.env.COMPRESSION_THRESHOLD_BYTES, 1024),
  corsAllowedOrigins: parseList(process.env.CORS_ALLOWED_ORIGINS),
  corsAllowedOriginRegexes: parseList(process.env.CORS_ALLOWED_ORIGIN_REGEXES),
  corsAllowNoOrigin: parseBool(process.env.CORS_ALLOW_NO_ORIGIN, true),
  rateLimitMaxPerMin: parseIntEnv(process.env.RATE_LIMIT_MAX_PER_MIN, 300),
  authRateLimitMaxPer15Min: parseIntEnv(process.env.AUTH_RATE_LIMIT_MAX_PER_15_MIN, 50),
  activityLogEnabled: parseBool(process.env.ACTIVITY_LOG_ENABLED, true),
  validateEnvOnBoot: parseBool(process.env.VALIDATE_ENV_ON_BOOT, true),
  idempotencyEnabled: parseBool(process.env.IDEMPOTENCY_ENABLED, true),
  idempotencyTtlSec: parseIntEnv(process.env.IDEMPOTENCY_TTL_SECONDS, 60 * 60 * 12),
  runtimeMode,
  apiClientMode: process.env.API_CLIENT_MODE || "electron-shell-over-api",
  allowDirectCoreLogin: parseBool(process.env.ALLOW_DIRECT_CORE_LOGIN, allowDirectCoreLoginDefault),
  platformRuntimeJwtSecret: process.env.PLATFORM_RUNTIME_JWT_SECRET || process.env.JWT_SECRET,
  platformRuntimeJwtIssuer: process.env.PLATFORM_RUNTIME_JWT_ISSUER || "unitflow-platform-api",
  platformRuntimeJwtAudience: process.env.PLATFORM_RUNTIME_JWT_AUDIENCE || "unitflow-core-api",
  buildFingerprint: process.env.BUILD_FINGERPRINT || crypto.createHash("sha256").update(serviceName + runtimeMode).digest("hex").slice(0, 12),
  platformApiBaseUrl: process.env.PLATFORM_API_BASE_URL || null,
  runtimeSessionValidationCacheMs: parseIntEnv(process.env.RUNTIME_SESSION_VALIDATION_CACHE_MS, 5000)
};

function validate() {
  const issues = [];
  if (!process.env.DATABASE_URL) issues.push("DATABASE_URL is required");
  if (!process.env.JWT_SECRET) issues.push("JWT_SECRET is required");
  if (String(process.env.JWT_SECRET || "").length > 0 && String(process.env.JWT_SECRET || "").length < 32) {
    issues.push("JWT_SECRET must be at least 32 characters");
  }
  if (!env.allowDirectCoreLogin) {
    if (!env.platformRuntimeJwtSecret) issues.push("PLATFORM_RUNTIME_JWT_SECRET is required when direct core login is disabled");
    if (!env.platformApiBaseUrl) issues.push("PLATFORM_API_BASE_URL is required when direct core login is disabled");
    if (!process.env.PLATFORM_INTERNAL_API_KEY) issues.push("PLATFORM_INTERNAL_API_KEY is required when direct core login is disabled");
    if (String(env.platformRuntimeJwtSecret || "").length > 0 && String(env.platformRuntimeJwtSecret || "").length < 32) {
      issues.push("PLATFORM_RUNTIME_JWT_SECRET must be at least 32 characters");
    }
  }
  if (issues.length) {
    const err = new Error(`Invalid environment configuration: ${issues.join("; ")}`);
    err.name = "EnvValidationError";
    throw err;
  }
}

function isOriginAllowed(origin) {
  if (!origin) return env.corsAllowNoOrigin;
  if (env.corsAllowedOrigins.includes(origin)) return true;
  return env.corsAllowedOriginRegexes.some((pattern) => {
    try {
      return new RegExp(pattern).test(origin);
    } catch {
      return false;
    }
  });
}

module.exports = {
  env,
  parseBool,
  parseIntEnv,
  parseList,
  validate,
  isOriginAllowed
};
