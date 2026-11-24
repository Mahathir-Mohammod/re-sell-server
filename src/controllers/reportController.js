import { created, ok } from "../utils/apiResponse.js";
import { createReport, listReports, resolveReport } from "../services/reportService.js";

export async function postReport(req, res) {
  created(res, await createReport(req.user, req.validated.body));
}

export async function getReports(req, res) {
  const { items, meta } = await listReports(req.validated.query);
  ok(res, items, meta);
}

export async function patchReport(req, res) {
  ok(res, await resolveReport(req.validated.params.id, req.validated.body.status, req.user.id));
}
