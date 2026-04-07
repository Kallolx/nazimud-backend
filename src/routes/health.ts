import { FastifyPluginAsync } from "fastify";

export const healthRoutes: FastifyPluginAsync = async (app) => {
  app.get("/health", async () => {
    return {
      ok: true,
      service: "XEscortSeek-backend",
      timestamp: new Date().toISOString(),
    };
  });
};
