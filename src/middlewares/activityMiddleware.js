const prisma = require("../config/db");

module.exports = async (req, res, next) => {
  const start = Date.now();

  res.on("finish", async () => {
    try {
      if (!req.user || req.method === "GET" || res.statusCode >= 400) return;

      await prisma.activityLog.create({
        data: {
          company_id: req.user.company_id,
          factory_id: req.factory_id || null,
          user_id: req.user.id,
          action: `${req.method} ${req.originalUrl}`,
          entity_type: "http_request",
          entity_id: null,
          meta: {
            duration_ms: Date.now() - start,
            status: res.statusCode
          },
          ip: req.ip,
          user_agent: req.headers["user-agent"]
        }
      });
    } catch (err) {
      console.error("Activity log failed", err.message);
    }
  });

  next();
};
