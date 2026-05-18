function normalizeString(value) {
  if (value === undefined || value === null) return null;
  const v = String(value).trim();
  return v ? v : null;
}

function toBool(value, defaultValue = false) {
  if (value === undefined || value === null || value === "") return defaultValue;
  return ["1", "true", "yes", "on"].includes(String(value).trim().toLowerCase());
}

function normalizePhone(value) {
  const v = normalizeString(value);
  return v ? v.replace(/[\s()-]+/g, "") : null;
}

function buildEmailBaseSender() {
  const port = Number(process.env.SMTP_PORT || 587);
  return {
    key: "default",
    label: normalizeString(process.env.SMTP_FROM_NAME) || normalizeString(process.env.BRAND_NAME) || normalizeString(process.env.SMTP_FROM_EMAIL) || normalizeString(process.env.SMTP_FROM) || "Default Email",
    from_email: normalizeString(process.env.SMTP_FROM_EMAIL) || normalizeString(process.env.SMTP_FROM) || normalizeString(process.env.SMTP_USER),
    from_name: normalizeString(process.env.SMTP_FROM_NAME) || normalizeString(process.env.BRAND_NAME) || "Babanamak",
    smtp: {
      host: normalizeString(process.env.SMTP_HOST),
      port,
      secure: toBool(process.env.SMTP_SECURE, port === 465),
      starttls: toBool(process.env.SMTP_STARTTLS, true),
      user: normalizeString(process.env.SMTP_USER),
      pass: normalizeString(process.env.SMTP_PASS),
      ehlo_name: normalizeString(process.env.SMTP_EHLO_NAME) || "localhost",
      tls_reject_unauthorized: toBool(process.env.SMTP_TLS_REJECT_UNAUTHORIZED, true)
    }
  };
}

function buildConfiguredEmailSender(index, base) {
  const prefix = `EMAIL_SENDER_${index}_`;
  const key = normalizeString(process.env[`${prefix}KEY`]) || `email_${index}`;
  const label = normalizeString(process.env[`${prefix}LABEL`]);
  const from_email = normalizeString(process.env[`${prefix}FROM_EMAIL`]) || base.from_email;
  const from_name = normalizeString(process.env[`${prefix}FROM_NAME`]) || base.from_name;
  const host = normalizeString(process.env[`${prefix}SMTP_HOST`]) || base.smtp.host;
  const portValue = normalizeString(process.env[`${prefix}SMTP_PORT`]);
  const port = portValue ? Number(portValue) : base.smtp.port;
  const secure = toBool(process.env[`${prefix}SMTP_SECURE`], base.smtp.secure);
  const starttls = toBool(process.env[`${prefix}SMTP_STARTTLS`], base.smtp.starttls);
  const user = normalizeString(process.env[`${prefix}SMTP_USER`]) || base.smtp.user;
  const pass = normalizeString(process.env[`${prefix}SMTP_PASS`]) || base.smtp.pass;
  const ehlo_name = normalizeString(process.env[`${prefix}SMTP_EHLO_NAME`]) || base.smtp.ehlo_name;
  const tls_reject_unauthorized = toBool(process.env[`${prefix}SMTP_TLS_REJECT_UNAUTHORIZED`], base.smtp.tls_reject_unauthorized);

  const isDeclared = [
    process.env[`${prefix}KEY`],
    process.env[`${prefix}LABEL`],
    process.env[`${prefix}FROM_EMAIL`],
    process.env[`${prefix}FROM_NAME`],
    process.env[`${prefix}SMTP_HOST`],
    process.env[`${prefix}SMTP_USER`]
  ].some((v) => normalizeString(v));

  if (!isDeclared) return null;
  if (!from_email || !host) return null;

  return {
    key,
    label: label || from_name || from_email,
    from_email,
    from_name,
    smtp: {
      host,
      port,
      secure,
      starttls,
      user,
      pass,
      ehlo_name,
      tls_reject_unauthorized
    }
  };
}

function getEmailSenders() {
  const base = buildEmailBaseSender();
  const configured = [1, 2]
    .map((index) => buildConfiguredEmailSender(index, base))
    .filter(Boolean);

  if (configured.length) return configured;
  if (base.from_email && base.smtp.host) return [base];
  return [];
}

function buildWhatsAppBaseSender() {
  return {
    key: "default",
    label: normalizeString(process.env.DOUBLETICK_WHATSAPP_LABEL) || normalizePhone(process.env.DOUBLETICK_WHATSAPP_FROM) || "Default WhatsApp",
    from_phone: normalizePhone(process.env.DOUBLETICK_WHATSAPP_FROM),
    api_key: normalizeString(process.env.DOUBLETICK_API_KEY)
  };
}

