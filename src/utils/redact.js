const SENSITIVE_KEY_PATTERN = /(^|[_-])(password|pass|pwd|token|secret|authorization|api[_-]?key|otp|verification[_-]?code|password[_-]?hash|device[_-]?fingerprint|jti)($|[_-])/i;
const SENSITIVE_HEADER_PATTERN = /^(authorization|cookie|set-cookie|x-platform-api-key|x-payment-webhook-secret|x-api-key)$/i;
const JWT_PATTERN = /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g;
const BEARER_PATTERN = /\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi;

function redactString(value) {
  return String(value)
    .replace(BEARER_PATTERN, 'Bearer [REDACTED]')
    .replace(JWT_PATTERN, '[REDACTED_JWT]');
}

function shouldRedactKey(key) {
  const normalized = String(key || '').trim();
  return SENSITIVE_KEY_PATTERN.test(normalized) || SENSITIVE_HEADER_PATTERN.test(normalized);
}

function redact(value, seen = new WeakSet(), depth = 0) {
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') return redactString(value);
  if (typeof value !== 'object') return value;
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Error) return redactError(value, seen, depth);
  if (seen.has(value)) return '[Circular]';
  if (depth >= 8) return '[Truncated]';

  seen.add(value);

  if (Array.isArray(value)) {
    return value.slice(0, 100).map((item) => redact(item, seen, depth + 1));
  }

  const output = {};
  for (const [key, item] of Object.entries(value)) {
    output[key] = shouldRedactKey(key) ? '[REDACTED]' : redact(item, seen, depth + 1);
  }
  return output;
}

function redactError(error, seen = new WeakSet(), depth = 0) {
  if (!error || typeof error !== 'object') return redact(error, seen, depth);
  return {
    name: error.name,
    message: redactString(error.message || ''),
    statusCode: error.statusCode || error.status || undefined,
    code: error.code || error.details?.code || undefined,
    details: error.details ? redact(error.details, seen, depth + 1) : undefined
  };
}

function clientSafeDetails(details) {
  if (!details || typeof details !== 'object') return undefined;
  return redact(details);
}

module.exports = {
  redact,
  redactError,
  redactString,
  clientSafeDetails
};
