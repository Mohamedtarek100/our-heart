const { app } = require('@azure/functions');
const { BlobServiceClient } = require("@azure/storage-blob");
const busboy = require("busboy");

const connectionString = process.env.AZURE_STORAGE_CONNECTION_STRING;
app.http('uploadVoice', {
    methods: ['POST'],
    authLevel: 'anonymous',

    handler: async (request, context) => {

        return new Promise(async (resolve, reject) => {

            const bb = busboy({
                headers: Object.fromEntries(request.headers)
            });

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
                        `voice-${Date.now()}.webm`;

                    const blockBlobClient =
                        containerClient.getBlockBlobClient(blobName);

                    await blockBlobClient.uploadData(fileBuffer);

                    resolve({
    headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "*"
    },

    jsonBody: {
        url: blockBlobClient.url
    }
});
                }

                catch (err) {

                    reject(err);

                }

            });

            bb.end(Buffer.from(await request.arrayBuffer()));

        });

    }
});