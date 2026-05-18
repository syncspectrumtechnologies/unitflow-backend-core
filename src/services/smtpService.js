const net = require("net");
const tls = require("tls");
const { resolveSender } = require("./messageSenderService");

function requireEnv(key) {
  const v = process.env[key];
  if (!v) {
    const err = new Error(`${key} is not set`);
    err.statusCode = 501;
    throw err;
  }
  return v;
}

function toBool(value, defaultValue = false) {
  if (value === undefined || value === null || value === "") return defaultValue;
  return ["1", "true", "yes", "on"].includes(String(value).trim().toLowerCase());
}

function b64(v) {
  return Buffer.from(String(v), "utf8").toString("base64");
}

function chunkBase64(buf) {
  const b = Buffer.isBuffer(buf) ? buf.toString("base64") : "";
  return b.replace(/(.{1,76})/g, "$1\r\n").trimEnd();
}

function stripHtml(html) {
  return String(html || "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function buildMime({ fromEmail, fromName, toEmail, subject, html, attachmentName, attachmentBuffer }) {
  const mix = `mix_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  const alt = `alt_${Date.now()}_${Math.random().toString(16).slice(2)}`;

  const safeSubject = String(subject || "Document").replace(/[\r\n]/g, " ");
  const safeFromName = String(fromName || "").replace(/"/g, "'");
  const fromLine = safeFromName ? `"${safeFromName}" <${fromEmail}>` : `<${fromEmail}>`;
  const text = stripHtml(html);

  const headers = [
    `From: ${fromLine}`,
    `To: <${toEmail}>`,
    `Subject: ${safeSubject}`,
    `MIME-Version: 1.0`,
    `Content-Type: multipart/mixed; boundary="${mix}"`
  ].join("\r\n");

  const altPart = [
    `--${mix}`,
    `Content-Type: multipart/alternative; boundary="${alt}"`,
    "",
    `--${alt}`,
    `Content-Type: text/plain; charset=utf-8`,
    `Content-Transfer-Encoding: 7bit`,
    "",
    text || " ",
    "",
    `--${alt}`,
    `Content-Type: text/html; charset=utf-8`,
    `Content-Transfer-Encoding: 7bit`,
    "",
    String(html || "<p></p>"),
    "",
    `--${alt}--`,
    ""
  ].join("\r\n");

  let attachPart = "";
  if (attachmentBuffer && Buffer.isBuffer(attachmentBuffer)) {
    const name = attachmentName || "document.pdf";
    attachPart = [
      `--${mix}`,
      `Content-Type: application/pdf; name="${name}"`,
      `Content-Disposition: attachment; filename="${name}"`,
      `Content-Transfer-Encoding: base64`,
      "",
      chunkBase64(attachmentBuffer),
      ""
    ].join("\r\n");
  }

  const end = `--${mix}--`;
  return `${headers}\r\n\r\n${altPart}${attachPart}${end}\r\n`;
}

function dotStuff(data) {
  return data.replace(/(^|\r\n)\./g, "$1..");
}

function createReader(socket) {
  return () =>
    new Promise((resolve, reject) => {
      let data = "";

      const cleanup = () => {
        socket.off("data", onData);
        socket.off("error", onError);
        socket.off("close", onClose);
        socket.off("end", onEnd);
        socket.off("timeout", onTimeout);
      };

      const finish = (value) => {
        cleanup();
        resolve(value);
      };

      const fail = (err) => {
        cleanup();
        reject(err);
      };

      const onData = (chunk) => {
        data += chunk;
        const lines = data.split(/\r\n/).filter(Boolean);
        if (!lines.length) return;
        const last = lines[lines.length - 1];
        if (/^\d{3}\s/.test(last)) finish(data);
      };

      const onError = (err) => fail(err);
      const onClose = () => fail(new Error("SMTP connection closed"));
      const onEnd = () => fail(new Error("SMTP connection ended"));
      const onTimeout = () => fail(new Error("SMTP connection timeout"));

      socket.on("data", onData);
      socket.on("error", onError);
      socket.on("close", onClose);
      socket.on("end", onEnd);
      socket.on("timeout", onTimeout);
    });
}

function parseAuthMethods(ehloResp) {
  const methods = new Set();
  String(ehloResp || "")
    .split(/\r\n/)
    .forEach((line) => {
      const m = line.match(/^250[-\s]AUTH\s+(.+)$/i);
      if (!m) return;
      String(m[1])
        .trim()
        .split(/\s+/)
        .filter(Boolean)
        .forEach((method) => methods.add(method.toUpperCase()));
    });
  return methods;
}

async function connectSocket({ host, port, secure, servername, rejectUnauthorized }) {
  return new Promise((resolve, reject) => {
    const onConnect = () => resolve(socket);
    const socket = secure
      ? tls.connect({ port, host, servername, rejectUnauthorized }, onConnect)
      : net.connect(port, host, onConnect);

    socket.setEncoding("utf8");
    socket.setTimeout(30_000);
    socket.once("error", reject);
    socket.once("timeout", () => reject(new Error("SMTP connection timeout")));
  });
}

async function upgradeToTls(socket, { servername, rejectUnauthorized }) {
  return new Promise((resolve, reject) => {
    const secureSocket = tls.connect({ socket, servername, rejectUnauthorized }, () => resolve(secureSocket));
    secureSocket.setEncoding("utf8");
    secureSocket.setTimeout(30_000);
    secureSocket.once("error", reject);
    secureSocket.once("timeout", () => reject(new Error("SMTP TLS upgrade timeout")));
  });
}

async function sendCommand({ socket, readResponse, cmd, expectCodes }) {
  if (cmd) socket.write(cmd + "\r\n");
  const resp = await readResponse();
  const expected = Array.isArray(expectCodes) ? expectCodes.map(String) : expectCodes ? [String(expectCodes)] : [];
  if (expected.length && !expected.some((code) => resp.startsWith(code))) {
    const err = new Error(`SMTP error${cmd ? ` for ${cmd}` : ""}: ${resp.trim()}`);
    err.smtp = resp;
    throw err;
  }
  return resp;
}

async function authenticate({ socket, readResponse, methods, username, password }) {
  if (!username || !password) return;

  if (methods.has("PLAIN")) {
    const authPlain = `\u0000${username}\u0000${password}`;
    await sendCommand({ socket, readResponse, cmd: `AUTH PLAIN ${b64(authPlain)}`, expectCodes: 235 });
    return;
  }

  if (methods.has("LOGIN") || methods.size === 0) {
    await sendCommand({ socket, readResponse, cmd: "AUTH LOGIN", expectCodes: 334 });
    await sendCommand({ socket, readResponse, cmd: b64(username), expectCodes: 334 });
    await sendCommand({ socket, readResponse, cmd: b64(password), expectCodes: 235 });
    return;
  }

  const err = new Error(`SMTP server does not support a configured auth method. Available methods: ${Array.from(methods).join(", ")}`);
  err.statusCode = 502;
  throw err;
}

async function smtpSend({
  host,
  port,
  secure,
  username,
  password,
  fromEmail,
  fromName,
  toEmail,
  subject,
  html,
  attachmentName,
  attachmentBuffer,
  starttls = true,
  ehloName = "localhost",
  tlsRejectUnauthorized = true
}) {
  const rejectUnauthorized = !!tlsRejectUnauthorized;
  const useSecure = !!secure;
  const p = Number(port);

  let socket = await connectSocket({ host, port: p, secure: useSecure, servername: host, rejectUnauthorized });
  let readResponse = createReader(socket);

  try {
    await sendCommand({ socket, readResponse, cmd: null, expectCodes: 220 });

    let ehloResp;
    try {
      ehloResp = await sendCommand({ socket, readResponse, cmd: `EHLO ${ehloName || "localhost"}`, expectCodes: 250 });
    } catch (err) {
      ehloResp = await sendCommand({ socket, readResponse, cmd: `HELO ${ehloName || "localhost"}`, expectCodes: 250 });
    }

    const supportsStartTls = /\bSTARTTLS\b/i.test(ehloResp);
    const wantStartTls = !useSecure && supportsStartTls && !!starttls;

    if (wantStartTls) {
      await sendCommand({ socket, readResponse, cmd: "STARTTLS", expectCodes: 220 });
      socket = await upgradeToTls(socket, { servername: host, rejectUnauthorized });
      readResponse = createReader(socket);
      ehloResp = await sendCommand({ socket, readResponse, cmd: `EHLO ${ehloName || "localhost"}`, expectCodes: 250 });
    }

    await authenticate({
      socket,
      readResponse,
      methods: parseAuthMethods(ehloResp),
      username,
      password
    });

    await sendCommand({ socket, readResponse, cmd: `MAIL FROM:<${fromEmail}>`, expectCodes: 250 });
    await sendCommand({ socket, readResponse, cmd: `RCPT TO:<${toEmail}>`, expectCodes: [250, 251] });
    await sendCommand({ socket, readResponse, cmd: "DATA", expectCodes: 354 });

    const mime = dotStuff(buildMime({ fromEmail, fromName, toEmail, subject, html, attachmentName, attachmentBuffer }));
    socket.write(mime + "\r\n.\r\n");
    const dataResp = await readResponse();
    if (!dataResp.startsWith("250")) {
      const err = new Error(`SMTP DATA rejected: ${dataResp.trim()}`);
      err.smtp = dataResp;
      throw err;
    }

    try {
      await sendCommand({ socket, readResponse, cmd: "QUIT", expectCodes: 221 });
    } catch (_) {
      // ignore quit failures after successful send
    }

    socket.end();
    return { ok: true, provider: "smtp" };
  } catch (err) {
    try {
      socket.end();
    } catch (_) {}
    throw err;
  }
}

async function sendEmailWithAttachment({ toEmail, toName, subject, html, attachmentName, attachmentBuffer, senderKey }) {
  const sender = resolveSender("EMAIL", senderKey);
  const host = sender.smtp.host || requireEnv("SMTP_HOST");
  const port = Number(sender.smtp.port || process.env.SMTP_PORT || 587);
  const secure = sender.smtp.secure;
  const username = sender.smtp.user || null;
  const password = sender.smtp.pass || null;
  const fromEmail = sender.from_email || process.env.SMTP_FROM_EMAIL || process.env.SMTP_FROM || requireEnv("SMTP_USER");
  const fromName = sender.from_name || process.env.SMTP_FROM_NAME || process.env.BRAND_NAME || "Babanamak";

  const normalizedToEmail = String(toEmail || "").trim();

  if (!normalizedToEmail) {
    const err = new Error("toEmail is required");
    err.statusCode = 400;
    throw err;
  }

  const resp = await smtpSend({
    host,
    port,
    secure,
    username,
    password,
    fromEmail,
    fromName,
    toEmail: normalizedToEmail,
    toName,
    subject,
    html,
    attachmentName,
    attachmentBuffer,
    starttls: sender.smtp.starttls,
    ehloName: sender.smtp.ehlo_name || "localhost",
    tlsRejectUnauthorized: sender.smtp.tls_reject_unauthorized
  });

  return {
    ...resp,
    sender: sender.public
  };
}

module.exports = {
  sendEmailWithAttachment,
  _internals: {
    buildMime,
    stripHtml,
    parseAuthMethods,
    toBool
  }
};
