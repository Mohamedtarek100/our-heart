/* ============================================================
   Our Heart — Frontend auth / session / lock orchestrator
   ------------------------------------------------------------
   Replaces the old client-side Access Code + localStorage trust
   mechanism entirely. This file contains:
     - NO access code
     - NO access-code hash
     - NO client-side proof of authentication
     - NO localStorage/sessionStorage "authenticated" flag

   Trust is decided ONLY by the backend:
     POST /api/login     (verify code -> trusted HttpOnly session)
     POST /api/logout    (revoke session + clear cookie)
     GET  /api/session   (report trust + lock state)

   State machine:
     checking-session -> authenticating -> trusted
                                         -> locked | chat
                     -> unauthenticated (Access Gate)
                     -> logging-out

   Everything FAILS CLOSED: any error, timeout or unreadable
   response leaves the visitor UNTRUSTED and the application
   unmounted.
   ============================================================ */

const API_BASE = "https://ourheartfunctions2026.azurewebsites.net/api";

const ACCESS_VERSION = "5.2";
const INTRO_VERSION = "7";
const LOCK_VERSION = "4";

/* Set to true only for a brand-new successful login; consumed once so a
   trusted page reload never autoplays the Intro. */
const INTRO_NEW_AUTH_KEY = "ourHeartNewAuth";

/* ------------------------------------------------------------------ */
/* DOM helpers                                                         */
/* ------------------------------------------------------------------ */

const appRoot = document.getElementById("appRoot");
const bootState = document.getElementById("bootState");
const accessGateMount = document.getElementById("accessGateMount");
const lockMount = document.getElementById("lockMount");
const appMount = document.getElementById("appMount");

let currentState = "checking-session";

function setState(next) {
  currentState = next;
  if (appRoot) appRoot.dataset.authState = next;
}

function showBoot(show) {
  if (bootState) bootState.hidden = !show;
  if (show) {
    document.body.classList.add("is-checking");
  } else {
    document.body.classList.remove("is-checking");
  }
}

/* Removes the checking shell entirely so it can never sit on top of the
   trusted experience (belt and braces alongside `hidden`). */
function destroyBoot() {
  showBoot(false);
  bootState?.remove();
}

