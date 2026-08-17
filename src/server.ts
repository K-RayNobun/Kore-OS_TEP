import Fastify from "fastify";
import websocket from "@fastify/websocket";
import cors from "@fastify/cors";
import * as net from "node:net";
import * as os from "node:os";
import * as path from "node:path";
import * as fs from "node:fs";

import { IPC_SOCKET_PATH } from "./utils/ipc_pipe.js";
import * as db from "./utils/database_helper.js";
import { captchaInterceptor } from "./utils/captcha_interceptor.js";
import { getSecureSessionContext } from "./utils/session_manager.js";
import { BudgetPool } from "./utils/budget_pool.js";
import { getPolicy } from "./utils/policy.js";
import { computePriority } from "./utils/priority_policy.js";
import { serializeMission, serializeSchedule, serializeCheckpoint, serializeInterruption } from "./utils/serializers.js";

const fastify = Fastify({ logger: true });

await fastify.register(websocket);
await fastify.register(cors, {
  origin: [process.env.KORE_CORS_ORIGIN || "http://localhost:5173", "http://localhost:3000"],
  allowedHeaders: ["X-Kore-Core-Token", "Content-Type"],
  credentials: true,
});

const KORE_TOKEN = process.env.KORE_CORE_TOKEN || "";
const cognitionClients = new Map<string, Set<any>>(new Map());
const interventionClients = new Map<string, Set<any>>(new Map());
const budgetPool = new BudgetPool();

function getSessionClients(map: Map<string, Set<any>>, sessionId: string | undefined): Set<any> | undefined {
  if (!sessionId) {
    return undefined;
  }
  let set = map.get(sessionId);
  if (!set) {
    set = new Set();
    map.set(sessionId, set);
  }
  return set;
}

function addClient(map: Map<string, Set<any>>, socket: any, sessionId?: string): void {
  const set = getSessionClients(map, sessionId);
  if (set) {
    set.add(socket);
  }
  socket.on("close", () => {
    if (set) set.delete(socket);
    if (set && set.size === 0) map.delete(sessionId || "");
  });
  socket.on("error", () => {
    if (set) set.delete(socket);
    if (set && set.size === 0) map.delete(sessionId || "");
  });
}

function sendToSession(map: Map<string, Set<any>>, sessionId: string | undefined, frame: Record<string, unknown>): void {
  const set = getSessionClients(map, sessionId);
  if (!set || set.size === 0) return;
  const payload = JSON.stringify(frame);
  for (const c of Array.from(set)) {
    try {
      c.send(payload);
    } catch {
      set.delete(c);
    }
  }
}

function sendToAll(map: Map<string, Set<any>>, frame: Record<string, unknown>): void {
  const payload = JSON.stringify(frame);
  for (const set of Array.from(map.values())) {
    for (const c of Array.from(set)) {
      try {
        c.send(payload);
      } catch {
        set.delete(c);
      }
    }
  }
}

const PUBLIC_PATHS = new Set(["/interactive"]);

fastify.addHook("onRequest", async (request, reply) => {
  const reqUrl = request.url || "";
  if (PUBLIC_PATHS.has((reqUrl.split("?")[0] || ""))) {
    return;
  }
  const token = (request.headers as any)["x-kore-core-token"] || (request.query as any)?.token;
  if (KORE_TOKEN && token !== KORE_TOKEN) {
    reply.status(401).send({ error: "Unauthorized" });
    throw new Error("Unauthorized");
  }
});

fastify.get("/api/v1/telemetry", async () => {
  const cpus = os.cpus();
  const cpuTotal = cpus.reduce((acc, cpu) => {
    const total = Object.values(cpu.times).reduce((a: number, b: number) => a + b, 0);
    const idle = cpu.times.idle;
    return acc + ((total - idle) / total);
  }, 0);
  const cpu = cpus.length ? (cpuTotal / cpus.length) * 100 : 0;

  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const ramUsed = totalMem - freeMem;
  const ramTotal = totalMem;

  const inputTokens = Number(lastTelemetryResponse.input_tokens ?? 0);
  const outputTokens = Number(lastTelemetryResponse.output_tokens ?? 0);
  const now = Date.now();
  const state = loadBudgetState();
  const elapsedSec = Math.max(1, (now - state.startedAt) / 1000);
  const totalTokens = inputTokens + outputTokens;
  const burnRate = totalTokens / elapsedSec;

  return {
    cpu: Math.round(cpu * 100) / 100,
    ramUsed,
    ramTotal,
    inputTokens,
    outputTokens,
    burnRate: Math.round(burnRate * 100) / 100,
    ceilActive: state.ceilActive,
    budgetRemaining: budgetPool.remaining(),
    budgetTotal: budgetPool.getTotalAllocated()
  };
});

