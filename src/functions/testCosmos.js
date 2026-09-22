const { app } = require("@azure/functions");
const { CosmosClient } = require("@azure/cosmos");
const { requireSession, json, corsHeaders } = require("./shared");

const client = new CosmosClient({
  endpoint: process.env.COSMOS_ENDPOINT,
  key: process.env.COSMOS_KEY
});

const database = client.database(process.env.COSMOS_DATABASE);
const container = database.container(process.env.COSMOS_CONTAINER);

/* Diagnostics endpoint — DISABLED BY DEFAULT in production.
   It performs a Cosmos write/upsert, so it must never be publicly
   callable. Two independent controls protect it:
     1) ENABLE_TEST_COSMOS must be exactly "true" (default: off), and
     2) the caller must hold a trusted session.
   When disabled it simply reports 404 so it is not discoverable. */
function isTestCosmosEnabled() {
  return String(process.env.ENABLE_TEST_COSMOS || "").trim().toLowerCase() === "true";
}

app.http("testCosmos", {
  methods: ["GET", "OPTIONS"],
  authLevel: "anonymous",

  handler: async (request, context) => {
    if (request.method === "OPTIONS") {
      return { status: 204, headers: corsHeaders(request) };
    }

    // Control 1: disabled unless explicitly enabled for diagnostics.
    if (!isTestCosmosEnabled()) {
      return json(request, 404, { success: false, error: "Not found" });
    }

    // Control 2: authenticated callers only.
    const auth = await requireSession(request);
    if (!auth.ok) return auth.response;

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

      // Never expose database internals — only a boolean result.
      return json(request, 200, {
        success: true,
        message: "Cosmos DB connection works",
        ok: !!resource
      });

    } catch (error) {
      context.error("Cosmos error:", error);

      return json(request, 500, {
        success: false,
        error: "Cosmos check failed"
      });
    }
  }
});