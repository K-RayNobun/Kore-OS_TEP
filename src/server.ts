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

const fastify = Fastify({ logger: true });

await fastify.register(websocket);
await fastify.register(cors, {
  origin: [process.env.KORE_CORS_ORIGIN || "http://localhost:5173", "http://localhost:3000"],
  allowedHeaders: ["X-Kore-Core-Token", "Content-Type"],
  credentials: true,
});

const KORE_TOKEN = process.env.KORE_CORE_TOKEN || "";
const cognitionClients = new Set<any>();
const interventionClients = new Set<any>();

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
    ceilActive: state.ceilActive
  };
});

fastify.post("/api/v1/telemetry/budget", async () => {
  const state = loadBudgetState();
  state.ceilActive = !state.ceilActive;
  saveBudgetState(state);
  return { status: "ok", ceilActive: state.ceilActive };
});

fastify.get("/api/v1/decisions", async () => {
  const decisions = db.getDecisionsByMission("001");
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
  const frame = JSON.stringify({
    type: "human_directive",
    payload: { taskId, approved: typeof body.approved === "boolean" ? body.approved : true },
  });
  try {
    await sendIpcFrame(frame);
    return reply.status(200).send({ status: "ok", taskId });
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
  db.createMission(missionId, prompt);
  const frame = JSON.stringify({ type: "prompt_submit", payload: { mission_id: missionId, prompt } });
  try {
    await sendIpcFrame(frame);
    return reply.status(200).send({ status: "queued", mission_id: missionId });
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
  // State is tracked in engine; gateway returns current known state from IPC cache if available
  return { mission_id: missionId, state: "UNKNOWN" };
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
  fastify.get("/api/v1/stream/cognition", { websocket: true }, (socket) => {
    cognitionClients.add(socket);
    socket.send(JSON.stringify({ intent: "Idle", rationale: "" }));
    socket.on("close", () => cognitionClients.delete(socket));
  });
});

fastify.register(async function (fastify) {
  fastify.get("/api/v1/stream/intervention", { websocket: true }, (socket) => {
    interventionClients.add(socket);
    const active = captchaInterceptor.getActive();
    if (active) {
      const base = process.env.KORE_PUBLIC_URL || `http://${socket.remoteAddress || "localhost"}:${process.env.KORE_GATEWAY_PORT || 3000}`;
      try {
        socket.send(JSON.stringify({
          type: "intervention_request",
          payload: {
            intervention_type: "captcha",
            task_id: active.taskId,
            url: `${base}${active.url}&interactive=true&showControls=true`
          }
        }));
      } catch {
        interventionClients.delete(socket);
      }
    }
    socket.on("close", () => interventionClients.delete(socket));
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
      }
      captchaInterceptor.ingest(frame);
      if (frame.type === "telemetry_response") {
        lastTelemetryResponse = frame.payload || {};
        continue;
      }
      if (frame.type === "thinking") {
        const payload = frame.payload || {};
        const cognitionFrame = {
          intent: (payload as any).action || "thinking",
          rationale: (payload as any).thought || ""
        };
        for (const c of Array.from(cognitionClients)) {
          try {
            c.send(JSON.stringify(cognitionFrame));
          } catch {
            cognitionClients.delete(c);
          }
        }
      }
      if (frame.type === "intercept_start") {
        const payload = frame.payload || {};
        const taskId = Number(payload.task_id ?? 0);
        if (Number.isFinite(taskId) && taskId > 0) {
          const base = process.env.KORE_PUBLIC_URL || `http://localhost:${process.env.KORE_GATEWAY_PORT || 3000}`;
          const wsFrame = {
            type: "intervention_request",
            payload: {
              intervention_type: "captcha",
              task_id: taskId,
              url: `${base}/interactive?taskId=${taskId}&interactive=true&showControls=true`
            }
          };
          for (const c of Array.from(interventionClients)) {
            try {
              c.send(JSON.stringify(wsFrame));
            } catch {
              interventionClients.delete(c);
            }
          }
        }
      }
      if (frame.type === "intervention_request") {
        for (const c of Array.from(interventionClients)) {
          try {
            c.send(JSON.stringify(frame));
          } catch {
            interventionClients.delete(c);
          }
        }
      }
      if (frame.type === "state_change") {
        for (const c of Array.from(interventionClients)) {
          try {
            c.send(JSON.stringify(frame));
          } catch {
            interventionClients.delete(c);
          }
        }
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
    const port = Number(process.env.KORE_GATEWAY_PORT || 3000);
    await fastify.listen({ port, host: "0.0.0.0" });
    console.error(`[GATEWAY] Fastify listening on :${port}`);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

start();
