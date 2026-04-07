import { createReadStream, existsSync } from "fs";
import path from "path";
import { FastifyPluginAsync } from "fastify";
import { env } from "../config/env";

const MIME_BY_EXT: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
};

function mimeTypeFor(fileName: string): string {
  const ext = path.extname(fileName).toLowerCase();
  return MIME_BY_EXT[ext] || "application/octet-stream";
}

function resolveLocalUploadCandidatePaths(fileName: string): string[] {
  const configured = String(env.LOCAL_UPLOAD_DIR || "uploads");
  const safeName = path.basename(fileName);

  if (path.isAbsolute(configured)) {
    return [path.join(configured, safeName)];
  }

  const projectRootDir = path.resolve(__dirname, "..", "..");
  const primary = path.join(path.resolve(projectRootDir, configured), safeName);
  const fallback = path.join(path.resolve(process.cwd(), configured), safeName);
  return Array.from(new Set([primary, fallback]));
}

export const uploadRoutes: FastifyPluginAsync = async (app) => {
  app.get("/uploads/:name", async (request, reply) => {
    if (env.IMAGE_STORAGE !== "local") {
      return reply.code(404).send({ message: "Upload route is disabled" });
    }

    const { name } = request.params as { name: string };
    const safeName = path.basename(String(name || ""));
    if (!safeName) {
      return reply.code(400).send({ message: "Invalid file name" });
    }

    const filePath = resolveLocalUploadCandidatePaths(safeName).find((item) => existsSync(item));

    if (!filePath) {
      return reply.code(404).send({ message: "File not found" });
    }

    reply
      .header("Cache-Control", "public, max-age=604800")
      .type(mimeTypeFor(safeName));

    return reply.send(createReadStream(filePath));
  });
};
