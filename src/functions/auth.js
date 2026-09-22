/* ============================================================
   Our Heart — Authentication + session + lock gate endpoints
   ------------------------------------------------------------
   POST /api/login    — verify the Access Code SERVER-SIDE, create a
                        trusted HttpOnly session bound to a chosen user.
   POST /api/logout   — revoke the server session + clear the cookie.
   GET  /api/session  — report the current trust + lock state. This is
                        the ONLY endpoint the frontend may call before
                        trust is established.
   OPTIONS           — CORS preflight for the two POST endpoints.

   Hardening:
   - The Access Code is never present in the browser; only its SHA-256
     exists here.
   - Constant-time hash compare.
   - Per-IP sliding-window rate limit + exponential backoff on failures.
   - Generic error messages (no credential leakage, no user enumeration).
   ============================================================ */

const { app } = require("@azure/functions");
const {
  container,
  ACCESS_CODE_HASH,
  sha256,
  safeEqualHex,
  isKnownUser,
  isRelationshipLockEnabled,
  APP_TIMEZONE,
  DEADLINE_ISO,
  DEADLINE_MS,
  serverNow,
  applicationDate,
  QUESTIONS,
  QUESTION_BY_USER,
  createSession,
  sessionTtlMs,
  buildSessionCookie,
  clearSessionCookie,
  parseCookies,
  SESSION_COOKIE,
  loadSession,
  revokeSession,
  createProvisional,
  loadProvisional,
  consumeProvisional,
  loadPresenceSummary,
  json,
  badRequest,
  serverError,
  corsHeaders
} = require("./shared");

/* ------------------------------------------------------------------ */
/* Brute-force protection                                              */
/* ------------------------------------------------------------------ */

const WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const MAX_ATTEMPTS = 8;           // per IP per window
const MAX_BACKOFF_MS = 60 * 1000; // cap the lockout growth

function clientIp(request) {
  try {
    const forwarded = request.headers.get("x-forwarded-for");
    if (forwarded) return forwarded.split(",")[0].trim();
    return request.headers.get("x-azure-clientip") || "unknown";
  } catch {
    return "unknown";
  }
}

function attemptId(ip) {
  // Hash the IP so we never store the raw address.
  return `authattempt:${sha256(ip).slice(0, 32)}`;
}

async function readAttempts(ip) {
  try {
    const { resource } = await container.item(attemptId(ip), "auth").read();
    if (!resource || resource.type !== "authattempt") return null;
    return resource;
  } catch {
    return null;
  }
}

async function registerFailure(ip) {
  const now = serverNow();
  const existing = await readAttempts(ip);
  const windowStart =
    existing && now - Number(existing.windowStart || 0) < WINDOW_MS
      ? Number(existing.windowStart)
      : now;
  const count =
    (existing && Number(existing.windowStart) === windowStart
      ? Number(existing.count) || 0
      : 0) + 1;

  // Exponential backoff: 0,1,2,4,8,... capped.
  const backoffMs = Math.min(MAX_BACKOFF_MS, count <= 1 ? 0 : 1000 * 2 ** (count - 2));

  const item = {
    id: attemptId(ip),
    type: "authattempt",
    windowStart,
    count,
    blockedUntil: now + backoffMs,
    updatedAt: now
  };

  try {
    await container.items.upsert(item);
  } catch {
    /* best effort */
  }

  return item;
}

async function clearFailures(ip) {
  try {
    await container.item(attemptId(ip), "auth").delete();
  } catch {
    /* best effort */
  }
}

/* ------------------------------------------------------------------ */
/* Shared state payload                                                */
/* ------------------------------------------------------------------ */

function buildState(user) {
  const lockEnabled = isRelationshipLockEnabled();
  const now = serverNow();

  const state = {
    success: true,
    serverTime: now,
    lockEnabled,
    authenticated: !!user,
    user: user || null,
    appTimezone: APP_TIMEZONE,
    // Server-authoritative countdown deadline (absolute instant).
    deadlineIso: DEADLINE_ISO,
    deadlineMs: Number.isFinite(DEADLINE_MS) ? DEADLINE_MS : null,
    currentDate: applicationDate(now)
  };

  if (user) {
    const questionId = QUESTION_BY_USER[user] || null;
    state.questionId = questionId;
    // The client is told WHICH question it owns, but never chooses it.
    state.questions = Object.values(QUESTIONS).map((question) => ({
      id: question.id,
      prompt: question.prompt,
      ownedByCurrentUser: question.id === questionId,
      options: question.options.map((option) => ({
        id: option.id,
        label: option.label
      }))
    }));
  }

  return state;
}

