const API_BASE = "https://web-production-eba27.up.railway.app";

/**
 * Create a job on Railway using multipart/form-data.
 * Required fields: backbone_srt, timestamps_json
 * Optional fields: protected_phrases, output_formats
 */
export async function createJob(payload) {
  const formData = new FormData();

  // Required fields
  formData.append("backbone_srt", payload.backbone_srt);
  formData.append("timestamps_json", payload.timestamps_json);

  // Optional fields
  if (payload.protected_phrases) {
    formData.append("protected_phrases", payload.protected_phrases);
  }
  if (payload.output_formats) {
    formData.append("output_formats", payload.output_formats);
  }

  const response = await fetch(`${API_BASE}/v1/jobs`, {
    method: "POST",
    body: formData,
    // Do NOT set Content-Type — browser sets it with boundary automatically
  });

  const responseText = await response.text();
  console.log("POST /v1/jobs response:", { status: response.status, body: responseText });

  if (!response.ok) {
    throw new Error(`Job creation failed (${response.status}): ${responseText}`);
  }

  return JSON.parse(responseText);
}

/**
 * Poll a Railway job. Returns the full response object.
 * When completed, result contains: result.srt, result.vtt, result.scc
 */
export async function pollJob(jobId) {
  const response = await fetch(`${API_BASE}/v1/jobs/${jobId}`, {
    method: "GET",
  });
  if (!response.ok) {
    throw new Error(`Poll failed (${response.status})`);
  }
  const data = await response.json();
  console.log("GET /v1/jobs/:id response:", { jobId, status: data.status, hasResult: !!data.result });
  return data;
}