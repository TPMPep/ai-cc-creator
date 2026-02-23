import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

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

    // If entire utterance fits in MAX_DUR, keep it as one segment (don't split short phrases)
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

    // For long utterances, split into chunks but keep each chunk meaningful
    let chunkStart = 0;
    while (chunkStart < words.length) {
      let chunkEnd = chunkStart;
      const firstWordStart = words[chunkStart].start;

      for (let j = chunkStart; j < words.length; j++) {
        if (words[j].end - firstWordStart <= MAX_DUR) {
          chunkEnd = j;
        } else break;
      }

      // Check if remaining words after this chunk would be too small (< 4 words)
      const remainingCount = words.length - (chunkEnd + 1);
      if (remainingCount > 0 && remainingCount < 4) {
        // Absorb remaining words into this chunk
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

// ─── GPT POLISH ──────────────────────────────────────────────────────────────

const BATCH_WINDOW_MS = 5 * 60 * 1000; // 5 minutes per batch

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

async function polishBatchWithGPT(segments, gaps, language, highlights, apiKey, batchIndex, totalBatches) {
  const segmentInput = segments.map((s, i) =>
    `[${i}] START=${s.start}ms END=${s.end}ms SPEAKER=${s.speaker || 'null'}\nTEXT: ${s.text}`
  ).join('\n\n');

  const gapInput = gaps.length > 0
    ? 'SILENCE GAPS (insert sound/music cues here if applicable):\n' +
      gaps.map(g => `${g.start}ms → ${g.end}ms (${Math.round((g.end - g.start)/1000)}s gap)`).join('\n')
    : '';

  const highlightDump = highlights && highlights.length > 0
    ? 'KEY AUDIO TERMS: ' + highlights.slice(0, 20).map(h => typeof h === 'string' ? `"${h}"` : `"${h.text}"`).join(', ')
    : '';

  const batchNote = totalBatches > 1
    ? `NOTE: This is batch ${batchIndex + 1} of ${totalBatches} from a longer video. Process only the segments provided.\n\n`
    : '';

  const prompt = `${batchNote}You are a professional broadcast closed caption editor (NBCU CM-051 / FCC standards).

You will receive pre-timed caption segments from a transcription API. Your job is to produce broadcast-quality closed captions.

═══════════════════════════════════════
YOUR TASKS:
═══════════════════════════════════════
1. Be TRUE to what is said. Every spoken word MUST appear in the output. NEVER drop, paraphrase, or summarize.
2. Fix grammar, punctuation, and homophones — but preserve how people actually speak (gonna, wanna, don't, ain't, etc.)
3. Format each cue: ≤32 characters per line, ≤2 lines per cue
4. Choose SMART line breaks — keep meaning together, fill lines efficiently
5. Insert sound/music cues into SILENCE GAPS where appropriate
6. Timecodes on screen must match when words are actually spoken

═══════════════════════════════════════
SPEAKER DASHES — CRITICAL:
═══════════════════════════════════════
- ONLY use "- " prefix when TWO DIFFERENT SPEAKERS share the SAME cue
- For a dual-speaker cue: line 1 = "- Speaker A text", line 2 = "- Speaker B text"
- NEVER put a dash on a single-speaker cue. A cue where only one person talks = NO DASH, ever.
- This means: if a cue has 2 lines but both lines are the same speaker, NO DASHES.

═══════════════════════════════════════
ORPHAN WORDS — CRITICAL:
═══════════════════════════════════════
- NEVER create a cue with just 1-3 words if those words are part of a larger sentence from the previous or next cue.
- Example: "Previously on Love Island USA." MUST be ONE cue — never split into "Previously on Love" + "Island USA."
- If adjacent input segments form a single sentence/phrase, COMBINE them into one cue (first segment's start, last segment's end) when the combined text fits in 2 lines × 32 chars.
- NEVER leave a single word dangling as its own cue (e.g. "Okay." alone when it's part of "Okay. Good vibration.").
- After you build your output, scan it: any cue with ≤3 words that doesn't end a sentence should be merged with its neighbor.

═══════════════════════════════════════
HARD RULES — NEVER VIOLATE:
═══════════════════════════════════════
- NEVER DROP OR OMIT spoken content. Every word in the input MUST appear in the output.
- TIMECODES ARE LOCKED. Output the exact start/end ms from the input. Do NOT invent new times.
  Exception: when combining adjacent segments, use the first segment's start and the last segment's end.
  Exception: sound cues in gaps get the gap's start/end times.
- MAX 32 characters per line (count EVERY char: letters, spaces, punctuation, brackets, dashes, ♪)
- MAX 2 lines per cue
- Cue duration must be ≥ 500ms
- Every sentence must end with . ? or !
- Fix homophones: to/too/two, there/their/they're, its/it's, your/you're, etc.
- Preserve contractions as spoken: gonna, wanna, kinda, don't, can't, I'm, etc.
- Do NOT censor. If objectionable words are said, include them exactly as spoken.

═══════════════════════════════════════
SOUND/MUSIC CUE RULES:
═══════════════════════════════════════
- Music: [ ♪ DESCRIPTION ♪ ] — ALL CAPS inside. Max 32 chars total.
- Sound effects: [DESCRIPTION] — ALL CAPS. Max 32 chars.
- Only insert into SILENCE GAPS listed below where it makes contextual sense.
- Infer sounds from context clues in the surrounding dialogue.
- If a gap is pure silence with no context, omit it.

═══════════════════════════════════════
LINE BREAK STRATEGY:
═══════════════════════════════════════
- Break at natural syntactic boundaries (after conjunctions, before prepositions, between clauses)
- Fill both lines as evenly as possible
- Keep subjects with their verbs
- Keep adjectives/articles with their nouns
- NEVER break mid-word

═══════════════════════════════════════
OUTPUT FORMAT:
═══════════════════════════════════════
Return ONLY a valid JSON array. No markdown. No explanation. No code fences.
Each element: {"start": number, "end": number, "text": string, "speaker": string|null}
- Use \\n for line breaks within 2-line cues
- speaker: "A"/"B"/"C" etc. for single-speaker cues, null for dual-speaker or sound cues
- VERIFY before outputting: every line ≤32 chars, no orphan-word cues, no single-speaker dashes

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
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o',
        messages: [
          {
            role: 'system',
            content: 'You are a broadcast caption editor. Output ONLY a valid JSON array. TIMECODES ARE LOCKED — do not change start/end values from the input. Every text line must be ≤32 characters. Every cue must have ≤2 lines. NEVER drop or omit any spoken content — every word from the input MUST appear in the output. Combine adjacent short segments that form a single phrase into one cue. Verify each cue before including it.',
          },
          { role: 'user', content: prompt },
        ],
        temperature: 0.1,
        max_tokens: 16000,
      }),
    });

    if (res.status === 429) {
      const wait = 30000 * (attempt + 1);
      console.log(`[BATCH ${batchIndex + 1}] Rate limited, waiting ${wait/1000}s...`);
      await new Promise(r => setTimeout(r, wait));
      continue;
    }
    break;
  }

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`OpenAI error (batch ${batchIndex + 1}): ${err}`);
  }

  const data = await res.json();
  const content = data.choices[0].message.content.trim();
  const jsonMatch = content.match(/\[[\s\S]*\]/);
  if (!jsonMatch) throw new Error(`OpenAI did not return valid JSON (batch ${batchIndex + 1})`);

  const parsed = JSON.parse(jsonMatch[0]);

  // Post-GPT merge: combine adjacent spoken cues that form incomplete phrases
  // (e.g. "Previously on Love" + "Island" + "USA." should be one cue)
  const merged = [];
  for (let i = 0; i < parsed.length; i++) {
    const cue = parsed[i];
    const isSoundCue = cue.text.startsWith('[') || cue.text.includes('♪');
    if (isSoundCue) { merged.push(cue); continue; }

    // Check if this cue is a short fragment that should merge with the previous spoken cue
    const plainText = cue.text.replace(/\n/g, ' ').trim();
    const prevIdx = merged.length - 1;
    const prevCue = prevIdx >= 0 ? merged[prevIdx] : null;
    const prevIsSoundCue = prevCue && (prevCue.text.startsWith('[') || prevCue.text.includes('♪'));

    if (prevCue && !prevIsSoundCue && plainText.length < 15) {
      // Check if combined text still fits (2 lines × 32 chars)
      const combinedText = prevCue.text.replace(/\n/g, ' ').trim() + ' ' + plainText;
      if (combinedText.length <= 64) {
        // Repack into ≤32 char lines
        const words = combinedText.split(/\s+/);
        let line1 = '';
        let line2 = '';
        for (const w of words) {
          if (!line1 || (line1 + ' ' + w).length <= 32) {
            line1 = line1 ? line1 + ' ' + w : w;
          } else if (!line2 || (line2 + ' ' + w).length <= 32) {
            line2 = line2 ? line2 + ' ' + w : w;
          } else {
            break; // doesn't fit, skip merge
          }
        }
        const newText = line2 ? line1 + '\n' + line2 : line1;
        const allFit = newText.split('\n').every(l => l.length <= 32);
        if (allFit) {
          merged[prevIdx] = { ...prevCue, end: cue.end, text: newText };
          continue;
        }
      }
    }
    merged.push(cue);
  }

  return merged;
}

// ─── FINAL ENFORCEMENT ───────────────────────────────────────────────────────

function finalEnforce(cues) {
  const MAX_CHARS = 32;
  const MIN_DUR = 500;
  const MIN_GAP = 67;
  const result = [];

  for (const cue of cues) {
    if (!cue.text || !cue.text.trim()) continue;

    const lines = cue.text.split('\n').filter(l => l.trim().length > 0);
    if (lines.length === 0) continue;

    const isSoundCue = cue.text.startsWith('[') || cue.text.includes('♪');
    const allOk = lines.length <= 2 && lines.every(l => l.length <= MAX_CHARS);

    // If it's already compliant, keep it (truncate sound cues if needed)
    if (allOk) {
      result.push({ ...cue, text: lines.join('\n') });
      continue;
    }

    // For cues with >2 lines or lines >32 chars, we need to split/repack into compliant cues
    // First, if it's a sound cue, just truncate lines and split into 2-line groups
    if (isSoundCue) {
      const truncated = lines.map(l => l.substring(0, MAX_CHARS));
      const totalDur = cue.end - cue.start;
      const groupCount = Math.ceil(truncated.length / 2);
      for (let g = 0; g < groupCount; g++) {
        const groupLines = truncated.slice(g * 2, g * 2 + 2);
        const groupStart = cue.start + Math.round((g / groupCount) * totalDur);
        const groupEnd = g === groupCount - 1 ? cue.end : cue.start + Math.round(((g + 1) / groupCount) * totalDur);
        result.push({
          start: groupStart,
          end: Math.max(groupStart + MIN_DUR, groupEnd),
          text: groupLines.join('\n'),
          speaker: cue.speaker,
        });
      }
      continue;
    }

    // Regular text cue — repack words into ≤32-char lines, ≤2 lines per cue
    const hasDashes = lines.length >= 2 && lines.every(l => l.startsWith('- '));
    const stripped = lines.map(l => l.replace(/^- /, '')).join(' ');
    const words = stripped.split(/\s+/).filter(Boolean);
    if (words.length === 0) continue;

    const prefix = hasDashes ? '- ' : '';
    const limit = MAX_CHARS - prefix.length;

    const packed = [];
    let cur = '';
    for (const word of words) {
      const candidate = cur ? `${cur} ${word}` : word;
      if (candidate.length <= limit) {
        cur = candidate;
      } else {
        if (cur) packed.push(cur);
        // Never truncate words — keep the full word even if it slightly exceeds limit
        cur = word;
      }
    }
    if (cur) packed.push(cur);

    if (packed.length === 0) continue;

    const totalDur = cue.end - cue.start;
    const chunkCount = Math.ceil(packed.length / 2);

    for (let i = 0; i < packed.length; i += 2) {
      const chunk = packed.slice(i, i + 2);
      const ci = Math.floor(i / 2);
      const chunkStart = cue.start + Math.round((ci / chunkCount) * totalDur);
      const chunkEnd = ci === chunkCount - 1
        ? cue.end
        : cue.start + Math.round(((ci + 1) / chunkCount) * totalDur);

      result.push({
        start: chunkStart,
        end: Math.max(chunkStart + MIN_DUR, chunkEnd),
        text: chunk.map(l => prefix + l).join('\n'),
        speaker: cue.speaker,
      });
    }
  }

  result.sort((a, b) => a.start - b.start);

  for (let i = 1; i < result.length; i++) {
    if (result[i].start < result[i - 1].end) {
      result[i].start = result[i - 1].end + MIN_GAP;
      if (result[i].end <= result[i].start) {
        result[i].end = result[i].start + MIN_DUR;
      }
    } else if (result[i].start - result[i - 1].end < MIN_GAP && result[i].start > result[i - 1].end) {
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
      if (lines[li].length > 32) {
        issues.push({ cue: i, type: 'line_too_long', value: `Line ${li+1}: ${lines[li].length} chars` });
      }
    }
    if (lines.length > 2) issues.push({ cue: i, type: 'too_many_lines', value: `${lines.length} lines` });
    if (dur < 500) issues.push({ cue: i, type: 'cue_too_short', value: `${dur}ms (min 500ms)` });
    if (dur > 8000) issues.push({ cue: i, type: 'cue_too_long', value: `${(dur/1000).toFixed(1)}s (max 8s)` });
    if (!isSoundCue && charCount / (dur / 1000) > 25) {
      issues.push({ cue: i, type: 'reading_speed', value: `${(charCount/(dur/1000)).toFixed(1)} CPS (too fast)` });
    }
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
    if (!c.text || c.text.trim().length === 0) {
      issues.push({ cue: i, type: 'empty_cue', value: 'No text content' });
    }
  }
  return { issuesCount: issues.length, issues };
}

// ─── HELPER: Add pipeline log entry ─────────────────────────────────────────

async function addLog(base44, jobId, step, status, detail) {
  const job = await base44.asServiceRole.entities.Job.get(jobId);
  const log = job.pipelineLog || [];
  log.push({ step, status, detail, ts: new Date().toISOString() });
  await base44.asServiceRole.entities.Job.update(jobId, { pipelineLog: log });
}

// ─── MAIN HANDLER ────────────────────────────────────────────────────────────
// Actions:
//   "start"         — fetch AssemblyAI transcript, pre-segment, build batches, start batch 0
//   "process_batch" — process one GPT batch, then chain to next or finalize
//   "reprocess"     — re-run GPT using saved transcript data (no new AssemblyAI charge)

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json();
    const { action, transcript_id, job_db_id } = body;

    if (!action || !job_db_id) {
      return Response.json({ error: 'action and job_db_id required' }, { status: 400 });
    }

    const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY');
    const ASSEMBLYAI_API_KEY = Deno.env.get('ASSEMBLYAI_API_KEY');

    // ── ACTION: START ────────────────────────────────────────────────────────
    if (action === 'start') {
      if (!transcript_id) return Response.json({ error: 'transcript_id required for start' }, { status: 400 });

      console.log(`[START] Fetching transcript ${transcript_id} for job ${job_db_id}`);
      await addLog(base44, job_db_id, '1_transcribe', 'ok', 'AssemblyAI transcription completed.');

      // Fetch full transcript from AssemblyAI
      const aaiRes = await fetch(`https://api.assemblyai.com/v2/transcript/${transcript_id}`, {
        headers: { 'authorization': ASSEMBLYAI_API_KEY },
      });
      if (!aaiRes.ok) throw new Error(`AssemblyAI fetch failed: ${aaiRes.status}`);
      const transcript = await aaiRes.json();

      if (transcript.status !== 'completed') {
        throw new Error(`Transcript not ready: ${transcript.status}`);
      }

      const utterances = transcript.utterances || [];
      const language = transcript.language_code || 'en';
      const highlights = (transcript.auto_highlights_result?.results || []).map(h => h.text);
      const totalDurationMs = transcript.audio_duration ? transcript.audio_duration * 1000 : null;

      // Pre-segment
      const segments = buildRawSegments(utterances);
      const gaps = findGaps(utterances, totalDurationMs);
      const batches = buildBatches(segments);

      console.log(`[START] ${segments.length} segments, ${batches.length} batches, ${gaps.length} gaps, lang=${language}`);

      // Save processing plan to job
      await base44.asServiceRole.entities.Job.update(job_db_id, {
        processingPlan: {
          batches: batches.map(b => b.map(s => ({ start: s.start, end: s.end, text: s.text, speaker: s.speaker }))),
          gaps,
          highlights,
          language,
          totalBatches: batches.length,
          polishedCues: [],
          utterances: utterances.map(u => ({ start: u.start, end: u.end, text: u.text, speaker: u.speaker, words: u.words })),
        },
      });

      // Chain to first batch (use service role so token doesn't expire on long jobs)
      base44.asServiceRole.functions.invoke('processAICaption', {
        transcript_id,
        job_db_id,
        action: 'process_batch',
        batch_index: 0,
      }).catch(err => console.error('[START] Chain to batch 0 failed:', err.message));

      return Response.json({ status: 'started', batches: batches.length });
    }

    // ── ACTION: REPROCESS ────────────────────────────────────────────────────
    if (action === 'reprocess') {
      console.log(`[REPROCESS] Re-running GPT for job ${job_db_id}`);

      const job = await base44.asServiceRole.entities.Job.get(job_db_id);
      let plan = job.processingPlan || {};
      let utterances = plan.utterances;

      // If no saved utterances, re-fetch from AssemblyAI
      if (!utterances || utterances.length === 0) {
        const tid = transcript_id || job.railwayJobId;
        if (!tid) {
          return Response.json({ error: 'No saved transcript data and no transcript_id to re-fetch' }, { status: 400 });
        }
        console.log(`[REPROCESS] No saved utterances, re-fetching from AssemblyAI: ${tid}`);
        const aaiRes = await fetch(`https://api.assemblyai.com/v2/transcript/${tid}`, {
          headers: { 'authorization': ASSEMBLYAI_API_KEY },
        });
        if (!aaiRes.ok) {
          return Response.json({ error: `AssemblyAI re-fetch failed: ${aaiRes.status}` }, { status: 500 });
        }
        const transcript = await aaiRes.json();
        if (transcript.status !== 'completed') {
          return Response.json({ error: `Transcript not ready: ${transcript.status}` }, { status: 400 });
        }
        utterances = (transcript.utterances || []).map(u => ({ start: u.start, end: u.end, text: u.text, speaker: u.speaker, words: u.words }));
        plan.language = transcript.language_code || 'en';
        plan.highlights = (transcript.auto_highlights_result?.results || []).map(h => h.text);
        const totalDurationMs = transcript.audio_duration ? transcript.audio_duration * 1000 : null;
        plan.gaps = findGaps(utterances, totalDurationMs);
      }

      // Re-segment from saved utterances
      const segments = buildRawSegments(utterances);
      const gaps = plan.gaps || [];
      const highlights = plan.highlights || [];
      const language = plan.language || 'en';
      const batches = buildBatches(segments);

      // Reset job state
      await base44.asServiceRole.entities.Job.update(job_db_id, {
        status: 'processing',
        result: null,
        error: null,
        pipelineLog: [{ step: '1_transcribe', status: 'ok', detail: 'Reprocess — using saved transcript data.', ts: new Date().toISOString() }],
        processingPlan: {
          ...plan,
          utterances: utterances,
          batches: batches.map(b => b.map(s => ({ start: s.start, end: s.end, text: s.text, speaker: s.speaker }))),
          totalBatches: batches.length,
          polishedCues: [],
        },
      });

      // Chain to first batch (use service role so token doesn't expire on long jobs)
      base44.asServiceRole.functions.invoke('processAICaption', {
        transcript_id: job.railwayJobId,
        job_db_id,
        action: 'process_batch',
        batch_index: 0,
      }).catch(err => console.error('[REPROCESS] Chain to batch 0 failed:', err.message));

      return Response.json({ status: 'reprocessing', batches: batches.length });
    }

    // ── ACTION: PROCESS_BATCH ────────────────────────────────────────────────
    if (action === 'process_batch') {
      const batchIndex = body.batch_index ?? 0;

      // Load the job and its processing plan
      const job = await base44.asServiceRole.entities.Job.get(job_db_id);
      
      // Guard: if job is already done (e.g. race condition), skip
      if (job.status === 'done') {
        console.log(`[BATCH ${batchIndex}] Job already done, skipping.`);
        return Response.json({ status: 'done' });
      }

      const plan = job.processingPlan;
      if (!plan || !plan.batches) {
        return Response.json({ error: 'No processing plan found' }, { status: 400 });
      }

      const totalBatches = plan.totalBatches;
      const batchSegments = plan.batches[batchIndex];
      if (!batchSegments) {
        return Response.json({ error: `Batch ${batchIndex} not found` }, { status: 400 });
      }

      const gaps = plan.gaps || [];
      const language = plan.language || 'en';
      const highlights = plan.highlights || [];

      // Compute gaps for this batch window
      const batchWindowStart = batchSegments[0].start;
      const batchWindowEnd = batchSegments[batchSegments.length - 1].end;
      const batchGaps = gaps.filter(g => g.start >= batchWindowStart - 2000 && g.end <= batchWindowEnd + 2000);

      console.log(`[BATCH ${batchIndex + 1}/${totalBatches}] Processing ${batchSegments.length} segments...`);

      await addLog(base44, job_db_id, `2_gpt_batch_${batchIndex + 1}_of_${totalBatches}`, 'running',
        `GPT-4o processing batch ${batchIndex + 1}/${totalBatches} (${batchSegments.length} segments)`);

      // Call GPT
      const polishedBatch = await polishBatchWithGPT(
        batchSegments, batchGaps, language, highlights, OPENAI_API_KEY, batchIndex, totalBatches
      );

      console.log(`[BATCH ${batchIndex + 1}/${totalBatches}] Got ${polishedBatch.length} cues from GPT`);

      // Update pipeline log with success
      await addLog(base44, job_db_id, `2_gpt_batch_${batchIndex + 1}_of_${totalBatches}`, 'ok',
        `Batch ${batchIndex + 1}/${totalBatches} done — ${polishedBatch.length} cues`);

      // Append polished cues to plan
      const freshJob = await base44.asServiceRole.entities.Job.get(job_db_id);
      const freshPlan = freshJob.processingPlan;
      const allPolished = [...(freshPlan.polishedCues || []), ...polishedBatch];

      await base44.asServiceRole.entities.Job.update(job_db_id, {
        processingPlan: { ...freshPlan, polishedCues: allPolished },
      });

      // Chain to next batch, or finalize
      if (batchIndex + 1 < totalBatches) {
        // Small delay to avoid rate limits
        await new Promise(r => setTimeout(r, 3000));
        
        base44.asServiceRole.functions.invoke('processAICaption', {
          transcript_id,
          job_db_id,
          action: 'process_batch',
          batch_index: batchIndex + 1,
        }).catch(err => console.error(`[BATCH ${batchIndex + 1}] Chain failed:`, err.message));

        return Response.json({ status: 'batch_done', batch: batchIndex, next: batchIndex + 1 });
      }

      // ── FINALIZE ─────────────────────────────────────────────────────────
      console.log(`[FINALIZE] All ${totalBatches} batches done. Enforcing rules...`);

      await addLog(base44, job_db_id, '3_finalize', 'running', 'Applying final formatting rules and QC...');

      const enforced = finalEnforce(allPolished);
      const qc = runQC(enforced);
      const srt = buildSRT(enforced);
      const vtt = buildVTT(enforced);
      const scc = buildSCC(enforced);
      const durationMs = enforced.length > 0 ? enforced[enforced.length - 1].end : 0;

      // Upload large text files to avoid entity field size limits
      const uploadText = async (content, filename, mimeType) => {
        const blob = new Blob([content], { type: mimeType });
        const formData = new FormData();
        formData.append('file', blob, filename);
        const uploadResult = await base44.asServiceRole.integrations.Core.UploadFile({ file: blob });
        return uploadResult.file_url;
      };

      console.log(`[FINALIZE] Uploading SRT/VTT/SCC files...`);
      const [srtUrl, vttUrl, sccUrl] = await Promise.all([
        uploadText(srt, `${job_db_id}.srt`, 'text/plain'),
        uploadText(vtt, `${job_db_id}.vtt`, 'text/plain'),
        uploadText(scc, `${job_db_id}.scc`, 'text/plain'),
      ]);

      await base44.asServiceRole.entities.Job.update(job_db_id, {
        status: 'done',
        result: {
          cues: enforced,
          srt_url: srtUrl,
          vtt_url: vttUrl,
          scc_url: sccUrl,
          qc,
          language,
        },
        durationMs,
        issuesCount: qc.issuesCount,
      });

      await addLog(base44, job_db_id, '3_finalize', 'ok',
        `Done! ${enforced.length} cues, ${qc.issuesCount} QC issues.`);

      console.log(`[FINALIZE] Job ${job_db_id} complete: ${enforced.length} cues, ${qc.issuesCount} issues`);

      return Response.json({ status: 'done', cues: enforced.length, issues: qc.issuesCount });
    }

    return Response.json({ error: `Unknown action: ${action}` }, { status: 400 });

  } catch (error) {
    console.error('[processAICaption] Error:', error.message);

    // Try to mark job as error
    try {
      const base44 = createClientFromRequest(req);
      const body = await req.json().catch(() => ({}));
      if (body.job_db_id) {
        await base44.asServiceRole.entities.Job.update(body.job_db_id, {
          status: 'error',
          error: error.message,
        });
      }
    } catch (_) { /* best effort */ }

    return Response.json({ error: error.message }, { status: 500 });
  }
});