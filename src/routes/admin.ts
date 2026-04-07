import { FastifyPluginAsync } from "fastify";
import { prisma } from "../db/prisma";
import { requireAdmin } from "../utils/auth";
import { comparePassword, hashPassword } from "../utils/password";
import { hardDeletePost } from "../utils/post-delete";

const POST_STATUS_PENDING = "PENDING";
const POST_STATUS_ACTIVE = "ACTIVE";
const POST_STATUS_REJECTED = "REJECTED";
const POST_STATUS_DELETED = "DELETED";
const USER_ACTIVITY_LOG_LIMIT = 8;

async function verifyAdminPassword(adminId: number, adminPassword: string): Promise<boolean> {
  if (!adminPassword) return false;

  const admin = await prisma.user.findUnique({ where: { id: adminId } });
  if (!admin) return false;

  return comparePassword(adminPassword, admin.passwordHash);
}

export const adminRoutes: FastifyPluginAsync = async (app) => {
  app.patch("/me", { preHandler: [requireAdmin] }, async (request, reply) => {
    const body = (request.body ?? {}) as {
      username?: string;
      email?: string;
      currentPassword?: string;
      newPassword?: string;
    };

    const username = String(body.username ?? "").trim();
    const email = String(body.email ?? "").trim().toLowerCase();
    const currentPassword = String(body.currentPassword ?? "");
    const newPassword = String(body.newPassword ?? "");

    if (!username) {
      return reply.code(400).send({ message: "Username is required" });
    }

    if (!/^[a-zA-Z0-9_]{3,32}$/.test(username)) {
      return reply.code(400).send({ message: "Username must be 3-32 chars and use letters, numbers, or underscore" });
    }

    if (!email || !/^\S+@\S+\.\S+$/.test(email)) {
      return reply.code(400).send({ message: "Valid email is required" });
    }

    if (newPassword && newPassword.length < 8) {
      return reply.code(400).send({ message: "New password must be at least 8 characters" });
    }

    const admin = await prisma.user.findUnique({ where: { id: request.user.id } });
    if (!admin) {
      return reply.code(404).send({ message: "Admin account not found" });
    }

    if (newPassword) {
      const ok = await comparePassword(currentPassword, admin.passwordHash);
      if (!ok) {
        return reply.code(403).send({ message: "Current password is incorrect" });
      }
    }

    const emailTaken = await prisma.user.findFirst({
      where: {
        email,
        id: { not: admin.id },
      },
      select: { id: true },
    });

    if (emailTaken) {
      return reply.code(409).send({ message: "Email already in use" });
    }

    const usernameTaken = await prisma.user.findFirst({
      where: {
        username,
        id: { not: admin.id },
      },
      select: { id: true },
    });

    if (usernameTaken) {
      return reply.code(409).send({ message: "Username already in use" });
    }

    const data: any = {
      username,
      email,
    };

    if (newPassword) {
      data.passwordHash = await hashPassword(newPassword);
    }

    const updated = await prisma.user.update({
      where: { id: admin.id },
      data,
      select: {
        id: true,
        email: true,
        username: true,
        role: true,
      },
    });

    await prisma.adminAction.create({
      data: {
        adminId: admin.id,
        actionType: "update_admin_profile",
        targetType: "user",
        targetId: admin.id,
      },
    });

    return { success: true, user: updated };
  });

  app.get("/users", { preHandler: [requireAdmin] }, async (request) => {
    const query = request.query as { page?: string; limit?: string; keyword?: string };
    const page = Math.max(Number(query.page ?? 1), 1);
    const limit = Math.min(Math.max(Number(query.limit ?? 50), 1), 100);
    const keyword = String(query.keyword ?? "").trim();

    const where: any = keyword
      ? {
          OR: [
            { email: { contains: keyword, mode: "insensitive" } },
            { username: { contains: keyword, mode: "insensitive" } },
          ],
        }
      : {};

    const [items, total] = await Promise.all([
      prisma.user.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
        select: {
          id: true,
          email: true,
          username: true,
          role: true,
          isBanned: true,
          createdAt: true,
        },
      }),
      prisma.user.count({ where }),
    ]);

    const itemsWithIp = await Promise.all(
      items.map(async (user) => {
        const lastAuthAction = await prisma.adminAction.findFirst({
          where: {
            targetType: "user",
            targetId: user.id,
            actionType: { in: ["user_login", "user_register"] },
          },
          orderBy: { createdAt: "desc" },
          select: { reason: true },
        });

        return {
          ...user,
          lastActivityIp: lastAuthAction?.reason ?? null,
        };
      }),
    );

    return {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
      items: itemsWithIp,
    };
  });

  app.get("/users/:id", { preHandler: [requireAdmin] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const userId = Number(id);

    if (!Number.isFinite(userId) || userId <= 0) {
      return reply.code(400).send({ message: "Invalid user id" });
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        username: true,
        role: true,
        isBanned: true,
        createdAt: true,
      },
    });

    if (!user) {
      return reply.code(404).send({ message: "User not found" });
    }

    const [authActions, moderationActions, posts] = await Promise.all([
      prisma.adminAction.findMany({
        where: {
          targetType: "user",
          targetId: userId,
          actionType: { in: ["user_login", "user_register", "user_refresh", "user_logout"] },
        },
        orderBy: { createdAt: "desc" },
        take: 25,
        select: { actionType: true, reason: true, createdAt: true },
      }),
      prisma.adminAction.findMany({
        where: {
          targetType: "user",
          targetId: userId,
          actionType: { in: ["set_user_role", "set_admin_role", "ban_user", "unban_user"] },
        },
        orderBy: { createdAt: "desc" },
        take: 25,
        select: { actionType: true, createdAt: true },
      }),
      prisma.post.findMany({
        where: {
          ownerId: userId,
          status: { not: POST_STATUS_DELETED },
        },
        include: { images: true },
        orderBy: { postedAt: "desc" },
        take: 100,
      }),
    ]);

    const events = [
      ...authActions.map((item) => ({
        actionType: item.actionType,
        ipAddress: item.reason || null,
        createdAt: item.createdAt,
      })),
      ...moderationActions.map((item) => ({
        actionType: item.actionType,
        ipAddress: null,
        createdAt: item.createdAt,
      })),
    ]
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, USER_ACTIVITY_LOG_LIMIT);

    const lastIp = authActions.find((item) => item.reason)?.reason ?? null;
    const lastLoginAt =
      authActions.find((item) => item.actionType === "user_login" || item.actionType === "user_refresh")?.createdAt ??
      null;

    return {
      user: {
        ...user,
        lastActivityIp: lastIp,
        lastLoginAt,
      },
      events,
      posts: posts.map((post: any) => ({
        id: post.id,
        title: post.title,
        category: post.category,
        subcategory: post.subcategory,
        state: post.state,
        city: post.city,
        status: post.status,
        postedAt: post.postedAt,
        desc: post.description,
        images: post.images.length,
        imageUrl: post.images[0]?.secureUrl || null,
      })),
    };
  });

  app.post("/users/:id/role", { preHandler: [requireAdmin] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = (request.body ?? {}) as { role?: "USER" | "ADMIN"; adminPassword?: string };

    const role = body.role;
    if (role !== "USER" && role !== "ADMIN") {
      return reply.code(400).send({ message: "Role must be USER or ADMIN" });
    }

    const ok = await verifyAdminPassword(request.user.id, String(body.adminPassword ?? ""));
    if (!ok) {
      return reply.code(403).send({ message: "Admin password is incorrect" });
    }

    const updated = await prisma.user.update({
      where: { id: Number(id) },
      data: { role },
      select: { id: true, email: true, username: true, role: true, isBanned: true, createdAt: true },
    });

    await prisma.adminAction.create({
      data: {
        adminId: request.user.id,
        actionType: role === "ADMIN" ? "set_admin_role" : "set_user_role",
        targetType: "user",
        targetId: updated.id,
      },
    });

    return { success: true, user: updated };
  });

  app.post("/users/:id/ban", { preHandler: [requireAdmin] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = (request.body ?? {}) as { isBanned?: boolean; adminPassword?: string };

    const ok = await verifyAdminPassword(request.user.id, String(body.adminPassword ?? ""));
    if (!ok) {
      return reply.code(403).send({ message: "Admin password is incorrect" });
    }

    const updated = await prisma.user.update({
      where: { id: Number(id) },
      data: { isBanned: Boolean(body.isBanned) },
      select: { id: true, email: true, username: true, role: true, isBanned: true, createdAt: true },
    });

    await prisma.adminAction.create({
      data: {
        adminId: request.user.id,
        actionType: updated.isBanned ? "ban_user" : "unban_user",
        targetType: "user",
        targetId: updated.id,
      },
    });

    if (!updated.isBanned) {
      const pendingDelete = await prisma.adminAction.findFirst({
        where: {
          actionType: "account_delete_requested",
          targetType: "user",
          targetId: updated.id,
        },
        orderBy: { createdAt: "desc" },
        select: { id: true },
      });

      if (pendingDelete) {
        await prisma.adminAction.create({
          data: {
            adminId: request.user.id,
            actionType: "account_delete_restored",
            targetType: "user",
            targetId: updated.id,
          },
        });
      }
    }

    return { success: true, user: updated };
  });

  app.get("/posts", { preHandler: [requireAdmin] }, async (request) => {
    const query = request.query as {
      page?: string;
      limit?: string;
      category?: string;
      status?: string;
      keyword?: string;
      postedOn?: string;
    };

    const page = Math.max(Number(query.page ?? 1), 1);
    const limit = Math.min(Math.max(Number(query.limit ?? 50), 1), 100);

    const where: any = {};
    const andFilters: any[] = [];

    if (query.category) {
      andFilters.push({
        OR: [{ category: query.category }, { subcategory: query.category }],
      });
    }

    const requestedStatus = String(query.status ?? "").toUpperCase();
    if (requestedStatus && requestedStatus !== "ALL") {
      andFilters.push({ status: requestedStatus });
    } else {
      andFilters.push({ status: { not: POST_STATUS_DELETED } });
    }

    if (query.postedOn) {
      const input = String(query.postedOn);
      const isValidDate = /^\d{4}-\d{2}-\d{2}$/.test(input);
      if (isValidDate) {
        const start = new Date(`${input}T00:00:00.000Z`);
        const end = new Date(start);
        end.setUTCDate(end.getUTCDate() + 1);

        andFilters.push({
          postedAt: {
            gte: start,
            lt: end,
          },
        });
      }
    }

    if (query.keyword) {
      const keyword = String(query.keyword).trim();
      const numericId = Number(keyword);
      const keywordOr: any[] = [
        { title: { contains: keyword, mode: "insensitive" } },
        { description: { contains: keyword, mode: "insensitive" } },
      ];

      if (Number.isInteger(numericId) && numericId > 0) {
        keywordOr.push({ id: numericId });
      }

      andFilters.push({ OR: keywordOr });
    }

    if (andFilters.length) {
      where.AND = andFilters;
    }

    const [items, total] = await Promise.all([
      prisma.post.findMany({
        where,
        orderBy: { postedAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
        include: { images: true, owner: true },
      }),
      prisma.post.count({ where }),
    ]);

    return {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
      items: items.map((post: any) => ({
        id: post.id,
        title: post.title,
        category: post.category,
        subcategory: post.subcategory,
        state: post.state,
        city: post.city,
        status: post.status,
        username: post.owner.username,
        postedAt: post.postedAt,
        desc: post.description,
        images: post.images.length,
        imageUrl: post.images[0]?.secureUrl || null,
      })),
    };
  });

  app.get("/posts/pending", { preHandler: [requireAdmin] }, async (request) => {
    const query = request.query as { page?: string; limit?: string };
    const page = Math.max(Number(query.page ?? 1), 1);
    const limit = Math.min(Math.max(Number(query.limit ?? 50), 1), 100);

    const [items, total] = await Promise.all([
      prisma.post.findMany({
        where: { status: POST_STATUS_PENDING },
        orderBy: { postedAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
        include: { images: true, owner: true },
      }),
      prisma.post.count({ where: { status: POST_STATUS_PENDING } }),
    ]);

    return {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
      items: items.map((post: any) => ({
        id: post.id,
        title: post.title,
        category: post.category,
        subcategory: post.subcategory,
        state: post.state,
        city: post.city,
        username: post.owner.username,
        status: post.status,
        desc: post.description,
        postedAt: post.postedAt,
        images: post.images.length,
        imageUrl: post.images[0]?.secureUrl || null,
      })),
    };
  });

  app.post("/posts/:id/approve", { preHandler: [requireAdmin] }, async (request) => {
    const { id } = request.params as { id: string };

    const post = await prisma.post.update({
      where: { id: Number(id) },
      data: { status: POST_STATUS_ACTIVE },
    });

    await prisma.adminAction.create({
      data: {
        adminId: request.user.id,
        actionType: "approve_post",
        targetType: "post",
        targetId: post.id,
      },
    });

    return { success: true };
  });

  app.post("/posts/:id/reject", { preHandler: [requireAdmin] }, async (request) => {
    const { id } = request.params as { id: string };

    const post = await prisma.post.update({
      where: { id: Number(id) },
      data: { status: POST_STATUS_REJECTED },
    });

    await prisma.adminAction.create({
      data: {
        adminId: request.user.id,
        actionType: "reject_post",
        targetType: "post",
        targetId: post.id,
      },
    });

    return { success: true };
  });

  app.patch("/posts/:id/status", { preHandler: [requireAdmin] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = (request.body ?? {}) as { status?: string };
    const status = String(body.status ?? "").toUpperCase();

    if (![POST_STATUS_PENDING, POST_STATUS_ACTIVE, POST_STATUS_REJECTED].includes(status)) {
      return reply.code(400).send({ message: "Invalid status value" });
    }

    const post = await prisma.post.update({
      where: { id: Number(id) },
      data: { status: status as any },
    });

    await prisma.adminAction.create({
      data: {
        adminId: request.user.id,
        actionType: `set_status_${status.toLowerCase()}`,
        targetType: "post",
        targetId: post.id,
      },
    });

    return { success: true, status };
  });

  app.delete("/posts/:id", { preHandler: [requireAdmin] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const postId = Number(id);

    const existing = await prisma.post.findUnique({
      where: { id: postId },
      include: { images: true },
    });

    if (!existing) {
      return reply.code(404).send({ message: "Post not found" });
    }

    await hardDeletePost({
      id: existing.id,
      images: existing.images.map((image: any) => ({
        cloudinaryPublicId: image.cloudinaryPublicId,
      })),
    });

    await prisma.adminAction.create({
      data: {
        adminId: request.user.id,
        actionType: "delete_post",
        targetType: "post",
        targetId: postId,
      },
    });

    return { success: true };
  });

  app.get("/reports", { preHandler: [requireAdmin] }, async (request) => {
    const query = request.query as {
      page?: string;
      limit?: string;
      status?: string;
      keyword?: string;
    };

    const page = Math.max(Number(query.page ?? 1), 1);
    const limit = Math.min(Math.max(Number(query.limit ?? 20), 1), 100);
    const status = String(query.status ?? "OPEN").toUpperCase();
    const keyword = String(query.keyword ?? "").trim();

    const where: any = {};
    if (status !== "ALL") {
      where.status = status;
    }

    if (keyword) {
      where.OR = [
        { reason: { contains: keyword, mode: "insensitive" } },
        { details: { contains: keyword, mode: "insensitive" } },
        { post: { title: { contains: keyword, mode: "insensitive" } } },
      ];
    }

    const reports = await prisma.postReport.findMany({
      where,
      include: {
        post: {
          select: {
            id: true,
            title: true,
            status: true,
            category: true,
            subcategory: true,
            state: true,
            city: true,
            owner: { select: { id: true, username: true, email: true } },
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    const grouped = new Map<number, any>();

    for (const report of reports) {
      if (!report.post) continue;
      const key = report.postId;
      if (!grouped.has(key)) {
        grouped.set(key, {
          postId: report.post.id,
          title: report.post.title,
          postStatus: report.post.status,
          category: report.post.subcategory || report.post.category,
          state: report.post.state,
          city: report.post.city,
          ownerUsername: report.post.owner.username,
          ownerEmail: report.post.owner.email,
          totalReports: 0,
          openReports: 0,
          resolvedReports: 0,
          latestReportAt: report.createdAt,
          reasons: {},
        });
      }

      const item = grouped.get(key);
      item.totalReports += 1;
      if (report.status === "OPEN") item.openReports += 1;
      if (report.status === "RESOLVED") item.resolvedReports += 1;
      if (report.createdAt > item.latestReportAt) item.latestReportAt = report.createdAt;

      const reason = String(report.reason || "Other").trim() || "Other";
      item.reasons[reason] = (item.reasons[reason] || 0) + 1;
    }

    const items = Array.from(grouped.values())
      .sort((a, b) => new Date(b.latestReportAt).getTime() - new Date(a.latestReportAt).getTime());

    const total = items.length;
    const start = (page - 1) * limit;
    const pagedItems = items.slice(start, start + limit).map((item) => ({
      ...item,
      reasons: Object.entries(item.reasons)
        .sort((a: any, b: any) => b[1] - a[1])
        .map(([reason, count]) => ({ reason, count })),
    }));

    return {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
      items: pagedItems,
    };
  });

  app.get("/reports/:postId", { preHandler: [requireAdmin] }, async (request, reply) => {
    const { postId } = request.params as { postId: string };
    const id = Number(postId);

    if (!Number.isFinite(id) || id <= 0) {
      return reply.code(400).send({ message: "Invalid post id" });
    }

    const post = await prisma.post.findUnique({
      where: { id },
      select: {
        id: true,
        title: true,
        status: true,
        category: true,
        subcategory: true,
        state: true,
        city: true,
        postedAt: true,
        owner: {
          select: {
            id: true,
            username: true,
            email: true,
          },
        },
      },
    });

    if (!post) {
      return reply.code(404).send({ message: "Post not found" });
    }

    const reports = await prisma.postReport.findMany({
      where: { postId: id },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        reason: true,
        details: true,
        reporterEmail: true,
        reporterIp: true,
        status: true,
        createdAt: true,
      },
    });

    const totals = {
      totalReports: reports.length,
      openReports: reports.filter((report) => report.status === "OPEN").length,
      resolvedReports: reports.filter((report) => report.status === "RESOLVED").length,
    };

    const reasonsMap = reports.reduce((acc, report) => {
      const reason = String(report.reason || "Other").trim() || "Other";
      acc[reason] = (acc[reason] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    const topReasons = Object.entries(reasonsMap)
      .sort((a, b) => b[1] - a[1])
      .map(([reason, count]) => ({ reason, count }));

    return {
      post: {
        id: post.id,
        title: post.title,
        status: post.status,
        category: post.subcategory || post.category,
        state: post.state,
        city: post.city,
        postedAt: post.postedAt,
        ownerUsername: post.owner.username,
        ownerEmail: post.owner.email,
      },
      totals,
      topReasons,
      reports,
    };
  });

  app.post("/reports/:postId/resolve", { preHandler: [requireAdmin] }, async (request, reply) => {
    const { postId } = request.params as { postId: string };
    const id = Number(postId);

    if (!Number.isFinite(id) || id <= 0) {
      return reply.code(400).send({ message: "Invalid post id" });
    }

    const result = await prisma.postReport.updateMany({
      where: {
        postId: id,
        status: "OPEN",
      },
      data: {
        status: "RESOLVED",
        resolvedAt: new Date(),
        resolvedById: request.user.id,
      },
    });

    await prisma.adminAction.create({
      data: {
        adminId: request.user.id,
        actionType: "resolve_post_reports",
        targetType: "post",
        targetId: id,
      },
    });

    return { success: true, updated: result.count };
  });
};
