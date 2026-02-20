import { base44 } from "@/api/base44Client";

const API_BASE = "https://web-production-eba27.up.railway.app";

export async function createJob(payload) {
  try {
    const response = await fetch(`${API_BASE}/v1/jobs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    
    const responseText = await response.text();
    console.log('POST /v1/jobs response:', { status: response.status, body: responseText });
    
    if (!response.ok) {
      throw new Error(`Job creation failed (${response.status}): ${responseText}`);
    }
    
    return JSON.parse(responseText);
  } catch (error) {
    console.error('Job creation error:', error.message);
    throw error;
  }
}

export async function pollJob(jobId) {
  const response = await fetch(`${API_BASE}/v1/jobs/${jobId}`, {
    method: "GET",
    headers: { "Content-Type": "application/json" },
  });
  if (!response.ok) {
    throw new Error(`Poll failed (${response.status})`);
  }
  const data = await response.json();
  console.log('GET /v1/jobs/:id response:', { jobId, status: data.status, hasResult: !!data.result, hasExports: !!data.exports, exports: data.exports, data });
  return data;
}