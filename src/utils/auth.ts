import { FastifyReply, FastifyRequest } from "fastify";

export async function requireAuth(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  try {
    await request.jwtVerify();
  } catch {
    return reply.code(401).send({ message: "Unauthorized" });
  }
}

export async function requireAdmin(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  try {
    await request.jwtVerify();
    if (request.user.role !== "ADMIN") {
      return reply.code(403).send({ message: "Admin access required" });
    }
  } catch {
    return reply.code(401).send({ message: "Unauthorized" });
  }
}