fastify.post("/api/v1/telemetry/budget", async (request, reply) => {
  const state = loadBudgetState();
  state.ceilActive = !state.ceilActive;
  saveBudgetState(state);
  return { status: "ok", ceilActive: state.ceilActive };
});

fastify.post("/api/v1/budget/refill", async (request) => {
  const body = (request.body as any) || {};
  const tokens = Number(body.tokens || 50000);
  budgetPool.refill(tokens);
  broadcastBudgetUpdate();
  return { status: "ok", remaining: budgetPool.remaining(), totalAllocated: budgetPool.getTotalAllocated() };
});

fastify.get("/api/v1/budget/status", async () => {
  return {
    remaining: budgetPool.remaining(),
    totalAllocated: budgetPool.getTotalAllocated()
  };
});

fastify.get("/api/v1/budget", async () => {
  const state = loadBudgetState();
  const totalTokens = Number(lastTelemetryResponse.input_tokens ?? 0) + Number(lastTelemetryResponse.output_tokens ?? 0);
  const elapsedMs = Math.max(1, Date.now() - state.startedAt);
  const burnRatePerMin = elapsedMs > 0 ? (totalTokens / elapsedMs) * 60000 : 0;
  return budgetPool.toDto(burnRatePerMin, state.ceilActive);
});

fastify.get("/api/v1/decisions", async (request) => {
  const query = (request.query as any) || {};
  const missionId = typeof query.missionId === "string" && query.missionId.trim() ? query.missionId.trim() : "001";
  const decisions = db.getDecisionsByMission(missionId);
  const records: any[] = [];
  for (const d of decisions) {
    const taskId = d.task_id as number | undefined;
    const logs = taskId ? db.getExecutionLogsByTask(taskId) : [];
    const executionLogs = logs.length > 0
      ? logs.map((l) => `[${l.phase}] ${l.status}: ${l.error_message || l.output_json || ""}`).join("\n")
      : null;
    records.push({
      id: String(d.id),
      thought: d.thought,
      action: d.action ?? null,
      execution_logs: executionLogs
    });
  }
  return records;
});

fastify.get("/api/v1/processes", async () => {
  const { execSync } = await import("node:child_process");
  const ps = execSync("ps -eo pid,comm,stat", { encoding: "utf8" });
  const lines = ps.split("\n").slice(1).filter(Boolean);
  const processes = lines.slice(0, 50).map((line) => {
    const parts = line.trim().split(/\s+/);
    const rawName = parts.slice(1, -1).join(" ") || parts[1] || "unknown";
    const name = path.basename(rawName);
    const stat = parts[parts.length - 1] || "";
    const status = stat.includes("Z") ? "STOPPED" : "RUNNING";
    return { name, status };
  });
  return processes;
});

fastify.post("/api/v1/jobs/resume", async (request, reply) => {
  const body = (request.body as any) || {};
  const sessionId = body.sessionId;
  if (typeof sessionId !== "string" || !sessionId) {
    reply.status(400).send({ status: "error", message: "sessionId must be a non-empty string" });
    return;
  }
  const taskId = Number(sessionId);
  if (!Number.isFinite(taskId) || taskId <= 0) {
    reply.status(400).send({ status: "error", message: "sessionId must be a valid task identifier" });
    return;
  }
  const approved = typeof body.approved === "boolean" ? body.approved : true;
  const choice = typeof body.choice === "string" ? body.choice : undefined;
  const answer = typeof body.answer === "string" ? body.answer : undefined;

  if (!approved) {
    db.createHumanIntervention(`intervention-${taskId}`, taskId, "rejection", JSON.stringify({ choice, answer }));
    db.resolveHumanIntervention(`intervention-${taskId}`, "REJECTED");
  }

  const frame = JSON.stringify({
    type: "human_directive",
    payload: { taskId, approved, choice, answer },
  });
  try {
    await sendIpcFrame(frame);
    return reply.status(200).send({ status: "ok", taskId, approved });
  } catch {
    return reply.status(502).send({ status: "error", message: "IPC pipe unavailable" });
  }
});

fastify.post("/api/v1/wallet/cookies", async (request) => {
  const body = (request.body as any) || {};
  const missionId = body.missionId || "default";
  const sessionDir = await getSecureSessionContext(missionId);
  const cookiePath = path.join(sessionDir, "cookies.json");
  fs.writeFileSync(cookiePath, JSON.stringify(body.cookies || {}));
  return { status: "ok", path: cookiePath };
});

fastify.post("/api/v1/wallet/vault", async (request) => {
  const body = (request.body as any) || {};
  const vaultDir = "/home/elo/.local/share/kore-vault";
  fs.mkdirSync(vaultDir, { recursive: true });
  const vaultFile = path.join(vaultDir, `${body.id || "vault"}.json`);
  fs.writeFileSync(vaultFile, JSON.stringify(body.data || {}));
  return { status: "ok", path: vaultFile };
});

