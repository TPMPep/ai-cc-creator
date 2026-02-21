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

// ─── STEP 1: PRE-SEGMENT ─────────────────────────────────────────────────────

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

// ─── STEP 2: GPT POLISH (one batch at a time) ────────────────────────────────

async function polishBatchWithGPT(segments, gaps, language, highlights, apiKey, batchIndex, totalBatches) {
  const segmentInput = segments.map((s, i) =>
    `[${i}] START=${s.start}ms END=${s.end}ms SPEAKER=${s.speaker || 'null'}\nTEXT: ${s.text}`
  ).join('\n\n');

  const gapInput = gaps.length > 0
    ? 'SILENCE GAPS (insert sound/music cues here if applicable):\n' +
      gaps.map(g => `${g.start}ms → ${g.end}ms (${Math.round((g.end - g.start)/1000)}s gap)`).join('\n')
    : '';

  const highlightDump = highlights && highlights.length > 0
    ? 'KEY AUDIO TERMS: ' + highlights.slice(0, 20).map(h => `"${h.text}"`).join(', ')
    : '';

  const batchNote = totalBatches > 1
    ? `NOTE: This is batch ${batchIndex + 1} of ${totalBatches} from a longer video. Process only the segments provided.\n\n`
    : '';

  const prompt = `${batchNote}You are a professional broadcast closed caption editor (NBCU CM-051 / FCC standards).

You will receive pre-timed caption segments. Your job is:
1. Fix grammar, punctuation, and homophones in each segment's text
2. Format the text to fit in ≤32 characters per line, ≤2 lines per cue
3. Choose the SMARTEST possible line break — keep context together, fill lines efficiently
4. If two adjacent segments have different speakers AND their combined text fits in 2 lines of ≤32 chars each, you MAY combine them into one cue with "- " prefix on each line
5. Insert sound/music cues into SILENCE GAPS where appropriate
6. Return ALL segments (you cannot skip any)

═══════════════════════════════════════
HARD RULES — NEVER VIOLATE:
═══════════════════════════════════════
- TIMECODES ARE LOCKED. Output the exact start/end ms from the input. Do NOT change them.
  Exception: when combining two adjacent segments, use the first segment's start and the last segment's end.
  Exception: sound cues in gaps get the gap's start/end times.
- MAX 32 characters per line (count every char: letters, spaces, punctuation, brackets, dashes, ♪)
- MAX 2 lines per cue
- Cue duration must be ≥ 500ms. If a segment is very short (<500ms) and text is brief, keep it as-is.
- When a cue has text from 2 different speakers, prefix EACH line with "- " (uses 2 of your 32 chars)
- NEVER use >> or > for speaker changes
- Every sentence must end with . ? or !
- Fix homophones: to/too/two, there/their/they're, its/it's, your/you're, etc.
- Preserve contractions as spoken: gonna, wanna, kinda, don't, can't, I'm, etc.

═══════════════════════════════════════
SOUND/MUSIC CUE RULES:
═══════════════════════════════════════
- Music: [ ♪ DESCRIPTION ♪ ] — ALL CAPS inside. Max 32 chars total.
- Sound effects: [DESCRIPTION] — ALL CAPS. Max 32 chars.
- Insert these into the silence gaps listed in your input where it makes sense contextually.
- Infer sounds from context clues in the surrounding dialogue.
- If a gap is pure silence with no context, use [AMBIENT SOUND] or omit it.

═══════════════════════════════════════
LINE BREAK STRATEGY:
═══════════════════════════════════════
- Prefer breaking at natural syntactic boundaries: after a comma, conjunction, or before a verb phrase
- Fill lines efficiently — don't leave a 10-char line when a 25-char line is possible
- Keep subjects with their verbs when possible

═══════════════════════════════════════
OUTPUT FORMAT:
═══════════════════════════════════════
Return ONLY a valid JSON array. No markdown. No explanation. No code fences.
Each element: {"start": number, "end": number, "text": string, "speaker": string|null}
- Use \\n for line breaks within 2-line cues
- speaker: "A"/"B"/"C" for single-speaker, null for multi-speaker or sound cues
- Include ALL input segments in the output (same count or more if you added sound cues)
- Verify EVERY line is ≤32 chars before outputting

═══════════════════════════════════════
INPUT SEGMENTS:
═══════════════════════════════════════
Language: ${language || 'en'}

${segmentInput}

${gapInput}
${highlightDump}`;

  let res;
  for (let attempt = 0; attempt < 5; attempt++) {
    res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: 'You are a broadcast caption editor. Output ONLY a valid JSON array. TIMECODES ARE LOCKED. Every text line must be ≤32 characters. Every cue must have ≤2 lines.' },
          { role: 'user', content: prompt },
        ],
        temperature: 0.1,
        max_tokens: 16000,
      }),
    });
    if (res.status === 429) {
      await new Promise(r => setTimeout(r, 30000 * (attempt + 1)));
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

// ─── STEP 3: FINAL ENFORCEMENT ───────────────────────────────────────────────

function finalEnforce(cues) {
  const MAX_CHARS = 32;
  const MIN_DUR = 500;
  const MIN_GAP = 67;
  const result = [];

  for (const cue of cues) {
    const isSoundCue = cue.text.startsWith('[') || cue.text.includes('♪');
    const lines = cue.text.split('\n');
    const allOk = lines.length <= 2 && lines.every(l => l.length <= MAX_CHARS);

    if (allOk || isSoundCue) {
      if (isSoundCue && lines.some(l => l.length > MAX_CHARS)) {
        result.push({ ...cue, text: lines.map(l => l.substring(0, MAX_CHARS)).join('\n') });
      } else {
        result.push(cue);
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

// ─── MAIN ────────────────────────────────────────────────────────────────────
//
// action="prepare"  → fetch transcript, build slim segment plan, return it to frontend
// action="finalize" → receive polished cues from frontend, enforce rules, build exports, save to DB
//
// GPT processing happens IN THE FRONTEND (no timeout constraints) using the returned plan.

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const { transcript_id, job_db_id, action = 'prepare', polished_cues } = await req.json();
    if (!transcript_id || !job_db_id) return Response.json({ error: 'transcript_id and job_db_id required' }, { status: 400 });

    const ASSEMBLYAI_API_KEY = Deno.env.get('ASSEMBLYAI_API_KEY');

    // ── PREPARE: fetch transcript, build and return the segment plan ──
    if (action === 'prepare') {
      const transcript = await getTranscript(transcript_id, ASSEMBLYAI_API_KEY);
      if (transcript.status !== 'completed') return Response.json({ status: transcript.status });

      const utterances = transcript.utterances || [];
      const rawSegments = buildRawSegments(utterances);
      const gaps = findGaps(utterances, transcript.audio_duration ? transcript.audio_duration * 1000 : null);
      const highlights = (transcript.auto_highlights_result?.results || []).slice(0, 20).map(h => h.text);
      const assemblyRawCues = utterances.map(u => ({ start: u.start, end: u.end, text: u.text, speaker: u.speaker }));

      // Batch by segment count: 15 segments per batch
      const BATCH_SIZE = 15;
      const batches = [];
      for (let i = 0; i < rawSegments.length; i += BATCH_SIZE) {
        // Strip word arrays — frontend only needs start/end/text/speaker
        batches.push(rawSegments.slice(i, i + BATCH_SIZE).map(({ start, end, text, speaker }) => ({ start, end, text, speaker })));
      }

      // Return plan to frontend — frontend will call GPT, then call finalize
      return Response.json({
        status: 'ready',
        batches,
        gaps,
        highlights,
        language: transcript.language_code,
        assemblyRawCues: assemblyRawCues.map(({ start, end, text, speaker }) => ({ start, end, text, speaker })),
      });
    }

    // ── FINALIZE: receive polished cues, enforce, QC, export, save ──
    if (action === 'finalize') {
      if (!polished_cues || !Array.isArray(polished_cues)) {
        return Response.json({ error: 'polished_cues array required' }, { status: 400 });
      }

      const cues = finalEnforce(polished_cues);
      const srt = buildSRT(cues);
      const vtt = buildVTT(cues);
      const scc = buildSCC(cues);
      const qc = runQC(cues);

      // Fetch original transcript to get assemblyRawCues for diagnostic
      const transcript = await getTranscript(transcript_id, ASSEMBLYAI_API_KEY);
      const assemblyRawCues = (transcript.utterances || []).map(u => ({ 
        start: u.start, 
        end: u.end, 
        text: u.text, 
        speaker: u.speaker 
      }));

      // Store cues, intermediate data for diagnostics, and QC; exports are generated on-demand
      await base44.asServiceRole.entities.Job.update(job_db_id, {
        status: 'done',
        result: {
          cues,
          assemblyRawCues,  // For diagnostic comparison
          openaiReformattedCues: polished_cues,  // For diagnostic comparison
          exports: { 
            srt: null,  // Generated on-demand
            vtt: null,  // Generated on-demand
            scc: null   // Generated on-demand
          },
          qc,
        },
        durationMs: cues.length > 0 ? cues[cues.length - 1].end : 0,
        issuesCount: qc.issuesCount || 0,
        lastPolledAt: new Date().toISOString(),
      });

      return Response.json({ status: 'completed', cues, exports: { srt, vtt, scc }, qc });
    }

    return Response.json({ error: 'Invalid action' }, { status: 400 });

  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});