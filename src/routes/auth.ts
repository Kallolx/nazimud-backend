import { FastifyPluginAsync } from "fastify";
import { prisma } from "../db/prisma";
import { comparePassword, hashPassword } from "../utils/password";
import { z } from "zod";
import { requireAuth } from "../utils/auth";
import { env } from "../config/env";
import crypto from "crypto";
import { checkRateLimit } from "../utils/rate-limit";

const registerSchema = z.object({
  email: z.string().email(),
  username: z.string().min(3).max(32).regex(/^[a-zA-Z0-9_]+$/),
  password: z.string().min(8),
  age: z.number().int().min(19),
  captchaToken: z.string().min(1),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  captchaToken: z.string().min(1),
});

const refreshSchema = z.object({
  refreshToken: z.string().min(20),
});

function buildUserPayload(user: {
  id: number;
  email: string;
  username: string;
  role: "USER" | "ADMIN";
}) {
  return {
    id: user.id,
    email: user.email,
    username: user.username,
    role: user.role,
  };
}

async function issueAuthTokens(reply: any, user: { id: number; email: string; role: "USER" | "ADMIN" }) {
  const accessToken = await reply.jwtSign(
    { id: user.id, email: user.email, role: user.role },
    { expiresIn: env.JWT_EXPIRES_IN },
  );

  const refreshToken = crypto.randomBytes(48).toString("hex");
  const expiresAt = new Date(Date.now() + env.REFRESH_TOKEN_DAYS * 24 * 60 * 60 * 1000);

  await prisma.refreshToken.create({
    data: {
      token: refreshToken,
      userId: user.id,
      expiresAt,
    },
  });

  return { accessToken, refreshToken };
}

function extractClientIp(request: any): string {
  const forwarded = request.headers?.["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.trim()) {
    return forwarded.split(",")[0].trim();
  }
  return String(request.ip || "").trim();
}

function applyNoStore(reply: any): void {
  reply.header("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  reply.header("Pragma", "no-cache");
  reply.header("Expires", "0");
}

function normalizeEmail(value: string): string {
  return String(value || "").trim().toLowerCase();
}

function getEmailDomain(email: string): string {
  const normalized = normalizeEmail(email);
  const at = normalized.lastIndexOf("@");
  if (at < 0) return "";
  return normalized.slice(at + 1);
}

function isAllowedEmailDomain(email: string): boolean {
  const allowed = env.ALLOWED_EMAIL_DOMAINS.split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);

  if (allowed.length === 0) {
    return true;
  }

  const domain = getEmailDomain(email);
  return Boolean(domain) && allowed.includes(domain);
}

async function verifyTurnstileOrReject(request: any, reply: any, token: string): Promise<boolean> {
  if (!String(token || "").trim()) {
    reply.code(400).send({ message: "Captcha token is required." });
    return false;
  }

  if (env.CAPTCHA_MODE === "mock" && env.NODE_ENV !== "production") {
    if (String(token).trim() !== env.LOCAL_CAPTCHA_TOKEN) {
      reply.code(400).send({ message: "Please complete local captcha checkbox." });
      return false;
    }
    return true;
  }

  if (!env.TURNSTILE_SECRET_KEY) {
    reply.code(503).send({ message: "Captcha is not configured on server." });
    return false;
  }

  try {
    const body = new URLSearchParams();
    body.set("secret", env.TURNSTILE_SECRET_KEY);
    body.set("response", token);

    const ip = extractClientIp(request);
    if (ip) {
      body.set("remoteip", ip);
    }

    const response = await fetch(env.TURNSTILE_VERIFY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });

    if (!response.ok) {
      reply.code(502).send({ message: "Captcha verification service unavailable." });
      return false;
    }

    const payload = (await response.json()) as { success?: boolean };
    if (!payload?.success) {
      reply.code(400).send({ message: "Captcha verification failed. Please try again." });
      return false;
    }

    return true;
  } catch {
    reply.code(502).send({ message: "Captcha verification failed. Please try again." });
    return false;
  }
}

function enforceAuthRateLimit(request: any, reply: any, scope: "login" | "register"): boolean {
  const clientIp = extractClientIp(request) || "unknown";
  const body = (request.body ?? {}) as { email?: string };
  const email = normalizeEmail(body.email || "");

  const ipLimit = checkRateLimit({
    key: `${scope}:ip:${clientIp}`,
    maxRequests: scope === "login" ? 40 : 15,
    windowMs: 10 * 60 * 1000,
    blockMs: 10 * 60 * 1000,
  });

  if (!ipLimit.allowed) {
    reply.header("Retry-After", String(ipLimit.retryAfterSeconds));
    reply.code(429).send({ message: "Too many requests. Please try again later." });
    return false;
  }

  if (email) {
    const emailLimit = checkRateLimit({
      key: `${scope}:email:${email}`,
      maxRequests: scope === "login" ? 15 : 8,
      windowMs: 10 * 60 * 1000,
      blockMs: 10 * 60 * 1000,
    });

    if (!emailLimit.allowed) {
      reply.header("Retry-After", String(emailLimit.retryAfterSeconds));
      reply.code(429).send({ message: "Too many attempts. Please try again later." });
      return false;
    }
  }

  return true;
}

