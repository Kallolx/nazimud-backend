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

    const uploadDir = path.resolve(process.cwd(), env.LOCAL_UPLOAD_DIR);
    const filePath = path.join(uploadDir, safeName);

    if (!existsSync(filePath)) {
      return reply.code(404).send({ message: "File not found" });
    }

    reply
      .header("Cache-Control", "public, max-age=604800")
      .type(mimeTypeFor(safeName));

    return reply.send(createReadStream(filePath));
  });
};
