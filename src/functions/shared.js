/* ============================================================
   Our Heart — shared backend security + configuration module
   ------------------------------------------------------------
   Single source of truth for:
     - Cosmos container access
     - Access-code verification (server-side, never in the client)
     - Trusted session issuance / validation (HttpOnly cookie)
     - Server-controlled Relationship Lock configuration
     - Application timezone + application-date calculation
     - Server-authoritative time (deadline is fixed server-side)
     - Daily question definitions + ownership
     - CORS / cache / security headers

   Security model (defense in depth):
     - The browser NEVER holds the access code, its hash, or any
       client-side proof of authentication.
     - Identity is ALWAYS derived from the server-side session, never
       from a request body / query / localStorage value.
     - Every protected endpoint validates the session first.
     - When the Relationship Lock is enabled every chat operation is
       rejected with 423 Locked.
     - Any failure of the auth/lock/session checks fails CLOSED.
   ============================================================ */

const crypto = require("crypto");
const { CosmosClient } = require("@azure/cosmos");

/* ------------------------------------------------------------------ */
/* Cosmos                                                              */
/* ------------------------------------------------------------------ */

const client = new CosmosClient({
  endpoint: process.env.COSMOS_ENDPOINT,
  key: process.env.COSMOS_KEY
});

const database = client.database(process.env.COSMOS_DATABASE);
const container = database.container(process.env.COSMOS_CONTAINER);

/* ------------------------------------------------------------------ */
/* Access code                                                         */
/* ------------------------------------------------------------------ */

/* Only the SHA-256 of the access code exists server-side. It is read
   from application settings first; the literal below is the fallback so
   existing deployments keep working without extra configuration.
   The browser never sees either value. */
const ACCESS_CODE_HASH =
  String(process.env.ACCESS_CODE_HASH || "").trim() ||
  "4a1c33367c51b50488ef25a30719ee7d5a2781cb7b67ccdcc06d49e6be844e67";

/* Trusted identities. The access code itself is shared; the *identity*
   is bound to the session that the client explicitly chose at login and
   is persisted server-side — the client cannot change it afterwards. */
const USERS = {
  Mohamed: { id: "mohamed", display: "Mohamed" },
  Yomna: { id: "yomna", display: "Yomna" }
};

function isKnownUser(value) {
  return Object.prototype.hasOwnProperty.call(USERS, String(value || ""));
}

function otherUser(value) {
  return String(value) === "Mohamed" ? "Yomna" : "Mohamed";
}

function sha256(text) {
  return crypto.createHash("sha256").update(String(text), "utf8").digest("hex");
}

/* Constant-time comparison to avoid leaking hash bytes via timing. */
function safeEqualHex(a, b) {
  const bufA = Buffer.from(String(a), "hex");
  const bufB = Buffer.from(String(b), "hex");
  if (bufA.length !== bufB.length || bufA.length === 0) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

/* ------------------------------------------------------------------ */
/* Relationship Lock configuration (SERVER CONTROLLED)                 */
/* ------------------------------------------------------------------ */

/* Enable with an application setting:
       RELATIONSHIP_LOCK_ENABLED = true
   or via the local.settings.json "Values" object.

   Default is TRUE: if the setting is missing or unreadable we keep the
   site locked rather than failing open. Set the value explicitly to
   "false" (or "0"/"off"/"no") to restore the normal chat. */
function isRelationshipLockEnabled() {
  const raw = process.env.RELATIONSHIP_LOCK_ENABLED;
  if (raw === undefined || raw === null || String(raw).trim() === "") {
    return true; // fail closed
  }
  const normalized = String(raw).trim().toLowerCase();
  if (["false", "0", "off", "no", "disabled"].includes(normalized)) return false;
  return true;
}

/* ------------------------------------------------------------------ */
/* Time + application timezone                                         */
/* ------------------------------------------------------------------ */

/* One explicit application timezone for the whole experience. Every
   "day" decision (daily question eligibility, journey day records) is
   made by the SERVER in this timezone, never by the device clock.
   Africa/Cairo is the natural choice for this couple. */
const APP_TIMEZONE = String(process.env.APP_TIMEZONE || "Africa/Cairo").trim();

/* Absolute, server-controlled deadline for the Relationship Lock
   countdown. Stored as a fixed UTC instant so the client can compute the
   remaining time without trusting its own clock, and re-synced from the
   server on every status fetch.

   Local requirement: 25/07/2027 (Africa/Cairo, UTC+3 in July 2027).
   => 2027-07-25T00:00:00+03:00 => 2027-07-24T21:00:00.000Z            */
const DEADLINE_ISO =
  String(process.env.RELATIONSHIP_DEADLINE_ISO || "").trim() ||
  "2027-07-24T21:00:00.000Z";
const DEADLINE_MS = Date.parse(DEADLINE_ISO);

function serverNow() {
  return Date.now();
}

/* Calendar date (YYYY-MM-DD) in the application timezone. */
function applicationDate(epochMs) {
  const date = new Date(epochMs === undefined ? serverNow() : epochMs);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: APP_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date);

  const get = (type) => parts.find((p) => p.type === type)?.value || "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/* Day-of-month / month / year helpers used by the journey renderer. */
function parseApplicationDate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ""));
  if (!match) return null;
  return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
}

