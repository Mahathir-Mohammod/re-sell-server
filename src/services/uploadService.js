import { ApiError } from "../utils/ApiError.js";

const IMGBB_ENDPOINT = "https://api.imgbb.com/1/upload";

export const isUploadConfigured = () => Boolean(process.env.IMGBB_API_KEY);

// Accepts a data URL (data:image/png;base64,...) or bare base64 and returns a hosted URL.
// Base64 instead of multipart keeps multer out of the dependency list.
export async function uploadImage(dataUrl, name = "product") {
  const apiKey = process.env.IMGBB_API_KEY;
  if (!apiKey) {
    throw new ApiError(503, "Image upload is not configured (IMGBB_API_KEY missing)");
  }

  const base64 = dataUrl.includes(",") ? dataUrl.split(",")[1] : dataUrl;
  const body = new URLSearchParams({ image: base64, name });

  const res = await fetch(`${IMGBB_ENDPOINT}?key=${apiKey}`, {
    method: "POST",
    body,
  });

  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json?.success) {
    const message = json?.error?.message ?? `Image host responded ${res.status}`;
    // imgbb answers "forbidden" for images it rejects (tiny/unsupported), which
    // reads like an auth problem to the user, so say what to do instead.
    if (json?.error?.code === 103) {
      throw new ApiError(400, "That image was rejected by the image host. Try a normal photo (JPG/PNG, at least a few hundred pixels).");
    }
    throw new ApiError(502, message);
  }

  return json.data.display_url || json.data.url;
}