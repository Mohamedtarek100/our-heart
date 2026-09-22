const { app } = require("@azure/functions");
const {
  container,
  requireSession,
  requireSessionAndUnlocked,
  touchPresence,
  describePresence,
  loadPresenceSummary,
  serverError,
  corsHeaders
} = require("./shared");

const KNOWN_USERS = ["Mohamed", "Yomna"];
const KNOWN_PERSONS = ["mohamed", "yomna"];

/* Presence rules, split by purpose:

   - HEARTBEAT (setPresence) requires a trusted session but is ALLOWED while
     the Relationship Lock is enabled, because presence is PART OF the locked
     experience (it shows on the account picker and the lock screen). Blocking
     it would make "Last seen" permanently freeze.
   - The chat-family operations (typing / reactions) remain gated behind the
     lock, exactly as before.
   - Reads (getPresence) require a trusted session and are also allowed while
     locked, since the lock screen legitimately displays the partner's state.

   Identity is ALWAYS taken from the trusted session — never from
   body.user / body.person / any client-supplied identity. */

/* --- HEARTBEAT ---------------------------------------------------- */
app.http("setPresence", {
  methods: ["POST", "OPTIONS"],
  authLevel: "anonymous",

  handler: async (request, context) => {
    if (request.method === "OPTIONS") {
      return { status: 204, headers: corsHeaders(request) };
    }

    // Trusted session required; NOT gated by the lock on purpose.
    const gate = await requireSession(request);
    if (!gate.ok) return gate.response;

    try {
      const body = await request.json().catch(() => ({}));

      // The client may only say "I am online" / "I am leaving" and give a
      // short status label. lastSeen is ALWAYS the server's own clock.
      const item = await touchPresence(gate.user, {
        online: body.online !== undefined ? !!body.online : true,
        status: body.status
      });

      return {
        status: 200,
        headers: corsHeaders(request),
        jsonBody: {
          success: true,
          presence: describePresence(gate.user, item),
          serverTime: item.updatedAt
        }
      };
    } catch (error) {
      return serverError(request, context, error, "Unable to update presence");
    }
  }
});

/* --- PRESENCE READ (for the lock screen & account picker) ---------- */
app.http("getPresenceSummary", {
  methods: ["GET", "OPTIONS"],
  authLevel: "anonymous",

  handler: async (request, context) => {
    if (request.method === "OPTIONS") {
      return { status: 204, headers: corsHeaders(request) };
    }

    const gate = await requireSession(request);
    if (!gate.ok) return gate.response;

    try {
      const summary = await loadPresenceSummary();
      return {
        status: 200,
        headers: corsHeaders(request),
        jsonBody: { success: true, ...summary }
      };
    } catch (error) {
      return serverError(request, context, error, "Unable to load presence");
    }
  }
});

app.http("setTyping", {
  methods: ["POST", "OPTIONS"],
  authLevel: "anonymous",

  handler: async (request, context) => {
    if (request.method === "OPTIONS") {
      return { status: 204, headers: corsHeaders(request) };
    }

    const gate = await requireSessionAndUnlocked(request);
    if (!gate.ok) return gate.response;

    try {
      const body = await request.json().catch(() => ({}));

      if (body.typing === undefined) {
        return {
          status: 400,
          jsonBody: { success: false, error: "typing is required" }
        };
      }

      const user = gate.user;

      const item = {
        id: `typing:${user}`,
        type: "typing",
        user,
        typing: !!body.typing,
        updatedAt: Date.now()
      };

      await container.items.upsert(item);

      return {
        status: 200,
        headers: corsHeaders(request),
        jsonBody: {
          success: true,
          typing: item
        }
      };
    } catch (error) {
      return serverError(request, context, error, "Unable to update typing");
    }
  }
});

