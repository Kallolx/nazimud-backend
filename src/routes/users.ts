import { FastifyPluginAsync } from "fastify";
import { prisma } from "../db/prisma";
import { requireAuth } from "../utils/auth";
import { comparePassword } from "../utils/password";
import { hardDeleteUserPosts } from "../utils/user-delete";

const ACCOUNT_DELETION_HOLD_DAYS = 7;

export const userRoutes: FastifyPluginAsync = async (app) => {
  app.delete("/me", { preHandler: [requireAuth] }, async (request, reply) => {
    const body = (request.body ?? {}) as { password?: string };
    const password = String(body.password ?? "").trim();

    if (!password) {
      return reply.code(400).send({ message: "Password is required" });
    }

    const user = await prisma.user.findUnique({
      where: { id: request.user.id },
      select: {
        id: true,
        isBanned: true,
        passwordHash: true,
      },
    });

    if (!user) {
      return reply.code(404).send({ message: "User not found" });
    }

    const valid = await comparePassword(password, user.passwordHash);
    if (!valid) {
      return reply.code(401).send({ message: "Invalid password" });
    }

    const deleteAfter = new Date(Date.now() + ACCOUNT_DELETION_HOLD_DAYS * 24 * 60 * 60 * 1000);

    await hardDeleteUserPosts(user.id);

    // Lock account and remove sessions during hold period.
    await prisma.refreshToken.deleteMany({ where: { userId: user.id } });

    await prisma.user.update({
      where: { id: user.id },
      data: {
        isBanned: true,
      },
    });

    await prisma.adminAction.create({
      data: {
        adminId: user.id,
        actionType: "account_delete_requested",
        targetType: "user",
        targetId: user.id,
        reason: `delete_after:${deleteAfter.toISOString()}`,
      },
    });

    return {
      success: true,
      scheduledDeletionAt: deleteAfter.toISOString(),
      holdDays: ACCOUNT_DELETION_HOLD_DAYS,
      alreadyLocked: user.isBanned,
    };
  });

  app.get("/me/posts", { preHandler: [requireAuth] }, async (request) => {
    const posts = await prisma.post.findMany({
      where: {
        ownerId: request.user.id,
        status: { not: "DELETED" },
      },
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