function prefersReducedMotion() {
  return (
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

/* Minimal HTML escaper for any value interpolated into the gate markup. */
function escapeHtml(value) {
  return String(value == null ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

/* Wipes every mounted surface + any non-sensitive local app state.
   Used on logout / change account / failed trust so no authenticated
   DOM survives. */
function unmountAll() {
  if (lockMount) lockMount.replaceChildren();
  if (appMount) appMount.replaceChildren();
  document.querySelectorAll("#romanticIntro").forEach((node) => node.remove());
}

/* ------------------------------------------------------------------ */
/* Backend calls                                                       */
/* ------------------------------------------------------------------ */

async function fetchSession() {
  const response = await fetch(`${API_BASE}/session`, {
    method: "GET",
    credentials: "include",
    cache: "no-store"
  });
  if (!response.ok) throw new Error(`session ${response.status}`);
  return response.json();
}

async function postVerifyCode(code) {
  const response = await fetch(`${API_BASE}/verify-code`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code })
  });
  const payload = await response.json().catch(() => ({}));
  return { ok: response.ok, status: response.status, payload };
}

async function postLogin(provisional, user, code) {
  const body = provisional ? { provisional, user } : { code, user };
  const response = await fetch(`${API_BASE}/login`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  const payload = await response.json().catch(() => ({}));
  return { ok: response.ok, status: response.status, payload };
}

async function postLogout() {
  try {
    await fetch(`${API_BASE}/logout`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" }
    });
  } catch (error) {
    console.error("Logout request failed:", error);
  }
}

/* ------------------------------------------------------------------ */
/* Intro trigger                                                       */
/* ------------------------------------------------------------------ */

function markNewAuth() {
  try { sessionStorage.setItem(INTRO_NEW_AUTH_KEY, "1"); } catch { }
}

function consumeNewAuth() {
  try {
    const flag = sessionStorage.getItem(INTRO_NEW_AUTH_KEY) === "1";
    sessionStorage.removeItem(INTRO_NEW_AUTH_KEY);
    return flag;
  } catch {
    return false;
  }
}

/* Plays the cinematic Intro. `force` is true for a fresh login, false for
   a trusted reload (where intro.js's own session guard already prevents a
   replay — we also never force it in that case). */
async function playIntro(force) {
  try {
    const introModule = await import(`./intro.js?v=${INTRO_VERSION}`);
    await introModule.showRomanticIntro({ force });
  } catch (introError) {
    console.error("Opening animation failed, continuing:", introError);
  }
}

/* Manual replay — only reachable from the footer control, which itself is
   only mounted after trust. */
let loveIntroReplayActive = false;
async function replayLoveIntro() {
  if (loveIntroReplayActive) return;
  if (document.getElementById("romanticIntro")) return;
  if (currentState !== "trusted" && currentState !== "locked") return;

  const button = document.getElementById("loveIntroButton");
  loveIntroReplayActive = true;
  if (button) button.disabled = true;

  try {
    const introModule = await import(`./intro.js?v=${INTRO_VERSION}`);
    await introModule.showRomanticIntro({ force: true });
  } catch (introError) {
    console.error("Love Intro replay failed:", introError);
  } finally {
    loveIntroReplayActive = false;
    if (button) button.disabled = false;
  }
}
window.replayLoveIntro = replayLoveIntro;

/* ------------------------------------------------------------------ */
/* Authenticated app mount                                             */
/* ------------------------------------------------------------------ */

let appModuleLoaded = false;

function mountAppShell(state) {
  if (!appMount) return;

  // Clone the template so the authenticated DOM is only created now.
  const template = document.getElementById("tplAppShell");
  if (template && appMount.childElementCount === 0) {
    appMount.appendChild(template.content.cloneNode(true));
  }

  // The trusted identity is handed to app.js from the SERVER session —
  // never from localStorage.
  if (state && state.user) {
    window.__OUR_HEART_USER = state.user;
  }

  // Start the existing chat application exactly once. app.js retains ALL
  // its original logic (messages, voice, sync, presence, reactions,
  // replies, media, delete, fullscreen) — we only gate WHEN it loads.
  if (!appModuleLoaded) {
    appModuleLoaded = true;
    import(`./app.js?v=${ACCESS_VERSION}`);
  }
}

/* ------------------------------------------------------------------ */
/* STAGE 1 — Access Gate (Access Code ONLY)                            */
/* ------------------------------------------------------------------ */

/* Before the Access Code is verified the ONLY thing mounted is this gate:
   a heart, the private-space line, the code input and the Enter button.
   No account names, no Love Intro, no Change Account, no chat. */
function mountAccessGate() {
  if (!accessGateMount || accessGateMount.childElementCount > 0) return;

  const gate = document.createElement("div");
  gate.id = "accessGate";
  gate.innerHTML = `
    <div class="accessCard">
      <div class="accessHeart">❤️</div>
      <h1>Our Heart</h1>
      <p class="accessSubtitle">This is a private space.</p>

      <div class="accessInputWrap">
        <input
          id="accessCodeInput"
          type="password"
          inputmode="text"
          autocomplete="off"
          placeholder="Access code"
          aria-label="Access code"
        >
      </div>

      <button id="accessSubmit" type="button">Enter ❤️</button>

      <p id="accessError" class="accessError" aria-live="polite" hidden>
        Incorrect access code.
      </p>
    </div>
  `;

  accessGateMount.appendChild(gate);

  const input = gate.querySelector("#accessCodeInput");
  const button = gate.querySelector("#accessSubmit");
  const error = gate.querySelector("#accessError");

  let submitting = false;

  async function submitCode() {
    if (submitting) return;
    const code = input.value.trim();
    if (!code) return;

    submitting = true;
    button.disabled = true;
    button.classList.add("is-loading");
    error.hidden = true;
    setState("authenticating");

    try {
      // STAGE 1: verify the code server-side and obtain a short-lived
      // provisional token. NO session is created yet and NO account has
      // been chosen.
      const { ok, status, payload } = await postVerifyCode(code);

      if (ok && payload && payload.codeVerified && payload.provisional) {
        // Code is valid -> reveal the account-selection stage.
        button.disabled = false;
        button.classList.remove("is-loading");
        submitting = false;
        await goToAccountSelection(payload.provisional, payload.provisionalExpiresAt, payload.presence);
        return;
      }

      // Failure: remain untrusted, Access Gate stays (no account selector).
      setState("unauthenticated");
      error.textContent =
        status === 429
          ? "Too many attempts. Please wait a moment and try again."
          : "Incorrect access code.";
      error.hidden = false;
      input.value = "";
      input.focus();

      gate.querySelector(".accessCard")?.classList.remove("access-shake");
      requestAnimationFrame(() => {
        gate.querySelector(".accessCard")?.classList.add("access-shake");
      });
    } catch (submitError) {
      console.error("Access verification failed:", submitError);
      // FAIL CLOSED.
      setState("unauthenticated");
      error.textContent = "Unable to verify access. Try again.";
      error.hidden = false;
    } finally {
      submitting = false;
      button.disabled = false;
      button.classList.remove("is-loading");
    }
  }

  button.addEventListener("click", submitCode);
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") submitCode();
  });
}