/* ------------------------------------------------------------------ */
/* Daily questions (definition + ownership live ONLY on the server)    */
/* ------------------------------------------------------------------ */

const QUESTIONS = {
  yomna: {
    id: "yomna",
    owner: "Yomna",
    prompt: "سؤال يمني",
    options: [
      { id: "stay", label: "هستناك يا محمد", positive: true },
      { id: "leave", label: "مش هعرف استناك", positive: false }
    ]
  },
  mohamed: {
    id: "mohamed",
    owner: "Mohamed",
    prompt: "سؤال محمد",
    options: [
      { id: "love", label: "بحبك يا يمني ومش هتخلي عنك", positive: true },
      { id: "leave", label: "هتخلي عنك يا يمني", positive: false }
    ]
  }
};

/* Maps a trusted user to the ONE question they own. The client can never
   influence this mapping. */
const QUESTION_BY_USER = {
  Yomna: "yomna",
  Mohamed: "mohamed"
};

function questionForUser(user) {
  return QUESTIONS[QUESTION_BY_USER[user]] || null;
}

function optionFor(questionId, optionId) {
  const question = QUESTIONS[questionId];
  if (!question) return null;
  return question.options.find((option) => option.id === optionId) || null;
}

/* ------------------------------------------------------------------ */
/* Trusted sessions                                                    */
/* ------------------------------------------------------------------ */

const SESSION_COOKIE = "oh_session";
/* 30 days — long enough that a daily-visiting couple is not forced to
   re-enter the code constantly, short enough to bound exposure. */
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

function sessionTtlMs() {
  const raw = Number(process.env.SESSION_TTL_MS);
  return Number.isFinite(raw) && raw > 60_000 ? raw : SESSION_TTL_MS;
}

function newSessionId() {
  return crypto.randomBytes(32).toString("hex");
}

function hashSessionId(sessionId) {
  return sha256(sessionId);
}

async function createSession(user) {
  const sessionId = newSessionId();
  const now = serverNow();
  const expiresAt = now + sessionTtlMs();

  const item = {
    id: `session:${hashSessionId(sessionId)}`,
    type: "session",
    user,
    createdAt: now,
    lastSeenAt: now,
    expiresAt,
    revoked: false
  };

  await container.items.create(item);
  return { sessionId, user, expiresAt };
}

/* Loads a session by its raw cookie value and returns it only when it is
   well-formed, not revoked and not expired. Returns null otherwise. */
async function loadSession(sessionId) {
  if (!sessionId || typeof sessionId !== "string" || sessionId.length < 32) {
    return null;
  }

  try {
    const { resource } = await container
      .item(`session:${hashSessionId(sessionId)}`, "session")
      .read();

    if (!resource || resource.type !== "session") return null;
    if (resource.revoked) return null;
    if (!isKnownUser(resource.user)) return null;
    if (Number(resource.expiresAt) <= serverNow()) return null;

    return resource;
  } catch (error) {
    // 404 (missing) or any transient failure -> treated as NO session.
    return null;
  }
}

