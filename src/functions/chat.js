const { app } = require("@azure/functions");
const {
  container,
  requireSessionAndUnlocked,
  serverError
} = require("./shared");

// GET: آخر 60 رسالة
// LOCKED: requires a trusted session AND an unlocked relationship.
app.http("getChat", {
  methods: ["GET", "OPTIONS"],
  authLevel: "anonymous",

  handler: async (request, context) => {
    // Trusted session + lock gate. Fails CLOSED.
    const gate = await requireSessionAndUnlocked(request);
    if (!gate.ok) return gate.response;

    try {
      const querySpec = {
        partitionKey: "chat",
        query: `
          SELECT TOP 60 *
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
      return serverError(request, context, error, "Unable to load messages");
    }
  }
});


// GET: new messages + fast seen/read-receipt updates
// LOCKED: requires a trusted session AND an unlocked relationship.
app.http("getNewMessages", {
  methods: ["GET", "OPTIONS"],
  authLevel: "anonymous",

  handler: async (request, context) => {
    // Trusted session + lock gate. Fails CLOSED.
    const gate = await requireSessionAndUnlocked(request);
    if (!gate.ok) return gate.response;

    try {
      const after = Number(request.query.get("after"));
      const seenAfter = Number(request.query.get("seenAfter") || 0);
      // The identity ALWAYS comes from the trusted session — a client-supplied
      // "user" query value is never used to decide what this caller may read.
      const user = gate.user;

      if (!Number.isFinite(after)) {
        return {
          status: 400,
          jsonBody: {
            success: false,
            error: "after must be a valid timestamp"
          }
        };
      }

      const hasSeenCursor = Number.isFinite(seenAfter) && !!user;

      const query = hasSeenCursor
        ? `
          SELECT TOP 100 *
          FROM c
          WHERE c.type = "chat"
            AND (
              c.time > @after
              OR (c.sender = @user AND IS_DEFINED(c.seenAt) AND c.seenAt > @seenAfter)
            )
          ORDER BY c.time ASC
        `
        : `
          SELECT TOP 50 *
          FROM c
          WHERE c.type = "chat"
            AND c.time > @after
          ORDER BY c.time ASC
        `;

      const parameters = hasSeenCursor
        ? [
            { name: "@after", value: after },
            { name: "@user", value: user },
            { name: "@seenAfter", value: seenAfter }
          ]
        : [{ name: "@after", value: after }];

      const { resources } = await container.items
        .query({ query, parameters })
        .fetchAll();

      return {
        status: 200,
        jsonBody: resources
      };
    } catch (error) {
      return serverError(request, context, error, "Unable to load messages");
    }
  }
});

// POST: إضافة رسالة
// LOCKED: requires a trusted session AND an unlocked relationship.
app.http("sendChat", {
  methods: ["POST", "OPTIONS"],
  authLevel: "anonymous",

  handler: async (request, context) => {
    // Trusted session + lock gate. Fails CLOSED.
    const gate = await requireSessionAndUnlocked(request);
    if (!gate.ok) return gate.response;

    try {
      const body = await request.json();

      // The sender is ALWAYS the trusted session user. Any client-supplied
      // sender/owner/userId/account value is ignored on purpose.
      const sender = gate.user;
      if (!sender) {
        return {
          status: 401,
          jsonBody: { success: false, error: "Authentication required" }
        };
      }

      const messageType = body.type === "sticker" || body.type === "gif" ? body.type : body.voiceUrl ? "voice" : "text";
      const mediaUrl = body.voiceUrl || body.stickerUrl || body.gifUrl || "";
      if ((messageType === "text" && !body.text) || (messageType !== "text" && !mediaUrl)) {
        return {
          status: 400,
          jsonBody: {
            success: false,
            error: "valid message content is required"
          }
        };
      }

      if (messageType !== "text" && !/^https:\/\//i.test(String(mediaUrl))) {
        return {
          status: 400,
          jsonBody: { success: false, error: "media URL must use HTTPS" }
        };
      }

      if (["sticker", "gif"].includes(messageType) && !/^https:\/\/(?:media\d*\.giphy\.com|i\.giphy\.com|giphy\.com)\//i.test(String(mediaUrl))) {
        return {
          status: 400,
          jsonBody: { success: false, error: "unsupported media host" }
        };
      }

      const item = {
        id: crypto.randomUUID(),
        type: "chat",
        sender,
        messageType,
        text: body.text || "",
        voiceUrl: body.voiceUrl || "",
        stickerUrl: messageType === "sticker" ? String(body.stickerUrl || "") : "",
        stickerPack: messageType === "sticker" ? String(body.stickerPack || "") : "",
        stickerName: messageType === "sticker" ? String(body.stickerName || "Sticker") : "",
        gifUrl: messageType === "gif" ? String(body.gifUrl || "") : "",
        gifPreview: messageType === "gif" ? String(body.gifPreview || body.gifUrl || "") : "",
        gifName: messageType === "gif" ? String(body.gifName || "GIF") : "",
        time: Date.now(),
        status: "delivered",
        seen: false,
        reaction: "",
        ...(body.replyToMessageId ? {
          replyToMessageId: String(body.replyToMessageId),
          replyToSender: String(body.replyToSender || "Unknown"),
          replyToText: String(body.replyToText || ""),
          replyToType: ["voice", "sticker", "gif"].includes(body.replyToType) ? body.replyToType : "text",
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
      return serverError(request, context, error, "Unable to send message");
    }
  }
});

// POST: mark messages from the other user as seen
// LOCKED: requires a trusted session AND an unlocked relationship.
app.http("markSeen", {
  methods: ["POST", "OPTIONS"],
  authLevel: "anonymous",

  handler: async (request, context) => {
    // Trusted session + lock gate. Fails CLOSED.
    const gate = await requireSessionAndUnlocked(request);
    if (!gate.ok) return gate.response;

    try {
      // The identity ALWAYS comes from the trusted session, never from the
      // request body.
      const user = gate.user;

      if (!user) {
        return {
          status: 401,
          jsonBody: { success: false, error: "Authentication required" }
        };
      }

      const { resources } = await container.items.query({
        query: "SELECT * FROM c WHERE c.type = 'chat' AND c.sender != @user AND (NOT IS_DEFINED(c.seen) OR c.seen = false)",
        parameters: [{ name: "@user", value: user }]
      }).fetchAll();

      const messageIds = [];
      let seenCursor = 0;
      const seenBase = Date.now();
      await Promise.all(resources.map(async (message, index) => {
        message.seen = true;
        message.seenAt = seenBase + index;
        seenCursor = Math.max(seenCursor, message.seenAt);
        await container.item(String(message.id), "chat").replace(message);
        messageIds.push(String(message.id));
      }));

      return {
        status: 200,
        jsonBody: {
          success: true,
          messageIds,
          seenCursor
        }
      };
    } catch (error) {
      return serverError(request, context, error, "Unable to update messages");
    }
  }
});