function unmountAccessGate() {
  if (accessGateMount) accessGateMount.replaceChildren();
}

/* ------------------------------------------------------------------ */
/* STAGE 2 — Account Selection (only after the code is verified)       */
/* ------------------------------------------------------------------ */

/* Holds the provisional token in MEMORY ONLY for the lifetime of the
   selection step. It is never written to localStorage or any cookie the
   page can read. */
let pendingProvisional = null;
let pendingProvisionalExpiresAt = 0;
let pendingPresence = null;

/* Formats a server presence entry into an elegant status line. The online
   flag and the day offset are BOTH decided by the server (heartbeat
   freshness against server time / application timezone), so the device
   clock can never change what is shown. Real data only — never fabricated. */
function formatPresence(entry) {
  if (!entry) return { text: "", online: false };
  if (entry.online) return { text: "Online", online: true };

  const lastSeen = Number(entry.lastSeen) || 0;
  if (!lastSeen) return { text: "Offline", online: false };

  const time = new Date(lastSeen).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

  if (entry.dayOffset === 0) return { text: `Last seen today at ${time}`, online: false };
  if (entry.dayOffset === 1) return { text: `Last seen yesterday at ${time}`, online: false };

  const d = new Date(lastSeen);
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = d.getFullYear();
  return { text: `Last seen ${dd}/${mm}/${yyyy} at ${time}`, online: false };
}

async function goToAccountSelection(provisional, expiresAt, presence) {
  setState("account-selection");
  pendingProvisional = provisional;
  pendingProvisionalExpiresAt = Number(expiresAt) || 0;
  pendingPresence = presence || null;

  // Elegant exit of stage 1, then reveal stage 2.
  const gate = accessGateMount?.querySelector("#accessGate");
  if (gate) {
    gate.classList.add("is-leaving");
    await new Promise((resolve) => setTimeout(resolve, prefersReducedMotion() ? 60 : 420));
  }
  unmountAccessGate();

  mountAccountSelection();
}