async function touchSession(session) {
  if (!session) return;
  const now = serverNow();
  // Avoid a write on every single call; refresh at most once a minute.
  if (now - Number(session.lastSeenAt || 0) < 60_000) return;
  try {
    await container
      .item(session.id, "session")
      .replace({ ...session, lastSeenAt: now });
  } catch {
    /* best effort — never block a valid request on this */
  }
}

async function revokeSession(session) {
  if (!session) return;
  try {
    await container
      .item(session.id, "session")
      .replace({ ...session, revoked: true, revokedAt: serverNow() });
  } catch {
    /* best effort */
  }
}

/* ------------------------------------------------------------------ */
/* Provisional pre-auth state                                          */
/* ------------------------------------------------------------------ */

/* After the Access Code is verified but BEFORE an account is chosen, the
   server issues a short-lived, opaque provisional token. It only proves
   "a valid access code was entered moments ago" — it carries no identity
   and grants NO access to any protected endpoint. The account is bound
   only when /api/login exchanges this token for a trusted session.

   Properties required by the design:
     - server-issued: created and stored here, never computed client-side
     - short-lived: PROVISIONAL_TTL_MS (default 5 minutes)
     - opaque: 32 random bytes, only its sha256 is stored
     - not forgeable: unforgeable random id + expiry + single-use
     - not a credential: it is NOT a session and is NOT stored in
       localStorage by the client  */
const PROVISIONAL_TTL_MS = 5 * 60 * 1000;
const PROVISIONAL_COOKIE = "oh_preauth";

function provisionalDocId(token) {
  return `provisional:${sha256(token)}`;
}

async function createProvisional() {
  const token = crypto.randomBytes(32).toString("hex");
  const now = serverNow();
  const item = {
    id: provisionalDocId(token),
    type: "provisional",
    createdAt: now,
    expiresAt: now + PROVISIONAL_TTL_MS,
    consumed: false
  };
  await container.items.create(item);
  return { token, expiresAt: item.expiresAt };
}

/* Returns the provisional record when the token is well-formed, unused and
   unexpired; otherwise null. */
async function loadProvisional(token) {
  if (!token || typeof token !== "string" || token.length < 32) return null;
  try {
    const { resource } = await container
      .item(provisionalDocId(token), "provisional")
      .read();
    if (!resource || resource.type !== "provisional") return null;
    if (resource.consumed) return null;
    if (Number(resource.expiresAt) <= serverNow()) return null;
    return resource;
  } catch {
    return null;
  }
}

/* Single-use: mark consumed so the same provisional cannot mint twice. */
async function consumeProvisional(resource) {
  if (!resource) return;
  try {
    await container
      .item(resource.id, "provisional")
      .replace({ ...resource, consumed: true, consumedAt: serverNow() });
  } catch {
    /* best effort */
  }
}

/* ------------------------------------------------------------------ */
/* Cookies + headers                                                   */
/* ------------------------------------------------------------------ */

function parseCookies(request) {
  const raw = request.headers.get("cookie") || "";
  const jar = {};
  raw.split(";").forEach((pair) => {
    const index = pair.indexOf("=");
    if (index < 0) return;
    const key = pair.slice(0, index).trim();
    const value = pair.slice(index + 1).trim();
    if (!key) return;
    try {
      jar[key] = decodeURIComponent(value);
    } catch {
      jar[key] = value;
    }
  });
  return jar;
}

function isSecureRequest(request) {
  try {
    const proto = request.headers.get("x-forwarded-proto");
    if (proto && proto.split(",")[0].trim() === "https") return true;
    if (request.url && new URL(request.url).protocol === "https:") return true;
  } catch {
    /* fall through */
  }
  return false;
}

/* HttpOnly + Secure + SameSite + Path=/

   SameSite policy:
     - Local development loads the frontend from http://127.0.0.1:5500 while
       the API lives on *.azurewebsites.net. That is a CROSS-SITE request, so
       a SameSite=Strict cookie would be dropped by the browser. For allowed
       cross-site origins we therefore send SameSite=None, which browsers
       only accept together with Secure.
     - When the request is effectively same-site (production: the frontend
       is served from the same host, or no cross-site Origin is present) we
       keep the stricter SameSite=Strict.

   The cookie is ALWAYS HttpOnly, so JavaScript can never read or forge it.
   This is what makes claim-based bypass impossible on the client. */
