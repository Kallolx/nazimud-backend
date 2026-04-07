import { prisma } from "../db/prisma";
import { hardDeletePost } from "./post-delete";

export async function hardDeleteUserPosts(userId: number): Promise<void> {
  if (!Number.isFinite(userId) || userId <= 0) {
    return;
  }

  const posts = await prisma.post.findMany({
    where: { ownerId: userId },
    include: {
      images: {
        select: { cloudinaryPublicId: true },
      },
    },
  });

  for (const post of posts) {
    await hardDeletePost({
      id: post.id,
      images: post.images,
    });
  }
}

export async function hardDeleteUserAccount(userId: number): Promise<void> {
  await hardDeleteUserPosts(userId);
  await prisma.user.delete({ where: { id: userId } });
}
