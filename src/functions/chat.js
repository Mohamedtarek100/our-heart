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
        reaction: ""
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