import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

const ASSEMBLYAI_BASE = 'https://api.assemblyai.com/v2';

async function getTranscript(transcriptId, apiKey) {
  const res = await fetch(`${ASSEMBLYAI_BASE}/transcript/${transcriptId}`, {
    headers: { 'authorization': apiKey },
  });
  if (!res.ok) throw new Error(`AssemblyAI poll failed: ${res.status}`);
  return res.json();
}

// ─── TIMECODE UTILITIES ──────────────────────────────────────────────────────

function msToSCCTimecode(ms) {
  const totalFrames = Math.floor(ms / (1000 / 29.97));
  const fps = 30;
  const dropFrames = 2;
  const framesPerMin = fps * 60;
  const framesPerTenMin = framesPerMin * 10 - dropFrames * 9;
  const d = Math.floor(totalFrames / framesPerTenMin);
  const m = totalFrames % framesPerTenMin;
  let frames;
  if (m < dropFrames) {
    frames = m + d * framesPerTenMin;
  } else {
    frames = totalFrames + dropFrames * 9 * d + dropFrames * (Math.floor((m - dropFrames) / (framesPerMin - dropFrames)));
  }
  const ff = frames % fps;
  const secs = Math.floor(frames / fps);
  return `${String(Math.floor(secs / 3600)).padStart(2,'0')}:${String(Math.floor((secs % 3600) / 60)).padStart(2,'0')}:${String(secs % 60).padStart(2,'0')}:${String(ff).padStart(2,'0')}`;
}

function textToSCCBytes(text) {
  const bytes = [];
  const clean = text.replace(/\r/g, '').substring(0, 64);
  for (let i = 0; i < clean.length; i++) {
    const code = clean.charCodeAt(i);
    if (code >= 0x20 && code <= 0x7e) {
      if (i + 1 < clean.length && clean.charCodeAt(i + 1) >= 0x20 && clean.charCodeAt(i + 1) <= 0x7e) {
        bytes.push(`${code.toString(16).padStart(2,'0')}${clean.charCodeAt(i+1).toString(16).padStart(2,'0')}`);
        i++;
      } else {
        bytes.push(`${code.toString(16).padStart(2,'0')}80`);
      }
    }
  }
  return bytes;
}

function buildSCCLine(ms, text) {
  const tc = msToSCCTimecode(ms);
  const bytePairs = textToSCCBytes(text);
  return `${tc}\t${ ['942c','9420',...bytePairs,'942f'].join(' ') }`;
}

