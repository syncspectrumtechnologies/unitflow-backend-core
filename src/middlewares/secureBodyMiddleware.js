const BLOCKED_KEYS = new Set(['__proto__', 'prototype', 'constructor', '__definegetter__', '__definesetter__']);

function badRequest(message) {
  const err = new Error(message);
  err.statusCode = 400;
  return err;
}

function assertSafeBody(value, path = 'body', depth = 0) {
  if (value === null || value === undefined || typeof value !== 'object') return;
  if (depth > 20) throw badRequest('Request body is too deeply nested');

  if (Array.isArray(value)) {
    if (value.length > 1000) throw badRequest(`${path} has too many items`);
    value.forEach((item, index) => assertSafeBody(item, `${path}[${index}]`, depth + 1));
    return;
  }

  const keys = Object.keys(value);
  if (keys.length > 250) throw badRequest(`${path} has too many fields`);

  for (const key of keys) {
    if (BLOCKED_KEYS.has(String(key).toLowerCase())) {
      throw badRequest('Request body contains unsafe object keys');
    }
    assertSafeBody(value[key], `${path}.${key}`, depth + 1);
  }
}

module.exports = function secureBodyMiddleware(req, res, next) {
  try {
    assertSafeBody(req.body);
    next();
  } catch (error) {
    next(error);
  }
};
