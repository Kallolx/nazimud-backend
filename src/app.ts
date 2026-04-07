import Fastify from "fastify";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import jwt from "@fastify/jwt";
import multipart from "@fastify/multipart";
import { env } from "./config/env";
import { healthRoutes } from "./routes/health";
import { authRoutes } from "./routes/auth";
import { postRoutes } from "./routes/posts";
import { userRoutes } from "./routes/users";
import { adminRoutes } from "./routes/admin";
import { uploadRoutes } from "./routes/uploads";

function buildAllowedOrigins() {
  if (env.CLIENT_ORIGIN === "*") {
    return true;
  }

  const staticOrigins = env.CLIENT_ORIGIN.split(",")
    .map((item) => item.trim())
    .filter(Boolean);

  function normalizeOrigin(value: string): string {
    return String(value || "").trim().replace(/\/+$/, "").toLowerCase();
  }

  function isAllowedByPattern(origin: string, pattern: string): boolean {
    const normalizedOrigin = normalizeOrigin(origin);
    const normalizedPattern = normalizeOrigin(pattern);

    if (!normalizedPattern) {
      return false;
    }

    if (!normalizedPattern.includes("*")) {
      return normalizedOrigin === normalizedPattern;
    }

    // Supports patterns like https://*.vercel.app
    if (normalizedPattern.startsWith("http://*.") || normalizedPattern.startsWith("https://*.")) {
      const prefix = normalizedPattern.startsWith("https://*.") ? "https://" : "http://";
      const baseDomain = normalizedPattern.slice(prefix.length + 2);

      if (!normalizedOrigin.startsWith(prefix)) {
        return false;
      }

      const originHost = normalizedOrigin.slice(prefix.length);
      return originHost === baseDomain || originHost.endsWith(`.${baseDomain}`);
    }

    return false;
  }

  return (origin: string | undefined, cb: (err: Error | null, allow: boolean) => void) => {
    // Allow non-browser/server-to-server requests with no origin header.
    if (!origin) {
      cb(null, true);
      return;
    }

    if (staticOrigins.some((allowed) => isAllowedByPattern(origin, allowed))) {
      cb(null, true);
      return;
    }

    // Local development convenience for Live Server, Vite, etc.
    if (env.NODE_ENV !== "production") {
      const isLocalhost = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin);
      if (isLocalhost) {
        cb(null, true);
        return;
      }
    }

    cb(new Error("Origin not allowed by CORS"), false);
  };
}

export function buildApp() {
  const app = Fastify({ logger: true });

  app.register(cors, {
    origin: buildAllowedOrigins(),
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  });

  app.register(helmet);

  app.register(jwt, {
    secret: env.JWT_SECRET,
    sign: {
      expiresIn: env.JWT_EXPIRES_IN,
    },
  });

  app.register(multipart, {
    limits: {
      fileSize: 10 * 1024 * 1024,
      files: 8,
    },
  });

  app.register(healthRoutes, { prefix: "/api" });
  app.register(uploadRoutes, { prefix: "/api" });
  app.register(authRoutes, { prefix: "/api/auth" });
  app.register(postRoutes, { prefix: "/api/posts" });
  app.register(userRoutes, { prefix: "/api/users" });
  app.register(adminRoutes, { prefix: "/api/admin" });

  return app;
}
