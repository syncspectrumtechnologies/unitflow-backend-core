const prisma = require("../config/db");
const { env } = require("../config/env");
const { comparePassword, hashPassword } = require("../utils/password");
const { signToken, expiresInToMs } = require("../utils/jwt");
const { refreshCoreSessionAuth } = require("../services/authSessionService");
const logActivity = require("../utils/activityLogger");
const {
  normalizeEmail,
  createAndSendPasswordResetOtp,
  verifyOtpAndConsume,
  revokeAllUserSessions
} = require("../services/passwordResetService");

exports.login = async (req, res) => {
  if (!env.allowDirectCoreLogin) {
    return res.status(403).json({
      message: "Direct core login is disabled. Use the Platform API runtime login flow.",
      code: "DIRECT_CORE_LOGIN_DISABLED"
    });
  }

  const { email, password } = req.body;
  const tenantId = String(req.body?.tenant_id || req.body?.company_id || '').trim() || null;

  if (!email || !password) {
    return res.status(400).json({ message: "Email and password required" });
  }

  const user = await prisma.user.findFirst({
    where: {
      email: normalizeEmail(email),
      ...(tenantId ? { company_id: tenantId } : {})
    },
    orderBy: { created_at: "asc" }
  });

  if (!user || user.status !== "ACTIVE") {
    return res.status(401).json({ message: "Invalid credentials" });
  }

  const isValid = await comparePassword(password, user.password_hash);
  if (!isValid) {
    return res.status(401).json({ message: "Invalid credentials" });
  }

  const { token, jti, expiresIn } = signToken({
    user_id: user.id,
    company_id: user.company_id,
    is_admin: user.is_admin
  });

  const now = new Date();
  const sessionExpiry = new Date(now.getTime() + expiresInToMs(expiresIn));

  await prisma.$transaction([
    prisma.user.update({
      where: { id: user.id },
      data: { last_login_at: now }
    }),
    prisma.userSession.create({
      data: {
        company_id: user.company_id,
        user_id: user.id,
        token_jti: jti,
        ip: req.ip,
        user_agent: req.headers["user-agent"],
        last_seen_at: now,
        expires_at: sessionExpiry
      }
    })
  ]);

  return res.json({
    token,
    expires_in: expiresIn
  });
};

exports.me = async (req, res) => {
  try {
    const user = req.user;

    let factories = [];

    if (user.is_admin) {
      factories = await prisma.factory.findMany({
        where: {
          company_id: user.company_id,
          is_active: true
        },
        select: {
          id: true,
          name: true
        }
      });
    } else {
      const mappings = await prisma.userFactoryMap.findMany({
        where: {
          user_id: user.id,
          company_id: user.company_id
        },
        include: {
          factory: {
            select: { id: true, name: true, is_active: true }
          }
        }
      });

      factories = mappings
        .map(m => m.factory)
        .filter(f => f.is_active);
    }

    res.json({
      user_id: user.id,
      email: user.email,
      company_id: user.company_id,
      is_admin: user.is_admin,
      factories,
      roles: Array.isArray(user.roles) ? user.roles : []
    });

  } catch (err) {
    console.error("Auth me error:", err);
    res.status(500).json({ message: "Internal server error" });
  }
};

