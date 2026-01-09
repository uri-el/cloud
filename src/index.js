const crypto = require("crypto");

module.exports = async function (context, req) {
  try {
    const key = process.env.COSMOS_KEY; // Cosmos Primary Key from portal
    const { id, ownerId } = req.body || {};

    if (!key) return (context.res = { status: 500, body: "Missing COSMOS_KEY setting" });
    if (!id || !ownerId) return (context.res = { status: 400, body: "Missing id or ownerId" });

    const account = "cosmos-cloudshare-b00953252";
    const db = "cloudshare";
    const coll = "posts";

    const verb = "delete";
    const resourceType = "docs";
    const resourceLink = `dbs/${db}/colls/${coll}/docs/${id}`;

    const dateHeader = new Date().toUTCString();
    const dateToSign = dateHeader.toLowerCase();

    const text = `${verb}\n${resourceType}\n${resourceLink}\n${dateToSign}\n\n`.toLowerCase();

    const decodedKey = Buffer.from(key, "base64");
    const sig = crypto.createHmac("sha256", decodedKey).update(text, "utf8").digest("base64");
    const auth = encodeURIComponent(`type=master&ver=1.0&sig=${sig}`);

    context.res = {
      status: 200,
      headers: { "Content-Type": "application/json" },
      body: {
        uri: `https://${account}.documents.azure.com/${resourceLink}`,
        auth,
        xmsDate: dateHeader,
        pkHeader: JSON.stringify([ownerId])
      }
    };
  } catch (e) {
    context.res = { status: 500, body: e.message };
  }
};
