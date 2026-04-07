import { prisma } from "../db/prisma";
import { hardDeletePost } from "../utils/post-delete";
import { hardDeleteUserAccount } from "../utils/user-delete";

const HOLD_DAYS = 7;
const POST_STATUS_DELETED = "DELETED";

function parseDeleteAfter(reason?: string | null, createdAt?: Date): Date {
  const match = String(reason || "").match(/^delete_after:(.+)$/i);
  if (match?.[1]) {
    const parsed = new Date(match[1]);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed;
    }
  }

  const fallback = new Date(createdAt || Date.now());
  fallback.setDate(fallback.getDate() + HOLD_DAYS);
  return fallback;
}

async function run(): Promise<void> {
  const now = new Date();

  const postRequests = await prisma.adminAction.findMany({
    where: {
      actionType: "post_delete_requested",
      targetType: "post",
    },
    orderBy: { createdAt: "desc" },
  });

  const latestPostRequestById = new Map<number, (typeof postRequests)[number]>();
  for (const item of postRequests) {
    if (!latestPostRequestById.has(item.targetId)) {
      latestPostRequestById.set(item.targetId, item);
    }
  }

  for (const requestAction of latestPostRequestById.values()) {
    const deleteAfter = parseDeleteAfter(requestAction.reason, requestAction.createdAt);
    if (deleteAfter > now) {
      continue;
    }

    const post = await prisma.post.findUnique({
      where: { id: requestAction.targetId },
      include: {
        images: {
          select: { cloudinaryPublicId: true },
        },
      },
    });

    // Admin changed status during hold period, so skip permanent deletion.
    if (!post || post.status !== POST_STATUS_DELETED) {
      continue;
    }

    await hardDeletePost({
      id: post.id,
      images: post.images,
    });
  }

  const requests = await prisma.adminAction.findMany({
    where: {
      actionType: "account_delete_requested",
      targetType: "user",
    },
    orderBy: { createdAt: "desc" },
  });

  const latestByUser = new Map<number, (typeof requests)[number]>();
  for (const item of requests) {
    if (!latestByUser.has(item.targetId)) {
      latestByUser.set(item.targetId, item);
    }
  }

  for (const requestAction of latestByUser.values()) {
    const deleteAfter = parseDeleteAfter(requestAction.reason, requestAction.createdAt);
    if (deleteAfter > now) {
      continue;
    }

    const restored = await prisma.adminAction.findFirst({
      where: {
        actionType: "account_delete_restored",
        targetType: "user",
        targetId: requestAction.targetId,
        createdAt: { gt: requestAction.createdAt },
      },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });

    if (restored) {
      continue;
    }

    const user = await prisma.user.findUnique({
      where: { id: requestAction.targetId },
      select: { id: true, isBanned: true },
    });

    // Only purge if account still exists and remains locked.
    if (!user || !user.isBanned) {
      continue;
    }

    await hardDeleteUserAccount(user.id);
  }
}

run()
  .catch((error) => {
    console.error("process-deletion-holds failed", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