fastify.post("/api/v1/auth/verify", async (request) => {
  return { status: "ok" };
});

fastify.post("/api/v1/missions/start", async (request, reply) => {
  const body = (request.body as any) || {};
  const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
  if (!prompt) {
    return reply.status(400).send({ status: "error", message: "prompt is required" });
  }
  const missionId = typeof body.missionId === "string" && body.missionId.trim() ? body.missionId.trim() : `mission-${Date.now()}`;
  const resumeFrom = typeof body.resumeFrom === "string" && body.resumeFrom.trim() ? body.resumeFrom.trim() : undefined;
  const attributes = (body.attributes && typeof body.attributes === "object") ? body.attributes : undefined;
  const attributesJson = attributes ? JSON.stringify(attributes) : undefined;
  const policy = getPolicy();
  const priority = attributes ? computePriority(attributes, policy) : Number(body.priority || 0);
  const budgetTokens = attributes && typeof attributes.budgetCap === "number"
    ? attributes.budgetCap
    : Number(body.budgetTokens || 50000);

  db.createMission(missionId, prompt, attributesJson);
  db.createMissionQueueEntry({ missionId, priority, budgetAllocatedTokens: budgetTokens, attributes: attributesJson });

  if (attributes?.recurrence && attributes.recurrence.kind && attributes.recurrence.kind !== "none") {
    const rec = attributes.recurrence;
    db.createTaskSchedule({
      name: `Recurring: ${prompt.slice(0, 60)}`,
      missionId,
      cronExpr: rec.cron,
      intervalMinutes: rec.intervalMinutes,
      nextTriggerAt: rec.nextAt || new Date(Date.now() + 60000).toISOString(),
      priorityOverride: priority,
      budgetAllocatedTokens: budgetTokens,
      attributes: attributesJson
    });
  }

  const framePayload: any = { mission_id: missionId, prompt, priority, budget_tokens: budgetTokens };
  if (resumeFrom) framePayload.resume_from = resumeFrom;
  if (attributes) framePayload.attributes = attributes;

  const frame = JSON.stringify({ type: "prompt_submit", session_id: missionId, payload: framePayload });
  try {
    await sendIpcFrame(frame);
    return reply.status(200).send({ status: resumeFrom ? "resuming" : "queued", mission_id: missionId });
  } catch {
    return reply.status(502).send({ status: "error", message: "IPC pipe unavailable" });
  }
});

fastify.get("/api/v1/policy", async () => {
  return getPolicy();
});

fastify.post("/api/v1/missions/:id/pause", async (request, reply) => {
  const missionId = (request.params as any).id;
  const frame = JSON.stringify({ type: "mission_pause", session_id: missionId, payload: { mission_id: missionId } });
  try {
    await sendIpcFrame(frame);
    broadcastMissionUpdate();
    return reply.status(200).send({ status: "paused", mission_id: missionId });
  } catch {
    return reply.status(502).send({ status: "error", message: "IPC pipe unavailable" });
  }
});

fastify.post("/api/v1/missions/:id/resume", async (request, reply) => {
  const missionId = (request.params as any).id;
  const frame = JSON.stringify({ type: "mission_resume", session_id: missionId, payload: { mission_id: missionId } });
  try {
    await sendIpcFrame(frame);
    broadcastMissionUpdate();
    return reply.status(200).send({ status: "resumed", mission_id: missionId });
  } catch {
    return reply.status(502).send({ status: "error", message: "IPC pipe unavailable" });
  }
});

fastify.post("/api/v1/missions/:id/cancel", async (request, reply) => {
  const missionId = (request.params as any).id;
  const frame = JSON.stringify({ type: "mission_cancel", session_id: missionId, payload: { mission_id: missionId } });
  try {
    await sendIpcFrame(frame);
    db.updateMissionQueueStatus(missionId, "CANCELLED", { completedAt: new Date().toISOString() });
    broadcastMissionUpdate();
    return reply.status(200).send({ status: "cancelled", mission_id: missionId });
  } catch {
    return reply.status(502).send({ status: "error", message: "IPC pipe unavailable" });
  }
});

fastify.post("/api/v1/missions/:id/interrupt", async (request, reply) => {
  const missionId = (request.params as any).id;
  const body = (request.body as any) || {};
  const force = body.force === true;
  const frame = JSON.stringify({ type: "mission_interrupt", session_id: missionId, payload: { mission_id: missionId, force } });
  try {
    await sendIpcFrame(frame);
    db.updateMissionQueueStatus(missionId, "INTERRUPTED");
    broadcastMissionUpdate();
    return reply.status(200).send({ status: "interrupted", mission_id: missionId });
  } catch {
    return reply.status(502).send({ status: "error", message: "IPC pipe unavailable" });
  }
});

