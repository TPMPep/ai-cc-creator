import { base44 } from "@/api/base44Client";

export async function createJob(payload) {
  const response = await base44.functions.invoke('railwayProxy', {
    method: 'POST',
    endpoint: '/jobs',
    body: payload,
  });
  
  if (response.data.error) {
    throw new Error(response.data.error);
  }
  
  return response.data;
}

export async function pollJob(jobId) {
  const response = await base44.functions.invoke('railwayProxy', {
    method: 'GET',
    endpoint: `/jobs/${jobId}`,
  });
  
  if (response.data.error) {
    throw new Error(response.data.error);
  }
  
  return response.data;
}