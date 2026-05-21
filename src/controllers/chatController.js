const prisma = require("../config/db");
const { getIO } = require("../sockets/socketServer");
const { Prisma } = require("../generated/prisma");

function safeBody(body) {
  const s = (body ?? "").toString().trim();
  if (!s) return null;
  if (s.length > 2000) return null;
  return s;
}

function makeDirectKey(a, b) {
  return [a, b].sort().join(":");
}

async function ensureMember(company_id, conversationId, user_id) {
  return prisma.conversationMember.findFirst({
    where: { company_id, conversation_id: conversationId, user_id }
  });
}

exports.createOrFindDirect = async (req, res) => {
  try {
    const company_id = req.user.company_id;
    const me = req.user;
    const otherId = (req.params.userId || "").toString().trim();

    if (!otherId || otherId === me.id) {
      return res.status(400).json({ message: "Invalid userId" });
    }

    const other = await prisma.user.findFirst({
      where: { id: otherId, company_id, status: "ACTIVE" }
    });
    if (!other) return res.status(404).json({ message: "User not found" });

    // Admin ↔ Employee only: at least one participant must be admin.
    if (!me.is_admin && !other.is_admin) {
      return res.status(403).json({ message: "Direct chat allowed only with admin" });
    }

    // Employees can only start chats with admins.
    if (!me.is_admin && other.is_admin !== true) {
      return res.status(403).json({ message: "Only admin can be contacted" });
    }

    const direct_key = makeDirectKey(me.id, otherId);

    const existing = await prisma.conversation.findFirst({
      where: { company_id, type: "DIRECT", direct_key },
      include: {
        members: { include: { user: { select: { id: true, name: true, email: true, is_admin: true } } } }
      }
    });

    if (existing) return res.json(existing);

    const created = await prisma.$transaction(async (tx) => {
      const conv = await tx.conversation.create({
        data: {
          company_id,
          type: "DIRECT",
          direct_key,
          members: {
            create: [
              { company_id, user_id: me.id },
              { company_id, user_id: otherId }
            ]
          }
        },
        include: {
          members: { include: { user: { select: { id: true, name: true, email: true, is_admin: true } } } }
        }
      });
      return conv;
    });

    return res.status(201).json(created);
  } catch (err) {
    console.error("createOrFindDirect error:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};

exports.listConversations = async (req, res) => {
  try {
    const company_id = req.user.company_id;
    const user_id = req.user.id;

    const conversations = await prisma.conversation.findMany({
      where: {
        company_id,
        members: { some: { user_id } }
      },
      orderBy: { updated_at: "desc" },
      include: {
        members: {
          include: { user: { select: { id: true, name: true, email: true, is_admin: true } } }
        },
        messages: {
          orderBy: { created_at: "desc" },
          take: 1,
          select: { id: true, sender_id: true, body: true, created_at: true }
        }
      }
    });

    const cm = await prisma.conversationMember.findMany({
      where: { company_id, user_id, conversation_id: { in: conversations.map((c) => c.id) } },
      select: { conversation_id: true, last_read_at: true }
    });
    const lastReadMap = new Map(cm.map((r) => [r.conversation_id, r.last_read_at]));

    const unreadRows = conversations.length
      ? await prisma.$queryRaw(Prisma.sql`
          SELECT cm.conversation_id, COUNT(m.id)::int AS unread_count
          FROM "ConversationMember" cm
          LEFT JOIN "ChatMessage" m
            ON m.conversation_id = cm.conversation_id
           AND m.company_id = cm.company_id
           AND m.sender_id <> cm.user_id
           AND m.created_at > COALESCE(cm.last_read_at, TO_TIMESTAMP(0))
          WHERE cm.company_id = ${company_id}
            AND cm.user_id = ${user_id}
            AND cm.conversation_id IN (${Prisma.join(conversations.map((c) => c.id))})
          GROUP BY cm.conversation_id
        `)
      : [];
    const unreadMap = new Map(unreadRows.map((row) => [row.conversation_id, Number(row.unread_count || 0)]));

    const out = [];
    for (const c of conversations) {
      const last_message = c.messages?.[0] || null;
      const members = c.members.map((m) => m.user);
      const other = members.find((u) => u.id !== user_id) || null;

      out.push({
        id: c.id,
        type: c.type,
        created_at: c.created_at,
        updated_at: c.updated_at,
        members,
        direct_with: c.type === "DIRECT" ? other : null,
        last_message,
        unread_count: unreadMap.get(c.id) || 0
      });
    }

    return res.json(out);
  } catch (err) {
    console.error("listConversations error:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};

exports.getMessages = async (req, res) => {
  try {
    const company_id = req.user.company_id;
    const user_id = req.user.id;
    const conversationId = (req.params.conversationId || "").toString().trim();

    const member = await ensureMember(company_id, conversationId, user_id);
    if (!member) return res.status(403).json({ message: "Forbidden" });

    const rawLimit = Number(req.query.limit || 30);
    const limit = Number.isFinite(rawLimit) ? Math.max(1, Math.min(100, rawLimit)) : 30;
    const cursor = (req.query.cursor || "").toString().trim();

    const query = {
      where: { company_id, conversation_id: conversationId },
      orderBy: { created_at: "desc" },
      take: limit + 1,
      include: {
        sender: { select: { id: true, name: true } }
      }
    };
    if (cursor) {
      query.cursor = { id: cursor };
      query.skip = 1;
    }

    const rows = await prisma.chatMessage.findMany(query);
    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;
    const nextCursor = hasMore ? rows[limit].id : null;

    // Mark as read when opening history (best-effort)
    const readAt = new Date();
    await prisma.conversationMember.updateMany({
      where: { company_id, conversation_id: conversationId, user_id },
      data: { last_read_at: readAt }
    });

    // Notify other participant(s) (optional)
    const io = getIO();
    if (io) {
      const members = await prisma.conversationMember.findMany({
        where: { company_id, conversation_id: conversationId },
        select: { user_id: true }
      });
      members
        .map((m) => m.user_id)
        .filter((id) => id !== user_id)
        .forEach((uid) => {
          io.to(`user:${uid}`).emit("chat:read", { conversationId, userId: user_id, readAt });
        });
    }

    return res.json({ items, nextCursor });
  } catch (err) {
    console.error("getMessages error:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};

exports.sendMessage = async (req, res) => {
  try {
    const company_id = req.user.company_id;
    const user_id = req.user.id;
    const conversationId = (req.params.conversationId || "").toString().trim();
    const body = safeBody(req.body?.body);

    if (!body) return res.status(400).json({ message: "body is required" });

    const member = await ensureMember(company_id, conversationId, user_id);
    if (!member) return res.status(403).json({ message: "Forbidden" });

    const msg = await prisma.$transaction(async (tx) => {
      const created = await tx.chatMessage.create({
        data: {
          company_id,
          conversation_id: conversationId,
          sender_id: user_id,
          body
        },
        include: { sender: { select: { id: true, name: true } } }
      });

      await tx.conversation.update({
        where: { id: conversationId },
        data: { updated_at: new Date() }
      });

      await tx.conversationMember.updateMany({
        where: { company_id, conversation_id: conversationId, user_id },
        data: { last_read_at: new Date() }
      });

      return created;
    });

    const members = await prisma.conversationMember.findMany({
      where: { company_id, conversation_id: conversationId },
      select: { user_id: true }
    });
    const recipients = members.map((m) => m.user_id).filter((id) => id !== user_id);

    const io = getIO();
    if (io) {
      recipients.forEach((uid) => {
        io.to(`user:${uid}`).emit("chat:new", { conversationId, message: msg });
      });
      // Optional: conversation room
      io.to(`conversation:${conversationId}`).emit("chat:new", { conversationId, message: msg });
    }

    return res.status(201).json(msg);
  } catch (err) {
    console.error("sendMessage error:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};

exports.markConversationRead = async (req, res) => {
  try {
    const company_id = req.user.company_id;
    const user_id = req.user.id;
    const conversationId = (req.params.conversationId || "").toString().trim();

    const member = await ensureMember(company_id, conversationId, user_id);
    if (!member) return res.status(403).json({ message: "Forbidden" });

    const readAt = new Date();
    await prisma.conversationMember.updateMany({
      where: { company_id, conversation_id: conversationId, user_id },
      data: { last_read_at: readAt }
    });

    const io = getIO();
    if (io) {
      const members = await prisma.conversationMember.findMany({
        where: { company_id, conversation_id: conversationId },
        select: { user_id: true }
      });
      members
        .map((m) => m.user_id)
        .filter((id) => id !== user_id)
        .forEach((uid) => {
          io.to(`user:${uid}`).emit("chat:read", { conversationId, userId: user_id, readAt });
        });
    }

    return res.json({ ok: true, readAt });
  } catch (err) {
    console.error("markConversationRead error:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};


exports.deleteMessage = async (req, res) => {
  try {
    const company_id = req.user.company_id;
    const user_id = req.user.id;
    const conversationId = (req.params.conversationId || "").toString().trim();
    const messageId = (req.params.messageId || "").toString().trim();

    const member = await ensureMember(company_id, conversationId, user_id);
    if (!member) return res.status(403).json({ message: "Forbidden" });

    const existing = await prisma.chatMessage.findFirst({
      where: { id: messageId, company_id, conversation_id: conversationId }
    });
    if (!existing) return res.status(404).json({ message: "Message not found" });

    if (!req.user.is_admin && existing.sender_id !== user_id) {
      return res.status(403).json({ message: "Only the sender or admin can delete this message" });
    }

    await prisma.chatMessage.delete({ where: { id: messageId } });

    const lastMessage = await prisma.chatMessage.findFirst({
      where: { company_id, conversation_id: conversationId },
      orderBy: { created_at: "desc" },
      select: { created_at: true }
    });
    await prisma.conversation.update({
      where: { id: conversationId },
      data: { updated_at: lastMessage?.created_at || new Date() }
    });

    const io = getIO();
    if (io) {
      io.to(`conversation:${conversationId}`).emit("chat:deleted", { conversationId, messageId });
    }

    return res.json({ message: "Message deleted successfully" });
  } catch (err) {
    console.error("deleteMessage error:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};

exports.deleteConversation = async (req, res) => {
  try {
    const company_id = req.user.company_id;
    const user_id = req.user.id;
    const conversationId = (req.params.conversationId || "").toString().trim();

    const member = await ensureMember(company_id, conversationId, user_id);
    if (!member) return res.status(403).json({ message: "Forbidden" });

    const existing = await prisma.conversation.findFirst({
      where: { id: conversationId, company_id },
      select: { id: true }
    });
    if (!existing) return res.status(404).json({ message: "Conversation not found" });

    const members = await prisma.conversationMember.findMany({
      where: { company_id, conversation_id: conversationId },
      select: { user_id: true }
    });

    await prisma.$transaction(async (tx) => {
      await tx.chatMessage.deleteMany({ where: { company_id, conversation_id: conversationId } });
      await tx.conversationMember.deleteMany({ where: { company_id, conversation_id: conversationId } });
      await tx.conversation.delete({ where: { id: conversationId } });
    });

    const io = getIO();
    if (io) {
      members.forEach((m) => io.to(`user:${m.user_id}`).emit("chat:conversation_deleted", { conversationId }));
    }

    return res.json({ message: "Conversation deleted successfully" });
  } catch (err) {
    console.error("deleteConversation error:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};
