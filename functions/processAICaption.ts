import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

// processAICaption v9 — 2026-02-28
// Handles START and REPROCESS actions, delegates to processAICaptionWorker

/** Generate a unique runId */
function newRunId() {
  return (globalThis.crypto?.randomUUID?.() ??
    `${Date.now()}-${Math.random().toString(16).slice(2)}`);
}

// ─── PRE-SEGMENT ─────────────────────────────────────────────────────────────

function buildRawSegments(utterances) {
  const MAX_DUR = 7500;
  const segments = [];

  for (const utt of utterances) {
    const words = utt.words || [];
    if (!words.length) {
      segments.push({ start: utt.start, end: utt.end, text: utt.text, speaker: utt.speaker, words });
      continue;
    }

    const uttDur = words[words.length - 1].end - words[0].start;
    if (uttDur <= MAX_DUR) {
      segments.push({
        start: words[0].start,
        end: words[words.length - 1].end,
        text: words.map(w => w.text).join(' '),
        speaker: utt.speaker,
        words: words,
      });
      continue;
    }

    let chunkStart = 0;
    while (chunkStart < words.length) {
      let chunkEnd = chunkStart;
      const firstWordStart = words[chunkStart].start;

      for (let j = chunkStart; j < words.length; j++) {
        if (words[j].end - firstWordStart <= MAX_DUR) {
          chunkEnd = j;
        } else break;
      }

      const remainingCount = words.length - (chunkEnd + 1);
      if (remainingCount > 0 && remainingCount < 4) {
        const allWords = words.slice(chunkStart);
        segments.push({
          start: allWords[0].start,
          end: allWords[allWords.length - 1].end,
          text: allWords.map(w => w.text).join(' '),
          speaker: utt.speaker,
          words: allWords,
        });
        chunkStart = words.length;
        continue;
      }

      const chunkWords = words.slice(chunkStart, chunkEnd + 1);
      segments.push({
        start: chunkWords[0].start,
        end: chunkWords[chunkWords.length - 1].end,
        text: chunkWords.map(w => w.text).join(' '),
        speaker: utt.speaker,
        words: chunkWords,
      });
      chunkStart = chunkEnd + 1;
    }
  }

  return segments;
}

function findGaps(utterances, totalDurationMs) {
  const gaps = [];
  let prevEnd = 0;
  for (const utt of utterances) {
    if (utt.start - prevEnd > 2000) {
      gaps.push({ start: prevEnd, end: utt.start });
    }
    prevEnd = utt.end;
  }
  if (totalDurationMs && totalDurationMs - prevEnd > 2000) {
    gaps.push({ start: prevEnd, end: totalDurationMs });
  }
  return gaps;
}

const BATCH_WINDOW_MS = 5 * 60 * 1000;

function buildBatches(segments) {
  if (segments.length === 0) return [];
  const batches = [];
  let batchStart = 0;
  const firstStart = segments[0].start;

  for (let i = 1; i <= segments.length; i++) {
    const isLast = i === segments.length;
    const crossedWindow = !isLast && (segments[i].start - firstStart) >= (batches.length + 1) * BATCH_WINDOW_MS;
    if (crossedWindow || isLast) {
      batches.push(segments.slice(batchStart, i));
      batchStart = i;
    }
  }
  return batches;
}

// ─── HELPER: Add pipeline log entry ─────────────────────────────────────────

async function addLog(base44, jobId, step, status, detail) {
  const job = await base44.asServiceRole.entities.Job.get(jobId);
  const log = job.pipelineLog || [];
  log.push({ step, status, detail, ts: new Date().toISOString() });
  await base44.asServiceRole.entities.Job.update(jobId, { pipelineLog: log });
}

