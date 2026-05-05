import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

// S3 upload path: public/ppantoja/Testing/Pluto/
const REGION = Deno.env.get("AWS_S3_REGION");
const BUCKET = Deno.env.get("AWS_S3_BUCKET");
const ACCESS_KEY = Deno.env.get("AWS_ACCESS_KEY_ID");
const SECRET_KEY = Deno.env.get("AWS_SECRET_ACCESS_KEY");

// AWS Signature V4 helpers
function hmac(key, msg) {
  const enc = new TextEncoder();
  return crypto.subtle.sign("HMAC",
    key instanceof CryptoKey ? key : crypto.subtle.importKey("raw", typeof key === "string" ? enc.encode(key) : key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]).then(k => k),
    enc.encode(msg)
  );
}

async function getSignatureKey(key, dateStamp, region, service) {
  const enc = new TextEncoder();
  const kDate = await crypto.subtle.sign("HMAC",
    await crypto.subtle.importKey("raw", enc.encode("AWS4" + key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]),
    enc.encode(dateStamp));
  const kRegion = await crypto.subtle.sign("HMAC",
    await crypto.subtle.importKey("raw", kDate, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]),
    enc.encode(region));
  const kService = await crypto.subtle.sign("HMAC",
    await crypto.subtle.importKey("raw", kRegion, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]),
    enc.encode(service));
  const kSigning = await crypto.subtle.sign("HMAC",
    await crypto.subtle.importKey("raw", kService, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]),
    enc.encode("aws4_request"));
  return kSigning;
}

function toHex(buffer) {
  return [...new Uint8Array(buffer)].map(b => b.toString(16).padStart(2, '0')).join('');
}

async function sha256(msg) {
  const enc = new TextEncoder();
  const hash = await crypto.subtle.digest("SHA-256", enc.encode(msg));
  return toHex(hash);
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { fileName, contentType } = await req.json();
    if (!fileName || !contentType) {
      return Response.json({ error: "fileName and contentType required" }, { status: 400 });
    }

    // Build S3 key with timestamp to avoid collisions
    const timestamp = Date.now();
    const sanitized = fileName.replace(/[^a-zA-Z0-9._-]/g, "_");
    const key = `pep-test/Pluto-Test/${timestamp}_${sanitized}`;

    // Generate presigned PUT URL using AWS Signature V4
    const now = new Date();
    const dateStamp = now.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
    const shortDate = dateStamp.substring(0, 8);
    const expiresIn = 3600;
    const host = `${BUCKET}.s3.${REGION}.amazonaws.com`;
    const credential = `${ACCESS_KEY}/${shortDate}/${REGION}/s3/aws4_request`;

    const queryParams = new URLSearchParams({
      "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
      "X-Amz-Credential": credential,
      "X-Amz-Date": dateStamp,
      "X-Amz-Expires": String(expiresIn),
      "X-Amz-SignedHeaders": "host",
    });
    // Sort params for canonical query string
    const sortedParams = new URLSearchParams([...queryParams.entries()].sort());
    const canonicalQueryString = sortedParams.toString();

    const canonicalRequest = [
      "PUT",
      `/${key}`,
      canonicalQueryString,
      `host:${host}\n`,
      "host",
      "UNSIGNED-PAYLOAD"
    ].join("\n");

    const stringToSign = [
      "AWS4-HMAC-SHA256",
      dateStamp,
      `${shortDate}/${REGION}/s3/aws4_request`,
      await sha256(canonicalRequest)
    ].join("\n");

    const signingKey = await getSignatureKey(SECRET_KEY, shortDate, REGION, "s3");
    const signatureKey = await crypto.subtle.importKey("raw", signingKey, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const enc = new TextEncoder();
    const signature = toHex(await crypto.subtle.sign("HMAC", signatureKey, enc.encode(stringToSign)));

    const presignedUrl = `https://${host}/${key}?${canonicalQueryString}&X-Amz-Signature=${signature}`;

    // The public URL that Railway/AAI can access
    const publicUrl = `https://${host}/${key}`;

    return Response.json({ uploadUrl: presignedUrl, publicUrl, key });
  } catch (error) {
    console.error("Error generating presigned URL:", error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});