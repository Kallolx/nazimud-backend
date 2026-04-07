import { FastifyPluginAsync } from "fastify";

export const healthRoutes: FastifyPluginAsync = async (app) => {
  app.get("/health", async () => {
    return {
      ok: true,
      service: "backpageseek-backend",
      timestamp: new Date().toISOString(),
    };
  });
};
