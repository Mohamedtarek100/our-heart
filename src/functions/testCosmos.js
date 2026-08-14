const { app } = require("@azure/functions");
const { CosmosClient } = require("@azure/cosmos");

const client = new CosmosClient({
  endpoint: process.env.COSMOS_ENDPOINT,
  key: process.env.COSMOS_KEY
});

const database = client.database(process.env.COSMOS_DATABASE);
const container = database.container(process.env.COSMOS_CONTAINER);

app.http("testCosmos", {
  methods: ["GET"],
  authLevel: "anonymous",

  handler: async (request, context) => {
    try {
      const testItem = {
        id: "test-connection",
        type: "test",
        message: "Cosmos connection works",
        time: Date.now()
      };

      await container.items.upsert(testItem);

      const { resource } = await container
        .item("test-connection", "test")
        .read();

      return {
        status: 200,
        jsonBody: {
          success: true,
          message: "Cosmos DB connection works",
          item: resource
        }
      };

    } catch (error) {
      context.error("Cosmos error:", error);

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