fastify.post("/api/v1/missions/:id/priority", async (request, reply) => {
  const missionId = (request.params as any).id;
  const body = (request.body as any) || {};
  const priority = Number(body.priority);
  if (!Number.isFinite(priority)) {
    return reply.status(400).send({ status: "error", message: "priority is required" });
  }
  const frame = JSON.stringify({ type: "mission_priority", session_id: missionId, payload: { mission_id: missionId, priority } });
  try {
    await sendIpcFrame(frame);
    db.updateMissionQueueStatus(missionId, db.getMissionQueueEntry(missionId)?.status || "QUEUED");
    const entry = db.getMissionQueueEntry(missionId);
    if (entry) {
      db.getDb().prepare("UPDATE mission_queue SET priority = ? WHERE mission_id = ?").run(priority, missionId);
    }
    broadcastMissionUpdate();
    return reply.status(200).send({ status: "prioritized", mission_id: missionId, priority });
  } catch {
    return reply.status(502).send({ status: "error", message: "IPC pipe unavailable" });
  }
});

fastify.post("/api/v1/missions/:id/budget", async (request, reply) => {
  const missionId = (request.params as any).id;
  const body = (request.body as any) || {};
  const tokens = Number(body.tokens);
  if (!Number.isFinite(tokens)) {
    return reply.status(400).send({ status: "error", message: "tokens is required" });
  }
  const frame = JSON.stringify({ type: "mission_budget", session_id: missionId, payload: { mission_id: missionId, tokens } });
  try {
    await sendIpcFrame(frame);
    const entry = db.getMissionQueueEntry(missionId);
    if (entry) {
      db.getDb().prepare("UPDATE mission_queue SET budget_allocated_tokens = ? WHERE mission_id = ?").run(tokens, missionId);
    }
    broadcastMissionUpdate();
    broadcastBudgetUpdate();
    return reply.status(200).send({ status: "budgeted", mission_id: missionId, tokens });
  } catch {
    return reply.status(502).send({ status: "error", message: "IPC pipe unavailable" });
  }
});

fastify.get("/api/v1/artifacts/download/:id", async (request, reply) => {
  const id = (request.params as any).id;
  const artifact = db.getArtifactById(id);
  if (!artifact) {
    return reply.status(404).send({ error: "Artifact not found" });
  }
  try {
    const stat = fs.statSync(artifact.file_path);
    const stream = fs.createReadStream(artifact.file_path);
    reply.header("Content-Type", artifact.mime_type || "application/octet-stream");
    reply.header("Content-Length", String(stat.size));
    reply.header("Content-Disposition", `attachment; filename="${encodeURIComponent(artifact.file_name)}"`);
    return stream;
  } catch {
    return reply.status(404).send({ error: "Artifact file missing" });
  }
});

fastify.get("/api/v1/missions/:id/artifacts", async (request) => {
  const missionId = (request.params as any).id;
  const artifacts = db.getArtifactsByMission(missionId);
  return { mission_id: missionId, artifacts };
});

fastify.get("/api/v1/missions/:id/state", async (request) => {
  const missionId = (request.params as any).id;
  const queueEntry = db.getMissionQueueEntry(missionId);
  const mission = db.getMission(missionId);
  return {
    mission_id: missionId,
    state: queueEntry?.status || "UNKNOWN",
    priority: queueEntry?.priority || 0,
    budget_allocated: queueEntry?.budget_allocated_tokens || 0,
    budget_consumed: queueEntry?.budget_consumed_tokens || 0,
    started_at: queueEntry?.started_at || null,
    completed_at: queueEntry?.completed_at || null,
    prompt: mission?.prompt || null
  };
});

fastify.get("/api/v1/missions", async () => {
  const queue = db.getAllQueueEntries();
  return queue.map((q: any) => serializeMission(q, db.getMission(q.mission_id)));
});

fastify.get("/api/v1/missions/:id/checkpoints", async (request) => {
  const missionId = (request.params as any).id;
  const rows = db.getCheckpointsByMission(missionId);
  return rows.map((r: any) => serializeCheckpoint(r));
});

fastify.get("/api/v1/missions/:id/interruptions", async (request) => {
  const missionId = (request.params as any).id;
  const rows = db.getInterruptionsByMission(missionId);
  return rows.map((r: any) => serializeInterruption(r));
});

fastify.get("/api/v1/tags", async () => {
  return db.getDistinctTags();
});

