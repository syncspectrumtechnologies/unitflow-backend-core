const prisma = require("../config/db");

module.exports = async ({
  company_id,
  factory_id = null,
  user_id = null,
  action,
  entity_type = null,
  entity_id = null,
  meta = null,

  // backward compatible convenience (stored inside meta)
  old_value = null,
  new_value = null,

  ip = null,
  user_agent = null
}) => {
  const safeMeta = meta || {};
  if (old_value !== null) safeMeta.old_value = old_value;
  if (new_value !== null) safeMeta.new_value = new_value;

  await prisma.activityLog.create({
    data: {
      company_id,
      factory_id,
      user_id,
      action,
      entity_type,
      entity_id,
      meta: safeMeta,
      ip,
      user_agent
    }
  });
};
