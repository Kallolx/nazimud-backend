import { buildApp } from "./app";
import { env } from "./config/env";
import { prisma } from "./db/prisma";

async function start(): Promise<void> {
  const app = buildApp();

  try {
    await app.listen({
      host: "0.0.0.0",
      port: env.PORT,
    });

    app.log.info(`API is running on http://localhost:${env.PORT}`);
  } catch (error) {
    app.log.error(error);
    await prisma.$disconnect();
    process.exit(1);
  }

  const shutdown = async () => {
    await app.close();
    await prisma.$disconnect();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

void start();