function mountAccountSelection() {
  if (!accessGateMount || accessGateMount.childElementCount > 0) return;

  const mohamedStatus = formatPresence(pendingPresence?.Mohamed);
  const yomnaStatus = formatPresence(pendingPresence?.Yomna);

  const wrap = document.createElement("div");
  wrap.id = "accountSelection";
  wrap.innerHTML = `
    <div class="accessCard accountCard">
      <div class="accessHeart">❤️</div>
      <h1>Choose your account</h1>
      <p class="accessSubtitle">اختر حسابك لتكمّل</p>

      <div class="accountOptions" role="radiogroup" aria-label="Choose your account">
        <button type="button" class="accountOption" data-user="Mohamed" role="radio" aria-checked="false">
          <span class="accountOptionAvatar" aria-hidden="true">❤️</span>
          <span class="accountOptionName">Mohamed</span>
          <span class="accountOptionStatus ${mohamedStatus.online ? "is-online" : ""}">${escapeHtml(mohamedStatus.text)}</span>
        </button>
        <button type="button" class="accountOption" data-user="Yomna" role="radio" aria-checked="false">
          <span class="accountOptionAvatar" aria-hidden="true">❤️</span>
          <span class="accountOptionName">Yomna</span>
          <span class="accountOptionStatus ${yomnaStatus.online ? "is-online" : ""}">${escapeHtml(yomnaStatus.text)}</span>
        </button>
      </div>

      <p id="accountStatus" class="accessError" aria-live="polite" hidden></p>
    </div>
  `;

  accessGateMount.appendChild(wrap);

  const status = wrap.querySelector("#accountStatus");
  const options = [...wrap.querySelectorAll(".accountOption")];
  let submitting = false;

  // Live presence poll while choosing: keeps both status lines fresh even
  // though the user has not established a session yet. Real server data.
  const paintPresence = (summary) => {
    if (!summary) return;
    options.forEach((option) => {
      const user = option.dataset.user;
      const state = formatPresence(summary[user]);
      const el = option.querySelector(".accountOptionStatus");
      if (!el) return;
      if (el.textContent !== state.text) el.textContent = state.text;
      el.classList.toggle("is-online", state.online);
    });
  };

  paintPresence(pendingPresence);

  const presencePoll = setInterval(async () => {
    if (document.hidden || submitting) return;
    try {
      const response = await fetch(`${API_BASE}/getPresenceSummary`, {
        credentials: "include",
        cache: "no-store"
      });
      if (!response.ok) return;
      paintPresence(await response.json());
    } catch {
      /* best effort */
    }
  }, 15000);

  // Stop polling as soon as we leave this stage.
  const stopPresencePoll = () => clearInterval(presencePoll);
  wrap._stopPresencePoll = stopPresencePoll;

  async function chooseAccount(user, button) {
    if (submitting) return;

    // Provisional must still be usable; if it lapsed, fall back to stage 1.
    if (!pendingProvisional ||
        (pendingProvisionalExpiresAt && Date.now() > pendingProvisionalExpiresAt)) {
      resetToAccessGate("انتهت صلاحية التحقق. أدخل الكود مرة أخرى.");
      return;
    }

    submitting = true;
    options.forEach((option) => { option.disabled = true; });
    button.classList.add("is-selected");
    button.setAttribute("aria-checked", "true");
    status.textContent = "جارٍ التحقق…";
    status.className = "accessError is-pending";
    status.hidden = false;
    setState("authenticating");

    try {
      // STAGE 3 + 5: exchange the provisional for the trusted server
      // session. The account is bound by the backend, not by the client.
      const { ok, payload } = await postLogin(pendingProvisional, user);

      if (ok && payload && payload.authenticated) {
        pendingProvisional = null;
        pendingProvisionalExpiresAt = 0;
        // NEW successful authentication -> Intro may autoplay once.
        markNewAuth();
        await enterTrusted(payload, { isNewAuth: true });
        return;
      }

      // Provisional rejected (expired/reused) -> back to the code step.
      resetToAccessGate("انتهت صلاحية التحقق. أدخل الكود مرة أخرى.");
    } catch (error) {
      console.error("Account selection failed:", error);
      resetToAccessGate("تعذّر إكمال الدخول. حاول مرة أخرى.");
    } finally {
      submitting = false;
    }
  }

  options.forEach((option) => {
    option.addEventListener("click", () => chooseAccount(option.dataset.user, option));
  });
}

