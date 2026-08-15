const { app } = require("@azure/functions");
const { CosmosClient } = require("@azure/cosmos");

const client = new CosmosClient({
  endpoint: process.env.COSMOS_ENDPOINT,
  key: process.env.COSMOS_KEY
});

const database = client.database(process.env.COSMOS_DATABASE);
const container = database.container(process.env.COSMOS_CONTAINER);

const KNOWN_USERS = ["Mohamed", "Yomna"];
const KNOWN_PERSONS = ["mohamed", "yomna"];

app.http("setPresence", {
  methods: ["POST"],
  authLevel: "anonymous",

  handler: async (request, context) => {
    try {
      const body = await request.json();

      if (!body.user) {
        return {
          status: 400,
          jsonBody: {
            success: false,
            error: "user is required"
          }
        };
      }

      const now = Date.now();
      const user = String(body.user);

      const item = {
        id: `presence:${user}`,
        type: "presence",
        user,
        online: body.online !== undefined ? !!body.online : true,
        lastSeen: typeof body.lastSeen === "number" ? body.lastSeen : now,
        updatedAt: now
      };

      await container.items.upsert(item);

      return {
        status: 200,
        jsonBody: {
          success: true,
          presence: item
        }
      };
    } catch (error) {
      context.error("Set presence error:", error);

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

app.http("setTyping", {
  methods: ["POST"],
  authLevel: "anonymous",

  handler: async (request, context) => {
    try {
      const body = await request.json();

      if (!body.user) {
        return {
          status: 400,
          jsonBody: {
            success: false,
            error: "user is required"
          }
        };
      }

      if (body.typing === undefined) {
        return {
          status: 400,
          jsonBody: {
            success: false,
            error: "typing is required"
          }
        };
      }

      const item = {
        id: `typing:${body.user}`,
        type: "typing",
        user: String(body.user),
        typing: !!body.typing,
        updatedAt: Date.now()
      };

      await container.items.upsert(item);

      return {
        status: 200,
        jsonBody: {
          success: true,
          typing: item
        }
      };
    } catch (error) {
      context.error("Set typing error:", error);

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

app.http("setStatus", {
  methods: ["POST"],
  authLevel: "anonymous",

  handler: async (request, context) => {
    try {
      const body = await request.json();

      if (!body.person) {
        return {
          status: 400,
          jsonBody: {
            success: false,
            error: "person is required"
          }
        };
      }

      if (!body.status) {
        return {
          status: 400,
          jsonBody: {
            success: false,
            error: "status is required"
          }
        };
      }

      const person = String(body.person).toLowerCase();
      const item = {
        id: `status:${person}`,
        type: "status",
        person,
        status: String(body.status),
        time: body.time || new Date().toLocaleString(),
        updatedAt: Date.now()
      };

      await container.items.upsert(item);

      return {
        status: 200,
        jsonBody: {
          success: true,
          status: item
        }
      };
    } catch (error) {
      context.error("Set status error:", error);

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

app.http("getPresence", {
  methods: ["GET"],
  authLevel: "anonymous",

  handler: async (request, context) => {
    try {
      const usersParam = request.query.get("users");
      const personsParam = request.query.get("persons");

      const users = usersParam
        ? usersParam.split(",").map((x) => x.trim()).filter(Boolean)
        : KNOWN_USERS;

      const persons = personsParam
        ? personsParam.split(",").map((x) => x.trim().toLowerCase()).filter(Boolean)
        : KNOWN_PERSONS;

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
        presence[item.user] = {
          online: !!item.online,
          lastSeen: item.lastSeen || 0,
          updatedAt: item.updatedAt || 0
        };
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
        jsonBody: {
          success: true,
          presence,
          typing,
          status
        }
      };
    } catch (error) {
      context.error("Get presence error:", error);

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

app.http("reactMessage", {
  methods: ["POST"],
  authLevel: "anonymous",

  handler: async (request, context) => {
    try {
      const body = await request.json();

      if (!body.messageId) {
        return {
          status: 400,
          jsonBody: {
            success: false,
            error: "messageId is required"
          }
        };
      }

      if (body.emoji === undefined) {
        return {
          status: 400,
          jsonBody: {
            success: false,
            error: "emoji is required"
          }
        };
      }

      const { resource } = await container.item(String(body.messageId), "chat").read();

      if (!resource) {
        return {
          status: 404,
          jsonBody: {
            success: false,
            error: "message not found"
          }
        };
      }

      resource.reaction = String(body.emoji);
      resource.reactionUpdatedAt = Date.now();

      const { resource: updated } = await container.item(String(body.messageId), "chat").replace(resource);

      return {
        status: 200,
        jsonBody: {
          success: true,
          message: updated
        }
      };
    } catch (error) {
      context.error("React message error:", error);

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
