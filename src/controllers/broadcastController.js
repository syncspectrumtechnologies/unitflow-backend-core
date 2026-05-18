const prisma = require("../config/db");
const { getIO } = require("../sockets/socketServer");
const { getPagination, buildPaginationMeta } = require("../utils/pagination");

function normalizeTargetType(v) {
  const t = (v || "").toString().toUpperCase();
  if (t === "ALL" || t === "ROLES" || t === "USERS") return t;
  return null;
}

function safeBody(body) {
  const s = (body ?? "").toString().trim();
  if (!s) return null;
  if (s.length > 5000) return null;
  return s;
}

async function resolveRecipients(company_id, sender_id, targetType, roleIds = [], userIds = []) {
  let ids = [];

  if (targetType === "ALL") {
    const users = await prisma.user.findMany({
      where: { company_id, status: "ACTIVE" },
      select: { id: true }
    });
    ids = users.map((u) => u.id);
  }

  if (targetType === "USERS") {
    if (!Array.isArray(userIds) || userIds.length === 0) return [];
    const users = await prisma.user.findMany({
      where: { company_id, status: "ACTIVE", id: { in: userIds } },
      select: { id: true }
    });
    if (users.length !== userIds.length) {
      // Reject if any invalid/outside company
      return null;
    }
    ids = users.map((u) => u.id);
  }

  if (targetType === "ROLES") {
    if (!Array.isArray(roleIds) || roleIds.length === 0) return [];
    const roles = await prisma.role.findMany({
      where: { company_id, is_active: true, id: { in: roleIds } },
      select: { id: true }
    });
    if (roles.length !== roleIds.length) return null;

    const maps = await prisma.userRoleMap.findMany({
      where: { company_id, role_id: { in: roleIds } },
      select: { user_id: true }
    });

    const roleUserIds = maps.map((m) => m.user_id);
    const users = await prisma.user.findMany({
      where: { company_id, status: "ACTIVE", id: { in: roleUserIds } },
      select: { id: true }
    });
    ids = users.map((u) => u.id);
  }

  // De-dupe and exclude sender
  return Array.from(new Set(ids)).filter((id) => id !== sender_id);
}