fastify.post("/api/v1/schedules", async (request, reply) => {
  const body = (request.body as any) || {};
  const name = typeof body.name === "string" && body.name.trim() ? body.name.trim() : "";
  if (!name) {
    return reply.status(400).send({ status: "error", message: "name is required" });
  }
  const cronExpr = typeof body.cronExpr === "string" ? body.cronExpr : undefined;
  const intervalMinutes = Number(body.intervalMinutes);
  const now = new Date(Date.now() + 60000).toISOString();
  const attributes = (body.attributes && typeof body.attributes === "object") ? JSON.stringify(body.attributes) : undefined;
  const scheduleParams: {
    name: string;
    cronExpr?: string;
    intervalMinutes?: number;
    nextTriggerAt: string;
    priorityOverride?: number;
    budgetAllocatedTokens?: number;
    missionId?: string;
    attributes?: string;
  } = {
    name,
    nextTriggerAt: now
  };
  if (cronExpr !== undefined) scheduleParams.cronExpr = cronExpr;
  if (Number.isFinite(intervalMinutes) && intervalMinutes > 0) scheduleParams.intervalMinutes = intervalMinutes;
  if (body.priorityOverride !== undefined) scheduleParams.priorityOverride = Number(body.priorityOverride);
  scheduleParams.budgetAllocatedTokens = Number(body.budgetAllocatedTokens || body.budgetTokens || 10000);
  if (typeof body.missionId === "string") scheduleParams.missionId = body.missionId;
  if (attributes) scheduleParams.attributes = attributes;
  const id = db.createTaskSchedule(scheduleParams);
  return { status: "ok", id };
});

fastify.get("/api/v1/schedules", async () => {
  const rows = db.getAllTaskSchedules();
  return rows.map((r: any) => serializeSchedule(r));
});

fastify.patch("/api/v1/schedules/:id", async (request, reply) => {
  const id = Number((request.params as any).id);
  if (!Number.isFinite(id) || id <= 0) {
    return reply.status(400).send({ status: "error", message: "invalid schedule id" });
  }
  const body = (request.body as any) || {};
  const updates: { nextTriggerAt?: string; lastStatus?: string; lastRunAt?: string; enabled?: number; priorityOverride?: number; budgetAllocatedTokens?: number; cronExpr?: string; intervalMinutes?: number } = {};
  if (body.cronExpr !== undefined) updates.cronExpr = String(body.cronExpr);
  if (body.intervalMinutes !== undefined) updates.intervalMinutes = Number(body.intervalMinutes);
  if (body.priorityOverride !== undefined) updates.priorityOverride = Number(body.priorityOverride);
  if (body.budgetAllocatedTokens !== undefined) updates.budgetAllocatedTokens = Number(body.budgetAllocatedTokens);
  if (body.enabled !== undefined) updates.enabled = body.enabled ? 1 : 0;
  if (body.nextTriggerAt !== undefined) updates.nextTriggerAt = String(body.nextTriggerAt);
  db.updateTaskSchedule(id, updates);
  return { status: "ok", id };
});

fastify.delete("/api/v1/schedules/:id", async (request, reply) => {
  const id = Number((request.params as any).id);
  if (!Number.isFinite(id) || id <= 0) {
    return reply.status(400).send({ status: "error", message: "invalid schedule id" });
  }
  db.deleteTaskSchedule(id);
  return { status: "ok", id };
});

fastify.post("/api/v1/schedules/:id/toggle", async (request, reply) => {
  const id = Number((request.params as any).id);
  const body = (request.body as any) || {};
  const enabled = body.enabled ? 1 : 0;
  db.updateTaskSchedule(id, { enabled: enabled as any });
  return { status: "ok", id, enabled: enabled === 1 };
});

fastify.post("/api/v1/push/subscribe", async (request) => {
  const body = (request.body as any) || {};
  const endpoint = body.endpoint;
  const keys = body.keys || {};
  if (!endpoint || !keys.p256dh || !keys.auth) {
    return { status: "error", message: "Missing endpoint or keys" };
  }
  const vaultDir = process.env.KORE_VAULT_DIR || "/home/elo/data/kore-vault";
  try {
    fs.mkdirSync(vaultDir, { recursive: true });
  } catch {
    // ignore persistence errors in non-Docker environments
  }
  const vaultFile = path.join(vaultDir, "push-subscriptions.json");
  let subscriptions: any[] = [];
  try {
    const raw = fs.readFileSync(vaultFile, "utf8");
    subscriptions = JSON.parse(raw);
  } catch {}
  const existing = subscriptions.findIndex((s: any) => s.endpoint === endpoint);
  const entry = { endpoint, keys, updated_at: new Date().toISOString() };
  if (existing >= 0) {
    subscriptions[existing] = entry;
  } else {
    subscriptions.push(entry);
  }
  try {
    fs.writeFileSync(vaultFile, JSON.stringify(subscriptions, null, 2));
  } catch {
    // ignore persistence errors in non-Docker environments
  }
  return { status: "ok", count: subscriptions.length };
});

