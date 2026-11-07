import { pingDB } from "../config/db.js";
import { ok } from "../utils/apiResponse.js";

export async function getHealth(req, res) {
  await pingDB();
  ok(res, {
    status: "ok",
    uptime: Math.round(process.uptime()),
    timestamp: new Date().toISOString(),
  });
}