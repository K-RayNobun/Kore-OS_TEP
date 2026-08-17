const WS_URL = (location.protocol === "https:" ? "wss:" : "ws:") + "//" + location.host;
const API_BASE = location.origin;

let token = localStorage.getItem("kore_token") || "";
let cognitionSocket = null;
let interventionSocket = null;
let currentSessionId = "";

const views = {
  login: document.getElementById("login-view"),
  terminal: document.getElementById("terminal-view"),
  journals: document.getElementById("journals-view"),
  missions: document.getElementById("missions-view"),
  artifacts: document.getElementById("artifacts-view")
};

const tabs = {
  login: document.getElementById("tab-login"),
  terminal: document.getElementById("tab-terminal"),
  journals: document.getElementById("tab-journals"),
  missions: document.getElementById("tab-missions"),
  artifacts: document.getElementById("tab-artifacts")
};

function switchTab(name) {
  Object.values(views).forEach((el) => el && el.classList.add("hidden"));
  views[name] && views[name].classList.remove("hidden");
  Object.values(tabs).forEach((btn) => btn.classList.remove("active"));
  tabs[name] && tabs[name].classList.add("active");
}

Object.keys(tabs).forEach((k) => {
  tabs[k].addEventListener("click", () => switchTab(k));
});

document.getElementById("login-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const input = document.getElementById("token-input");
  token = input.value.trim();
  if (!token) return;
  localStorage.setItem("kore_token", token);
  const ok = await fetch(`${API_BASE}/api/v1/auth/verify`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: "{}"
  }).then((r) => r.ok);
  if (ok) {
    switchTab("missions");
    startMissionPolling();
    startTelemetryPolling();
  } else {
    const err = document.getElementById("login-error");
    err.textContent = "Invalid token";
    err.classList.remove("hidden");
  }
});

async function api(path, init) {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(init && init.headers ? init.headers : {})
    }
  });
  if (!res.ok) throw new Error(`API ${res.status}`);
  return res.json();
}

function connectCognition(sessionId) {
  if (cognitionSocket) cognitionSocket.close();
  currentSessionId = sessionId;
  const url = `${WS_URL}/api/v1/stream/cognition?session_id=${encodeURIComponent(sessionId)}`;
  cognitionSocket = new WebSocket(url);
  const terminal = document.getElementById("thinking-terminal");
  cognitionSocket.onmessage = (ev) => {
    try {
      const frame = JSON.parse(ev.data);
      const line = `[${frame.intent || "info"}] ${frame.rationale || ""}`;
      terminal.textContent += line + "\n";
      terminal.scrollTop = terminal.scrollHeight;
    } catch {}
  };
}

function connectIntervention(sessionId) {
  if (interventionSocket) interventionSocket.close();
  const url = `${WS_URL}/api/v1/stream/intervention?session_id=${encodeURIComponent(sessionId)}`;
  interventionSocket = new WebSocket(url);
  interventionSocket.onmessage = (ev) => {
    try {
      const frame = JSON.parse(ev.data);
      if (frame.type === "intervention_request") {
        const iframe = document.getElementById("captcha-frame");
        iframe.src = frame.payload.url;
        document.getElementById("captcha-form").classList.remove("hidden");
      }
    } catch {}
  };
}

document.getElementById("captcha-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!currentSessionId) return;
  await api(`/api/v1/intervention/respond`, {
    method: "POST",
    body: JSON.stringify({ mission_id: currentSessionId, task_id: 0, approved: true })
  });
  document.getElementById("captcha-form").classList.add("hidden");
});

async function startMissionPolling() {
  const list = document.getElementById("mission-list");
  const refresh = async () => {
    try {
      const missions = await api("/api/v1/missions");
      list.innerHTML = missions
        .map(
          (m) =>
            `<div class="mission-item">
              <strong>${m.mission_id}</strong>
              <span>state=${m.state} priority=${m.priority}</span>
              <button data-pause="${m.mission_id}">Pause</button>
              <button data-resume="${m.mission_id}">Resume</button>
            </div>`
        )
        .join("");
      list.querySelectorAll("button[data-pause]").forEach((btn) => {
        btn.addEventListener("click", async () => {
          const id = btn.getAttribute("data-pause");
          await api(`/api/v1/missions/${encodeURIComponent(id)}/pause`, { method: "POST", body: "{}" });
        });
      });
      list.querySelectorAll("button[data-resume]").forEach((btn) => {
        btn.addEventListener("click", async () => {
          const id = btn.getAttribute("data-resume");
          await api(`/api/v1/missions/${encodeURIComponent(id)}/resume`, { method: "POST", body: "{}" });
        });
      });
    } catch {}
  };
  await refresh();
  setInterval(refresh, 5000);
}

async function startTelemetryPolling() {
  const update = async () => {
    try {
      const t = await api("/api/v1/telemetry");
      document.getElementById("g-cpu").textContent = `${t.cpu ?? 0}%`;
      document.getElementById("g-ram").textContent = `${t.ramUsed ?? 0} B`;
      document.getElementById("g-burn").textContent = `${t.burnRate ?? 0}`;
      document.getElementById("g-budget").textContent = `${t.budgetRemaining ?? 0}`;
    } catch {}
  };
  await update();
  setInterval(update, 5000);
}

document.getElementById("mission-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const prompt = document.getElementById("mission-prompt").value.trim();
  const priority = Number(document.getElementById("mission-priority").value || 0);
  const budget = Number(document.getElementById("mission-budget").value || 50000);
  if (!prompt) return;
  const missionId = `mission-${Date.now()}`;
  await api("/api/v1/missions/start", {
    method: "POST",
    body: JSON.stringify({ prompt, missionId, priority, budgetTokens: budget })
  });
  connectCognition(missionId);
  connectIntervention(missionId);
  switchTab("terminal");
});

async function boot() {
  if (token) {
    const ok = await fetch(`${API_BASE}/api/v1/auth/verify`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: "{}"
    }).then((r) => r.ok);
    if (ok) {
      switchTab("missions");
      startMissionPolling();
      startTelemetryPolling();
      return;
    }
  }
  switchTab("login");
}

boot().catch(() => switchTab("login"));
