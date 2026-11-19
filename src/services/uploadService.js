import { v2 as cloudinary } from "cloudinary";
import { ApiError } from "../utils/ApiError.js";

const IMGBB_ENDPOINT = "https://api.imgbb.com/1/upload";

const cloudinaryReady = () =>
  Boolean(
    process.env.CLOUDINARY_CLOUD_NAME &&
      process.env.CLOUDINARY_API_KEY &&
      process.env.CLOUDINARY_API_SECRET
  );

// Cloudinary is the provider; imgbb stays as a fallback only while the
// Cloudinary keys are missing, so listings keep working during setup.
export const uploadProvider = () =>
  cloudinaryReady() ? "cloudinary" : process.env.IMGBB_API_KEY ? "imgbb" : null;

export const isUploadConfigured = () => uploadProvider() !== null;

// Accepts a data URL (data:image/png;base64,...) or bare base64 and returns a hosted URL.
// Base64 instead of multipart keeps multer out of the dependency list.
export async function uploadImage(dataUrl, name = "product") {
  const provider = uploadProvider();
  if (!provider) {
    throw new ApiError(
      503,
      "Image upload is not configured (set CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY and CLOUDINARY_API_SECRET)"
    );
  }

  const base64 = dataUrl.includes(",") ? dataUrl.split(",")[1] : dataUrl;
  return provider === "cloudinary"
    ? uploadToCloudinary(base64)
    : uploadToImgbb(base64, name);
}

async function uploadToCloudinary(base64) {
  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
    secure: true,
  });

  try {
    const result = await cloudinary.uploader.upload(`data:image/jpeg;base64,${base64}`, {
      folder: "resell-hub/products",
      resource_type: "image",
      // keep payloads small without visible quality loss; Cloudinary re-encodes anyway
      transformation: [{ width: 1200, crop: "limit" }, { quality: "auto" }],
    });
    return result.secure_url;
  } catch (err) {
    console.error("cloudinary upload failed:", err?.message);
    throw new ApiError(502, "Could not upload that image, please try a JPG or PNG under 5 MB");
  }
}

async function uploadToImgbb(base64, name) {
  const res = await fetch(`${IMGBB_ENDPOINT}?key=${process.env.IMGBB_API_KEY}`, {
    method: "POST",
    body: new URLSearchParams({ image: base64, name }),
  });

  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json?.success) {
    if (json?.error?.code === 103) {
      throw new ApiError(400, "That image was rejected by the image host. Try a normal photo (JPG/PNG, at least a few hundred pixels).");
    }
    throw new ApiError(502, json?.error?.message || `Image host responded ${res.status}`);
  }

  return json.data.display_url || json.data.url;
}