// ─── MAIN HANDLER ────────────────────────────────────────────────────────────
// This function handles START and REPROCESS actions only.
// It prepares the processing plan, then delegates to processAICaptionWorker
// via base44.asServiceRole.functions.invoke to avoid 508 LOOP_DETECTED.

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  let job_db_id = null;

  try {
    let body;
    try {
      body = await req.json();
    } catch (e) {
      return Response.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    const action = body?.action;

    // Require authenticated user for all actions
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const transcript_id = body.transcript_id;
    job_db_id = body.job_db_id;

    if (!action || !job_db_id) {
      return Response.json({ error: 'action and job_db_id required' }, { status: 400 });
    }

    const ASSEMBLYAI_API_KEY = Deno.env.get('ASSEMBLYAI_API_KEY');
    console.log(`[v9 processAICaption] AAI present: ${!!ASSEMBLYAI_API_KEY}, ts: ${Date.now()}`);

    // ── ACTION: START ────────────────────────────────────────────────────────
    if (action === 'start') {
      if (!transcript_id) return Response.json({ error: 'transcript_id required for start' }, { status: 400 });

      console.log(`[START] Fetching transcript ${transcript_id} for job ${job_db_id}`);

      // Fetch transcript from AssemblyAI
      const aaiRes = await fetch(`https://api.assemblyai.com/v2/transcript/${transcript_id}`, {
        headers: { 'authorization': ASSEMBLYAI_API_KEY },
      });
      if (!aaiRes.ok) return Response.json({ error: `AssemblyAI fetch failed: ${aaiRes.status}` }, { status: 500 });
      const transcript = await aaiRes.json();
      if (transcript.status !== 'completed') return Response.json({ error: `Transcript not ready: ${transcript.status}` }, { status: 400 });

      // Extract utterances
      const utterances = (transcript.utterances || []).map(u => ({
        start: u.start, end: u.end, text: u.text, speaker: u.speaker, words: u.words,
      }));
      const language = transcript.language_code || 'en';
      const highlights = (transcript.auto_highlights_result?.results || []).map(h => h.text);
      const totalDurationMs = transcript.audio_duration ? transcript.audio_duration * 1000 : null;
      const gaps = findGaps(utterances, totalDurationMs);

      // Extract real audio events ([NOISE], [MUSIC], [LAUGHTER], etc.) from utterance text
      const AUDIO_EVENT_PATTERN = /\[(NOISE|MUSIC|LAUGHTER|APPLAUSE|SILENCE|COUGH|SIGH|CROSSTALK|INAUDIBLE|BACKGROUND NOISE|BACKGROUND MUSIC)\]/gi;
      const rawAudioEvents = [];
      for (const utt of utterances) {
        const matches = [...(utt.text || '').matchAll(AUDIO_EVENT_PATTERN)];
        for (const match of matches) {
          rawAudioEvents.push({
            label: match[1].toUpperCase(),
            start: utt.start,
            end: utt.end,
            text: utt.text,
            speaker: utt.speaker,
          });
        }
      }

      // Extract content safety labels separately for diagnostic reference
      const contentSafetyLabels = [];
      const safetyResults = transcript.content_safety_labels?.results || [];
      for (const r of safetyResults) {
        for (const label of (r.labels || [])) {
          contentSafetyLabels.push({
            label: label.label,
            confidence: label.confidence,
            severity: label.severity,
            start: r.timestamp?.start || 0,
            end: r.timestamp?.end || 0,
            text: r.text || '',
          });
        }
      }

      // Build segments and batches
      const segments = buildRawSegments(utterances);
      const batches = buildBatches(segments);
      const runId = newRunId();

      await addLog(base44, job_db_id, '1_transcribe', 'ok',
        `Transcript ready: ${utterances.length} utterances, lang=${language}, ${gaps.length} gaps`);

      await base44.asServiceRole.entities.Job.update(job_db_id, {
        status: 'processing',
        pipelineLog: (await base44.asServiceRole.entities.Job.get(job_db_id)).pipelineLog || [],
        processingPlan: {
          utterances,
          batches: batches.map(b => b.map(s => ({ start: s.start, end: s.end, text: s.text, speaker: s.speaker }))),
          totalBatches: batches.length,
          polishedCues: [],
          gaps,
          language,
          highlights,
          rawAudioEvents,
          contentSafetyLabels,
          runId,
        },
      });

      console.log(`[START] ${segments.length} segments, ${batches.length} batches, ${gaps.length} gaps, ${rawAudioEvents.length} audio events, lang=${language}, runId=${runId}`);

      // Invoke the WORKER function (different deployment endpoint — no 508 loop detection)
      base44.asServiceRole.functions.invoke('processAICaptionWorker', {
        action: 'process_batch',
        job_db_id,
        transcript_id,
        batch_index: 0,
        runId,
      }).catch(err => {
        console.error('[START WORKER INVOKE ERROR]', err.message);
        base44.asServiceRole.entities.Job.update(job_db_id, {
          status: 'error',
          error: `Failed to start worker: ${err.message}`,
        }).catch(() => {});
      });

      return Response.json({ status: 'started', batches: batches.length });
    }

    // ── ACTION: REPROCESS ────────────────────────────────────────────────────
    if (action === 'reprocess') {
      console.log(`[REPROCESS] Re-running GPT for job ${job_db_id}`);

      const job = await base44.asServiceRole.entities.Job.get(job_db_id);
      let plan = job.processingPlan || {};
      let utterances = plan.utterances;

      if (!utterances || utterances.length === 0) {
        const tid = transcript_id || job.railwayJobId;
        if (!tid) return Response.json({ error: 'No saved transcript data' }, { status: 400 });
        const aaiRes = await fetch(`https://api.assemblyai.com/v2/transcript/${tid}`, {
          headers: { 'authorization': ASSEMBLYAI_API_KEY },
        });
        if (!aaiRes.ok) return Response.json({ error: `AssemblyAI re-fetch failed: ${aaiRes.status}` }, { status: 500 });
        const transcript = await aaiRes.json();
        if (transcript.status !== 'completed') return Response.json({ error: `Transcript not ready: ${transcript.status}` }, { status: 400 });
        utterances = (transcript.utterances || []).map(u => ({ start: u.start, end: u.end, text: u.text, speaker: u.speaker, words: u.words }));
        plan.language = transcript.language_code || 'en';
        plan.highlights = (transcript.auto_highlights_result?.results || []).map(h => h.text);
        const totalDurationMs = transcript.audio_duration ? transcript.audio_duration * 1000 : null;
        plan.gaps = findGaps(utterances, totalDurationMs);

        // Extract content safety labels as rawAudioEvents for diagnostic
        const rawAudioEvents = [];
        const safetyResults = transcript.content_safety_labels?.results || [];
        for (const r of safetyResults) {
          for (const label of (r.labels || [])) {
            rawAudioEvents.push({
              label: label.label,
              confidence: label.confidence,
              severity: label.severity,
              start: r.timestamp?.start || 0,
              end: r.timestamp?.end || 0,
              text: r.text || '',
            });
          }
        }
        plan.rawAudioEvents = rawAudioEvents;
      }

      const segments = buildRawSegments(utterances);
      const batches = buildBatches(segments);
      const runId = newRunId();

      await base44.asServiceRole.entities.Job.update(job_db_id, {
        status: 'processing',
        result: null,
        error: null,
        pipelineLog: [{ step: '1_transcribe', status: 'ok', detail: 'Reprocess — using saved transcript data.', ts: new Date().toISOString() }],
        processingPlan: {
          ...plan,
          utterances,
          batches: batches.map(b => b.map(s => ({ start: s.start, end: s.end, text: s.text, speaker: s.speaker }))),
          totalBatches: batches.length,
          polishedCues: [],
          runId,
        },
      });

      console.log(`[REPROCESS] ${segments.length} segments, ${batches.length} batches, runId=${runId}`);

      // Invoke the WORKER function
      base44.asServiceRole.functions.invoke('processAICaptionWorker', {
        action: 'process_batch',
        job_db_id,
        transcript_id: job.railwayJobId,
        batch_index: 0,
        runId,
      }).catch(err => {
        console.error('[REPROCESS WORKER INVOKE ERROR]', err.message);
        base44.asServiceRole.entities.Job.update(job_db_id, {
          status: 'error',
          error: `Failed to start worker: ${err.message}`,
        }).catch(() => {});
      });

      return Response.json({ status: 'reprocessing', batches: batches.length });
    }

    return Response.json({ error: `Unknown action: ${action}. This function only handles start and reprocess.` }, { status: 400 });

  } catch (error) {
    console.error('[processAICaption] Error:', error.message);
    try {
      if (job_db_id) {
        await base44.asServiceRole.entities.Job.update(job_db_id, { status: 'error', error: error.message });
      }
    } catch (_) {}
    return Response.json({ error: error.message }, { status: 500 });
  }
});