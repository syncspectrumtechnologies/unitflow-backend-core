function factoryWhere(req) {
  // factoryAccessMiddleware sets either:
  // - req.factory_id for a single factory
  // - or req.factory_ids for "all factories" view
  if (req.factory_id) return { factory_id: req.factory_id };
  if (Array.isArray(req.factory_ids) && req.factory_ids.length) {
    return { factory_id: { in: req.factory_ids } };
  }
  return {};
}

function requireSingleFactory(req) {
  if (!req.factory_id) {
    const err = new Error("FACTORY_REQUIRED");
    err.statusCode = 400;
    throw err;
  }
  return req.factory_id;
}

module.exports = {
  factoryWhere,
  requireSingleFactory
};
