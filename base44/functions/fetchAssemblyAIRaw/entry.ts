import { createClientFromRequest } from 'npm:@base44/sdk@0.8.20';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { transcriptId, format } = await req.json();
    if (!transcriptId) {
      return Response.json({ error: 'Missing transcriptId' }, { status: 400 });
    }

    const apiKey = Deno.env.get("ASSEMBLYAI_API_KEY");
    if (!apiKey) {
      return Response.json({ error: 'ASSEMBLYAI_API_KEY not configured' }, { status: 500 });
    }

    const headers = { authorization: apiKey };

    // Fetch only the requested format to avoid huge payloads
    if (format === "srt") {
      const srtRes = await fetch(`https://api.assemblyai.com/v2/transcript/${transcriptId}/srt`, { headers });
      if (!srtRes.ok) {
        return Response.json({ error: `AssemblyAI SRT fetch failed: ${srtRes.status}` }, { status: 502 });
      }
      const srtText = await srtRes.text();
      return Response.json({ srt: srtText });
    }

    if (format === "json") {
      const jsonRes = await fetch(`https://api.assemblyai.com/v2/transcript/${transcriptId}`, { headers });
      if (!jsonRes.ok) {
        return Response.json({ error: `AssemblyAI JSON fetch failed: ${jsonRes.status}` }, { status: 502 });
      }
      const jsonData = await jsonRes.json();
      // Strip the massive words array to stay under payload limits, but keep utterances (has speaker labels)
      const { words, ...trimmed } = jsonData;
      trimmed._meta = {
        words_count: words?.length || 0,
        utterances_count: trimmed.utterances?.length || 0,
      };
      return Response.json({ json: trimmed });
    }

    if (format === "utterances") {
      const jsonRes = await fetch(`https://api.assemblyai.com/v2/transcript/${transcriptId}`, { headers });
      if (!jsonRes.ok) {
        return Response.json({ error: `AssemblyAI utterances fetch failed: ${jsonRes.status}` }, { status: 502 });
      }
      const jsonData = await jsonRes.json();
      // Strip word-level arrays from each utterance to reduce payload size
      const trimmed = (jsonData.utterances || []).map(({ words, ...rest }) => rest);
      return Response.json({ utterances: trimmed });
    }

    return Response.json({ error: 'Invalid format. Use "srt" or "json".' }, { status: 400 });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});