function isCrossSiteRequest(request) {
  const origin = requestOrigin(request);
  if (!origin) return false;
  try {
    const originHost = new URL(origin).hostname;
    const requestHost = request.url ? new URL(request.url).hostname : "";
    // Different host => genuinely cross-site (e.g. localhost -> azure).
    return !!requestHost && originHost !== requestHost;
  } catch {
    return true;
  }
}

function buildSessionCookie(request, sessionId, maxAgeSeconds) {
  const crossSite = isCrossSiteRequest(request);

  const parts = [
    `${SESSION_COOKIE}=${sessionId}`,
    "Path=/",
    "HttpOnly",
    crossSite ? "SameSite=None" : "SameSite=Strict",
    `Max-Age=${Math.max(0, Math.floor(maxAgeSeconds))}`
  ];

  // Secure is mandatory for SameSite=None, and required over HTTPS
  // generally. On a plain-HTTP local API we must omit it or the browser
  // rejects the cookie — hence the explicit check.
  if (crossSite || isSecureRequest(request)) parts.push("Secure");

  return parts.join("; ");
}

function clearSessionCookie(request) {
  return buildSessionCookie(request, "", 0);
}

/* CORS: the browser only accepts a credentialed response when the server
   echoes an EXACT allowed origin AND sends `Access-Control-Allow-Credentials:
   true`. A wildcard `*` is never sent for credentialed requests.

   Origins come from the ALLOWED_ORIGINS application setting (comma
   separated). The production Azure host and the local dev servers used by
   the project are always permitted so development and production share one
   policy. Extra origins can be added without a code change:
       ALLOWED_ORIGINS = https://ourheart.example,http://127.0.0.1:5500

   IMPORTANT (Azure): the Function App platform CORS setting must NOT be
   configured at the same time — the platform injects its own
   `Access-Control-Allow-Origin` which conflicts with these headers. If
   platform CORS is enabled, disable it and let this application-level
   policy be the single source of truth. Platforms that DO handle CORS
   themselves read the same ALLOWED_ORIGINS list below. */
const DEFAULT_ALLOWED_ORIGINS = [
  // Production frontend / API host.
  "https://ourheartfunctions2026.azurewebsites.net",
  // Production frontend on GitHub Pages (the real live site).
  "https://mohamedtarek100.github.io",
  // Local static-server origins commonly used while developing
  // (Live Server / VS Code / http-server).
  "http://127.0.0.1:5500",
  "http://localhost:5500",
  "http://127.0.0.1:5501",
  "http://localhost:5501",
  "http://localhost:8123",
  "http://127.0.0.1:8123"
];

const ALLOWED_ORIGINS = Array.from(
  new Set(
    [
      ...String(process.env.ALLOWED_ORIGINS || "")
        .split(",")
        .map((origin) => origin.trim())
        .filter(Boolean),
      ...DEFAULT_ALLOWED_ORIGINS
    ].map((origin) => origin.replace(/\/$/, ""))
  )
);

function requestOrigin(request) {
  try {
    return request.headers.get("origin") || "";
  } catch {
    return "";
  }
}

function isAllowedOrigin(origin) {
  if (!origin) return false;
  return ALLOWED_ORIGINS.includes(origin.replace(/\/$/, ""));
}

function corsHeaders(request) {
  const origin = requestOrigin(request);

  const headers = {
    // Vary so no cache ever mixes a credentialed response with a plain one.
    Vary: "Origin",
    "Cache-Control": "no-store, no-cache, must-revalidate, private",
    Pragma: "no-cache"
  };

  // Reflect ONLY an exact allow-listed origin. Never "*".
  if (isAllowedOrigin(origin)) {
    headers["Access-Control-Allow-Origin"] = origin;
    headers["Access-Control-Allow-Credentials"] = "true";
    headers["Access-Control-Allow-Methods"] = "GET, POST, DELETE, OPTIONS";
    headers["Access-Control-Allow-Headers"] = "Content-Type, Accept";
    headers["Access-Control-Max-Age"] = "600";
  }

  return headers;
}

