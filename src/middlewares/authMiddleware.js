const jwt = require("jsonwebtoken");
const { authenticateRequestToken } = require("../services/authSessionService");

function applyRefreshHeaders(res, refreshedToken) {
  if (!refreshedToken?.token) return;
  res.setHeader("Authorization", `Bearer ${refreshedToken.token}`);
  res.setHeader("X-Access-Token", refreshedToken.token);
  res.setHeader("X-Token-Refreshed", "true");
  res.setHeader("X-Token-Expires-In", refreshedToken.expires_in);
  res.setHeader("X-Token-Expires-At", refreshedToken.expires_at);
}

module.exports = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    const unauthorized = (message, code = "AUTH_LOGIN_REQUIRED") => {
      res.setHeader("X-Login-Required", "true");
      return res.status(401).json({
        message,
        code,
        login_required: true
      });
    };

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return unauthorized("Unauthorized");
    }

    const token = authHeader.split(" ")[1];
    const auth = await authenticateRequestToken(token, { touchSession: true, autoRefresh: true });
    const user = auth?.user;

    if (!user) {
      const decoded = jwt.decode(token) || {};
      if (decoded?.exp && Number(decoded.exp) <= Math.floor(Date.now() / 1000)) {
        return unauthorized("Session has expired", "AUTH_TOKEN_EXPIRED");
      }
      return unauthorized("Invalid or inactive user", "AUTH_SESSION_INVALID");
    }

    req.auth = auth;
    req.access_token = token;
    req.user = user;
    applyRefreshHeaders(res, auth?.refreshed_token);
    next();
  } catch (err) {
    if (err?.name === "TokenExpiredError") {
      res.setHeader("X-Login-Required", "true");
      return res.status(401).json({
        message: "Session has expired",
        code: "AUTH_TOKEN_EXPIRED",
        login_required: true
      });
    }
    res.setHeader("X-Login-Required", "true");
    return res.status(401).json({
      message: "Authentication failed",
      code: "AUTH_LOGIN_REQUIRED",
      login_required: true
    });
  }
};