export const authRoutes: FastifyPluginAsync = async (app) => {
  app.post("/register", async (request, reply) => {
    applyNoStore(reply);

    if (!enforceAuthRateLimit(request, reply, "register")) {
      return;
    }

    const parsed = registerSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ message: "Invalid registration payload", errors: parsed.error.flatten() });
    }

    const { email, username, password, age, captchaToken } = parsed.data;

    const captchaOk = await verifyTurnstileOrReject(request, reply, captchaToken);
    if (!captchaOk) {
      return;
    }

    if (!isAllowedEmailDomain(email)) {
      return reply.code(400).send({
        message:
          "Registration with this email domain is not allowed. Please use a supported provider.",
      });
    }

    const existing = await prisma.user.findFirst({
      where: {
        OR: [{ email }, { username }],
      },
    });

    if (existing) {
      return reply.code(409).send({ message: "Email or username already exists" });
    }

    const passwordHash = await hashPassword(password);

    const user = await prisma.user.create({
      data: {
        email,
        username,
        age,
        passwordHash,
      },
    });

    await prisma.adminAction.create({
      data: {
        adminId: user.id,
        actionType: "user_register",
        targetType: "user",
        targetId: user.id,
        reason: extractClientIp(request),
      },
    });

    const { accessToken, refreshToken } = await issueAuthTokens(reply, {
      id: user.id,
      email: user.email,
      role: user.role,
    });

    return reply.code(201).send({
      accessToken,
      refreshToken,
      user: buildUserPayload({
        id: user.id,
        email: user.email,
        username: user.username,
        role: user.role,
      }),
    });
  });

  app.post("/login", async (request, reply) => {
    applyNoStore(reply);

    if (!enforceAuthRateLimit(request, reply, "login")) {
      return;
    }

    const parsed = loginSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ message: "Invalid login payload", errors: parsed.error.flatten() });
    }

    const { email, password, captchaToken } = parsed.data;

    const captchaOk = await verifyTurnstileOrReject(request, reply, captchaToken);
    if (!captchaOk) {
      return;
    }
    const user = await prisma.user.findUnique({ where: { email } });

    if (!user) {
      return reply.code(401).send({ message: "Invalid email or password" });
    }

    if (user.isBanned) {
      return reply.code(403).send({ message: "Your account is banned" });
    }

    const validPassword = await comparePassword(password, user.passwordHash);
    if (!validPassword) {
      return reply.code(401).send({ message: "Invalid email or password" });
    }

    const { accessToken, refreshToken } = await issueAuthTokens(reply, {
      id: user.id,
      email: user.email,
      role: user.role,
    });

    await prisma.adminAction.create({
      data: {
        adminId: user.id,
        actionType: "user_login",
        targetType: "user",
        targetId: user.id,
        reason: extractClientIp(request),
      },
    });

    return {
      accessToken,
      refreshToken,
      user: buildUserPayload({
        id: user.id,
        email: user.email,
        username: user.username,
        role: user.role,
      }),
    };
  });

  app.post("/refresh", async (request, reply) => {
    applyNoStore(reply);

    const parsed = refreshSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ message: "Invalid refresh payload", errors: parsed.error.flatten() });
    }

    const { refreshToken } = parsed.data;

    const tokenRecord = await prisma.refreshToken.findUnique({
      where: { token: refreshToken },
      include: { user: true },
    });

    if (!tokenRecord) {
      return reply.code(401).send({ message: "Invalid refresh token" });
    }

    if (tokenRecord.expiresAt <= new Date()) {
      await prisma.refreshToken.delete({ where: { token: refreshToken } });
      return reply.code(401).send({ message: "Refresh token expired" });
    }

    if (tokenRecord.user.isBanned) {
      await prisma.refreshToken.deleteMany({ where: { userId: tokenRecord.user.id } });
      return reply.code(403).send({ message: "Your account is banned" });
    }

    await prisma.refreshToken.delete({ where: { token: refreshToken } });

    await prisma.adminAction.create({
      data: {
        adminId: tokenRecord.user.id,
        actionType: "user_refresh",
        targetType: "user",
        targetId: tokenRecord.user.id,
        reason: extractClientIp(request),
      },
    });

    const tokens = await issueAuthTokens(reply, {
      id: tokenRecord.user.id,
      email: tokenRecord.user.email,
      role: tokenRecord.user.role,
    });

    return {
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
    };
  });

  app.post("/logout", async (request, reply) => {
    applyNoStore(reply);

    const parsed = refreshSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ message: "Invalid logout payload", errors: parsed.error.flatten() });
    }

    const { refreshToken } = parsed.data;
    const tokenRecord = await prisma.refreshToken.findUnique({
      where: { token: refreshToken },
      include: { user: true },
    });

    if (tokenRecord?.user) {
      await prisma.adminAction.create({
        data: {
          adminId: tokenRecord.user.id,
          actionType: "user_logout",
          targetType: "user",
          targetId: tokenRecord.user.id,
          reason: extractClientIp(request),
        },
      });
    }

    await prisma.refreshToken.deleteMany({ where: { token: refreshToken } });

    return { success: true };
  });

  app.post("/logout-all", { preHandler: [requireAuth] }, async (request, reply) => {
    applyNoStore(reply);

    await prisma.refreshToken.deleteMany({ where: { userId: request.user.id } });
    return { success: true };
  });

  app.get("/me", { preHandler: [requireAuth] }, async (request, reply) => {
    applyNoStore(reply);

    const user = await prisma.user.findUnique({
      where: { id: request.user.id },
      select: {
        id: true,
        email: true,
        username: true,
        role: true,
        accountBalance: true,
        createdAt: true,
      },
    });

    if (!user) {
      return reply.code(404).send({ message: "User not found" });
    }

    return user;
  });
};
