// src/functions/CosmosSigner.js
const { app } = require("@azure/functions");
const crypto = require("crypto");

app.http("CosmosSigner", {
  methods: ["POST"],
  authLevel: "anonymous",
  handler: async (request, context) => {
    try {
      const key = process.env.COSMOS_KEY; // base64 master key
      if (!key) {
        return {
          status: 500,
          headers: {
            "Content-Type": "application/json",
            "Cache-Control": "no-store"
          },
          body: JSON.stringify({ error: "Missing COSMOS_KEY app setting" })
        };
      }

      const body = await request.json().catch(() => ({}));

      const verb = String(body.verb || "").trim().toLowerCase(); // delete|get|put|post
      const id = String(body.id || "").trim();
      const ownerId = String(body.ownerId || "").trim();

      if (!verb) {
        return {
          status: 400,
          headers: {
            "Content-Type": "application/json",
            "Cache-Control": "no-store"
          },
          body: JSON.stringify({ error: "Missing verb" })
        };
      }

      if (!["get", "put", "delete", "post"].includes(verb)) {
        return {
          status: 400,
          headers: {
            "Content-Type": "application/json",
            "Cache-Control": "no-store"
          },
          body: JSON.stringify({ error: "Invalid verb. Use get|put|delete|post" })
        };
      }

      if (!id || !ownerId) {
        return {
          status: 400,
          headers: {
            "Content-Type": "application/json",
            "Cache-Control": "no-store"
          },
          body: JSON.stringify({ error: "Missing id or ownerId" })
        };
      }

      // Cosmos config (must match your Cosmos account/db/container)
      const account = "cosmos-cloudshare-b00953252";
      const db = "cloudshare";
      const coll = "posts";

      const resourceType = "docs";
      const resourceLink = `dbs/${db}/colls/${coll}/docs/${id}`;

      // Cosmos expects RFC1123 date in header; lowercased in string-to-sign
      const xmsDateHeader = new Date().toUTCString();
      const xmsDateToSign = xmsDateHeader.toLowerCase();

      // Canonical string to sign (lowercased)
      const stringToSign = `${verb}\n${resourceType}\n${resourceLink}\n${xmsDateToSign}\n\n`;

      const decodedKey = Buffer.from(String(key).trim(), "base64");
      const sig = crypto
        .createHmac("sha256", decodedKey)
        .update(stringToSign.toLowerCase(), "utf8")
        .digest("base64");

      // Logic Apps will send this verbatim as Authorization header
      const auth = encodeURIComponent(`type=master&ver=1.0&sig=${sig}`);

      return {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": "no-store"
        },
        body: JSON.stringify({
          uri: `https://${account}.documents.azure.com/${resourceLink}`,
          auth,
          xmsDate: xmsDateHeader,
          pkHeader: JSON.stringify([ownerId])
        })
      };
    } catch (e) {
      return {
        status: 500,
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": "no-store"
        },
        body: JSON.stringify({ error: e?.message || String(e) })
      };
    }
  }
});
