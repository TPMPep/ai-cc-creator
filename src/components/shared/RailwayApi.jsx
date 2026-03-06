const API_BASE = "https://web-production-eba27.up.railway.app";

/**
 * Create a job on Railway.
 * Payload: mediaUrl, speakerLabels, languageDetection, allowHttp, captionRules
 */
export async function createJob(payload) {
  const response = await fetch(`${API_BASE}/v1/jobs`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      mediaUrl: payload.mediaUrl,
      speakerLabels: payload.speaker_labels,
      languageDetection: payload.language_detection,
      allowHttp: payload.allowHttp,
      captionRules: payload.rules,
    }),
  });

  const responseText = await response.text();
  console.log("POST /v1/jobs response:", { status: response.status, body: responseText });

  if (!response.ok) {
    throw new Error(`Job creation failed (${response.status}): ${responseText}`);
  }

  return JSON.parse(responseText);
}

/**
 * Poll a Railway job by ID.
 * When completed, result contains: result.srt, result.vtt, result.scc, result.qc
 */
export async function pollJob(jobId) {
  const response = await fetch(`${API_BASE}/v1/jobs/${jobId}`);
  if (!response.ok) {
    throw new Error(`Poll failed (${response.status})`);
  }
  const data = await response.json();
  console.log("GET /v1/jobs/:id response:", { jobId, status: data.status, hasResult: !!data.result });
  return data;
}