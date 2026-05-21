import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

// AWS Signature V4 helpers
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

function generatePresignedUrl(method, bucket, region, key, accessKey, secretKey, dateStamp, shortDate, expiresIn) {
  // Returns a promise
  return (async () => {
    const host = `${bucket}.s3.${region}.amazonaws.com`;
    const credential = `${accessKey}/${shortDate}/${region}/s3/aws4_request`;

    const queryParams = new URLSearchParams({
      "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
      "X-Amz-Credential": credential,
      "X-Amz-Date": dateStamp,
      "X-Amz-Expires": String(expiresIn),
      "X-Amz-SignedHeaders": "host",
    });
    const sortedParams = new URLSearchParams([...queryParams.entries()].sort());
    const canonicalQueryString = sortedParams.toString();

    const canonicalRequest = [
      method,
      `/${key}`,
      canonicalQueryString,
      `host:${host}\n`,
      "host",
      "UNSIGNED-PAYLOAD"
    ].join("\n");

    const stringToSign = [
      "AWS4-HMAC-SHA256",
      dateStamp,
      `${shortDate}/${region}/s3/aws4_request`,
      await sha256(canonicalRequest)
    ].join("\n");

    const signingKey = await getSignatureKey(secretKey, shortDate, region, "s3");
    const signatureKey = await crypto.subtle.importKey("raw", signingKey, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const enc = new TextEncoder();
    const signature = toHex(await crypto.subtle.sign("HMAC", signatureKey, enc.encode(stringToSign)));

    return `https://${host}/${key}?${canonicalQueryString}&X-Amz-Signature=${signature}`;
  })();
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const { fileName, contentType } = body;
    if (!fileName) {
      return Response.json({ error: "fileName is required" }, { status: 400 });
    }

    // Get the active default StorageProfile
    const profiles = await base44.asServiceRole.entities.StorageProfile.filter({
      status: "active",
      is_default: true,
    });

    if (!profiles || profiles.length === 0) {
      return Response.json({ error: "No active storage profile configured" }, { status: 500 });
    }

    const profile = profiles[0];
    const bucket = profile.bucket;
    const region = profile.region;
    // Use secrets for credentials — StorageProfile just stores a reference marker
    const accessKey = Deno.env.get("AWS_ACCESS_KEY_ID");
    const secretKey = Deno.env.get("AWS_SECRET_ACCESS_KEY");

    if (!accessKey || !secretKey) {
      return Response.json({ error: "AWS credentials not configured" }, { status: 500 });
    }

    // Build S3 key
    const timestamp = Date.now();
    const sanitized = fileName.replace(/[^a-zA-Z0-9._-]/g, "_");
    const prefix = profile.upload_prefix || "";
    const key = prefix ? `${prefix}/${timestamp}_${sanitized}` : `${timestamp}_${sanitized}`;

    // Generate timestamps for signing
    const now = new Date();
    const dateStamp = now.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
    const shortDate = dateStamp.substring(0, 8);
    const uploadExpiresIn = 3600;       // 1 hour for upload
    const getExpiresIn = 7 * 24 * 3600; // 7 days for download/playback (max for IAM user creds)

    // Generate presigned PUT URL (for upload)
    const uploadUrl = await generatePresignedUrl("PUT", bucket, region, key, accessKey, secretKey, dateStamp, shortDate, uploadExpiresIn);

    // Generate presigned GET URL (for playback & AssemblyAI download)
    const publicUrl = await generatePresignedUrl("GET", bucket, region, key, accessKey, secretKey, dateStamp, shortDate, getExpiresIn);

    return Response.json({ upload_url: uploadUrl, public_url: publicUrl, key });
  } catch (error) {
    console.error("Error generating presigned URL:", error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});