function buildConfiguredWhatsAppSender(index, base) {
  const prefix = `WHATSAPP_SENDER_${index}_`;
  const key = normalizeString(process.env[`${prefix}KEY`]) || `whatsapp_${index}`;
  const label = normalizeString(process.env[`${prefix}LABEL`]);
  const from_phone = normalizePhone(process.env[`${prefix}FROM_PHONE`]) || base.from_phone;
  const api_key = normalizeString(process.env[`${prefix}API_KEY`]) || base.api_key;

  const isDeclared = [
    process.env[`${prefix}KEY`],
    process.env[`${prefix}LABEL`],
    process.env[`${prefix}FROM_PHONE`],
    process.env[`${prefix}API_KEY`]
  ].some((v) => normalizeString(v));

  if (!isDeclared) return null;
  if (!from_phone || !api_key) return null;

  return {
    key,
    label: label || from_phone,
    from_phone,
    api_key
  };
}

function getWhatsAppSenders() {
  const base = buildWhatsAppBaseSender();
  const configured = [1, 2]
    .map((index) => buildConfiguredWhatsAppSender(index, base))
    .filter(Boolean);

  if (configured.length) return configured;
  if (base.from_phone && base.api_key) return [base];
  return [];
}

function getDefaultSenderKey(channel) {
  if (channel === "EMAIL") return normalizeString(process.env.EMAIL_DEFAULT_SENDER_KEY);
  if (channel === "WHATSAPP") return normalizeString(process.env.WHATSAPP_DEFAULT_SENDER_KEY);
  return null;
}

function publicEmailSender(sender, isDefault = false) {
  return {
    key: sender.key,
    label: sender.label,
    from_email: sender.from_email,
    from_name: sender.from_name,
    is_default: isDefault
  };
}

function publicWhatsAppSender(sender, isDefault = false) {
  return {
    key: sender.key,
    label: sender.label,
    from_phone: sender.from_phone,
    provider: "doubletick",
    is_default: isDefault
  };
}

function getSenderCatalog() {
  const emailSenders = getEmailSenders();
  const whatsappSenders = getWhatsAppSenders();
  const emailDefaultKey = getDefaultSenderKey("EMAIL");
  const whatsappDefaultKey = getDefaultSenderKey("WHATSAPP");

  return {
    email: emailSenders.map((sender, index) => publicEmailSender(sender, sender.key === emailDefaultKey || (!emailDefaultKey && index === 0))),
    whatsapp: whatsappSenders.map((sender, index) => publicWhatsAppSender(sender, sender.key === whatsappDefaultKey || (!whatsappDefaultKey && index === 0)))
  };
}

function resolveSender(channel, requestedKey = null) {
  const normalizedChannel = String(channel || "").trim().toUpperCase();
  const selectedKey = normalizeString(requestedKey);
  const senders = normalizedChannel === "EMAIL" ? getEmailSenders() : normalizedChannel === "WHATSAPP" ? getWhatsAppSenders() : [];

  if (!senders.length) {
    const err = new Error(normalizedChannel === "EMAIL" ? "No email sender is configured" : "No WhatsApp sender is configured");
    err.statusCode = 501;
    throw err;
  }

  const defaultKey = getDefaultSenderKey(normalizedChannel);
  let sender = null;

  if (selectedKey) {
    sender = senders.find((item) => item.key === selectedKey);
    if (!sender) {
      const err = new Error(`${normalizedChannel === "EMAIL" ? "email" : "whatsapp"}_sender_key is invalid`);
      err.statusCode = 400;
      throw err;
    }
  } else if (defaultKey) {
    sender = senders.find((item) => item.key === defaultKey) || senders[0];
  } else {
    sender = senders[0];
  }

  if (normalizedChannel === "EMAIL") {
    return {
      ...sender,
      public: publicEmailSender(sender, sender.key === defaultKey || (!defaultKey && senders[0]?.key === sender.key))
    };
  }

  return {
    ...sender,
    public: publicWhatsAppSender(sender, sender.key === defaultKey || (!defaultKey && senders[0]?.key === sender.key))
  };
}

function getRequestedSenderKey(body = {}, channel) {
  if (String(channel || "").trim().toUpperCase() === "EMAIL") {
    return normalizeString(body.email_sender_key) || normalizeString(body.sender_key) || normalizeString(body.from_email_key);
  }
  return normalizeString(body.whatsapp_sender_key) || normalizeString(body.sender_key) || normalizeString(body.from_phone_key);
}

module.exports = {
  getSenderCatalog,
  resolveSender,
  getRequestedSenderKey,
  normalizePhone
};
