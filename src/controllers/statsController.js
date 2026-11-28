import { ok } from "../utils/apiResponse.js";
import { getMarketplaceStats, getPublicSeller, listTopSellers } from "../services/statsService.js";

export async function getStats(req, res) {
  ok(res, await getMarketplaceStats());
}

export async function getTopSellers(req, res) {
  ok(res, await listTopSellers(Number(req.query.limit) || 6));
}

export async function getSeller(req, res) {
  ok(res, await getPublicSeller(req.params.id));
}
