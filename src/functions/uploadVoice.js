const { app } = require('@azure/functions');
const {
  BlobServiceClient,
  BlobSASPermissions
} = require("@azure/storage-blob");
const busboy = require("busboy");
const {
  requireSessionAndUnlocked,
  serverError,
  corsHeaders
} = require("./shared");

const connectionString = process.env.AZURE_STORAGE_CONNECTION_STRING;

/* Voice upload is part of the locked chat experience.
   - Requires a trusted session AND an unlocked relationship.
   - CORS is restricted to the allowed frontend origin(s) via the shared
     helper (no wildcard).
   - The SAS URL is only ever returned to an authenticated caller. */
app.http('uploadVoice', {
    methods: ['POST', 'OPTIONS'],
    authLevel: 'anonymous',

    handler: async (request, context) => {

        if (request.method === 'OPTIONS') {
            return { status: 204, headers: corsHeaders(request) };
        }

        // Trusted session + lock gate. Fails CLOSED.
        const gate = await requireSessionAndUnlocked(request);
        if (!gate.ok) return gate.response;

        const responseHeaders = corsHeaders(request);

        return new Promise(async (resolve) => {

            let settled = false;
            const respond = (response) => {
                if (settled) return;
                settled = true;
                resolve(response);
            };

            let bb;
            try {
                bb = busboy({ headers: Object.fromEntries(request.headers) });
            } catch (error) {
                respond({ status: 400, headers: responseHeaders, jsonBody: { success: false, error: "Invalid upload" } });
                return;
            }

            let fileBuffer = Buffer.alloc(0);

            bb.on("file", (name, file) => {

                file.on("data", data => {
                    fileBuffer = Buffer.concat([fileBuffer, data]);
                });

            });

            bb.on("finish", async () => {

                try {

                    const blobServiceClient =
                        BlobServiceClient.fromConnectionString(connectionString);

                    const containerClient =
                        blobServiceClient.getContainerClient("voices");

                    const blobName =
                        `voice-${Date.now()}-${crypto.randomUUID()}.webm`;

                    const blockBlobClient =
                        containerClient.getBlockBlobClient(blobName);

                    if (!fileBuffer.length) {
                        throw new Error("Voice upload is empty");
                    }

                    await blockBlobClient.uploadData(fileBuffer, {
                        blobHTTPHeaders: {
                            blobContentType: "audio/webm"
                        }
                    });

                    const sasUrl = await blockBlobClient.generateSasUrl({
  permissions: BlobSASPermissions.parse("r"),
  expiresOn: new Date(Date.now() + 60 * 60 * 1000)
});

                                respond({
    status: 201,
    headers: responseHeaders,
    jsonBody: {
        success: true,
    url: sasUrl
  }
});
                }

                catch (err) {
                                        respond({ status: 500, headers: responseHeaders, jsonBody: { success: false, error: "Voice upload failed" } });

                }

            });

                        bb.on("error", (error) => {
                                respond({ status: 400, headers: responseHeaders, jsonBody: { success: false, error: "Invalid upload" } });
                        });

            bb.end(Buffer.from(await request.arrayBuffer()));

        });

    }
});