fastify.get("/pwa", async (request, reply) => {
  const pwaDir = path.join(process.cwd(), "src", "pwa");
  const indexPath = path.join(pwaDir, "index.html");
  try {
    const html = fs.readFileSync(indexPath, "utf8");
    reply.type("text/html").send(html);
  } catch {
    reply.status(404).send({ error: "PWA not found" });
  }
});

fastify.get("/pwa/manifest.json", async (request, reply) => {
  const manifestPath = path.join(process.cwd(), "src", "pwa", "manifest.json");
  try {
    const manifest = fs.readFileSync(manifestPath, "utf8");
    reply.type("application/json").send(manifest);
  } catch {
    reply.status(404).send({ error: "manifest not found" });
  }
});

fastify.get("/pwa/sw.js", async (request, reply) => {
  const swPath = path.join(process.cwd(), "src", "pwa", "sw.js");
  try {
    const sw = fs.readFileSync(swPath, "utf8");
    reply.type("application/javascript").send(sw);
  } catch {
    reply.status(404).send({ error: "service worker not found" });
  }
});

fastify.get("/pwa/app.js", async (request, reply) => {
  const appPath = path.join(process.cwd(), "src", "pwa", "app.js");
  try {
    const app = fs.readFileSync(appPath, "utf8");
    reply.type("application/javascript").send(app);
  } catch {
    reply.status(404).send({ error: "app not found" });
  }
});

fastify.get("/pwa/styles.css", async (request, reply) => {
  const cssPath = path.join(process.cwd(), "src", "pwa", "styles.css");
  try {
    const css = fs.readFileSync(cssPath, "utf8");
    reply.type("text/css").send(css);
  } catch {
    reply.status(404).send({ error: "styles not found" });
  }
});

fastify.get("/pwa/*", async (request, reply) => {
  reply.status(404).send({ error: "not found" });
});

fastify.get("/api/v1/captcha/active", async (request) => {
  const active = captchaInterceptor.getActive();
  if (!active) {
    return null;
  }
  let base = process.env.KORE_PUBLIC_URL;
  if (!base) {
    const proto = (request as any).protocol || "http";
    const host = (request as any).hostname || "localhost";
    base = `${proto}://${host}`;
  }
  return { id: active.id, url: `${base}${active.url}&interactive=true&showControls=true` };
});

fastify.get("/interactive", async (request, reply) => {
  const taskId = Number((request.query as any).taskId);
  if (!Number.isFinite(taskId) || taskId <= 0) {
    reply.status(400).send({ error: "Invalid taskId" });
    return;
  }
  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Task Verification</title>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 640px; margin: 40px auto; padding: 0 20px; }
    button { padding: 12px 24px; font-size: 16px; border: none; cursor: pointer; margin: 8px 8px 0 0; }
    .approve { background: #4CAF50; color: white; }
    .reject { background: #f44336; color: white; }
  </style>
</head>
<body>
  <h1>Task #${taskId} Verification</h1>
  <p>The agent requires human verification for this task.</p>
  <form id="form">
    <button type="button" class="approve" onclick="send(true)">Approve</button>
    <button type="button" class="reject" onclick="send(false)">Reject</button>
  </form>
  <script>
    function send(approved) {
      window.parent.postMessage({ type: 'resume', taskId: ${taskId}, approved }, '*');
      document.body.innerHTML = '<p>Submitted. You can close this window.</p>';
    }
  </script>
</body>
</html>`;
  reply.type("text/html").send(html);
});

fastify.register(async function (fastify) {
  fastify.get("/api/v1/stream/cognition", { websocket: true }, (socket, req) => {
    const query = (req as any).query || {};
    const sessionId = typeof query.session_id === "string" ? query.session_id : undefined;
    addClient(cognitionClients, socket, sessionId);
    socket.send(JSON.stringify({ intent: "Idle", rationale: "", session_id: sessionId }));
    socket.on("close", () => {
      if (sessionId) {
        const set = cognitionClients.get(sessionId);
        if (set) { set.delete(socket); if (set.size === 0) cognitionClients.delete(sessionId); }
      }
    });
  });
});

fastify.register(async function (fastify) {
  fastify.get("/api/v1/stream/intervention", { websocket: true }, (socket, req) => {
    const query = (req as any).query || {};
    const sessionId = typeof query.session_id === "string" ? query.session_id : undefined;
    addClient(interventionClients, socket, sessionId);
    const active = captchaInterceptor.getActive();
    if (active) {
      const base = process.env.KORE_PUBLIC_URL || `http://${socket.remoteAddress || "localhost"}:${process.env.KORE_GATEWAY_PORT || 3000}`;
      try {
        const wsFrame = {
          type: "intervention_request",
          session_id: sessionId,
          payload: {
            intervention_type: "captcha",
            task_id: active.taskId,
            url: `${base}${active.url}&interactive=true&showControls=true`
          }
        };
        socket.send(JSON.stringify(wsFrame));
      } catch {
        if (sessionId) {
          const set = interventionClients.get(sessionId);
          if (set) { set.delete(socket); if (set.size === 0) interventionClients.delete(sessionId); }
        }
      }
    }
    socket.on("close", () => {
      if (sessionId) {
        const set = interventionClients.get(sessionId);
        if (set) { set.delete(socket); if (set.size === 0) interventionClients.delete(sessionId); }
      }
    });
  });
});