exports.create = async (req, res) => {
  try {
    const company_id = req.user.company_id;
    const sender_id = req.user.id;

    const targetType = normalizeTargetType(req.body?.targetType);
    const body = safeBody(req.body?.body);
    const roleIds = req.body?.roleIds || [];
    const userIds = req.body?.userIds || [];

    if (!targetType || !body) {
      return res.status(400).json({ message: "Invalid payload" });
    }

    const recipients = await resolveRecipients(
      company_id,
      sender_id,
      targetType,
      Array.isArray(roleIds) ? roleIds : [],
      Array.isArray(userIds) ? userIds : []
    );

    if (recipients === null) {
      return res.status(400).json({ message: "Invalid roleIds/userIds" });
    }
    if (recipients.length === 0) {
      return res.status(400).json({ message: "No recipients" });
    }

    const broadcast = await prisma.$transaction(async (tx) => {
      const b = await tx.broadcastMessage.create({
        data: {
          company_id,
          sender_id,
          body,
          target_type: targetType,
          target_role_ids: targetType === "ROLES" ? roleIds : [],
          target_user_ids: targetType === "USERS" ? userIds : []
        }
      });

      await tx.broadcastRecipient.createMany({
        data: recipients.map((uid) => ({
          company_id,
          broadcast_id: b.id,
          user_id: uid
        })),
        skipDuplicates: true
      });

      return b;
    });

    // Emit realtime
    const io = getIO();
    if (io) {
      const payload = {
        id: broadcast.id,
        sender_id: broadcast.sender_id,
        body: broadcast.body,
        target_type: broadcast.target_type,
        created_at: broadcast.created_at
      };
      recipients.forEach((uid) => {
        io.to(`user:${uid}`).emit("broadcast:new", { broadcast: payload });
      });
    }

    return res.status(201).json({ id: broadcast.id, recipients_count: recipients.length });
  } catch (err) {
    console.error("broadcast create error:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};

exports.listForMe = async (req, res) => {
  try {
    const company_id = req.user.company_id;
    const user_id = req.user.id;

    const rawLimit = Number(req.query.limit || 50);
    const pagination = getPagination(req, { defaultPageSize: Math.max(1, Math.min(200, rawLimit)), maxPageSize: 200 });
    const where = { company_id, user_id };
    const query = {
      where,
      orderBy: [{ created_at: "desc" }, { id: "desc" }],
      include: {
        broadcast: {
          include: {
            sender: { select: { id: true, name: true } }
          }
        }
      }
    };
    if (pagination.enabled) {
      query.skip = pagination.skip;
      query.take = pagination.take;
    } else {
      query.take = Math.max(1, Math.min(200, rawLimit));
    }

    const [rows, total] = await Promise.all([
      prisma.broadcastRecipient.findMany(query),
      pagination.enabled && pagination.include_total ? prisma.broadcastRecipient.count({ where }) : Promise.resolve(null)
    ]);

    const out = rows.map((r) => ({
      broadcast_id: r.broadcast_id,
      seen_at: r.seen_at,
      created_at: r.created_at,
      broadcast: {
        id: r.broadcast.id,
        body: r.broadcast.body,
        target_type: r.broadcast.target_type,
        sender: r.broadcast.sender,
        created_at: r.broadcast.created_at
      }
    }));

    if (!pagination.enabled) return res.json(out);

    return res.json({
      items: out,
      pagination: buildPaginationMeta({ page: pagination.page, page_size: pagination.page_size, total: total ?? out.length })
    });
  } catch (err) {
    console.error("broadcast list error:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};

exports.markSeen = async (req, res) => {
  try {
    const company_id = req.user.company_id;
    const user_id = req.user.id;
    const broadcastId = (req.params.broadcastId || "").toString().trim();

    const row = await prisma.broadcastRecipient.findFirst({
      where: { company_id, broadcast_id: broadcastId, user_id }
    });

    if (!row) return res.status(404).json({ message: "Not found" });
    if (row.seen_at) return res.json({ ok: true, seen_at: row.seen_at });

    const seenAt = new Date();
    const updated = await prisma.broadcastRecipient.update({
      where: { id: row.id },
      data: { seen_at: seenAt }
    });

    // Optionally notify sender
    const io = getIO();
    if (io) {
      const b = await prisma.broadcastMessage.findFirst({
        where: { company_id, id: broadcastId },
        select: { sender_id: true }
      });
      if (b?.sender_id) {
        io.to(`user:${b.sender_id}`).emit("broadcast:seen", {
          broadcastId,
          userId: user_id,
          seenAt
        });
      }
    }

    return res.json({ ok: true, seen_at: updated.seen_at });
  } catch (err) {
    console.error("broadcast markSeen error:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};

exports.listRecentForAdmin = async (req, res) => {
  try {
    const company_id = req.user.company_id;

    const rawLimit = Number(req.query.limit || 5);
    const limit = Number.isFinite(rawLimit)
      ? Math.max(1, Math.min(50, rawLimit))
      : 5;

    const rows = await prisma.broadcastMessage.findMany({
      where: { company_id },
      orderBy: { created_at: "desc" },
      take: limit,
      include: {
        sender: { select: { id: true, name: true, email: true } },
        _count: { select: { recipients: true } }
      }
    });

    const ids = rows.map((r) => r.id);

    let seenRows = [];
    if (ids.length) {
      seenRows = await prisma.broadcastRecipient.groupBy({
        by: ["broadcast_id"],
        where: {
          company_id,
          broadcast_id: { in: ids },
          NOT: { seen_at: null }
        },
        _count: { _all: true }
      });
    }

    const seenMap = new Map(
      seenRows.map((r) => [r.broadcast_id, r._count._all])
    );

    const out = rows.map((b) => ({
      id: b.id,
      body: b.body,
      target_type: b.target_type,
      target_role_ids: b.target_role_ids || [],
      target_user_ids: b.target_user_ids || [],
      created_at: b.created_at,
      sender: b.sender,
      recipients_count: b._count?.recipients || 0,
      seen_count: seenMap.get(b.id) || 0
    }));

    return res.json(out);
  } catch (err) {
    console.error("broadcast listRecentForAdmin error:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};

exports.deleteBroadcast = async (req, res) => {
  try {
    const company_id = req.user.company_id;
    const { broadcastId } = req.params;

    const existing = await prisma.broadcastMessage.findFirst({
      where: { id: broadcastId, company_id },
      select: { id: true, sender_id: true }
    });
    if (!existing) return res.status(404).json({ message: "Broadcast not found" });

    const recipientRows = await prisma.broadcastRecipient.findMany({
      where: { company_id, broadcast_id: broadcastId },
      select: { user_id: true }
    });

    await prisma.$transaction(async (tx) => {
      await tx.broadcastRecipient.deleteMany({ where: { company_id, broadcast_id: broadcastId } });
      await tx.broadcastMessage.delete({ where: { id: broadcastId } });
    });

    const io = getIO();
    if (io) {
      recipientRows.forEach((row) => {
        io.to(`user:${row.user_id}`).emit("broadcast:deleted", { broadcastId });
      });
    }

    return res.json({ message: "Broadcast deleted successfully" });
  } catch (err) {
    console.error("deleteBroadcast error:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};
