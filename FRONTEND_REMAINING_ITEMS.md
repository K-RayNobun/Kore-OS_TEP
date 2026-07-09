# Frontend Remaining Items

> **Purpose:** Changes required on the frontend to complete the Kore OS Control Center contract.  
> **Backend state:** fully aligned on the API contract; these items are UX / resilience gaps.

---

## 1. Call `POST /api/v1/auth/verify` on login

**Why:** The endpoint already exists and returns `200` when the token is valid, but the frontend never calls it. The token is only validated implicitly when the first real API call returns `401`.

**What to change:**
- After the user enters the base URL + token and clicks **Link Core**, POST to `<baseUrl>/api/v1/auth/verify` with header `X-Kore-Core-Token: <token>`.
- If it returns `200`, proceed into the shell.
- If it returns `401`, show an inline error (invalid token) and stay on the login screen.
- Store the token in `localStorage["kore_token"]` only after a successful verify.

**Effort:** Trivial.

---

## 2. Bounce to login on `401`

**Why:** Currently, if the token becomes invalid (e.g. rotated on the server), the frontend silently fails every polled request and keeps showing stale data forever.

**What to change:**
- Add a global fetch/WS interceptor (or wrap your API client) so that any `401` response:
  1. Clears `localStorage["kore_token"]` and `localStorage["kore_url"]`.
  2. Resets local state (`setAuthenticated(false)`, `setActiveCaptcha(null)`, etc.).
  3. Navigates the user back to the login screen.
- Do not retry the failed request after bouncing.

**Effort:** Trivial.

---

## 3. WebSocket reconnect

**Why:** The backend does not persist WS sessions. If the socket drops (network blip, server restart, idle timeout), the frontend is left showing the last frame forever with no “disconnected” indicator.

**What to change:**
- On `ws.onclose` / `ws.onerror`, attempt reconnect with exponential backoff (e.g. 1 s → 2 s → 4 s, cap at 30 s).
- Show a small status indicator when disconnected/reconnecting.
- On successful reconnect, the backend will send the initial `{ "intent": "Idle", "rationale": "" }` frame automatically.

**Effort:** Easy.

---

## 4. Web Push / VAPID (optional, deferred)

**Why:** The contract documents this as a `[GAP]`. The backend has no push subscription endpoint, and the frontend has no VAPID registration. Push is **not** required for the current CAPTCHA flow (that uses the 3 s REST poll).

**What would be needed if/when this is desired:**
- Backend: new endpoint to accept and store push subscriptions, plus a VAPID public key endpoint.
- Frontend: `pushManager.subscribe()` with VAPID key retrieved from backend; store subscription; handle `push` and `notificationclick` in `public/sw.js`.
- Use case: “intervention alerts” when the engine needs human input while the PWA is backgrounded.

**Effort:** Medium (both sides). Defer until there is a concrete alerting requirement.

---

## Notes

- **Do not** change the existing WS message assumption unless backend confirms it is also updated. The safest path is for backend to filter WS frames to `{ intent, rationale }` only. If backend does not change, frontend must defend against unknown shapes.
- **Do not** append `&interactive=true&showControls=true` to the `url` returned by `GET /api/v1/captcha/active` — backend already includes those params.
