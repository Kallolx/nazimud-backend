import { FastifyPluginAsync } from "fastify";
import { prisma } from "../db/prisma";
import { requireAuth } from "../utils/auth";
import { deleteImage, uploadImageBuffer } from "../utils/cloudinary";

const AD_TYPE_FREE = "FREE";
const AD_TYPE_PREMIUM = "PREMIUM";
const POST_STATUS_PENDING = "PENDING";
const POST_STATUS_ACTIVE = "ACTIVE";
const POST_STATUS_DELETED = "DELETED";

type MultipartExtracted = {
  fields: Record<string, string>;
  uploadedImages: Awaited<ReturnType<typeof uploadImageBuffer>>[];
};

function parseJsonOrNull(value?: string): any {
  if (!value) return undefined;
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

function extractClientIp(request: any): string {
  const forwarded = request.headers?.["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.trim()) {
    return forwarded.split(",")[0].trim();
  }
  return String(request.ip || "").trim();
}

async function getOptionalReporterUserId(request: any): Promise<number | null> {
  const authHeader = String(request.headers?.authorization || "");
  if (!authHeader.toLowerCase().startsWith("bearer ")) {
    return null;
  }

  try {
    const payload = await request.jwtVerify();
    const id = Number((payload as any)?.id);
    if (!Number.isFinite(id) || id <= 0) return null;
    return id;
  } catch {
    return null;
  }
}

function mapPost(post: any) {
  const casualDetails = post.casualDetails ?? null;

  return {
    id: post.id,
    category: post.category,
    subcategory: post.subcategory,
    title: post.title,
    desc: post.description,
    description: post.description,
    topText: post.topText,
    age: post.age,
    state: post.state,
    city: post.city,
    country: post.country,
    location: post.locationText,
    phone: post.phoneNumber,
    phoneNumber: post.phoneNumber,
    contactEmail: post.contactEmail,
    status: post.status,
    adType: post.adType,
    date: new Date(post.postedAt).toLocaleDateString("en-US", {
      month: "short",
      day: "2-digit",
      year: "numeric",
    }),
    images: post.images?.length ?? 0,
    imageUrls: post.images?.map((img: any) => img.secureUrl) ?? [],
    imageItems:
      post.images?.map((img: any) => ({
        id: img.id,
        secureUrl: img.secureUrl,
        url: img.url,
      })) ?? [],
    casualDetails,
    orientation: casualDetails?.orientation ?? null,
    lookingFor: casualDetails?.looking_for ?? casualDetails?.lookingFor ?? null,
    rentalDetails: post.rentalDetails,
    petDetails: post.petDetails,
    serviceDetails: post.serviceDetails,
    postedAt: post.postedAt,
  };
}

async function extractMultipart(request: any): Promise<MultipartExtracted> {
  const fields: Record<string, string> = {};
  const uploadedImages: Awaited<ReturnType<typeof uploadImageBuffer>>[] = [];

  for await (const part of request.parts()) {
    if (part.type === "file") {
      if (!part.mimetype?.startsWith("image/")) {
        continue;
      }
      const buffer = await part.toBuffer();
      if (buffer.length === 0) {
        continue;
      }
      const uploaded = await uploadImageBuffer(buffer, part.filename ?? `post-${Date.now()}`);
      uploadedImages.push(uploaded);
      continue;
    }

    const rawValue = String(part.value ?? "");
    fields[part.fieldname] = part.fieldname === "description" ? rawValue : rawValue.trim();
  }

  return { fields, uploadedImages };
}

export const postRoutes: FastifyPluginAsync = async (app) => {
  app.get("/", async (request) => {
    const query = request.query as {
      category?: string;
      state?: string;
      city?: string;
      status?: string;
      keyword?: string;
      page?: string;
      limit?: string;
    };

    const page = Math.max(Number(query.page ?? 1), 1);
    const limit = Math.min(Math.max(Number(query.limit ?? 50), 1), 100);

    const where: any = {};

    const normalizedStatus = (query.status || "").toUpperCase();
    if (normalizedStatus && normalizedStatus !== "ALL") {
      where.status = normalizedStatus;
    }

    if (!normalizedStatus) {
      where.status = POST_STATUS_ACTIVE;
    }

    if (query.category) where.category = query.category;
    if (query.state) where.state = query.state;
    if (query.city) where.city = query.city;

    if (query.keyword) {
      where.OR = [
        { title: { contains: query.keyword, mode: "insensitive" } },
        { description: { contains: query.keyword, mode: "insensitive" } },
      ];
    }

    const [items, total] = await Promise.all([
      prisma.post.findMany({
        where,
        orderBy: { postedAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
        include: { images: { orderBy: { displayOrder: "asc" } } },
      }),
      prisma.post.count({ where }),
    ]);

    return {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
      items: items.map(mapPost),
    };
  });

  app.get("/:id", async (request, reply) => {
    const { id } = request.params as { id: string };

    const post = await prisma.post.findUnique({
      where: { id: Number(id) },
      include: {
        images: { orderBy: { displayOrder: "asc" } },
      },
    });

    if (!post || post.status === POST_STATUS_DELETED) {
      return reply.code(404).send({ message: "Post not found" });
    }

    return mapPost(post);
  });

  app.post("/:id/reports", async (request, reply) => {
    const { id } = request.params as { id: string };
    const postId = Number(id);
    const body = (request.body ?? {}) as { reason?: string; details?: string; email?: string };

    if (!Number.isFinite(postId) || postId <= 0) {
      return reply.code(400).send({ message: "Invalid post id" });
    }

    const reason = String(body.reason ?? "").trim();
    if (!reason) {
      return reply.code(400).send({ message: "Reason is required" });
    }

    const post = await prisma.post.findUnique({
      where: { id: postId },
      select: { id: true, status: true },
    });

    if (!post || post.status === POST_STATUS_DELETED) {
      return reply.code(404).send({ message: "Post not found" });
    }

    const reporterUserId = await getOptionalReporterUserId(request);

    await prisma.postReport.create({
      data: {
        postId,
        reporterUserId,
        reporterEmail: String(body.email ?? "").trim() || null,
        reporterIp: extractClientIp(request) || null,
        reason,
        details: String(body.details ?? "").trim() || null,
      },
    });

    return reply.code(201).send({ success: true });
  });

  app.post("/", { preHandler: [requireAuth] }, async (request, reply) => {
    const isMultipart = request.isMultipart();

    let fields: Record<string, string> = {};
    let uploadedImages: Awaited<ReturnType<typeof uploadImageBuffer>>[] = [];

    if (isMultipart) {
      const parsed = await extractMultipart(request);
      fields = parsed.fields;
      uploadedImages = parsed.uploadedImages;
    } else {
      fields = (request.body as Record<string, string>) ?? {};
    }

    const requiredFields = ["category", "subcategory", "title", "description", "state", "city"];
    const missing = requiredFields.filter((field) => !fields[field]);
    if (missing.length > 0) {
      return reply.code(400).send({ message: `Missing required fields: ${missing.join(", ")}` });
    }

    const post = await prisma.post.create({
      data: {
        ownerId: request.user.id,
        category: fields.category,
        subcategory: fields.subcategory,
        title: fields.title,
        description: fields.description,
        topText: fields.topText || null,
        age: fields.age ? Number(fields.age) : null,
        locationText: fields.location || null,
        phoneNumber: fields.phone || fields.phoneNumber || null,
        contactEmail: fields.contactEmail || request.user.email,
        country: fields.country || "usa",
        state: fields.state,
        city: fields.city,
        adType: fields.adType?.toUpperCase() === AD_TYPE_PREMIUM || fields.adType?.toLowerCase() === "premium" ? AD_TYPE_PREMIUM : AD_TYPE_FREE,
        status: POST_STATUS_PENDING,
        isSponsored: fields.adType?.toLowerCase() === "premium",
        casualDetails: parseJsonOrNull(fields.casualDetails),
        rentalDetails: parseJsonOrNull(fields.rentalDetails),
        petDetails: parseJsonOrNull(fields.petDetails),
        serviceDetails: parseJsonOrNull(fields.serviceDetails),
        images: {
          create: uploadedImages.map((image, index) => ({
            ...image,
            displayOrder: index,
          })),
        },
      },
      include: {
        images: { orderBy: { displayOrder: "asc" } },
      },
    });

    return reply.code(201).send(mapPost(post));
  });

  app.put("/:id", { preHandler: [requireAuth] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const postId = Number(id);

    const existing = await prisma.post.findUnique({
      where: { id: postId },
      include: { images: true },
    });

    if (!existing || existing.status === POST_STATUS_DELETED) {
      return reply.code(404).send({ message: "Post not found" });
    }

    if (existing.ownerId !== request.user.id && request.user.role !== "ADMIN") {
      return reply.code(403).send({ message: "You are not allowed to edit this post" });
    }

    let fields: Record<string, string> = {};
    let uploadedImages: Awaited<ReturnType<typeof uploadImageBuffer>>[] = [];

    if (request.isMultipart()) {
      const parsed = await extractMultipart(request);
      fields = parsed.fields;
      uploadedImages = parsed.uploadedImages;
    } else {
      fields = (request.body as Record<string, string>) ?? {};
    }

    const removeImageIds = fields.removeImageIds
      ? (JSON.parse(fields.removeImageIds) as number[])
      : [];

    if (removeImageIds.length > 0) {
      const imagesToRemove = existing.images.filter((img: any) => removeImageIds.includes(img.id));
      await Promise.all(imagesToRemove.map((img: any) => deleteImage(img.cloudinaryPublicId)));

      await prisma.postImage.deleteMany({
        where: {
          id: { in: removeImageIds },
          postId,
        },
      });
    }

    const updateData: any = {
      category: fields.category ?? existing.category,
      subcategory: fields.subcategory ?? existing.subcategory,
      title: fields.title ?? existing.title,
      description: fields.description ?? existing.description,
      topText: fields.topText ?? existing.topText,
      age: fields.age ? Number(fields.age) : existing.age,
      locationText: fields.location ?? existing.locationText,
      phoneNumber: fields.phone ?? fields.phoneNumber ?? existing.phoneNumber,
      contactEmail: fields.contactEmail ?? existing.contactEmail,
      country: fields.country ?? existing.country,
      state: fields.state ?? existing.state,
      city: fields.city ?? existing.city,
      adType:
        fields.adType?.toLowerCase() === "premium"
          ? AD_TYPE_PREMIUM
          : fields.adType?.toLowerCase() === "free"
            ? AD_TYPE_FREE
            : existing.adType,
      images: {
        create: uploadedImages.map((image, index) => ({
          ...image,
          displayOrder: (existing.images.length - removeImageIds.length) + index,
        })),
      },
    };

    const casualDetails = parseJsonOrNull(fields.casualDetails);
    const rentalDetails = parseJsonOrNull(fields.rentalDetails);
    const petDetails = parseJsonOrNull(fields.petDetails);
    const serviceDetails = parseJsonOrNull(fields.serviceDetails);

    if (casualDetails !== undefined) updateData.casualDetails = casualDetails;
    if (rentalDetails !== undefined) updateData.rentalDetails = rentalDetails;
    if (petDetails !== undefined) updateData.petDetails = petDetails;
    if (serviceDetails !== undefined) updateData.serviceDetails = serviceDetails;

    const post = await prisma.post.update({
      where: { id: postId },
      data: updateData,
      include: {
        images: { orderBy: { displayOrder: "asc" } },
      },
    });

    return mapPost(post);
  });

  app.delete("/:id", { preHandler: [requireAuth] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const postId = Number(id);

    const existing = await prisma.post.findUnique({
      where: { id: postId },
      include: { images: true },
    });

    if (!existing) {
      return reply.code(404).send({ message: "Post not found" });
    }

    if (existing.ownerId !== request.user.id && request.user.role !== "ADMIN") {
      return reply.code(403).send({ message: "You are not allowed to delete this post" });
    }

    await Promise.all(existing.images.map((image: any) => deleteImage(image.cloudinaryPublicId)));

    await prisma.post.update({
      where: { id: postId },
      data: { status: POST_STATUS_DELETED },
    });

    return { success: true };
  });
};
