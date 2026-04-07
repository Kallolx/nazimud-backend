import { prisma } from "../db/prisma";
import { deleteImage } from "./cloudinary";

type PostImageRef = {
  cloudinaryPublicId: string;
};

type PostDeleteRef = {
  id: number;
  images: PostImageRef[];
};

export async function hardDeletePost(post: PostDeleteRef): Promise<void> {
  if (!post || !Number.isFinite(post.id)) {
    return;
  }

  // Delete stored assets first, then remove DB row and cascaded relations.
  await Promise.allSettled(
    (post.images || []).map((image) => deleteImage(String(image.cloudinaryPublicId || ""))),
  );

  await prisma.post.delete({ where: { id: post.id } });
}
