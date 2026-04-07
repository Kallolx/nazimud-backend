import dotenv from "dotenv";

dotenv.config({ override: true });

function readEnv(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export const env = {
  NODE_ENV: process.env.NODE_ENV ?? "development",
  PORT: Number(process.env.PORT ?? 4000),
  CLIENT_ORIGIN: process.env.CLIENT_ORIGIN ?? "*",
  IMAGE_STORAGE: (process.env.IMAGE_STORAGE ?? "cloudinary").toLowerCase(),
  PUBLIC_BASE_URL: process.env.PUBLIC_BASE_URL ?? `http://localhost:${process.env.PORT ?? 4000}`,
  LOCAL_UPLOAD_DIR: process.env.LOCAL_UPLOAD_DIR ?? "uploads",
  DATABASE_URL: readEnv("DATABASE_URL"),
  JWT_SECRET: readEnv("JWT_SECRET"),
  JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN ?? "15m",
  REFRESH_TOKEN_DAYS: Number(process.env.REFRESH_TOKEN_DAYS ?? 30),
  TURNSTILE_SECRET_KEY: process.env.TURNSTILE_SECRET_KEY ?? "",
  TURNSTILE_VERIFY_URL: process.env.TURNSTILE_VERIFY_URL ?? "https://challenges.cloudflare.com/turnstile/v0/siteverify",
  ALLOWED_EMAIL_DOMAINS:
    process.env.ALLOWED_EMAIL_DOMAINS ??
    "gmail.com,yahoo.com,outlook.com,hotmail.com,icloud.com,proton.me,protonmail.com,live.com,aol.com,mail.com",
  CLOUDINARY_CLOUD_NAME: process.env.CLOUDINARY_CLOUD_NAME ?? "",
  CLOUDINARY_API_KEY: process.env.CLOUDINARY_API_KEY ?? "",
  CLOUDINARY_API_SECRET: process.env.CLOUDINARY_API_SECRET ?? "",
  CLOUDINARY_FOLDER: process.env.CLOUDINARY_FOLDER ?? "backpageseek/posts",
};
