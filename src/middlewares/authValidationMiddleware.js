const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const SAFE_ID_PATTERN = /^[A-Za-z0-9_-]{6,128}$/;
const LOGIN_ID_PATTERN = /^[A-Za-z0-9._-]{3,40}$/;

function badRequest(message) {
  const err = new Error(message);
  err.statusCode = 400;
  return err;
}

function body(req) {
  if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
    throw badRequest('Request body must be a JSON object');
  }
  return req.body;
}

function trim(value) {
  return String(value ?? '').trim();
}

function email(obj, key, required = true) {
  if (!required && (obj[key] === undefined || obj[key] === null || obj[key] === '')) return;
  const value = trim(obj[key]).toLowerCase();
  if (!value && required) throw badRequest(`${key} is required`);
  if (value && (!EMAIL_PATTERN.test(value) || value.length > 254)) throw badRequest(`${key} must be a valid email`);
  obj[key] = value;
}

function optionalTenantId(obj) {
  const value = trim(obj.tenant_id || obj.company_id || '');
  if (!value) return;
  if (!SAFE_ID_PATTERN.test(value)) throw badRequest('tenant_id is invalid');
  obj.tenant_id = value;
}

function password(obj, key, min = 8) {
  const value = String(obj[key] ?? '');
  if (!value) throw badRequest(`${key} is required`);
  if (value.length < min || value.length > 128) throw badRequest(`${key} must be between ${min} and 128 characters`);
}

function otp(obj) {
  const value = trim(obj.otp);
  if (!/^\d{4,12}$/.test(value)) throw badRequest('otp must be numeric');
  obj.otp = value;
}

function validateLogin(req, res, next) {
  try {
    const data = body(req);
    email(data, 'email', false);
    if (data.login_id !== undefined || data.identifier !== undefined || data.username !== undefined) {
      const key = data.login_id !== undefined ? 'login_id' : data.identifier !== undefined ? 'identifier' : 'username';
      const value = trim(data[key]).toLowerCase();
      if (!LOGIN_ID_PATTERN.test(value)) throw badRequest('login_id is invalid');
      data.login_id = value;
    }
    if (!data.email && !data.login_id) throw badRequest('email or login_id is required');
    password(data, 'password', 1);
    optionalTenantId(data);
    next();
  } catch (error) {
    next(error);
  }
}

function validatePasswordResetRequest(req, res, next) {
  try {
    const data = body(req);
    email(data, 'email');
    optionalTenantId(data);
    next();
  } catch (error) {
    next(error);
  }
}

function validatePasswordReset(req, res, next) {
  try {
    const data = body(req);
    email(data, 'email');
    otp(data);
    data.new_password = String(data.new_password || data.password || '');
    password(data, 'new_password');
    next();
  } catch (error) {
    next(error);
  }
}

module.exports = {
  validateLogin,
  validatePasswordResetRequest,
  validatePasswordReset
};
