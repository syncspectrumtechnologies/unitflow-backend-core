const axios = require("axios");
const crypto = require("crypto");
const { resolveSender, normalizePhone } = require("./messageSenderService");

const BASE_URL = "https://public.doubletick.io";

function buildHeaders(apiKey, extra = {}) {
  return {
    Authorization: apiKey,
    ...extra
  };
}

function resolveWhatsAppSender(senderKey) {
  return resolveSender("WHATSAPP", senderKey);
}

function resolveMessageId(messageId) {
  return messageId || crypto.randomUUID();
}

async function sendWhatsAppText({ toPhone, text, senderKey, messageId }) {
  const sender = resolveWhatsAppSender(senderKey);
  const normalizedTo = normalizePhone(toPhone);
  if (!normalizedTo) {
    const err = new Error("toPhone is required");
    err.statusCode = 400;
    throw err;
  }
  if (!String(text || "").trim()) {
    const err = new Error("text is required");
    err.statusCode = 400;
    throw err;
  }
  const payload = {
    to: normalizedTo,
    from: sender.from_phone,
    messageId: resolveMessageId(messageId),
    content: {
      text: String(text || "")
    }
  };

  const resp = await axios.post(`${BASE_URL}/whatsapp/message/text`, payload, {
    headers: buildHeaders(sender.api_key, { "Content-Type": "application/json" })
  });

  return {
    ...resp.data,
    _sender: sender.public
  };
}

async function uploadMedia({ buffer, filename, contentType, senderKey }) {
  const sender = resolveWhatsAppSender(senderKey);
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    const err = new Error("buffer is required");
    err.statusCode = 400;
    throw err;
  }
  const boundary = `----babanamak_dt_${crypto.randomBytes(8).toString("hex")}`;
  const safeFilename = filename || "document.pdf";
  const mimeType = contentType || "application/pdf";

  const head = Buffer.from(
    `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="file"; filename="${safeFilename}"\r\n` +
      `Content-Type: ${mimeType}\r\n\r\n`,
    "utf8"
  );
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`, "utf8");
  const body = Buffer.concat([head, Buffer.isBuffer(buffer) ? buffer : Buffer.from([]), tail]);

  const resp = await axios.post(`${BASE_URL}/media/upload`, body, {
    headers: buildHeaders(sender.api_key, {
      "Content-Type": `multipart/form-data; boundary=${boundary}`,
      "Content-Length": body.length
    }),
    maxBodyLength: Infinity,
    maxContentLength: Infinity
  });

  return {
    ...resp.data,
    _sender: sender.public
  };
}

async function sendWhatsAppDocument({ toPhone, documentUrl, filename, caption, senderKey, messageId }) {
  const sender = resolveWhatsAppSender(senderKey);
  const normalizedTo = normalizePhone(toPhone);
  if (!normalizedTo) {
    const err = new Error("toPhone is required");
    err.statusCode = 400;
    throw err;
  }
  if (!String(documentUrl || "").trim()) {
    const err = new Error("documentUrl is required");
    err.statusCode = 400;
    throw err;
  }
  const payload = {
    to: normalizedTo,
    from: sender.from_phone,
    messageId: resolveMessageId(messageId),
    content: {
      mediaUrl: String(documentUrl || ""),
      caption: caption || undefined,
      filename: filename || undefined
    }
  };

  const resp = await axios.post(`${BASE_URL}/whatsapp/message/document`, payload, {
    headers: buildHeaders(sender.api_key, { "Content-Type": "application/json" })
  });

  return {
    ...resp.data,
    _sender: sender.public
  };
}

async function sendWhatsAppDocumentBuffer({ toPhone, buffer, filename, caption, senderKey, messageId }) {
  const upload = await uploadMedia({
    buffer,
    filename: filename || "document.pdf",
    contentType: "application/pdf",
    senderKey
  });

  const resp = await sendWhatsAppDocument({
    toPhone,
    documentUrl: upload.mediaUrl,
    filename,
    caption,
    senderKey,
    messageId
  });

  return {
    ...resp,
    mediaUrl: upload.mediaUrl,
    expiresIn: upload.expiresIn,
    _sender: resp._sender || upload._sender
  };
}

module.exports = {
  sendWhatsAppText,
  sendWhatsAppDocument,
  sendWhatsAppDocumentBuffer,
  uploadMedia
};
