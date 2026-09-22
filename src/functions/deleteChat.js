const { app } = require("@azure/functions");
const {
  container,
  requireSessionAndUnlocked,
  serverError,
  corsHeaders
} = require("./shared");

/* Delete is part of the locked chat experience.
   Secure flow:
     request
     → require trusted session
     → derive current user server-side
     → load target message
     → validate ownership
     → check relationship lock (requireSessionAndUnlocked)
     → authorize
     → execute
   The client can never supply the identity used for the ownership check. */
app.http("deleteChat", {
  methods: ["DELETE", "OPTIONS"],
  authLevel: "anonymous",

  handler: async (request, context) => {
    if (request.method === "OPTIONS") {
      return { status: 204, headers: corsHeaders(request) };
    }

    const gate = await requireSessionAndUnlocked(request);
    if (!gate.ok) return gate.response;

    try {
      const body = await request.json().catch(() => ({}));
      const messageId = String(body.messageId || "").trim();
      // Ownership identity ALWAYS comes from the trusted session.
      const user = gate.user;

      if (!messageId) {
        return {
          status: 400,
          jsonBody: {
            success: false,
            error: "messageId is required"
          }
        };
      }

      const { resource: message } = await container.item(messageId, "chat").read();

      if (!message) {
        return {
          status: 404,
          jsonBody: {
            success: false,
            error: "message not found"
          }
        };
      }

      if (String(message.sender || "") !== user) {
        return {
          status: 403,
          jsonBody: {
            success: false,
            error: "you can only delete your own messages"
          }
        };
      }

      await container.item(messageId, "chat").delete();

      return {
        status: 200,
        jsonBody: {
          success: true,
          messageId
        }
      };
    } catch (error) {
      return serverError(request, context, error, "Unable to delete message");
    }
  }
});
