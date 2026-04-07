import { FastifyPluginAsync } from "fastify";
import { prisma } from "../db/prisma";
import { comparePassword, hashPassword } from "../utils/password";
import { z } from "zod";
import { requireAuth } from "../utils/auth";
import { env } from "../config/env";
import crypto from "crypto";

const registerSchema = z.object({
  email: z.string().email(),
  username: z.string().min(3).max(32).regex(/^[a-zA-Z0-9_]+$/),
  password: z.string().min(8),
  age: z.number().int().min(19),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
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

export const authRoutes: FastifyPluginAsync = async (app) => {
  app.post("/register", async (request, reply) => {
    const parsed = registerSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ message: "Invalid registration payload", errors: parsed.error.flatten() });
    }

    const { email, username, password, age } = parsed.data;

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
    const parsed = loginSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ message: "Invalid login payload", errors: parsed.error.flatten() });
    }

    const { email, password } = parsed.data;
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

  app.post("/logout-all", { preHandler: [requireAuth] }, async (request) => {
    await prisma.refreshToken.deleteMany({ where: { userId: request.user.id } });
    return { success: true };
  });

  app.get("/me", { preHandler: [requireAuth] }, async (request, reply) => {
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