/* ------------------------------------------------------------------ */
/* POST /api/verify-code                                               */
/* ------------------------------------------------------------------ */

/* STAGE 1 of authentication.

   Verifies the Access Code server-side and, on success, returns a
   short-lived OPAQUE provisional token. It does NOT create a session and
   does NOT grant access to any protected endpoint — it only permits the
   client to proceed to the account-selection step. Account choice is
   therefore impossible before the code has been validated.

   The token is single-use and expires in PROVISIONAL_TTL_MS. The client
   keeps it in memory only (never localStorage). */
app.http("verifyCode", {
  methods: ["POST", "OPTIONS"],
  authLevel: "anonymous",
  route: "verify-code",

  handler: async (request, context) => {
    if (request.method === "OPTIONS") {
      return { status: 204, headers: corsHeaders(request) };
    }

    try {
      const ip = clientIp(request);

      // Throttle before touching the credential.
      const attempts = await readAttempts(ip);
      if (attempts && Number(attempts.blockedUntil) > serverNow()) {
        const retryAfterSeconds = Math.ceil(
          (Number(attempts.blockedUntil) - serverNow()) / 1000
        );
        return json(
          request,
          429,
          {
            success: false,
            error: "Too many attempts. Please wait and try again.",
            code: "RATE_LIMITED",
            retryAfterSeconds
          },
          { "Retry-After": String(Math.max(1, retryAfterSeconds)) }
        );
      }

      if (attempts && Number(attempts.count) >= MAX_ATTEMPTS &&
        serverNow() - Number(attempts.windowStart) < WINDOW_MS) {
        return json(
          request,
          429,
          {
            success: false,
            error: "Too many attempts. Please wait and try again.",
            code: "RATE_LIMITED",
            retryAfterSeconds: Math.ceil(WINDOW_MS / 1000)
          },
          { "Retry-After": String(Math.ceil(WINDOW_MS / 1000)) }
        );
      }

      let body;
      try {
        body = await request.json();
      } catch {
        return badRequest(request, "Invalid request body");
      }

      const code = String(body?.code || "");
      if (!code) {
        return badRequest(request, "Access code is required");
      }

      // Constant-time compare against the server-side hash.
      const matches = safeEqualHex(sha256(code), ACCESS_CODE_HASH);

      if (!matches) {
        await registerFailure(ip);
        return json(request, 401, {
          success: false,
          error: "Incorrect access code.",
          code: "INVALID_CREDENTIALS"
        });
      }

      // Valid code: reset throttling and hand back the provisional token.
      // We also include a small presence summary for the account picker —
      // this is only reachable AFTER the shared Access Code is proven, and
      // the values come from the server, never the client.
      await clearFailures(ip);
      const provisional = await createProvisional();
      const presence = await loadPresenceSummary();

      return json(request, 200, {
        success: true,
        codeVerified: true,
        // Opaque, single-use, short-lived. Grants NO access on its own.
        provisional: provisional.token,
        provisionalExpiresAt: provisional.expiresAt,
        presence,
        serverTime: serverNow()
      });
    } catch (error) {
      return serverError(request, context, error, "Unable to verify access right now");
    }
  }
});

/* ------------------------------------------------------------------ */
/* POST /api/login                                                     */
/* ------------------------------------------------------------------ */

/* STAGE 2 of authentication.

   Creates the trusted session. Accepts EITHER:
     - { provisional, user }  (preferred: code already verified in stage 1)
     - { code, user }         (back-compat: verifies the code inline)

   Either way the identity is only bound AFTER the access code has been
   proven valid, and the resulting session is authoritative on the server. */
