const crypto = require('crypto');

function safeEqual(a, b) {
  const aBuf = Buffer.from(String(a || ''));
  const bBuf = Buffer.from(String(b || ''));
  if (aBuf.length !== bBuf.length) return false;
  return crypto.timingSafeEqual(aBuf, bBuf);
}

module.exports = function platformInternalAuthMiddleware(req, res, next) {
  const configured = process.env.PLATFORM_INTERNAL_API_KEY;
  if (!configured) {
    return res.status(503).json({ message: 'Platform integration key is not configured' });
  }

  const authHeader = req.headers.authorization || '';
  const bearer = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : null;
  const headerKey = req.headers['x-platform-api-key'];
  const provided = bearer || headerKey;

  if (!provided || !safeEqual(configured, provided)) {
    return res.status(401).json({ message: 'Unauthorized platform request' });
  }

  next();
};
