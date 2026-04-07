import "@fastify/jwt";

declare module "@fastify/jwt" {
  interface FastifyJWT {
    payload: {
      id: number;
      email: string;
      role: "USER" | "ADMIN";
    };
    user: {
      id: number;
      email: string;
      role: "USER" | "ADMIN";
    };
  }
}