app.http("login", {
  methods: ["POST", "OPTIONS"],
  authLevel: "anonymous",
  route: "login",

  handler: async (request, context) => {
    if (request.method === "OPTIONS") {
      return { status: 204, headers: corsHeaders(request) };
    }

    try {
      const ip = clientIp(request);

      // 1) Throttle check BEFORE touching credentials.
      const attempts = await readAttempts(ip);
      if (attempts && Number(attempts.blockedUntil) > serverNow()) {
        const retryAfterSeconds = Math.ceil(
          (Number(attempts.blockedUntil) - serverNow()) / 1000
        );
        return json(
          request,
          429,
          {
            success: false,
            error: "Too many attempts. Please wait and try again.",
            code: "RATE_LIMITED",
            retryAfterSeconds
          },
          { "Retry-After": String(Math.max(1, retryAfterSeconds)) }
        );
      }

      if (attempts && Number(attempts.count) >= MAX_ATTEMPTS &&
        serverNow() - Number(attempts.windowStart) < WINDOW_MS) {
        return json(
          request,
          429,
          {
            success: false,
            error: "Too many attempts. Please wait and try again.",
            code: "RATE_LIMITED",
            retryAfterSeconds: Math.ceil(WINDOW_MS / 1000)
          },
          { "Retry-After": String(Math.ceil(WINDOW_MS / 1000)) }
        );
      }

      // 2) Parse + validate the request.
      let body;
      try {
        body = await request.json();
      } catch {
        return badRequest(request, "Invalid request body");
      }

      const requestedUser = String(body?.user || "").trim();
      const provisionalToken = String(body?.provisional || "").trim();
      const code = String(body?.code || "");

      // The chosen identity must be one of the two known people; anything
      // else is silently rejected (no enumeration, no unknown account).
      if (!isKnownUser(requestedUser)) {
        return badRequest(request, "Unknown account");
      }

      // 3) Prove the access code was valid — via the single-use provisional
      //    token (preferred) or an inline code (back-compat).
      let codeProven = false;
      let provisionalRecord = null;

      if (provisionalToken) {
        provisionalRecord = await loadProvisional(provisionalToken);
        codeProven = !!provisionalRecord;
      } else if (code) {
        codeProven = safeEqualHex(sha256(code), ACCESS_CODE_HASH);
      }

      if (!codeProven) {
        await registerFailure(ip);
        return json(request, 401, {
          success: false,
          error: "Incorrect access code.",
          code: provisionalToken ? "INVALID_PROVISIONAL" : "INVALID_CREDENTIALS"
        });
      }

      // 4) Success: burn the provisional (single-use), reset throttling and
      //    create the trusted session bound to the chosen account.
      if (provisionalRecord) await consumeProvisional(provisionalRecord);
      await clearFailures(ip);

      const { sessionId } = await createSession(requestedUser);

      const cookie = buildSessionCookie(
        request,
        sessionId,
        Math.floor(sessionTtlMs() / 1000)
      );

      return json(request, 200, buildState(requestedUser), {
        "Set-Cookie": cookie
      });
    } catch (error) {
      return serverError(request, context, error, "Unable to sign in right now");
    }
  }
});

/* ------------------------------------------------------------------ */
/* POST /api/logout                                                    */
/* ------------------------------------------------------------------ */

app.http("logout", {
  methods: ["POST", "OPTIONS"],
  authLevel: "anonymous",
  route: "logout",

  handler: async (request, context) => {
    if (request.method === "OPTIONS") {
      return { status: 204, headers: corsHeaders(request) };
    }

    try {
      const cookies = parseCookies(request);
      const session = await loadSession(cookies[SESSION_COOKIE]);

      // Revoke server-side FIRST so a copied cookie is dead immediately.
      if (session) await revokeSession(session);

      return json(
        request,
        200,
        {
          success: true,
          authenticated: false,
          user: null,
          lockEnabled: isRelationshipLockEnabled(),
          serverTime: serverNow(),
          currentDate: applicationDate(serverNow())
        },
        { "Set-Cookie": clearSessionCookie(request) }
      );
    } catch (error) {
      return serverError(request, context, error, "Unable to sign out right now");
    }
  }
});

/* ------------------------------------------------------------------ */
/* GET /api/session                                                    */
/* ------------------------------------------------------------------ */

/* Reports trust + lock without exposing any private data. This endpoint
   is deliberately safe to call while unauthenticated, and it NEVER
   reveals chat content, partner data, or answers. */
app.http("session", {
  methods: ["GET", "OPTIONS"],
  authLevel: "anonymous",
  route: "session",

  handler: async (request, context) => {
    if (request.method === "OPTIONS") {
      return { status: 204, headers: corsHeaders(request) };
    }

    try {
      const cookies = parseCookies(request);
      const session = await loadSession(cookies[SESSION_COOKIE]);
      const user = session ? session.user : null;

      // An expired/revoked cookie is cleared so the browser stops sending
      // a dead token.
      const headers = user
        ? {}
        : { "Set-Cookie": clearSessionCookie(request) };

      return json(request, 200, buildState(user), headers);
    } catch (error) {
      // Fail CLOSED: on any error report "not authenticated" and keep the
      // lock state as configured rather than guessing.
      try {
        context?.error?.("Session check failed:", error);
      } catch {
        /* ignore */
      }
      return json(
        request,
        200,
        {
          success: false,
          authenticated: false,
          user: null,
          lockEnabled: true,
          serverTime: serverNow(),
          appTimezone: APP_TIMEZONE,
          deadlineIso: DEADLINE_ISO,
          deadlineMs: Number.isFinite(DEADLINE_MS) ? DEADLINE_MS : null
        },
        { "Set-Cookie": clearSessionCookie(request) }
      );
    }
  }
});