const jwt = require("jsonwebtoken");
const crypto = require("crypto");

function newJti() {
  return crypto.randomBytes(16).toString("hex");
}

function expiresInToMs(value) {
  const v = String(value || "4h").trim();
  const match = v.match(/^(\d+)([smhd])?$/i);
  if (!match) return 4 * 60 * 60 * 1000;
  const amount = Number(match[1]);
  const unit = (match[2] || "s").toLowerCase();
  const multiplier =
    unit === "s" ? 1000 :
    unit === "m" ? 60_000 :
    unit === "h" ? 3_600_000 :
    86_400_000;
  return amount * multiplier;
}

function expiryDateFromNow(expiresIn, baseDate = new Date()) {
  return new Date(baseDate.getTime() + expiresInToMs(expiresIn));
}

function signToken(payload, options = {}) {
  const jti = options.jti || newJti();
  const expiresIn = options.expiresIn || process.env.JWT_EXPIRES_IN || "4h";

  const token = jwt.sign(
    {
      ...payload,
      jti
    },
    process.env.JWT_SECRET,
    { expiresIn }
  );

  return { token, jti, expiresIn };
}

module.exports = {
  signToken,
  expiresInToMs,
  expiryDateFromNow,
  verifyToken: (token) => jwt.verify(token, process.env.JWT_SECRET),
  decodeToken: (token) => jwt.decode(token)
};
