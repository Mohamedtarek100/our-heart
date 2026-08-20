const { app } = require("@azure/functions");
const { CosmosClient } = require("@azure/cosmos");

const client = new CosmosClient({
  endpoint: process.env.COSMOS_ENDPOINT,
  key: process.env.COSMOS_KEY
});

const database = client.database(process.env.COSMOS_DATABASE);
const container = database.container(process.env.COSMOS_CONTAINER);

app.http("deleteChat", {
  methods: ["DELETE"],
  authLevel: "anonymous",

  handler: async (request, context) => {
    try {
      const body = await request.json();
      const messageId = String(body.messageId || "").trim();
      const user = String(body.user || body.sender || "").trim();

      if (!messageId) {
        return {
          status: 400,
          jsonBody: {
            success: false,
            error: "messageId is required"
          }
        };
      }

      if (!user) {
        return {
          status: 400,
          jsonBody: {
            success: false,
            error: "user is required"
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
      context.error("Delete chat error:", error);

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
