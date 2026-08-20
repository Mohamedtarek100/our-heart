const { app } = require("@azure/functions");
const { CosmosClient } = require("@azure/cosmos");

const client = new CosmosClient({
  endpoint: process.env.COSMOS_ENDPOINT,
  key: process.env.COSMOS_KEY
});

const database = client.database(process.env.COSMOS_DATABASE);
const container = database.container(process.env.COSMOS_CONTAINER);

// GET: آخر 30 رسالة
app.http("getChat", {
  methods: ["GET"],
  authLevel: "anonymous",

  handler: async (request, context) => {
    try {
      const querySpec = {
        query: `
          SELECT TOP 30 *
          FROM c
          WHERE c.type = "chat"
          ORDER BY c.time DESC
        `
      };

      const { resources } = await container.items
        .query(querySpec)
        .fetchAll();

      // نرجع الرسائل من الأقدم للأحدث
      resources.reverse();

      return {
        status: 200,
        jsonBody: resources
      };

    } catch (error) {
      context.error("Get chat error:", error);

      return {
        status: 500,
        jsonBody: {
          success: false,
          error: error.message
        }
      };
    }
  }
});

// POST: إضافة رسالة
app.http("sendChat", {
  methods: ["POST"],
  authLevel: "anonymous",

  handler: async (request, context) => {
    try {
      const body = await request.json();

      // لازم يكون فيه sender
      if (!body.sender) {
        return {
          status: 400,
          jsonBody: {
            success: false,
            error: "sender is required"
          }
        };
      }

      // لازم يكون فيه نص أو voiceUrl
      if (!body.text && !body.voiceUrl) {
        return {
          status: 400,
          jsonBody: {
            success: false,
            error: "text or voiceUrl is required"
          }
        };
      }

      const item = {
        id: crypto.randomUUID(),
        type: "chat",
        sender: body.sender,
        text: body.text || "",
        voiceUrl: body.voiceUrl || "",
        time: Date.now(),
        status: "delivered",
        seen: false,
        reaction: "",
        ...(body.replyToMessageId ? {
          replyToMessageId: String(body.replyToMessageId),
          replyToSender: String(body.replyToSender || "Unknown"),
          replyToText: String(body.replyToText || ""),
          replyToType: body.replyToType === "voice" ? "voice" : "text",
          replyToVoice: !!body.replyToVoice
        } : {})
      };

      await container.items.create(item);

      return {
        status: 201,
        jsonBody: {
          success: true,
          message: item
        }
      };

    } catch (error) {
      context.error("Send chat error:", error);

      return {
        status: 500,
        jsonBody: {
          success: false,
          error: error.message
        }
      };
    }
  }
});

// POST: mark messages from the other user as seen
app.http("markSeen", {
  methods: ["POST"],
  authLevel: "anonymous",

  handler: async (request, context) => {
    try {
      const body = await request.json();
      const user = String(body.user || "").trim();

      if (!user) {
        return {
          status: 400,
          jsonBody: {
            success: false,
            error: "user is required"
          }
        };
      }

      const { resources } = await container.items.query({
        query: "SELECT * FROM c WHERE c.type = 'chat' AND c.sender != @user AND (NOT IS_DEFINED(c.seen) OR c.seen = false)",
        parameters: [{ name: "@user", value: user }]
      }).fetchAll();

      const messageIds = [];
      await Promise.all(resources.map(async (message) => {
        message.seen = true;
        message.seenAt = Date.now();
        await container.item(String(message.id), "chat").replace(message);
        messageIds.push(String(message.id));
      }));

      return {
        status: 200,
        jsonBody: {
          success: true,
          messageIds
        }
      };
    } catch (error) {
      context.error("Mark seen error:", error);

      return {
        status: 500,
        jsonBody: {
          success: false,
          error: error.message
        }
      };
    }
  }
});