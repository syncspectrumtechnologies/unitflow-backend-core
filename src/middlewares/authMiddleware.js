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

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const token = authHeader.split(" ")[1];
    const auth = await authenticateRequestToken(token, { touchSession: true, autoRefresh: true });
    const user = auth?.user;

    if (!user) {
      return res.status(401).json({ message: "Invalid or inactive user" });
    }

    req.auth = auth;
    req.access_token = token;
    req.user = user;
    applyRefreshHeaders(res, auth?.refreshed_token);
    next();
  } catch (err) {
    return res.status(401).json({ message: "Authentication failed" });
  }
};
