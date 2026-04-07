import { v2 as cloudinary } from "cloudinary";
import { randomUUID } from "crypto";
import { promises as fs } from "fs";
import path from "path";
import { env } from "../config/env";

const cloudinaryConfigured =
  Boolean(env.CLOUDINARY_CLOUD_NAME) &&
  Boolean(env.CLOUDINARY_API_KEY) &&
  Boolean(env.CLOUDINARY_API_SECRET);

const useLocalStorage = env.IMAGE_STORAGE === "local";

function resolveLocalUploadDirs(): { primaryDir: string; fallbackDir: string } {
  const configured = String(env.LOCAL_UPLOAD_DIR || "uploads");
  if (path.isAbsolute(configured)) {
    return { primaryDir: configured, fallbackDir: configured };
  }

  const projectRootDir = path.resolve(__dirname, "..", "..");
  const primaryDir = path.resolve(projectRootDir, configured);
  const fallbackDir = path.resolve(process.cwd(), configured);
  return { primaryDir, fallbackDir };
}

if (cloudinaryConfigured) {
  cloudinary.config({
    cloud_name: env.CLOUDINARY_CLOUD_NAME,
    api_key: env.CLOUDINARY_API_KEY,
    api_secret: env.CLOUDINARY_API_SECRET,
  });
}

function sanitizeFileName(name: string): string {
  return String(name || "image")
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80) || "image";
}

function extractExtension(name: string): string {
  const ext = path.extname(name || "").toLowerCase();
  if (/^\.[a-z0-9]{1,6}$/.test(ext)) {
    return ext;
  }
  return ".jpg";
}

async function uploadLocalImageBuffer(buffer: Buffer, fileName: string): Promise<UploadedImage> {
  const { primaryDir: uploadDir } = resolveLocalUploadDirs();
  await fs.mkdir(uploadDir, { recursive: true });

  const ext = extractExtension(fileName);
  const base = sanitizeFileName(path.basename(fileName, ext));
  const storedName = `${Date.now()}-${randomUUID().slice(0, 8)}-${base}${ext}`;
  const fullPath = path.join(uploadDir, storedName);

  await fs.writeFile(fullPath, buffer);

  const baseUrl = env.PUBLIC_BASE_URL.replace(/\/$/, "");
  const publicPath = `/api/uploads/${storedName}`;

  return {
    url: `${baseUrl}${publicPath}`,
    secureUrl: `${baseUrl}${publicPath}`,
    cloudinaryPublicId: storedName,
    format: ext.replace(".", "") || undefined,
    bytes: buffer.length,
  };
}

export type UploadedImage = {
  url: string;
  secureUrl: string;
  cloudinaryPublicId: string;
  width?: number;
  height?: number;
  format?: string;
  bytes?: number;
};

export async function uploadImageBuffer(buffer: Buffer, fileName: string): Promise<UploadedImage> {
  if (useLocalStorage) {
    return uploadLocalImageBuffer(buffer, fileName);
  }

  if (!cloudinaryConfigured) {
    throw new Error("Cloudinary is not configured yet. Set IMAGE_STORAGE=local or add Cloudinary credentials in .env.");
  }

  const result = await new Promise<any>((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        folder: env.CLOUDINARY_FOLDER,
        resource_type: "image",
        use_filename: true,
        filename_override: fileName,
      },
      (error, response) => {
        if (error) return reject(error);
        resolve(response);
      },
    );
    stream.end(buffer);
  });

  return {
    url: result.url,
    secureUrl: result.secure_url,
    cloudinaryPublicId: result.public_id,
    width: result.width,
    height: result.height,
    format: result.format,
    bytes: result.bytes,
  };
}

export async function deleteImage(publicId: string): Promise<void> {
  if (useLocalStorage) {
    if (!publicId) return;

    const baseName = path.basename(publicId);
    const { primaryDir, fallbackDir } = resolveLocalUploadDirs();
    const candidatePaths = Array.from(new Set([
      path.join(primaryDir, baseName),
      path.join(fallbackDir, baseName),
    ]));

    for (const filePath of candidatePaths) {
      try {
        await fs.unlink(filePath);
        return;
      } catch (error: any) {
        if (error?.code !== "ENOENT") {
          throw error;
        }
      }
    }
    return;
  }

  if (!cloudinaryConfigured) {
    return;
  }
  await cloudinary.uploader.destroy(publicId, { resource_type: "image" });
}
