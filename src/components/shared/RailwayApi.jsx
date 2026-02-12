import { base44 } from "@/api/base44Client";

const API_BASE = "https://web-production-eba27.up.railway.app";

export async function createJob(payload) {
  const response = await fetch(`${API_BASE}/v1/jobs`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Job creation failed (${response.status}): ${err}`);
  }
  return response.json();
}

export async function pollJob(jobId) {
  const response = await fetch(`${API_BASE}/v1/jobs/${jobId}`, {
    method: "GET",
    headers: { "Content-Type": "application/json" },
  });
  if (!response.ok) {
    throw new Error(`Poll failed (${response.status})`);
  }
  return response.json();
}