function fmtMs(ms, sep = ',') {
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const ms2 = ms % 1000;
  return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}${sep}${String(ms2).padStart(3,'0')}`;
}

function buildSRT(cues) {
  return cues.map((c,i) => `${i+1}\n${fmtMs(c.start)} --> ${fmtMs(c.end)}\n${c.text}\n`).join('\n');
}

function buildVTT(cues) {
  const body = cues.map(c => `${fmtMs(c.start,'.')} --> ${fmtMs(c.end,'.')}\n${c.text}`).join('\n\n');
  return `WEBVTT\n\n${body}`;
}

function buildSCC(cues) {
  const lines = ['Scenarist_SCC V1.0', ''];
  for (const cue of cues) {
    lines.push(`${msToSCCTimecode(cue.start)}\t942e`);
    for (const line of cue.text.split('\n')) {
      if (line.trim()) lines.push(buildSCCLine(cue.start, line.trim()));
    }
    lines.push(`${msToSCCTimecode(cue.end)}\t942e`);
    lines.push('');
  }
  return lines.join('\n');
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
    let chunkStart = 0;
    while (chunkStart < words.length) {
      let chunkEnd = chunkStart;
      const firstWordStart = words[chunkStart].start;
      for (let j = chunkStart; j < words.length; j++) {
        if (words[j].end - firstWordStart <= MAX_DUR) chunkEnd = j;
        else break;
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
    if (utt.start - prevEnd > 2000) gaps.push({ start: prevEnd, end: utt.start });
    prevEnd = utt.end;
  }
  if (totalDurationMs && totalDurationMs - prevEnd > 2000) gaps.push({ start: prevEnd, end: totalDurationMs });
  return gaps;
}

// ─── GPT POLISH (single batch, server-side) ──────────────────────────────────

async function polishBatchWithGPT(segments, gaps, language, highlights, apiKey, batchIndex, totalBatches) {
  const segmentInput = segments.map((s, i) =>
    `[${i}] START=${s.start}ms END=${s.end}ms SPEAKER=${s.speaker || 'null'}\nTEXT: ${s.text}`
  ).join('\n\n');

  const gapInput = gaps.length > 0
    ? 'SILENCE GAPS (insert sound/music cues here if applicable):\n' +
      gaps.map(g => `${g.start}ms → ${g.end}ms (${Math.round((g.end - g.start)/1000)}s gap)`).join('\n')
    : '';

  const highlightDump = highlights && highlights.length > 0
    ? 'KEY AUDIO TERMS: ' + highlights.slice(0, 20).map(h => `"${h}"`).join(', ')
    : '';

  const batchNote = totalBatches > 1
    ? `NOTE: This is batch ${batchIndex + 1} of ${totalBatches} from a longer video. Process only the segments provided.\n\n`
    : '';

  const prompt = `${batchNote}You are a professional broadcast closed caption editor working to NBCU CM-051 and FCC standards. You will receive pre-timed caption segments and must return broadcast-ready captions.

  ═══════════════════════════════════════
  HARD RULES — NEVER VIOLATE:
  ═══════════════════════════════════════
  1. TIMECODES ARE LOCKED. Copy start/end ms exactly from input. Never alter them.
  - Exception: when combining two adjacent same-or-different speaker segments, use first.start and last.end.
  - Exception: sound/music cues inserted into gaps use the gap's start and end ms.
  2. MAX 32 characters per line. Count EVERY character: letters, spaces, punctuation, dashes, brackets, ♪.
  3. MAX 2 lines per cue. Never 3.
  4. Cue duration ≥ 500ms minimum.
  5. SPEAKER CHANGES: When one cue contains dialogue from 2 different speakers, prefix EACH line with "- " (that's 2 chars of your 32). Never use >> or >.
  6. SINGLE SPEAKER cues: no dash prefix needed.
  7. Every dialogue sentence must end with a terminal punctuation mark: . ? ! … or —
  8. Fix ALL homophones in context: to/too/two, there/their/they're, its/it's, your/you're, than/then, etc.
  9. Preserve natural spoken contractions: gonna, wanna, kinda, gotta, don't, can't, I'm, etc.
  10. Return EVERY input segment — never drop one.

  ═══════════════════════════════════════
  LINE BREAK STRATEGY (critical for readability):
  ═══════════════════════════════════════
  - Break at natural syntactic boundaries: after comma, conjunction (and/but/or/so), or before verb phrase
  - NEVER break mid-phrase or mid-thought if avoidable (e.g. don't split "the" from its noun)
  - Aim for balanced line lengths — a 28-char line + 26-char line beats a 5-char + 32-char split
  - Subject + verb should stay together when possible
  - Examples of GOOD breaks:
  "She said she would never" / "go back to that place."
  "- I don't think that's right." / "- Well, I disagree."
  - Examples of BAD breaks:
  "She said she would" / "never go back to that place." ← widowed word

  ═══════════════════════════════════════
  SPEAKER DASH FORMATTING:
  ═══════════════════════════════════════
  - Use "- " prefix on BOTH lines when two speakers share a cue
  - If a speaker's dialogue wraps to 2 lines within the same cue, only the first line gets "- "
  - Combine adjacent different-speaker segments into one cue ONLY when combined text fits cleanly in 2 lines of ≤32 chars each
  - If it doesn't fit cleanly, keep them as separate single-speaker cues (no dash needed)

  ═══════════════════════════════════════
  SOUND/MUSIC CUE RULES:
  ═══════════════════════════════════════
  - Music: [♪ DESCRIPTION ♪] — ALL CAPS description, max 32 chars total including brackets and ♪
  - Sound effects: [SOUND DESCRIPTION] — ALL CAPS, max 32 chars total
  - ONLY insert into the silence gaps provided — never displace dialogue
  - Infer from surrounding dialogue context (e.g. laughing described → [AUDIENCE LAUGHTER])
  - If gap has no contextual clues, omit the sound cue rather than guessing

  ═══════════════════════════════════════
  OUTPUT FORMAT — STRICT:
  ═══════════════════════════════════════
  Return ONLY a raw JSON array. Zero markdown. Zero explanation. Zero code fences.
  Schema: [{"start": number, "end": number, "text": string, "speaker": string|null}, ...]
  - Use \\n for the line break between line 1 and line 2 within a cue
  - speaker field: "A" / "B" / "C" for single-speaker cues; null for multi-speaker or sound cues
  - Count characters on every line before outputting — if any line exceeds 32 chars, reformat it

  ═══════════════════════════════════════
  INPUT:
  ═══════════════════════════════════════
  Language: ${language || 'en'}
  ${highlightDump}

  ${segmentInput}

  ${gapInput}`;

  let res;
  for (let attempt = 0; attempt < 3; attempt++) {
    res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
              model: 'gpt-4o',
              messages: [
                { role: 'system', content: 'You are a professional broadcast closed caption editor specializing in NBCU CM-051 / FCC standards. Output ONLY a valid JSON array. TIMECODES ARE LOCKED — never alter them. Every text line must be ≤32 characters. Every cue must have ≤2 lines. Speaker changes use "- " prefix on each line.' },
                { role: 'user', content: prompt },
              ],
              temperature: 0.1,
              max_tokens: 8000,
            }),
    });
    if (res.status === 429) {
      await new Promise(r => setTimeout(r, 5000 * (attempt + 1)));
      continue;
    }
    break;
  }

  if (!res.ok) throw new Error(`OpenAI error (batch ${batchIndex + 1}): ${await res.text()}`);
  const data = await res.json();
  const content = data.choices[0].message.content.trim();
  const jsonMatch = content.match(/\[[\s\S]*\]/);
  if (!jsonMatch) throw new Error(`OpenAI did not return valid JSON (batch ${batchIndex + 1})`);
  return JSON.parse(jsonMatch[0]);
}

// ─── STRIP SPEAKER LABELS FROM TEXT ─────────────────────────────────────────
// GPT sometimes leaks [A], [B], [C] into the text field — strip them out
function cleanCueText(text) {
  // Remove leading [A], [B], [C], [SPEAKER_A] etc. from each line
  return text.split('\n').map(line =>
    line.replace(/^\s*\[[A-Z](?:PEAKER_[A-Z])?\]\s*/g, '').trimStart()
  ).join('\n');
}

// ─── FINAL ENFORCEMENT ───────────────────────────────────────────────────────

function finalEnforce(cues) {
  const MAX_CHARS = 32;
  const MIN_DUR = 500;
  const MIN_GAP = 67;
  const result = [];

  for (const cue of cues) {
    const cleanedText = cleanCueText(cue.text || '');
    const isSoundCue = cleanedText.startsWith('[') || cleanedText.includes('♪');
    const lines = cleanedText.split('\n');
    const allOk = lines.length <= 2 && lines.every(l => l.length <= MAX_CHARS);

    if (allOk || isSoundCue) {
      if (isSoundCue && lines.some(l => l.length > MAX_CHARS)) {
        result.push({ ...cue, text: lines.map(l => l.substring(0, MAX_CHARS)).join('\n') });
      } else {
        result.push({ ...cue, text: cleanedText });
      }
      continue;
    }

    const hasDashes = lines.length >= 2 && lines.every(l => l.startsWith('- '));
    const stripped = lines.map(l => l.replace(/^- /, '')).join(' ');
    const words = stripped.split(/\s+/).filter(Boolean);
    const prefix = hasDashes ? '- ' : '';
    const limit = MAX_CHARS - prefix.length;
    const packed = [];
    let cur = '';
    for (const word of words) {
      const candidate = cur ? `${cur} ${word}` : word;
      if (candidate.length <= limit) { cur = candidate; }
      else { if (cur) packed.push(cur); cur = word.length > limit ? word.substring(0, limit) : word; }
    }
    if (cur) packed.push(cur);

    const totalDur = cue.end - cue.start;
    const chunkCount = Math.ceil(packed.length / 2);
    for (let i = 0; i < packed.length; i += 2) {
      const chunk = packed.slice(i, i + 2);
      const ci = Math.floor(i / 2);
      const chunkStart = cue.start + Math.round((ci / chunkCount) * totalDur);
      const chunkEnd = ci === chunkCount - 1 ? cue.end : cue.start + Math.round(((ci + 1) / chunkCount) * totalDur);
      result.push({ start: chunkStart, end: Math.max(chunkStart + MIN_DUR, chunkEnd), text: chunk.map(l => prefix + l).join('\n'), speaker: cue.speaker });
    }
  }

  result.sort((a, b) => a.start - b.start);
  for (let i = 1; i < result.length; i++) {
    if (result[i].start < result[i - 1].end) {
      result[i].start = result[i - 1].end + MIN_GAP;
      if (result[i].end <= result[i].start) result[i].end = result[i].start + MIN_DUR;
    } else if (result[i].start - result[i - 1].end < MIN_GAP) {
      result[i].start = result[i - 1].end + MIN_GAP;
    }
  }
  return result.filter(c => c.text && c.text.trim().length > 0);
}

// ─── QC CHECK ────────────────────────────────────────────────────────────────

function runQC(cues) {
  const issues = [];
  for (let i = 0; i < cues.length; i++) {
    const c = cues[i];
    const lines = c.text.split('\n');
    const dur = c.end - c.start;
    const charCount = c.text.replace(/\n/g, '').length;
    const isSoundCue = c.text.startsWith('[') || c.text.includes('♪');
    for (let li = 0; li < lines.length; li++) {
      if (lines[li].length > 32) issues.push({ cue: i, type: 'line_too_long', value: `Line ${li+1}: ${lines[li].length} chars` });
    }
    if (lines.length > 2) issues.push({ cue: i, type: 'too_many_lines', value: `${lines.length} lines` });
    if (dur < 500) issues.push({ cue: i, type: 'cue_too_short', value: `${dur}ms (min 500ms)` });
    if (dur > 8000) issues.push({ cue: i, type: 'cue_too_long', value: `${(dur/1000).toFixed(1)}s (max 8s)` });
    if (!isSoundCue && charCount / (dur / 1000) > 25) issues.push({ cue: i, type: 'reading_speed', value: `${(charCount/(dur/1000)).toFixed(1)} CPS (too fast)` });
    if (i > 0) {
      const gap = c.start - cues[i - 1].end;
      if (gap < 0) issues.push({ cue: i, type: 'overlap', value: `${Math.abs(gap)}ms overlap with cue ${i}` });
      else if (gap < 67) issues.push({ cue: i, type: 'gap_too_small', value: `${gap}ms (min 67ms)` });
    }
    if (!isSoundCue && c.text.trim().length > 0) {
      const lastLine = lines[lines.length - 1].replace(/^- /, '').trim();
      const lastChar = lastLine[lastLine.length - 1];
      if (!['.', '?', '!', '…', '"', "'"].includes(lastChar) && !lastLine.endsWith('--') && !lastLine.endsWith('—')) {
        issues.push({ cue: i, type: 'missing_punctuation', value: `Ends with "${lastChar}"` });
      }
    }
    if (!c.text || c.text.trim().length === 0) issues.push({ cue: i, type: 'empty_cue', value: 'No text content' });
  }
  return { issuesCount: issues.length, issues };
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────
//
// action="start"        → fetch transcript, build plan, kick off batch 0, save plan to DB
// action="process_batch"→ process one GPT batch, save progress, trigger next batch or finalize
//
// Everything runs server-side. Frontend just polls the DB.

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json();
    const { transcript_id, job_db_id, action = 'start', batch_index } = body;
    if (!transcript_id || !job_db_id) return Response.json({ error: 'transcript_id and job_db_id required' }, { status: 400 });

    const ASSEMBLYAI_API_KEY = Deno.env.get('ASSEMBLYAI_API_KEY');
    const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY');

    // ── START: fetch transcript, build plan, save to DB, kick off batch 0 ──
    if (action === 'start') {
      const transcript = await getTranscript(transcript_id, ASSEMBLYAI_API_KEY);
      if (transcript.status !== 'completed') return Response.json({ status: transcript.status });

      const utterances = transcript.utterances || [];
      const rawSegments = buildRawSegments(utterances);
      const gaps = findGaps(utterances, transcript.audio_duration ? transcript.audio_duration * 1000 : null);
      const highlights = (transcript.auto_highlights_result?.results || []).slice(0, 20).map(h => h.text);
      const assemblyRawCues = utterances.map(u => ({ start: u.start, end: u.end, text: u.text, speaker: u.speaker }));

      const BATCH_SIZE = 15;
      const batches = [];
      for (let i = 0; i < rawSegments.length; i += BATCH_SIZE) {
        batches.push(rawSegments.slice(i, i + BATCH_SIZE).map(({ start, end, text, speaker }) => ({ start, end, text, speaker })));
      }

      const prepareLog = { step: '1_transcribe', status: 'ok', detail: `AssemblyAI completed. ${utterances.length} utterances → ${rawSegments.length} segments → ${batches.length} GPT batches.`, ts: new Date().toISOString() };

      // Save the full processing plan to DB so server can resume without re-fetching transcript
      await base44.asServiceRole.entities.Job.update(job_db_id, {
        pipelineLog: [prepareLog],
        processingPlan: {
          batches,
          gaps,
          highlights,
          language: transcript.language_code,
          assemblyRawCues,
          polishedCues: [],  // accumulates as batches complete
          totalBatches: batches.length,
        },
      });

      // Kick off batch 0 asynchronously (fire and forget — server carries it forward)
      base44.functions.invoke('processAICaption', {
        transcript_id,
        job_db_id,
        action: 'process_batch',
        batch_index: 0,
      }).catch(() => {});

      return Response.json({ status: 'started', totalBatches: batches.length });
    }

    // ── PROCESS_BATCH: run one GPT batch, save progress, trigger next ──
    if (action === 'process_batch') {
      const batchIndex = typeof batch_index === 'number' ? batch_index : 0;

      const job = await base44.asServiceRole.entities.Job.get(job_db_id);
      if (!job) return Response.json({ error: 'Job not found' }, { status: 404 });

      // If job errored or was cancelled, stop
      if (job.status === 'error' || job.status === 'done') return Response.json({ status: job.status });

      const plan = job.processingPlan;
      if (!plan) return Response.json({ error: 'No processing plan found' }, { status: 400 });

      const { batches, gaps, highlights, language, assemblyRawCues, totalBatches } = plan;
      const polishedCues = plan.polishedCues || [];
      const batch = batches[batchIndex];

      // Get gaps relevant to this batch window
      const batchWindowStart = batch[0].start;
      const batchWindowEnd = batch[batch.length - 1].end;
      const batchGaps = (gaps || []).filter(g => g.start >= batchWindowStart - 2000 && g.end <= batchWindowEnd + 2000);

      // Call GPT for this batch
      const batchResult = await polishBatchWithGPT(batch, batchGaps, language, highlights, OPENAI_API_KEY, batchIndex, totalBatches);

      // Append results and update log
      const newPolishedCues = [...polishedCues, ...batchResult];
      const existingLog = job.pipelineLog || [];
      const batchLog = { step: `2_gpt_batch_${batchIndex + 1}_of_${totalBatches}`, status: 'ok', detail: `gpt-4o batch ${batchIndex + 1}/${totalBatches} returned ${batchResult.length} cues.`, ts: new Date().toISOString() };

      await base44.asServiceRole.entities.Job.update(job_db_id, {
        pipelineLog: [...existingLog, batchLog],
        processingPlan: { ...plan, polishedCues: newPolishedCues },
      });

      const nextBatch = batchIndex + 1;
      if (nextBatch < totalBatches) {
        // Trigger next batch asynchronously
        base44.functions.invoke('processAICaption', {
          transcript_id,
          job_db_id,
          action: 'process_batch',
          batch_index: nextBatch,
        }).catch(() => {});
        return Response.json({ status: 'batch_done', next: nextBatch });
      }

      // All batches done — finalize
      const cues = finalEnforce(newPolishedCues);
      const srt = buildSRT(cues);
      const vtt = buildVTT(cues);
      const scc = buildSCC(cues);
      const qc = runQC(cues);

      const finalLog = { step: '3_finalize', status: 'ok', detail: `Final enforce done. ${cues.length} cues. QC issues: ${qc.issuesCount}.`, ts: new Date().toISOString() };

      await base44.asServiceRole.entities.Job.update(job_db_id, {
        status: 'done',
        result: {
          cues,
          assemblyRawCues,
          openaiReformattedCues: newPolishedCues,
          exports: { srt: null, vtt: null, scc: null },
          qc,
        },
        durationMs: cues.length > 0 ? cues[cues.length - 1].end : 0,
        issuesCount: qc.issuesCount || 0,
        lastPolledAt: new Date().toISOString(),
        pipelineLog: [...(job.pipelineLog || []), batchLog, finalLog],
        processingPlan: null, // clean up
      });

      return Response.json({ status: 'completed', cues: cues.length, qcIssues: qc.issuesCount });
    }

    return Response.json({ error: 'Invalid action' }, { status: 400 });

  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});