let ipcClient: net.Socket | null = null;
let ipcReconnectTimer: NodeJS.Timeout | null = null;

function connectIpcPipe(): void {
  if (ipcClient) {
    try {
      ipcClient.destroy();
    } catch {}
    ipcClient = null;
  }
  const client = net.createConnection({ path: IPC_SOCKET_PATH }, () => {
    console.error("[GATEWAY] Connected to IPC pipe");
    if (ipcReconnectTimer) {
      clearTimeout(ipcReconnectTimer);
      ipcReconnectTimer = null;
    }
  });
  client.on("data", (data) => {
    const lines = data.toString().split("\n").filter((l) => l.trim());
    for (const line of lines) {
      let frame: any;
      try {
        frame = JSON.parse(line);
      } catch {
        continue;
      }
      if (frame.type === "thinking" || frame.type === "tool_execution" || frame.type === "mission_complete") {
        const payload = frame.payload || {};
        if (payload.input_tokens !== undefined) lastTelemetryResponse.input_tokens = payload.input_tokens;
        if (payload.output_tokens !== undefined) lastTelemetryResponse.output_tokens = payload.output_tokens;
        if (payload.input_tokens !== undefined || payload.output_tokens !== undefined) {
          broadcastBudgetUpdate();
        }
      }
      captchaInterceptor.ingest(frame);
      if (frame.type === "telemetry_response") {
        lastTelemetryResponse = frame.payload || {};
        continue;
      }
      if (frame.type === "thinking") {
        const payload = frame.payload || {};
        const sessionId = (frame as any).session_id;
        const cognitionFrame = {
          session_id: sessionId,
          intent: (payload as any).action || "thinking",
          rationale: (payload as any).thought || ""
        };
        sendToSession(cognitionClients, sessionId, cognitionFrame);
        sendToAll(cognitionClients, cognitionFrame);
      }
      if (frame.type === "intercept_start") {
        const payload = frame.payload || {};
        const taskId = Number(payload.task_id ?? 0);
        const sessionId = (frame as any).session_id;
        if (Number.isFinite(taskId) && taskId > 0) {
          const base = process.env.KORE_PUBLIC_URL || `http://localhost:${process.env.KORE_GATEWAY_PORT || 3000}`;
          const wsFrame = {
            type: "intervention_request",
            session_id: sessionId,
            payload: {
              intervention_type: "captcha",
              task_id: taskId,
              url: `${base}/interactive?taskId=${taskId}&interactive=true&showControls=true`
            }
          };
          sendToSession(interventionClients, sessionId, wsFrame);
          sendToAll(interventionClients, wsFrame);
        }
      }
      if (frame.type === "intervention_request") {
        const sessionId = (frame as any).session_id;
        const out = { ...frame, session_id: sessionId };
        sendToSession(interventionClients, sessionId, out);
        sendToAll(interventionClients, out);
      }
      if (frame.type === "state_change") {
        const sessionId = (frame as any).session_id;
        const out = { ...frame, session_id: sessionId };
        sendToSession(interventionClients, sessionId, out);
        sendToAll(interventionClients, out);
        broadcastMissionUpdate();
      }
      if (frame.type === "tool_execution") {
        const sessionId = (frame as any).session_id;
        const out = { ...frame, session_id: sessionId };
        sendToSession(interventionClients, sessionId, out);
        sendToAll(interventionClients, out);
      }
      if (frame.type === "mission_update") {
        const sessionId = (frame as any).session_id;
        const out = { ...frame, session_id: sessionId };
        sendToSession(interventionClients, sessionId, out);
        sendToAll(interventionClients, out);
      }
      if (frame.type === "budget_update") {
        const out = { ...frame };
        sendToAll(interventionClients, out);
      }
      if (frame.type === "checkpoint") {
        const sessionId = (frame as any).session_id;
        const out = { ...frame, session_id: sessionId };
        sendToSession(interventionClients, sessionId, out);
        sendToAll(interventionClients, out);
      }
      if (frame.type === "interruption") {
        const sessionId = (frame as any).session_id;
        const out = { ...frame, session_id: sessionId };
        sendToSession(interventionClients, sessionId, out);
        sendToAll(interventionClients, out);
      }
      if (frame.type === "alert") {
        const sessionId = (frame as any).session_id;
        const out = { ...frame, session_id: sessionId };
        sendToSession(interventionClients, sessionId, out);
        sendToAll(interventionClients, out);
      }
      if (frame.type === "artifact_manifest") {
        const payload = frame.payload as any;
        if (payload && payload.id && payload.mission_id) {
          try {
            db.createMissionArtifact(
              String(payload.id),
              payload.mission_id,
              payload.task_id ?? undefined,
              payload.file_name || `artifact-${payload.id}`,
              payload.file_path || "",
              Number(payload.file_size ?? 0),
              payload.mime_type || "application/octet-stream"
            );
          } catch {}
        }
      }
      if (frame.type === "telemetry_heartbeat") {
        const payload = frame.payload || {};
        lastTelemetryResponse.input_tokens = payload.tokens ?? lastTelemetryResponse.input_tokens;
        lastTelemetryResponse.burn_rate = payload.burn_rate ?? lastTelemetryResponse.burn_rate;
        if (payload.cpu !== undefined || payload.ram !== undefined) {
          const heartbeatFrame = {
            type: "telemetry_heartbeat",
            session_id: (frame as any).session_id,
            payload
          };
          sendToSession(cognitionClients, (frame as any).session_id, heartbeatFrame);
        }
      }
    }
  });
  client.on("error", () => {
    console.error("[GATEWAY] IPC pipe error, will retry...");
    client.destroy();
    ipcClient = null;
    scheduleIpcReconnect();
  });
  client.on("close", () => {
    if (ipcClient === client) {
      ipcClient = null;
    }
    scheduleIpcReconnect();
  });
  ipcClient = client;
}

