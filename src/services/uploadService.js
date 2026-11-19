const IMGBB_ENDPOINT = "https://api.imgbb.com/1/upload";

export const isUploadConfigured = () => Boolean(process.env.IMGBB_API_KEY);

// Accepts a data URL (data:image/png;base64,...) or bare base64 and returns a hosted URL.
// Base64 instead of multipart keeps multer out of the dependency list.
export async function uploadImage(dataUrl, name = "product") {
  const apiKey = process.env.IMGBB_API_KEY;
  if (!apiKey) {
    const err = new Error("Image upload is not configured (IMGBB_API_KEY missing)");
    err.status = 503;
    throw err;
  }

  const base64 = dataUrl.includes(",") ? dataUrl.split(",")[1] : dataUrl;
  const body = new URLSearchParams({ image: base64, name });

  const res = await fetch(`${IMGBB_ENDPOINT}?key=${apiKey}`, {
    method: "POST",
    body,
  });

  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json?.success) {
    const err = new Error(json?.error?.message || `Image host responded ${res.status}`);
    err.status = 502;
    throw err;
  }

  return json.data.display_url || json.data.url;
}