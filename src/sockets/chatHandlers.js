const prisma = require("../config/db");

function safeBody(body) {
  const s = (body ?? "").toString().trim();
  if (!s) return null;
  if (s.length > 2000) return null;
  return s;
}

async function ensureMember(company_id, conversationId, user_id) {
  return prisma.conversationMember.findFirst({
    where: { company_id, conversation_id: conversationId, user_id }
  });
}

module.exports = function registerChatHandlers(io, socket) {
  const user = socket.user;

  // Client -> Server: chat:send { conversationId, body }
  socket.on("chat:send", async (payload = {}, cb) => {
    try {
      const conversationId = payload.conversationId;
      const body = safeBody(payload.body);
      if (!conversationId || !body) {
        if (cb) cb({ ok: false, message: "Invalid payload" });
        return;
      }

      const member = await ensureMember(user.company_id, conversationId, user.id);
      if (!member) {
        if (cb) cb({ ok: false, message: "Forbidden" });
        return;
      }

      const msg = await prisma.$transaction(async (tx) => {
        const created = await tx.chatMessage.create({
          data: {
            company_id: user.company_id,
            conversation_id: conversationId,
            sender_id: user.id,
            body
          }
        });

        await tx.conversation.update({
          where: { id: conversationId },
          data: { updated_at: new Date() }
        });

        await tx.conversationMember.updateMany({
          where: { company_id: user.company_id, conversation_id: conversationId, user_id: user.id },
          data: { last_read_at: new Date() }
        });

        return created;
      });

      // Emit to other participants only
      const members = await prisma.conversationMember.findMany({
        where: { company_id: user.company_id, conversation_id: conversationId },
        select: { user_id: true }
      });

      const recipients = members.map((m) => m.user_id).filter((id) => id !== user.id);

      const messagePayload = {
        id: msg.id,
        conversation_id: msg.conversation_id,
        sender_id: msg.sender_id,
        body: msg.body,
        created_at: msg.created_at
      };

      recipients.forEach((uid) => {
        io.to(`user:${uid}`).emit("chat:new", {
          conversationId,
          message: messagePayload
        });
      });

      // Optional: also emit into conversation room for active screens
      io.to(`conversation:${conversationId}`).emit("chat:new", {
        conversationId,
        message: messagePayload
      });

      if (cb) cb({ ok: true, message: messagePayload });
    } catch (err) {
      console.error("socket chat:send error:", err);
      if (cb) cb({ ok: false, message: "Internal error" });
    }
  });

  // Client -> Server: chat:read { conversationId }
  socket.on("chat:read", async (payload = {}, cb) => {
    try {
      const conversationId = payload.conversationId;
      if (!conversationId) {
        if (cb) cb({ ok: false, message: "Invalid payload" });
        return;
      }

      const member = await ensureMember(user.company_id, conversationId, user.id);
      if (!member) {
        if (cb) cb({ ok: false, message: "Forbidden" });
        return;
      }

      const readAt = new Date();
      await prisma.conversationMember.updateMany({
        where: { company_id: user.company_id, conversation_id: conversationId, user_id: user.id },
        data: { last_read_at: readAt }
      });

      // Notify the other participant(s) (optional)
      const members = await prisma.conversationMember.findMany({
        where: { company_id: user.company_id, conversation_id: conversationId },
        select: { user_id: true }
      });
      members
        .map((m) => m.user_id)
        .filter((id) => id !== user.id)
        .forEach((uid) => {
          io.to(`user:${uid}`).emit("chat:read", { conversationId, userId: user.id, readAt });
        });

      if (cb) cb({ ok: true, readAt });
    } catch (err) {
      console.error("socket chat:read error:", err);
      if (cb) cb({ ok: false, message: "Internal error" });
    }
  });
};
