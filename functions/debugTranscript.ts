import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

const ASSEMBLYAI_BASE = 'https://api.assemblyai.com/v2';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const { transcript_id } = await req.json();
    if (!transcript_id) return Response.json({ error: 'transcript_id required' }, { status: 400 });

    const ASSEMBLYAI_API_KEY = Deno.env.get('ASSEMBLYAI_API_KEY');

    const res = await fetch(`${ASSEMBLYAI_BASE}/transcript/${transcript_id}`, {
      headers: { 'authorization': ASSEMBLYAI_API_KEY },
    });
    if (!res.ok) return Response.json({ error: `AssemblyAI error: ${res.status}` }, { status: 500 });
    const transcript = await res.json();

    // Return all top-level keys and specifically the audio events related fields
    const topLevelKeys = Object.keys(transcript);
    const audioRelatedKeys = topLevelKeys.filter(k => k.toLowerCase().includes('audio') || k.toLowerCase().includes('event') || k.toLowerCase().includes('sound'));
    
    // Get the actual audio event data whatever key it's under
    const audioEventData = {};
    for (const key of audioRelatedKeys) {
      audioEventData[key] = transcript[key];
    }

    // Also check content_safety_labels for any sound-related data
    const contentSafety = transcript.content_safety_labels;

    // Check EVERY key for anything that could contain audio event / sound data
    const allData = {};
    for (const key of topLevelKeys) {
      const val = transcript[key];
      if (val !== null && val !== undefined && val !== false && val !== '' && val !== 0) {
        if (typeof val === 'object' || Array.isArray(val)) {
          allData[key] = JSON.stringify(val).substring(0, 200);
        }
      }
    }

    return Response.json({
      topLevelKeys,
      audioEventsFieldValue: transcript.audio_events,
      contentSafetyEnabled: transcript.content_safety,
      // Dump all non-null object/array fields to find where events might be
      objectFields: allData,
      utterancesSample: (transcript.utterances || []).slice(0, 5).map(u => ({
        start: u.start, end: u.end, speaker: u.speaker, text: u.text?.substring(0, 80)
      })),
      utteranceCount: (transcript.utterances || []).length,
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});