function scheduleIpcReconnect(): void {
  if (ipcReconnectTimer) return;
  ipcReconnectTimer = setTimeout(() => {
    ipcReconnectTimer = null;
    connectIpcPipe();
  }, 1000);
}

async function sendIpcFrame(frame: string): Promise<void> {
  const timeoutMs = 5000;
  const start = Date.now();
  while (!ipcClient || ipcClient.destroyed) {
    if (Date.now() - start > timeoutMs) {
      throw new Error("IPC pipe unavailable");
    }
    await new Promise(r => setTimeout(r, 50));
  }
  console.error("[GATEWAY] IPC WRITE:", frame);
  ipcClient.write(frame + "\n");
}

function broadcastBudgetUpdate(): void {
  const state = loadBudgetState();
  const totalTokens = Number(lastTelemetryResponse.input_tokens ?? 0) + Number(lastTelemetryResponse.output_tokens ?? 0);
  const elapsedMs = Math.max(1, Date.now() - state.startedAt);
  const burnRatePerMin = elapsedMs > 0 ? (totalTokens / elapsedMs) * 60000 : 0;
  const payload = budgetPool.toDto(burnRatePerMin, state.ceilActive);
  sendToAll(interventionClients, { type: "budget_update", payload: { pool: payload } });
}

function broadcastMissionUpdate(): void {
  const queue = db.getAllQueueEntries();
  const missions = queue.map((q: any) => serializeMission(q, db.getMission(q.mission_id)));
  sendToAll(interventionClients, { type: "mission_update", payload: { missions } });
}

connectIpcPipe();

let lastTelemetryResponse: Record<string, unknown> = {};

interface BudgetState {
  ceilActive: boolean;
  startedAt: number;
}

const BUDGET_STATE_PATH = "/home/elo/data/kore-vault/budget.json";

function loadBudgetState(): BudgetState {
  try {
    const raw = fs.readFileSync(BUDGET_STATE_PATH, "utf8");
    return JSON.parse(raw);
  } catch {
    return { ceilActive: false, startedAt: Date.now() };
  }
}

function saveBudgetState(state: BudgetState): void {
  try {
    fs.mkdirSync(path.dirname(BUDGET_STATE_PATH), { recursive: true });
    fs.writeFileSync(BUDGET_STATE_PATH, JSON.stringify(state), "utf8");
  } catch {
    // ignore persistence errors
  }
}

const start = async () => {
  try {
    budgetPool.initialize(Number(process.env.KORE_BUDGET_POOL_TOKENS || 100000));
    const port = Number(process.env.KORE_GATEWAY_PORT || 3000);
    await fastify.listen({ port, host: "0.0.0.0" });
    console.error(`[GATEWAY] Fastify listening on :${port}`);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

start();