/* Defense-in-depth headers for every JSON response. */
function securityHeaders(request) {
  return {
    ...corsHeaders(request),
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "X-Frame-Options": "DENY",
    "Permissions-Policy": "geolocation=(), camera=(), microphone=(self)"
  };
}

/* ------------------------------------------------------------------ */
/* Response helpers                                                    */
/* ------------------------------------------------------------------ */

function json(request, status, jsonBody, extraHeaders = {}) {
  return {
    status,
    headers: { ...securityHeaders(request), ...extraHeaders },
    jsonBody
  };
}

/* 401 — no valid trusted session. */
function unauthorized(request, message = "Authentication required") {
  return json(request, 401, { success: false, error: message, code: "UNAUTHENTICATED" });
}

/* 423 — authenticated but the relationship lock forbids the operation. */
function locked(request, message = "Relationship lock is active") {
  return json(request, 423, { success: false, error: message, code: "RELATIONSHIP_LOCKED" });
}

function badRequest(request, message = "Invalid request") {
  return json(request, 400, { success: false, error: message, code: "BAD_REQUEST" });
}

function serverError(request, context, error, message = "Unexpected error") {
  try {
    context?.error?.("Unhandled error:", error);
  } catch {
    /* ignore */
  }
  // Never leak error internals to the client.
  return json(request, 500, { success: false, error: message, code: "SERVER_ERROR" });
}

/* ------------------------------------------------------------------ */
/* Auth / lock gate used by every protected endpoint                    */
/* ------------------------------------------------------------------ */

/* Resolves the trusted identity from the session cookie only.
   Returns { ok: true, user, session } or { ok: false, response }. */
async function requireSession(request) {
  try {
    const cookies = parseCookies(request);
    const session = await loadSession(cookies[SESSION_COOKIE]);

    if (!session) {
      return { ok: false, response: unauthorized(request) };
    }

    await touchSession(session);
    return { ok: true, user: session.user, session };
  } catch (error) {
    // Fail CLOSED — any failure is treated as unauthenticated.
    return { ok: false, response: unauthorized(request) };
  }
}

/* Full gate: authenticate (trusted session) THEN enforce the lock.
   Chat operations use this. Order is deliberate and matches the spec:
     request -> authenticate session -> derive trusted user
             -> check lock status -> reject if locked -> continue. */
async function requireSessionAndUnlocked(request) {
  const auth = await requireSession(request);
  if (!auth.ok) return auth;

  if (isRelationshipLockEnabled()) {
    return { ok: false, response: locked(request), user: auth.user, session: auth.session };
  }

  return auth;
}

/* ------------------------------------------------------------------ */
/* Presence                                                            */
/* ------------------------------------------------------------------ */

/* How long a heartbeat is considered "still online". A user counts as
   ONLINE when the server has seen activity within this window. This is
   the SINGLE source of truth for online state — never the browser clock,
   and never a client-supplied flag. */
const PRESENCE_ONLINE_WINDOW_MS = 60 * 1000;

/* Deterministic document id — one record per person, so a heartbeat is an
   upsert of the SAME document and can never create duplicates. */
function presenceDocId(user) {
  return `presence:${user}`;
}

/* Records activity for a trusted user. Server time is authoritative.
   Returns the stored record (with the derived online flag). */
async function touchPresence(user, options = {}) {
  const { online = true, status = "" } = options;
  const now = serverNow();

  const item = {
    id: presenceDocId(user),
    type: "presence",
    user,                              // trusted, from the session
    online: !!online,
    lastSeen: now,                     // server timestamp of last activity
    lastActiveAt: now,
    appDate: applicationDate(now),     // application-timezone day
    appTimezone: APP_TIMEZONE,
    status: String(status || ""),
    updatedAt: now
  };

  await container.items.upsert(item);
  return item;
}

/* Server-side view of one person's presence. `online` is DERIVED here
   from heartbeat freshness against server time — a stale record is
   reported offline even if it still says online:true. */
