import { z } from "zod";
import { SCHEMA_VERSION, parsePlan, runRepair, validateAssignment, Assignment } from "../src/domain";
import { enqueueWebhook } from "./webhook";
import { explainWithGemini } from "./assist";

/** Minimal HTTP API (payload v2) event shape so we need no extra type packages. */
interface HttpEvent {
  requestContext?: { http?: { method?: string; path?: string }; authorizer?: { jwt?: { claims?: Record<string, string>; scopes?: string[] } } };
  rawPath?: string;
  body?: string | null;
  isBase64Encoded?: boolean;
}
interface HttpResult {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
}

const MAX_BODY_BYTES = 250 * 1024;
const BUILD = process.env.BUILD_VERSION ?? "dev";
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN ?? "*";

const json = (statusCode: number, data: unknown): HttpResult => ({
  statusCode,
  headers: {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    // CORS is a browser convenience, not authentication.
    "access-control-allow-origin": ALLOWED_ORIGIN,
  },
  body: JSON.stringify(data),
});

const objectiveSchema = z.union([
  z.object({ mode: z.literal("A") }),
  z.object({ mode: z.literal("B"), sessionId: z.string().min(1).max(40) }),
]);
const repairBody = z.object({ plan: z.unknown(), objective: objectiveSchema });
const placement = z.object({ roomId: z.string().max(40), startMinute: z.number().int().min(0).max(1440) });
const validateBody = z.object({ plan: z.unknown(), assignment: z.record(z.string().max(40), placement) });
const assistBody = z.object({
  message: z.string().trim().min(1).max(600),
  history: z.array(z.object({ role: z.enum(["user", "model"]), text: z.string().max(800) })).max(6).optional(),
  facts: z.unknown(),
});

function readBody(event: HttpEvent): { ok: true; value: unknown } | { ok: false; res: HttpResult } {
  const raw = event.body ?? "";
  const text = event.isBase64Encoded ? Buffer.from(raw, "base64").toString("utf8") : raw;
  if (Buffer.byteLength(text, "utf8") > MAX_BODY_BYTES) return { ok: false, res: json(413, { error: "Request body is too large (max 250 KB)." }) };
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false, res: json(400, { error: "Body must be valid JSON." }) };
  }
}

export async function handler(event: HttpEvent): Promise<HttpResult> {
  const method = event.requestContext?.http?.method ?? "GET";
  const path = event.requestContext?.http?.path ?? event.rawPath ?? "/";
  const route = path.replace(/^\/(prod|api)(?=\/)/, "").replace(/\/+$/, "") || "/";

  if (method === "OPTIONS") return { statusCode: 204, headers: { "access-control-allow-origin": ALLOWED_ORIGIN, "access-control-allow-methods": "GET,POST,OPTIONS", "access-control-allow-headers": "content-type,authorization" }, body: "" };

  try {
    if (method === "GET" && route === "/health") {
      return json(200, { status: "ok", build: BUILD, schemaVersion: SCHEMA_VERSION, runtime: "aws-lambda", time: new Date().toISOString() });
    }
    const claims = event.requestContext?.authorizer?.jwt?.claims;
    const subject = claims?.sub;
    const authenticated = !!subject && claims?.token_use === "access" && (event.requestContext?.authorizer?.jwt?.scopes ?? claims?.scope?.split(" ") ?? []).includes("planb/write");
    if ((process.env.REQUIRE_AUTH === "true" || route === "/publish" || route === "/integrations") && !authenticated) return json(401, { error: "Sign in to use cloud services." });
    if (method === "GET" && route === "/integrations") return json(200, { webhook: !!process.env.WEBHOOK_QUEUE_URL, delivery: "at-least-once" });
    if (method === "POST" && route === "/publish") {
      const b = readBody(event);
      if (!b.ok) return b.res;
      const input = validateBody.safeParse(b.value);
      if (!input.success) return json(400, { error: "Choose a valid approved schedule." });
      const plan = parsePlan(input.data.plan);
      if (!plan.ok) return json(422, { error: "The event needs attention before sharing.", issues: plan.issues });
      const assignment = input.data.assignment as Assignment;
      if (!validateAssignment(plan.plan, assignment).valid) return json(422, { error: "The schedule did not pass its checks." });
      if (!process.env.WEBHOOK_QUEUE_URL) return json(503, { error: "Webhook delivery is not connected yet." });
      return json(202, await enqueueWebhook(plan.plan, assignment, subject!));
    }
    if (method === "POST" && route === "/repair") {
      const b = readBody(event);
      if (!b.ok) return b.res;
      const parsed = repairBody.safeParse(b.value);
      if (!parsed.success) return json(400, { error: "Body must be { plan, objective }." });
      return json(200, runRepair(parsed.data.plan, parsed.data.objective));
    }
    if (method === "POST" && route === "/validate") {
      const b = readBody(event);
      if (!b.ok) return b.res;
      const parsed = validateBody.safeParse(b.value);
      if (!parsed.success) return json(400, { error: "Body must be { plan, assignment }." });
      const plan = parsePlan(parsed.data.plan);
      if (!plan.ok) return json(422, { status: "INVALID_INPUT", issues: plan.issues });
      return json(200, { schemaVersion: SCHEMA_VERSION, report: validateAssignment(plan.plan, parsed.data.assignment as Assignment) });
    }
    if (method === "POST" && route === "/assist") {
      const b = readBody(event);
      if (!b.ok) return b.res;
      const parsed = assistBody.safeParse(b.value);
      if (!parsed.success) return json(400, { error: "Body must be { message, facts }." });
      const facts = JSON.stringify(parsed.data.facts);
      if (Buffer.byteLength(facts, "utf8") > 12_000) return json(413, { error: "The board summary is too large." });
      const out = await explainWithGemini(parsed.data.message, parsed.data.history ?? [], parsed.data.facts);
      return out.ok ? json(200, { reply: out.reply, model: out.model }) : json(503, { error: out.error });
    }
    return json(404, { error: "Not found." });
  } catch {
    // Never echo input or stack traces; log only a fixed marker.
    console.error(JSON.stringify({ level: "error", msg: "unhandled", route }));
    return json(500, { error: "Internal error." });
  }
}
