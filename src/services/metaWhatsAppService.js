const axios = require("axios");
const crypto = require("crypto");

function requireEnv(key) {
  const v = process.env[key];
  if (!v) {
    const err = new Error(`${key} is not set`);
    err.statusCode = 501;
    throw err;
  }
  return v;
}

/**
 * WhatsApp Cloud API typically prefers sending documents by LINK.
 * We'll send a document message with a URL (the PDF URL we generate).
 */
async function sendWhatsAppDocument({ toPhone, documentUrl, filename, caption }) {
  const token = requireEnv("META_WA_ACCESS_TOKEN");
  const phoneNumberId = requireEnv("META_WA_PHONE_NUMBER_ID");
  const version = process.env.META_WA_VERSION || "v20.0";

  const url = `https://graph.facebook.com/${version}/${phoneNumberId}/messages`;

  const payload = {
    messaging_product: "whatsapp",
    to: toPhone,
    type: "document",
    document: {
      link: documentUrl,
      filename: filename || "document.pdf",
      caption: caption || ""
    }
  };

  const resp = await axios.post(url, payload, {
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    }
  });

  return resp.data; // contains messages[0].id etc.
}

async function sendWhatsAppText({ toPhone, text }) {
  const token = requireEnv("META_WA_ACCESS_TOKEN");
  const phoneNumberId = requireEnv("META_WA_PHONE_NUMBER_ID");
  const version = process.env.META_WA_VERSION || "v20.0";

  const url = `https://graph.facebook.com/${version}/${phoneNumberId}/messages`;

  const payload = {
    messaging_product: "whatsapp",
    to: toPhone,
    type: "text",
    text: {
      preview_url: false,
      body: String(text || "")
    }
  };

  const resp = await axios.post(url, payload, {
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    }
  });

  return resp.data;
}

// Upload media and send as a document by Media ID (no public link needed).
async function sendWhatsAppDocumentBuffer({ toPhone, buffer, filename, caption }) {
  const token = requireEnv("META_WA_ACCESS_TOKEN");
  const phoneNumberId = requireEnv("META_WA_PHONE_NUMBER_ID");
  const version = process.env.META_WA_VERSION || "v20.0";

  const boundary = `----babanamak_${crypto.randomBytes(8).toString("hex")}`;
  const mediaUrl = `https://graph.facebook.com/${version}/${phoneNumberId}/media`;

  const head1 = Buffer.from(
    `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="messaging_product"\r\n\r\n` +
      `whatsapp\r\n`,
    "utf8"
  );

  const fname = filename || "document.pdf";
  const head2 = Buffer.from(
    `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="file"; filename="${fname}"\r\n` +
      `Content-Type: application/pdf\r\n\r\n`,
    "utf8"
  );
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`, "utf8");

  const body = Buffer.concat([head1, head2, Buffer.isBuffer(buffer) ? buffer : Buffer.from([]), tail]);

  const uploadResp = await axios.post(mediaUrl, body, {
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": `multipart/form-data; boundary=${boundary}`,
      "Content-Length": body.length
    }
  });

  const mediaId = uploadResp?.data?.id;
  if (!mediaId) {
    const err = new Error("Failed to upload WhatsApp media");
    err.statusCode = 502;
    throw err;
  }

  const msgUrl = `https://graph.facebook.com/${version}/${phoneNumberId}/messages`;
  const payload = {
    messaging_product: "whatsapp",
    to: toPhone,
    type: "document",
    document: {
      id: mediaId,
      filename: fname,
      caption: caption || ""
    }
  };

  const resp = await axios.post(msgUrl, payload, {
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    }
  });

  return resp.data;
}

module.exports = { sendWhatsAppDocument, sendWhatsAppText, sendWhatsAppDocumentBuffer };
