import { createClientFromRequest } from 'npm:@base44/sdk@0.8.20';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { transcriptId } = await req.json();
    if (!transcriptId) {
      return Response.json({ error: 'Missing transcriptId' }, { status: 400 });
    }

    const apiKey = Deno.env.get("ASSEMBLYAI_API_KEY");
    if (!apiKey) {
      return Response.json({ error: 'ASSEMBLYAI_API_KEY not configured' }, { status: 500 });
    }

    const headers = { authorization: apiKey };

    // Fetch raw JSON transcript and raw SRT in parallel
    const [jsonRes, srtRes] = await Promise.all([
      fetch(`https://api.assemblyai.com/v2/transcript/${transcriptId}`, { headers }),
      fetch(`https://api.assemblyai.com/v2/transcript/${transcriptId}/srt`, { headers }),
    ]);

    if (!jsonRes.ok) {
      return Response.json({ error: `AssemblyAI JSON fetch failed: ${jsonRes.status}` }, { status: 502 });
    }
    if (!srtRes.ok) {
      return Response.json({ error: `AssemblyAI SRT fetch failed: ${srtRes.status}` }, { status: 502 });
    }

    const jsonData = await jsonRes.json();
    const srtText = await srtRes.text();

    return Response.json({ json: jsonData, srt: srtText });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});