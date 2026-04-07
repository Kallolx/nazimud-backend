import { v2 as cloudinary } from "cloudinary";
import { env } from "../config/env";

const cloudinaryConfigured =
  Boolean(env.CLOUDINARY_CLOUD_NAME) &&
  Boolean(env.CLOUDINARY_API_KEY) &&
  Boolean(env.CLOUDINARY_API_SECRET);

if (cloudinaryConfigured) {
  cloudinary.config({
    cloud_name: env.CLOUDINARY_CLOUD_NAME,
    api_key: env.CLOUDINARY_API_KEY,
    api_secret: env.CLOUDINARY_API_SECRET,
  });
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
  if (!cloudinaryConfigured) {
    throw new Error("Cloudinary is not configured yet. Add Cloudinary credentials in .env.");
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
  if (!cloudinaryConfigured) {
    return;
  }
  await cloudinary.uploader.destroy(publicId, { resource_type: "image" });
}
