import { FastifyPluginAsync } from "fastify";
import { prisma } from "../db/prisma";
import { requireAuth } from "../utils/auth";

export const userRoutes: FastifyPluginAsync = async (app) => {
  app.get("/me/posts", { preHandler: [requireAuth] }, async (request) => {
    const posts = await prisma.post.findMany({
      where: { ownerId: request.user.id },
      orderBy: { postedAt: "desc" },
      include: { images: { orderBy: { displayOrder: "asc" } } },
    });

    return posts.map((post: any) => ({
      id: post.id,
      category: post.category,
      subcategory: post.subcategory,
      title: post.title,
      desc: post.description,
      age: post.age,
      state: post.state,
      city: post.city,
      status: post.status,
      postedAt: post.postedAt,
      imageUrls: post.images.map((image: any) => image.secureUrl),
      date: new Date(post.postedAt).toLocaleDateString("en-US", {
        month: "short",
        day: "2-digit",
        year: "numeric",
      }),
      images: post.images.length,
    }));
  });
};
