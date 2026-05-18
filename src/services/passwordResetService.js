const crypto = require('crypto');
const prisma = require('../config/db');
const { sendEmailWithAttachment } = require('./smtpService');

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function hashOtp(code) {
  return crypto.createHash('sha256').update(String(code)).digest('hex');
}

function generateOtpCode() {
  const min = 100000;
  const max = 999999;
  return String(Math.floor(Math.random() * (max - min + 1)) + min);
}

function getOtpExpiryMinutes() {
  const n = Number(process.env.PASSWORD_RESET_OTP_EXPIRES_MINUTES || 10);
  return Number.isFinite(n) && n > 0 ? n : 10;
}

function getOtpCooldownSeconds() {
  const n = Number(process.env.PASSWORD_RESET_OTP_COOLDOWN_SECONDS || 60);
  return Number.isFinite(n) && n >= 0 ? n : 60;
}

function getOtpMaxAttempts() {
  const n = Number(process.env.PASSWORD_RESET_OTP_MAX_ATTEMPTS || 5);
  return Number.isFinite(n) && n > 0 ? n : 5;
}

async function createAndSendPasswordResetOtp({ user, ip, userAgent }) {
  const email = normalizeEmail(user.email);
  const now = new Date();
  const cooldownSeconds = getOtpCooldownSeconds();
  const cutoff = new Date(now.getTime() - cooldownSeconds * 1000);

  const recent = await prisma.passwordResetOtp.findFirst({
    where: {
      company_id: user.company_id,
      user_id: user.id,
      used_at: null,
      created_at: { gte: cutoff }
    },
    orderBy: { created_at: 'desc' },
    select: { id: true, created_at: true }
  });

  if (recent) {
    const retryAfter = Math.max(1, cooldownSeconds - Math.floor((now.getTime() - new Date(recent.created_at).getTime()) / 1000));
    const err = new Error('OTP_COOLDOWN');
    err.statusCode = 429;
    err.meta = { retry_after_seconds: retryAfter };
    throw err;
  }

  await prisma.passwordResetOtp.updateMany({
    where: {
      company_id: user.company_id,
      user_id: user.id,
      used_at: null
    },
    data: { used_at: now }
  });

  const code = generateOtpCode();
  const expiresAt = new Date(now.getTime() + getOtpExpiryMinutes() * 60 * 1000);

  await prisma.passwordResetOtp.create({
    data: {
      company_id: user.company_id,
      user_id: user.id,
      email,
      otp_hash: hashOtp(code),
      expires_at: expiresAt,
      requested_ip: ip || null,
      requested_user_agent: userAgent || null
    }
  });

  const appName = process.env.SMTP_FROM_NAME || 'Babanamak';
  const subject = 'Your password reset OTP';
  const html = `
    <div style="font-family: Arial, sans-serif; color: #111827; line-height: 1.5;">
      <p>Hello ${String(user.name || 'User')},</p>
      <p>Use the OTP below to reset your password:</p>
      <div style="font-size: 30px; font-weight: 700; letter-spacing: 6px; margin: 18px 0; color: #022999;">
        ${code}
      </div>
      <p>This OTP will expire in ${getOtpExpiryMinutes()} minutes.</p>
      <p>If you did not request this, you can ignore this email.</p>
      <p>Thanks,<br/>${appName}</p>
    </div>
  `;

  await sendEmailWithAttachment({
    toEmail: email,
    toName: user.name || email,
    subject,
    html
  });

  return { expires_at: expiresAt };
}

async function verifyOtpAndConsume({ email, otp }) {
  const normalizedEmail = normalizeEmail(email);
  const now = new Date();
  const maxAttempts = getOtpMaxAttempts();

  const record = await prisma.passwordResetOtp.findFirst({
    where: {
      email: normalizedEmail,
      used_at: null,
      expires_at: { gt: now }
    },
    orderBy: { created_at: 'desc' },
    include: {
      user: {
        select: {
          id: true,
          company_id: true,
          name: true,
          email: true,
          status: true
        }
      }
    }
  });

  if (!record || !record.user || record.user.status !== 'ACTIVE') {
    const err = new Error('INVALID_OTP');
    err.statusCode = 400;
    throw err;
  }

  if ((record.attempt_count || 0) >= maxAttempts) {
    await prisma.passwordResetOtp.update({ where: { id: record.id }, data: { used_at: now } });
    const err = new Error('OTP_ATTEMPTS_EXCEEDED');
    err.statusCode = 400;
    throw err;
  }

  const expected = record.otp_hash;
  const actual = hashOtp(otp);
  if (expected !== actual) {
    await prisma.passwordResetOtp.update({
      where: { id: record.id },
      data: { attempt_count: { increment: 1 } }
    });
    const err = new Error('INVALID_OTP');
    err.statusCode = 400;
    throw err;
  }

  await prisma.passwordResetOtp.update({
    where: { id: record.id },
    data: { used_at: now }
  });

  return { user: record.user };
}

async function revokeAllUserSessions(company_id, user_id) {
  return prisma.userSession.updateMany({
    where: {
      company_id,
      user_id,
      revoked_at: null
    },
    data: { revoked_at: new Date() }
  });
}

module.exports = {
  normalizeEmail,
  createAndSendPasswordResetOtp,
  verifyOtpAndConsume,
  revokeAllUserSessions
};
