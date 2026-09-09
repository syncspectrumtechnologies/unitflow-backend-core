const crypto = require("crypto");
const { env } = require("../config/env");

module.exports = function requestTimingMiddleware(req, res, next) {
  req.request_id = req.headers[env.requestIdHeader] || crypto.randomUUID();
  res.setHeader("X-Request-Id", req.request_id);

  const startNs = process.hrtime.bigint();
  const startedAt = Date.now();

  res.on("finish", () => {
    const elapsedMs = Number(process.hrtime.bigint() - startNs) / 1e6;
    const threshold = Number(process.env.SLOW_REQUEST_MS || 750);
    const verbose = String(process.env.LOG_ALL_REQUESTS || "false").toLowerCase() === "true";

    if (verbose || elapsedMs >= threshold) {
      console.log(
        `[REQ] ${req.request_id} ${req.method} ${req.path} -> ${res.statusCode} ${elapsedMs.toFixed(1)}ms`
      );
    }
  });

  req._request_started_at = startedAt;
  next();
};
