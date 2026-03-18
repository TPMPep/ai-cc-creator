import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

// startAICaption v2 — Submits to AssemblyAI AND kicks off server-side polling+processing
// No longer relies on the browser tab staying open.

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const { mediaUrl, job_db_id } = await req.json();
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
        speech_models: ["universal-3-pro", "universal-2"],
        prompt: "Always: Transcribe speech with your best guess based on context in all possible scenarios where speech is present in the audio. Include: Tag sounds: [laughter], [applause], [music], [silence], [noise], [cough], [sigh], [beep], [hold music], [inaudible], [crosstalk]. Tag all non-speech audio events using bracketed tags.",
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      return Response.json({ error: `AssemblyAI error: ${err}` }, { status: 500 });
    }

    const data = await res.json();
    const transcript_id = data.id;

    // If job_db_id was provided, fire off server-side polling in the background
    // This ensures processing starts even if the browser tab is closed
    if (job_db_id) {
      // Fire and forget — don't await, let it run in the background
      base44.functions.invoke('waitAndProcess', {
        transcript_id,
        job_db_id,
      }).then(() => {
        console.log(`[startAICaption] waitAndProcess completed for ${job_db_id}`);
      }).catch(err => {
        console.error(`[startAICaption] waitAndProcess error for ${job_db_id}:`, err.message);
      });
    }

    return Response.json({ transcript_id, status: data.status });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});