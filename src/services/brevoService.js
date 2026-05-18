const axios = require("axios");

function requireEnv(key) {
  const v = process.env[key];
  if (!v) {
    const err = new Error(`${key} is not set`);
    err.statusCode = 501;
    throw err;
  }
  return v;
}

async function sendEmailWithAttachment({ toEmail, toName, subject, html, attachmentName, attachmentBuffer }) {
  const apiKey = requireEnv("BREVO_API_KEY");
  const senderEmail = requireEnv("BREVO_SENDER_EMAIL");
  const senderName = process.env.BREVO_SENDER_NAME || "Babanamak";

  const payload = {
    sender: { email: senderEmail, name: senderName },
    to: [{ email: toEmail, name: toName || toEmail }],
    subject: subject || "Document",
    htmlContent: html || "<p>Please find attached document.</p>",
    attachment: attachmentBuffer
      ? [
          {
            name: attachmentName || "document.pdf",
            content: attachmentBuffer.toString("base64")
          }
        ]
      : undefined
  };

  const resp = await axios.post("https://api.brevo.com/v3/smtp/email", payload, {
    headers: {
      "api-key": apiKey,
      "content-type": "application/json"
    }
  });

  return resp.data; // { messageId: ... } usually
}

module.exports = { sendEmailWithAttachment };