app.http("setStatus", {
  methods: ["POST", "OPTIONS"],
  authLevel: "anonymous",

  handler: async (request, context) => {
    if (request.method === "OPTIONS") {
      return { status: 204, headers: corsHeaders(request) };
    }

    const gate = await requireSessionAndUnlocked(request);
    if (!gate.ok) return gate.response;

    try {
      const body = await request.json().catch(() => ({}));

      if (!body.status) {
        return {
          status: 400,
          jsonBody: { success: false, error: "status is required" }
        };
      }

      // The person whose status is written is derived from the session,
      // so a client can never overwrite the other person's status.
      const person = String(gate.user).toLowerCase();

      const item = {
        id: `status:${person}`,
        type: "status",
        person,
        status: String(body.status),
        time: new Date().toLocaleString(),
        updatedAt: Date.now()
      };

      await container.items.upsert(item);

      return {
        status: 200,
        headers: corsHeaders(request),
        jsonBody: {
          success: true,
          status: item
        }
      };
    } catch (error) {
      return serverError(request, context, error, "Unable to update status");
    }
  }
});

app.http("getPresence", {
  methods: ["GET", "OPTIONS"],
  authLevel: "anonymous",

  handler: async (request, context) => {
    if (request.method === "OPTIONS") {
      return { status: 204, headers: corsHeaders(request) };
    }

    const gate = await requireSessionAndUnlocked(request);
    if (!gate.ok) return gate.response;

    try {
      // The known-user set is fixed by the server; client query values for
      // arbitrary users/persons are ignored so presence cannot be probed.
      const users = KNOWN_USERS;
      const persons = KNOWN_PERSONS;

      const [presenceResult, typingResult, statusResult] = await Promise.all([
        container.items.query({
          query: "SELECT * FROM c WHERE c.type = 'presence' AND ARRAY_CONTAINS(@users, c.user)",
          parameters: [{ name: "@users", value: users }]
        }).fetchAll(),
        container.items.query({
          query: "SELECT * FROM c WHERE c.type = 'typing' AND ARRAY_CONTAINS(@users, c.user)",
          parameters: [{ name: "@users", value: users }]
        }).fetchAll(),
        container.items.query({
          query: "SELECT * FROM c WHERE c.type = 'status' AND ARRAY_CONTAINS(@persons, c.person)",
          parameters: [{ name: "@persons", value: persons }]
        }).fetchAll()
      ]);

      const presence = {};
      const typing = {};
      const status = {};

      presenceResult.resources.forEach((item) => {
        // Use the SAME server-derived online rule as everywhere else, so a
        // stale document never reports as online.
        presence[item.user] = describePresence(item.user, item);
      });

      typingResult.resources.forEach((item) => {
        typing[item.user] = {
          typing: !!item.typing,
          updatedAt: item.updatedAt || 0
        };
      });

      statusResult.resources.forEach((item) => {
        status[item.person] = {
          status: item.status || "",
          time: item.time || "",
          updatedAt: item.updatedAt || 0
        };
      });

      return {
        status: 200,
        headers: corsHeaders(request),
        jsonBody: {
          success: true,
          presence,
          typing,
          status
        }
      };
    } catch (error) {
      return serverError(request, context, error, "Unable to load presence");
    }
  }
});

app.http("reactMessage", {
  methods: ["POST", "OPTIONS"],
  authLevel: "anonymous",

  handler: async (request, context) => {
    if (request.method === "OPTIONS") {
      return { status: 204, headers: corsHeaders(request) };
    }

    const gate = await requireSessionAndUnlocked(request);
    if (!gate.ok) return gate.response;

    try {
      const body = await request.json().catch(() => ({}));

      if (!body.messageId) {
        return {
          status: 400,
          jsonBody: { success: false, error: "messageId is required" }
        };
      }

      if (body.emoji === undefined) {
        return {
          status: 400,
          jsonBody: { success: false, error: "emoji is required" }
        };
      }

      const { resource } = await container.item(String(body.messageId), "chat").read();

      if (!resource) {
        return {
          status: 404,
          jsonBody: { success: false, error: "message not found" }
        };
      }

      resource.reaction = String(body.emoji);
      resource.reactionUpdatedAt = Date.now();
      // Record WHO reacted, derived from the session (never the body).
      resource.reactionBy = gate.user;

      const { resource: updated } = await container.item(String(body.messageId), "chat").replace(resource);

      return {
        status: 200,
        headers: corsHeaders(request),
        jsonBody: {
          success: true,
          message: updated
        }
      };
    } catch (error) {
      return serverError(request, context, error, "Unable to react to message");
    }
  }
});
