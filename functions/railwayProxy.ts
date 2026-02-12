import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

const RAILWAY_API_URL = "https://web-production-eba27.up.railway.app/v1";

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { method, endpoint, body } = await req.json();
    
    const url = `${RAILWAY_API_URL}${endpoint}`;
    const options = {
      method: method || 'GET',
      headers: { 'Content-Type': 'application/json' },
    };
    
    if (body) {
      options.body = JSON.stringify(body);
    }
    
    const response = await fetch(url, options);
    const data = await response.json();
    
    if (!response.ok) {
      return Response.json({ error: data.error || 'Railway API error' }, { status: response.status });
    }
    
    return Response.json(data);
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});