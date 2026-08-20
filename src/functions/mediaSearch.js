const { app } = require("@azure/functions");

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "*"
};

app.http("mediaSearch", {
  methods: ["GET"],
  authLevel: "anonymous",
  handler: async (request, context) => {
    const type = String(request.query.get("type") || "").trim();
    const query = String(request.query.get("q") || "").trim().slice(0, 80);
    const apiKey = process.env.GIPHY_API_KEY;

    if (!apiKey) {
      return {
        status: 503,
        headers: corsHeaders,
        jsonBody: { success: false, error: "Media search is not configured" }
      };
    }

    if (!["sticker", "gif"].includes(type) || !query) {
      return {
        status: 400,
        headers: corsHeaders,
        jsonBody: { success: false, error: "type and q are required" }
      };
    }

    try {
      const endpoint = type === "sticker" ? "stickers" : "gifs";
      const url = new URL(`https://api.giphy.com/v1/${endpoint}/search`);
      url.searchParams.set("api_key", apiKey);
      url.searchParams.set("q", query);
      url.searchParams.set("limit", "18");
      url.searchParams.set("rating", "pg");
      url.searchParams.set("lang", "en");

      const response = await fetch(url, { headers: { Accept: "application/json" } });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.message || "Provider search failed");

      const items = (payload.data || []).map((item) => {
        const images = item.images || {};
        const original = images.original || images.downsized || {};
        const preview = images.fixed_width_small || images.preview_gif || original;
        return {
          url: original.url || "",
          previewUrl: preview.url || original.url || "",
          name: item.title || (type === "gif" ? "GIF" : "Sticker"),
          pack: "Giphy"
        };
      }).filter((item) => /^https:\/\//i.test(item.url) && /^https:\/\//i.test(item.previewUrl));

      return {
        status: 200,
        headers: corsHeaders,
        jsonBody: { success: true, items }
      };
    } catch (error) {
      context.error("Media search error:", error);
      return {
        status: 502,
        headers: corsHeaders,
        jsonBody: { success: false, error: "Media provider unavailable" }
      };
    }
  }
});