function describePresence(user, record) {
  const now = serverNow();
  const lastSeen = Number(record?.lastSeen) || 0;
  // Online only when the heartbeat is inside the window. A timestamp in the
  // future (clock skew / tampering) is clamped to "not online" rather than
  // being trusted, and writes always use serverNow() anyway.
  const fresh = lastSeen > 0 && lastSeen <= now && (now - lastSeen) <= PRESENCE_ONLINE_WINDOW_MS;

  return {
    user,
    online: !!(record?.online) && fresh,
    lastSeen: lastSeen > 0 ? Math.min(lastSeen, now) : null,
    appDate: record?.appDate || (lastSeen ? applicationDate(lastSeen) : null),
    appTimezone: APP_TIMEZONE,
    // Relative day label computed on the SERVER in the app timezone so the
    // client never has to guess and the device clock cannot change it.
    dayOffset: lastSeen ? applicationDayOffset(lastSeen) : null
  };
}

/* 0 = today, 1 = yesterday, -1 = future/unknown, 2+ = older. */
function applicationDayOffset(epochMs) {
  const today = applicationDate(serverNow());
  const that = applicationDate(epochMs);
  if (today === that) return 0;
  const t = parseApplicationDate(today);
  const d = parseApplicationDate(that);
  if (!t || !d) return 2;
  const tMs = Date.UTC(t.year, t.month - 1, t.day);
  const dMs = Date.UTC(d.year, d.month - 1, d.day);
  const diffDays = Math.round((tMs - dMs) / 86400000);
  if (diffDays === 1) return 1;
  if (diffDays <= 0) return -1;
  return 2;
}

/* Returns a small, safe presence summary for the two known people.
   This is ONLY used behind a valid Access Code (provisional stage) or a
   trusted session — never on a public endpoint. The client can never
   fabricate it: the values come straight from the stored presence docs
   and the online flag is decided by the server. */
async function loadPresenceSummary() {
  const records = new Map();

  try {
    const { resources } = await container.items
      .query("SELECT * FROM c WHERE c.type = 'presence'")
      .fetchAll();
    resources.forEach((item) => {
      if (isKnownUser(item.user)) records.set(item.user, item);
    });
  } catch {
    /* best effort — a missing summary must never break auth */
  }

  return {
    Mohamed: describePresence("Mohamed", records.get("Mohamed")),
    Yomna: describePresence("Yomna", records.get("Yomna")),
    serverTime: serverNow(),
    onlineWindowMs: PRESENCE_ONLINE_WINDOW_MS
  };
}

/* ------------------------------------------------------------------ */
/* Small utility                                                       */
/* ------------------------------------------------------------------ */

/* Accepts only the two trusted identity values; anything else is null. */
function normalizeUser(value) {
  const candidate = String(value || "").trim();
  return isKnownUser(candidate) ? candidate : null;
}

module.exports = {
  container,
  CosmosClient,
  // access code
  ACCESS_CODE_HASH,
  sha256,
  safeEqualHex,
  // users
  USERS,
  isKnownUser,
  otherUser,
  normalizeUser,
  // lock
  isRelationshipLockEnabled,
  // time
  APP_TIMEZONE,
  DEADLINE_ISO,
  DEADLINE_MS,
  serverNow,
  applicationDate,
  parseApplicationDate,
  // questions
  QUESTIONS,
  QUESTION_BY_USER,
  questionForUser,
  optionFor,
  // sessions
  SESSION_COOKIE,
  sessionTtlMs,
  createSession,
  loadSession,
  revokeSession,
  // provisional pre-auth state
  PROVISIONAL_TTL_MS,
  PROVISIONAL_COOKIE,
  createProvisional,
  loadProvisional,
  consumeProvisional,
  parseCookies,
  buildSessionCookie,
  clearSessionCookie,
  // http
  securityHeaders,
  corsHeaders,
  isAllowedOrigin,
  // presence
  PRESENCE_ONLINE_WINDOW_MS,
  touchPresence,
  describePresence,
  loadPresenceSummary,
  json,
  unauthorized,
  locked,
  badRequest,
  serverError,
  requireSession,
  requireSessionAndUnlocked
};
