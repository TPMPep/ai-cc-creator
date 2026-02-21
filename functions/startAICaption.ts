import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const { mediaUrl } = await req.json();
    if (!mediaUrl) return Response.json({ error: 'mediaUrl is required' }, { status: 400 });

    const ASSEMBLYAI_API_KEY = Deno.env.get('ASSEMBLYAI_API_KEY');
    if (!ASSEMBLYAI_API_KEY) return Response.json({ error: 'ASSEMBLYAI_API_KEY not set' }, { status: 500 });

    const res = await fetch('https://api.assemblyai.com/v2/transcript', {
      method: 'POST',
      headers: {
        'authorization': ASSEMBLYAI_API_KEY,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        audio_url: mediaUrl,
        speaker_labels: true,
        language_detection: true,
        punctuate: true,
        format_text: true,
        disfluencies: false,
        auto_highlights: true,
        content_safety: true,
        speech_model: "best",
        speech_models: { best: {} },
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      return Response.json({ error: `AssemblyAI error: ${err}` }, { status: 500 });
    }

    const data = await res.json();
    return Response.json({ transcript_id: data.id, status: data.status });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});