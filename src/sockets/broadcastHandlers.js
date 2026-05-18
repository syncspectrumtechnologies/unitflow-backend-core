const prisma = require("../config/db");

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
    ids = users.map((u) => u.id);
  }

  if (targetType === "ROLES") {
    if (!Array.isArray(roleIds) || roleIds.length === 0) return [];
    const roles = await prisma.role.findMany({
      where: { company_id, is_active: true, id: { in: roleIds } },
      select: { id: true }
    });
    if (roles.length !== roleIds.length) return [];

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

module.exports = function registerBroadcastHandlers(io, socket) {
  const user = socket.user;

  // Client -> Server: broadcast:send { targetType, roleIds?, userIds?, body }
  socket.on("broadcast:send", async (payload = {}, cb) => {
    try {
      // admin only (is_admin or ADMIN role)
      if (!user.is_admin && !(user.roles || []).includes("ADMIN")) {
        if (cb) cb({ ok: false, message: "Forbidden" });
        return;
      }

      const targetType = normalizeTargetType(payload.targetType);
      const body = safeBody(payload.body);
      const roleIds = payload.roleIds || [];
      const userIds = payload.userIds || [];

      if (!targetType || !body) {
        if (cb) cb({ ok: false, message: "Invalid payload" });
        return;
      }

      const recipients = await resolveRecipients(
        user.company_id,
        user.id,
        targetType,
        Array.isArray(roleIds) ? roleIds : [],
        Array.isArray(userIds) ? userIds : []
      );

      if (recipients.length === 0) {
        if (cb) cb({ ok: false, message: "No recipients" });
        return;
      }

      const broadcast = await prisma.$transaction(async (tx) => {
        const b = await tx.broadcastMessage.create({
          data: {
            company_id: user.company_id,
            sender_id: user.id,
            body,
            target_type: targetType,
            target_role_ids: targetType === "ROLES" ? roleIds : [],
            target_user_ids: targetType === "USERS" ? userIds : []
          }
        });

        await tx.broadcastRecipient.createMany({
          data: recipients.map((uid) => ({
            company_id: user.company_id,
            broadcast_id: b.id,
            user_id: uid
          })),
          skipDuplicates: true
        });

        return b;
      });

      // Emit to each targeted user
      const broadcastPayload = {
        id: broadcast.id,
        sender_id: broadcast.sender_id,
        body: broadcast.body,
        target_type: broadcast.target_type,
        created_at: broadcast.created_at
      };

      recipients.forEach((uid) => {
        io.to(`user:${uid}`).emit("broadcast:new", { broadcast: broadcastPayload });
      });

      if (cb) cb({ ok: true, broadcast: broadcastPayload, recipients_count: recipients.length });
    } catch (err) {
      console.error("socket broadcast:send error:", err);
      if (cb) cb({ ok: false, message: "Internal error" });
    }
  });

  // Client -> Server: broadcast:seen { broadcastId }
  socket.on("broadcast:seen", async (payload = {}, cb) => {
    try {
      const broadcastId = payload.broadcastId;
      if (!broadcastId) {
        if (cb) cb({ ok: false, message: "Invalid payload" });
        return;
      }

      const row = await prisma.broadcastRecipient.findFirst({
        where: { company_id: user.company_id, broadcast_id: broadcastId, user_id: user.id }
      });

      if (!row) {
        if (cb) cb({ ok: false, message: "Not found" });
        return;
      }

      if (row.seen_at) {
        if (cb) cb({ ok: true, seen_at: row.seen_at });
        return;
      }

      const seenAt = new Date();
      const updated = await prisma.broadcastRecipient.update({
        where: { id: row.id },
        data: { seen_at: seenAt }
      });

      // Optionally notify sender
      const b = await prisma.broadcastMessage.findFirst({
        where: { id: broadcastId, company_id: user.company_id },
        select: { sender_id: true }
      });
      if (b?.sender_id) {
        io.to(`user:${b.sender_id}`).emit("broadcast:seen", {
          broadcastId,
          userId: user.id,
          seenAt
        });
      }

      if (cb) cb({ ok: true, seen_at: updated.seen_at });
    } catch (err) {
      console.error("socket broadcast:seen error:", err);
      if (cb) cb({ ok: false, message: "Internal error" });
    }
  });
};
