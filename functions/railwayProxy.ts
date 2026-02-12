import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

const RAILWAY_BASE = "https://web-production-eba27.up.railway.app";

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json();
    const { action, jobId, payload } = body;

    if (action === "createJob") {
      const res = await fetch(`${RAILWAY_BASE}/v1/jobs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) {
        return Response.json({ error: data }, { status: res.status });
      }
      return Response.json(data);
    }

    if (action === "pollJob") {
      const res = await fetch(`${RAILWAY_BASE}/v1/jobs/${jobId}`, {
        method: "GET",
        headers: { "Content-Type": "application/json" },
      });
      const data = await res.json();
      if (!res.ok) {
        return Response.json({ error: data }, { status: res.status });
      }
      return Response.json(data);
    }

    return Response.json({ error: "Unknown action" }, { status: 400 });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});