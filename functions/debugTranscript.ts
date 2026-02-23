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

    // Check what's in the saved job result for utterances
    const jobResult = await base44.asServiceRole.entities.Job.filter({ railwayJobId: transcript_id }, '-created_date', 1);
    const job = jobResult[0];
    const savedUtterances = job?.result?.assemblyUtterances || [];
    const savedAssemblyRaw = job?.result?.assemblyRawCues || [];

    return Response.json({
      audioEventsFieldExists: 'audio_events_result' in transcript,
      audioEventsValue: transcript.audio_events ?? 'field not present',
      // Sample utterances from AssemblyAI directly
      directUtterancesSample: (transcript.utterances || []).slice(0, 3).map(u => ({
        start: u.start, end: u.end, speaker: u.speaker, text: u.text?.substring(0, 60)
      })),
      directUtteranceCount: (transcript.utterances || []).length,
      // What's saved in the DB
      savedUtteranceCount: savedUtterances.length,
      savedUtteranceSample: savedUtterances.slice(0, 3).map(u => ({
        start: u.start, end: u.end, speaker: u.speaker, text: u.text?.substring(0, 60)
      })),
      savedAssemblyRawCount: savedAssemblyRaw.length,
      savedAssemblyRawSample: savedAssemblyRaw.slice(0, 3).map(u => ({
        start: u.start, end: u.end, speaker: u.speaker, text: u.text?.substring(0, 60)
      })),
      // Around 56 seconds - check utterances near that time
      utterancesAround56s: (transcript.utterances || []).filter(u => u.start >= 50000 && u.start <= 65000).map(u => ({
        start: u.start, end: u.end, speaker: u.speaker, text: u.text?.substring(0, 80)
      })),
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});