const { io } = require("socket.io-client");

const URL = process.env.URL || "http://localhost:4000";
const TOKEN = process.env.TOKEN; // JWT

if (!TOKEN) {
  console.log("Set TOKEN env var");
  process.exit(1);
}

const socket = io(URL, {
  auth: { token: TOKEN }
});

socket.on("connect", () => console.log("connected:", socket.id));
socket.on("connect_error", (e) => console.log("connect_error:", e.message));

socket.on("chat:new", (p) => console.log("chat:new", p));
socket.on("chat:read", (p) => console.log("chat:read", p));
socket.on("broadcast:new", (p) => console.log("broadcast:new", p));
socket.on("broadcast:seen", (p) => console.log("broadcast:seen", p));

// Example send helpers via stdin
process.stdin.on("data", (buf) => {
  const line = buf.toString().trim();
  try {
    const msg = JSON.parse(line);

    if (msg.type === "join") socket.emit("conversation:join", { conversationId: msg.conversationId });
    if (msg.type === "send_chat") socket.emit("chat:send", { conversationId: msg.conversationId, body: msg.body }, console.log);
    if (msg.type === "read_chat") socket.emit("chat:read", { conversationId: msg.conversationId }, console.log);
    if (msg.type === "send_broadcast") socket.emit("broadcast:send", msg.payload, console.log);
    if (msg.type === "seen_broadcast") socket.emit("broadcast:seen", { broadcastId: msg.broadcastId }, console.log);
  } catch {
    console.log("Send JSON lines only.");
  }
});