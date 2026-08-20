const { app } = require('@azure/functions');
const {
  BlobServiceClient,
  BlobSASPermissions
} = require("@azure/storage-blob");
const busboy = require("busboy");

const connectionString = process.env.AZURE_STORAGE_CONNECTION_STRING;
const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "*"
};
app.http('uploadVoice', {
    methods: ['POST'],
    authLevel: 'anonymous',

    handler: async (request, context) => {

        return new Promise(async (resolve, reject) => {

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
                respond({ status: 400, headers: corsHeaders, jsonBody: { success: false, error: error.message } });
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
    headers: corsHeaders,
    jsonBody: {
        success: true,
    url: sasUrl
  }
});
                }

                catch (err) {
                                        context.error("Voice upload error:", err);
                                        respond({ status: 500, headers: corsHeaders, jsonBody: { success: false, error: err.message } });

                }

            });

                        bb.on("error", (error) => {
                                context.error("Voice multipart parse error:", error);
                                respond({ status: 400, headers: corsHeaders, jsonBody: { success: false, error: error.message } });
                        });

            bb.end(Buffer.from(await request.arrayBuffer()));

        });

    }
});