exports.refresh = async (req, res) => {
  try {
    if (!req.auth?.user) {
      return res.status(401).json({ message: "Authentication required" });
    }

    if (req.auth.token_source !== "core") {
      return res.status(400).json({
        message: "Runtime tokens are refreshed by the Platform API session flow."
      });
    }

    const refreshed = req.auth.refreshed_token || await refreshCoreSessionAuth(req.auth, { force: true });
    if (!refreshed) {
      return res.status(401).json({ message: "Session is no longer active" });
    }

    res.setHeader("Authorization", "Bearer " + refreshed.token);
    res.setHeader("X-Access-Token", refreshed.token);
    res.setHeader("X-Token-Refreshed", "true");
    res.setHeader("X-Token-Expires-In", refreshed.expires_in);
    res.setHeader("X-Token-Expires-At", refreshed.expires_at);

    return res.json(refreshed);
  } catch (err) {
    console.error("refresh error:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};

// POST /auth/forgot-password/request-otp
exports.requestPasswordResetOtp = async (req, res) => {
  try {
    const email = normalizeEmail(req.body?.email);
    const tenantId = String(req.body?.tenant_id || req.body?.company_id || '').trim() || null;
    if (!email) {
      return res.status(400).json({ message: "email is required" });
    }

    const user = await prisma.user.findFirst({
      where: {
        email,
        ...(tenantId ? { company_id: tenantId } : {})
      },
      orderBy: { created_at: 'asc' },
      select: {
        id: true,
        company_id: true,
        name: true,
        email: true,
        status: true,
        is_admin: true
      }
    });

    if (!user || user.status !== "ACTIVE") {
      return res.json({ message: "If the account exists, an OTP has been sent to the registered email." });
    }

    if (!user.is_admin) {
      return res.status(403).json({
        message: "Password reset via email is available only for admin accounts. Please contact your admin."
      });
    }

    try {
      const result = await createAndSendPasswordResetOtp({
        user,
        ip: req.ip,
        userAgent: req.headers["user-agent"] || null
      });

      await logActivity({
        company_id: user.company_id,
        user_id: user.id,
        action: "PASSWORD_RESET_OTP_REQUESTED",
        entity_type: "user",
        entity_id: user.id,
        ip: req.ip,
        user_agent: req.headers["user-agent"] || null,
        meta: { expires_at: result.expires_at }
      });
    } catch (err) {
      if (err?.message === "OTP_COOLDOWN") {
        return res.status(429).json({
          message: "OTP already sent recently. Please wait before requesting again.",
          ...(err.meta || {})
        });
      }
      throw err;
    }

    return res.json({ message: "If the account exists, an OTP has been sent to the registered email." });
  } catch (err) {
    console.error("requestPasswordResetOtp error:", err);
    const statusCode = err?.statusCode || 500;
    return res.status(statusCode).json({ message: statusCode === 501 ? err.message : "Internal server error" });
  }
};

// POST /auth/forgot-password/reset
exports.resetOwnPasswordWithOtp = async (req, res) => {
  try {
    const email = normalizeEmail(req.body?.email);
    const otp = String(req.body?.otp || "").trim();
    const new_password = String(req.body?.new_password || req.body?.password || "");

    if (!email) return res.status(400).json({ message: "email is required" });
    if (!otp) return res.status(400).json({ message: "otp is required" });
    if (new_password.length < 6) {
      return res.status(400).json({ message: "new_password must be at least 6 characters" });
    }

    let verified;
    try {
      verified = await verifyOtpAndConsume({ email, otp });
    } catch (err) {
      if (err?.message === "INVALID_OTP") {
        return res.status(400).json({ message: "Invalid or expired OTP" });
      }
      if (err?.message === "OTP_ATTEMPTS_EXCEEDED") {
        return res.status(400).json({ message: "OTP attempts exceeded. Please request a new OTP." });
      }
      throw err;
    }

    const password_hash = await hashPassword(new_password);
    const revoked = await prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: verified.user.id },
        data: { password_hash }
      });

      const revokedSessions = await tx.userSession.updateMany({
        where: {
          company_id: verified.user.company_id,
          user_id: verified.user.id,
          revoked_at: null
        },
        data: { revoked_at: new Date() }
      });

      return revokedSessions;
    });

    await logActivity({
      company_id: verified.user.company_id,
      user_id: verified.user.id,
      action: "PASSWORD_RESET_SELF",
      entity_type: "user",
      entity_id: verified.user.id,
      ip: req.ip,
      user_agent: req.headers["user-agent"] || null,
      meta: { revoked_session_count: revoked.count || 0 }
    });

    return res.json({ message: "Password reset successful. Please login again." });
  } catch (err) {
    console.error("resetOwnPasswordWithOtp error:", err);
    const statusCode = err?.statusCode || 500;
    return res.status(statusCode).json({ message: "Internal server error" });
  }
};
