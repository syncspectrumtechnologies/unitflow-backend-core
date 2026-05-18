const zlib = require("zlib");

function shouldCompress(req, res, body) {
  if (!body || req.method === "HEAD") return false;
  if (res.getHeader("Content-Encoding")) return false;
  const accept = String(req.headers["accept-encoding"] || "").toLowerCase();
  if (!accept.includes("gzip")) return false;
  const threshold = Number(process.env.COMPRESSION_THRESHOLD_BYTES || 1024);
  const size = Buffer.isBuffer(body) ? body.length : Buffer.byteLength(String(body));
  if (size < threshold) return false;
  const type = String(res.getHeader("Content-Type") || "").toLowerCase();
  return (
    !type ||
    type.includes("application/json") ||
    type.includes("text/") ||
    type.includes("javascript") ||
    type.includes("svg+xml")
  );
}

module.exports = function compressionMiddleware(req, res, next) {
  const originalSend = res.send.bind(res);
  const originalJson = res.json.bind(res);

  function finalize(body, isJson) {
    try {
      let payload = body;
      if (!isJson && payload && typeof payload === "object" && !Buffer.isBuffer(payload)) {
        return originalJson(payload);
      }
      if (isJson) {
        payload = JSON.stringify(body);
        if (!res.getHeader("Content-Type")) {
          res.setHeader("Content-Type", "application/json; charset=utf-8");
        }
      }

      if (!shouldCompress(req, res, payload)) {
        return originalSend(payload);
      }

      zlib.gzip(Buffer.isBuffer(payload) ? payload : Buffer.from(String(payload)), (err, gzipped) => {
        if (err) return originalSend(payload);
        res.setHeader("Content-Encoding", "gzip");
        res.setHeader("Vary", "Accept-Encoding");
        res.setHeader("Content-Length", String(gzipped.length));
        return originalSend(gzipped);
      });
    } catch (err) {
      return originalSend(body);
    }
  }

  res.json = (body) => finalize(body, true);
  res.send = (body) => finalize(body, false);
  next();
};
