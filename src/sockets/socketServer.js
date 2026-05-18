const http = require("http");
const { Server } = require("socket.io");

const registerChatHandlers = require("./chatHandlers");
const registerBroadcastHandlers = require("./broadcastHandlers");
const { authenticateToken } = require("../services/authSessionService");

let ioInstance = null;

function getIO() {
  return ioInstance;
}

function extractToken(socket) {
  const authToken = socket.handshake?.auth?.token;
  if (authToken) return String(authToken);

  const hdr = socket.handshake?.headers?.authorization;
  if (hdr && String(hdr).startsWith("Bearer ")) return String(hdr).slice(7);

  const q = socket.handshake?.query?.token;
  if (q) return String(q);

  return null;
}

function maybeEnableRedisAdapter(io) {
  if (String(process.env.REDIS_SOCKET_ADAPTER_ENABLED || "false").toLowerCase() !== "true") {
    return;
  }

  try {
    const { createAdapter } = require("@socket.io/redis-adapter");
    const { createClient } = require("redis");

    const pubClient = createClient({ url: process.env.REDIS_URL });
    const subClient = pubClient.duplicate();

    Promise.all([pubClient.connect(), subClient.connect()])
      .then(() => io.adapter(createAdapter(pubClient, subClient)))
      .catch((err) => console.error("Socket Redis adapter init failed:", err?.message || err));
  } catch (err) {
    console.warn("Socket Redis adapter dependencies not installed; using in-process adapter.");
  }
}

function initSocketServer(app) {
  const server = http.createServer(app);

  const io = new Server(server, {
    cors: {
      origin: "*",
      methods: ["GET", "POST"]
    }
  });

  maybeEnableRedisAdapter(io);

  io.use(async (socket, next) => {
    try {
      const token = extractToken(socket);
      if (!token) return next(new Error("Unauthorized"));

      const user = await authenticateToken(token, { touchSession: true });
      if (!user) return next(new Error("Unauthorized"));

      socket.user = user;
      return next();
    } catch (e) {
      return next(new Error("Unauthorized"));
    }
  });

  io.on("connection", (socket) => {
    const u = socket.user;

    socket.join(`company:${u.company_id}`);
    socket.join(`user:${u.id}`);

    socket.on("conversation:join", (data = {}) => {
      const conversationId = data.conversationId;
      if (conversationId) socket.join(`conversation:${conversationId}`);
    });

    socket.on("conversation:leave", (data = {}) => {
      const conversationId = data.conversationId;
      if (conversationId) socket.leave(`conversation:${conversationId}`);
    });

    registerChatHandlers(io, socket);
    registerBroadcastHandlers(io, socket);
  });

  ioInstance = io;
  return { io, server };
}

module.exports = { initSocketServer, getIO };