function unmountAccountSelection() {
  accessGateMount?.querySelector("#accountSelection")?._stopPresencePoll?.();
  if (accessGateMount) accessGateMount.replaceChildren();
}

/* Returns the visitor to a clean STAGE 1 with an explanatory message. */
function resetToAccessGate(message) {
  pendingProvisional = null;
  pendingProvisionalExpiresAt = 0;
  setState("unauthenticated");
  unmountAccountSelection();
  mountAccessGate();
  if (message) {
    const error = document.querySelector("#accessError");
    if (error) {
      error.textContent = message;
      error.hidden = false;
    }
  }
}

/* ------------------------------------------------------------------ */
/* Trusted routing (locked vs unlocked)                                */
/* ------------------------------------------------------------------ */

async function enterTrusted(state, options = {}) {
  const { isNewAuth = false } = options;

  setState("trusted");
  destroyBoot();
  unmountAccessGate();

  // Fail closed: unless the backend explicitly says the lock is disabled,
  // we treat the site as locked.
  const lockEnabled = state.lockEnabled !== false;

  if (isNewAuth) {
    // Intro plays once, then transitions into whatever comes next.
    await playIntro(true);
  }

  if (lockEnabled) {
    setState("locked");
    // Mount the Relationship Lock experience.
    const { mountRelationshipLock } = await import(`./lock.js?v=${LOCK_VERSION}`);
    mountRelationshipLock(lockMount, { state });
  } else {
    setState("trusted");
    mountAppShell(state);
  }
}

/* ------------------------------------------------------------------ */
/* Boot                                                                */
/* ------------------------------------------------------------------ */

async function boot() {
  setState("checking-session");
  showBoot(true);
  unmountAll();
  unmountAccessGate();

  let state = null;
  try {
    state = await fetchSession();
  } catch (error) {
    // FAIL CLOSED: backend unavailable -> no trust -> Access Gate.
    console.error("Session check failed:", error);
    state = null;
  }

  const trusted = !!(state && state.authenticated && state.user);

  if (trusted) {
    // A trusted page reload NEVER autoplays the Intro.
    const isNewAuth = consumeNewAuth();
    try {
      await enterTrusted(state, { isNewAuth });
    } catch (error) {
      // If mounting the trusted experience throws, fail safe to the gate.
      console.error("Failed to enter trusted state:", error);
      setState("unauthenticated");
      destroyBoot();
      mountAccessGate();
    }
    return;
  }

  // Not trusted -> Access Gate only. No Intro, no chat, no account info.
  setState("unauthenticated");
  destroyBoot();
  mountAccessGate();
}

/* ------------------------------------------------------------------ */
/* Change account / logout                                             */
/* ------------------------------------------------------------------ */

async function logoutAndReturnToGate() {
  setState("logging-out");
  // Remove authenticated UI + lock + intro immediately so nothing lingers.
  unmountAll();
  unmountAccessGate();
  appModuleLoaded = false;

  // The provisional pre-auth state must never survive a logout either.
  pendingProvisional = null;
  pendingProvisionalExpiresAt = 0;

  // Invalidate the server session (authoritative) and clear local state.
  await postLogout();
  try {
    localStorage.removeItem("currentUser");
    sessionStorage.removeItem(INTRO_NEW_AUTH_KEY);
  } catch { }

  setState("unauthenticated");
  destroyBoot();
  mountAccessGate();
}

/* app.js exposes window.changeUser; make it terminate the real session. */
window.changeUser = function () {
  logoutAndReturnToGate();
};

boot();