import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

// ─── INTERNAL CHAIN SECRET & HELPERS ────────────────────────────────────────

const INTERNAL_CHAIN_SECRET = Deno.env.get("INTERNAL_CHAIN_SECRET") || "";

/** Break large strings into chunks to avoid entity/field size limits */
function chunkString(str, size = 75000) {
  const chunks = [];
  for (let i = 0; i < str.length; i += size) {
    chunks.push(str.slice(i, i + size));
  }
  return chunks;
}

/** Generate a unique runId */
function newRunId() {
  return (globalThis.crypto?.randomUUID?.() ??
    `${Date.now()}-${Math.random().toString(16).slice(2)}`);
}

/** True if this request is an internal chained call (not user-auth) */
function isInternalChain(payload) {
  if (!INTERNAL_CHAIN_SECRET) return false;
  return payload?.chain_secret === INTERNAL_CHAIN_SECRET;
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

// ─── GPT POLISH ──────────────────────────────────────────────────────────────

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
- NEVER put a dash on a single-speaker cue.

═══════════════════════════════════════
ORPHAN WORDS — CRITICAL:
═══════════════════════════════════════
- NEVER create a cue with just 1-3 words if those words are part of a larger sentence.
- Combine adjacent segments into one cue when the combined text fits in 2 lines × 32 chars.
- After you build your output, scan it: any cue with ≤3 words that doesn't end a sentence should be merged.

═══════════════════════════════════════
HARD RULES — NEVER VIOLATE:
═══════════════════════════════════════
- NEVER DROP OR OMIT spoken content.
- TIMECODES ARE LOCKED. Output the exact start/end ms from the input.
  Exception: when combining adjacent segments, use first start and last end.
  Exception: sound cues in gaps get the gap's start/end times.
- MAX 32 characters per line, MAX 2 lines per cue
- Cue duration must be ≥ 500ms
- Every sentence must end with . ? or !
- Preserve contractions as spoken. Do NOT censor.

═══════════════════════════════════════
SOUND/MUSIC CUE RULES:
═══════════════════════════════════════
- Music: [ ♪ DESCRIPTION ♪ ] — ALL CAPS. Max 32 chars.
- Sound: [DESCRIPTION] — ALL CAPS. Max 32 chars.
- Only insert into SILENCE GAPS. If no context, omit.

═══════════════════════════════════════
OUTPUT FORMAT:
═══════════════════════════════════════
Return ONLY a valid JSON array. No markdown. No code fences.
Each element: {"start": number, "end": number, "text": string, "speaker": string|null}
Use \\n for line breaks within 2-line cues.

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
            content: 'You are a broadcast caption editor. Output ONLY a valid JSON array. TIMECODES ARE LOCKED. Every line ≤32 chars, ≤2 lines per cue. Never drop content. Combine orphan cues. No dashes on single-speaker cues.',
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

  // ── Post-GPT cleanup: Strip dashes from single-speaker cues ──
  for (const cue of parsed) {
    if (!cue.text) continue;
    const lines = cue.text.split('\n');
    if (lines.length >= 2 && lines.every(l => l.trimStart().startsWith('- ')) && cue.speaker) {
      cue.text = lines.map(l => l.replace(/^- /, '')).join('\n');
    }
    if (lines.length === 1 && lines[0].startsWith('- ') && cue.speaker) {
      cue.text = cue.text.replace(/^- /, '');
    }
  }

  // ── Merge orphan cues ──
  const isSoundCueFn = (text) => text.startsWith('[') || text.includes('♪');
  const isCompleteSentence = (text) => {
    const trimmed = text.replace(/\n/g, ' ').trim();
    return /[.?!]$/.test(trimmed) && trimmed.split(/\s+/).length >= 2;
  };
  const repackLines = (text) => {
    const words = text.split(/\s+/).filter(Boolean);
    let line1 = '', line2 = '';
    for (const w of words) {
      if (!line1 || (line1 + ' ' + w).length <= 32) { line1 = line1 ? line1 + ' ' + w : w; }
      else if (!line2 || (line2 + ' ' + w).length <= 32) { line2 = line2 ? line2 + ' ' + w : w; }
      else { return null; }
    }
    const result = line2 ? line1 + '\n' + line2 : line1;
    if (result.split('\n').every(l => l.length <= 32)) return result;
    return null;
  };

  const merged = [];
  for (let i = 0; i < parsed.length; i++) {
    const cue = parsed[i];
    if (!cue.text || !cue.text.trim()) continue;
    if (isSoundCueFn(cue.text)) { merged.push(cue); continue; }
    const plainText = cue.text.replace(/\n/g, ' ').trim();
    const wordCount = plainText.split(/\s+/).length;
    const prevIdx = merged.length - 1;
    const prevCue = prevIdx >= 0 ? merged[prevIdx] : null;
    const prevIsSound = prevCue && isSoundCueFn(prevCue.text);

    if (wordCount <= 3 && !isCompleteSentence(plainText) && prevCue && !prevIsSound) {
      const combinedText = prevCue.text.replace(/\n/g, ' ').trim() + ' ' + plainText;
      const repacked = repackLines(combinedText);
      if (repacked) { merged[prevIdx] = { ...prevCue, end: cue.end, text: repacked }; continue; }
    }
    if (plainText.length < 20 && !/[.?!]$/.test(plainText) && prevCue && !prevIsSound) {
      const combinedText = prevCue.text.replace(/\n/g, ' ').trim() + ' ' + plainText;
      const repacked = repackLines(combinedText);
      if (repacked) { merged[prevIdx] = { ...prevCue, end: cue.end, text: repacked }; continue; }
    }
    merged.push(cue);
  }

  const finalMerged = [];
  for (let i = 0; i < merged.length; i++) {
    const cue = merged[i];
    if (isSoundCueFn(cue.text)) { finalMerged.push(cue); continue; }
    const plainText = cue.text.replace(/\n/g, ' ').trim();
    const wordCount = plainText.split(/\s+/).length;
    const nextCue = i + 1 < merged.length ? merged[i + 1] : null;
    const nextIsSound = nextCue && isSoundCueFn(nextCue.text);
    if (wordCount <= 2 && !isCompleteSentence(plainText) && nextCue && !nextIsSound) {
      const combinedText = plainText + ' ' + nextCue.text.replace(/\n/g, ' ').trim();
      const repacked = repackLines(combinedText);
      if (repacked) { merged[i + 1] = { ...nextCue, start: cue.start, text: repacked }; continue; }
    }
    finalMerged.push(cue);
  }

  return finalMerged;
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

    if (allOk) { result.push({ ...cue, text: lines.join('\n') }); continue; }

    if (isSoundCue) {
      const truncated = lines.map(l => l.substring(0, MAX_CHARS));
      const totalDur = cue.end - cue.start;
      const groupCount = Math.ceil(truncated.length / 2);
      for (let g = 0; g < groupCount; g++) {
        const groupLines = truncated.slice(g * 2, g * 2 + 2);
        const groupStart = cue.start + Math.round((g / groupCount) * totalDur);
        const groupEnd = g === groupCount - 1 ? cue.end : cue.start + Math.round(((g + 1) / groupCount) * totalDur);
        result.push({ start: groupStart, end: Math.max(groupStart + MIN_DUR, groupEnd), text: groupLines.join('\n'), speaker: cue.speaker });
      }
      continue;
    }

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
      if (candidate.length <= limit) { cur = candidate; }
      else { if (cur) packed.push(cur); cur = word; }
    }
    if (cur) packed.push(cur);
    if (packed.length === 0) continue;

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
    } else if (result[i].start - result[i - 1].end < MIN_GAP && result[i].start > result[i - 1].end) {
      result[i].start = result[i - 1].end + MIN_GAP;
    }
  }

  const isSndCue = (t) => t.startsWith('[') || t.includes('♪');
  const repack = (text) => {
    const words = text.split(/\s+/).filter(Boolean);
    let l1 = '', l2 = '';
    for (const w of words) {
      if (!l1 || (l1 + ' ' + w).length <= MAX_CHARS) { l1 = l1 ? l1 + ' ' + w : w; }
      else if (!l2 || (l2 + ' ' + w).length <= MAX_CHARS) { l2 = l2 ? l2 + ' ' + w : w; }
      else return null;
    }
    const r = l2 ? l1 + '\n' + l2 : l1;
    return r.split('\n').every(l => l.length <= MAX_CHARS) ? r : null;
  };

  for (let i = result.length - 1; i >= 0; i--) {
    const c = result[i];
    if (!c.text || isSndCue(c.text)) continue;
    const plain = c.text.replace(/\n/g, ' ').trim();
    const wc = plain.split(/\s+/).length;
    if (wc > 2) continue;
    if (i > 0 && !isSndCue(result[i-1].text)) {
      const combo = result[i-1].text.replace(/\n/g, ' ').trim() + ' ' + plain;
      const repacked = repack(combo);
      if (repacked) { result[i-1] = { ...result[i-1], end: c.end, text: repacked }; result.splice(i, 1); continue; }
    }
    if (i < result.length - 1 && !isSndCue(result[i+1].text)) {
      const combo = plain + ' ' + result[i+1].text.replace(/\n/g, ' ').trim();
      const repacked = repack(combo);
      if (repacked) { result[i+1] = { ...result[i+1], start: c.start, text: repacked }; result.splice(i, 1); continue; }
    }
  }

  for (const c of result) {
    if (!c.text || isSndCue(c.text)) continue;
    const lines = c.text.split('\n');
    if (lines.length >= 2 && lines.every(l => l.startsWith('- ')) && c.speaker) {
      c.text = lines.map(l => l.replace(/^- /, '')).join('\n');
    }
    if (lines.length === 1 && lines[0].startsWith('- ') && c.speaker) {
      c.text = c.text.replace(/^- /, '');
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
    if (!isSoundCue && charCount / (dur / 1000) > 25) {
      issues.push({ cue: i, type: 'reading_speed', value: `${(charCount/(dur/1000)).toFixed(1)} CPS (too fast)` });
    }
    if (i > 0) {
      const gap = c.start - cues[i - 1].end;
      if (gap < 0) issues.push({ cue: i, type: 'overlap', value: `${Math.abs(gap)}ms overlap` });
      else if (gap < 67) issues.push({ cue: i, type: 'gap_too_small', value: `${gap}ms (min 67ms)` });
    }
    if (!isSoundCue && c.text.trim().length > 0) {
      const lastLine = lines[lines.length - 1].replace(/^- /, '').trim();
      const lastChar = lastLine[lastLine.length - 1];
      if (!['.', '?', '!', '…', '"', "'"].includes(lastChar) && !lastLine.endsWith('--') && !lastLine.endsWith('—')) {
        issues.push({ cue: i, type: 'missing_punctuation', value: `Ends with "${lastChar}"` });
      }
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
// ARCHITECTURE: Process up to 3 batches per invocation, then HTTP-chain to self
// for the remaining batches. This avoids the 150s timeout while keeping batches
// sequential. No asServiceRole.functions.invoke (which causes 403).
//
// Actions:
//   "start"         — fetch transcript, pre-segment, start processing batches
//   "process_batch" — process up to 3 batches, chain or finalize
//   "reprocess"     — reset job, re-run GPT on saved transcript data

const BATCHES_PER_INVOCATION = 3;

Deno.serve(async (req) => {
  const reqClone = req.clone();
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
    const internal = isInternalChain(body);

    // Only require a real user for start/reprocess actions.
    // process_batch is allowed for internal chain calls.
    if (!internal) {
      const user = await base44.auth.me();
      if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Internal calls cannot start/reprocess jobs (safety guard).
    if (internal && (action === 'start' || action === 'reprocess')) {
      return Response.json({ error: 'Internal chain cannot perform start/reprocess' }, { status: 403 });
    }

    const transcript_id = body.transcript_id;
    job_db_id = body.job_db_id;

    if (!action || !job_db_id) {
      return Response.json({ error: 'action and job_db_id required' }, { status: 400 });
    }

    const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY');
    const ASSEMBLYAI_API_KEY = Deno.env.get('ASSEMBLYAI_API_KEY');

    // ── Helper: chain to next batch via internal secret (no user token needed) ──
    async function chainToSelf(payload) {
      const selfUrl = reqClone.url;
      const headers = { 'Content-Type': 'application/json' };
      // Forward SDK-required headers (NOT Authorization) so createClientFromRequest works
      for (const h of ['x-app-id', 'x-workspace-id', 'x-project-id']) {
        const val = reqClone.headers.get(h);
        if (val) headers[h] = val;
      }

      try {
        const res = await fetch(selfUrl, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            ...payload,
            chain_secret: INTERNAL_CHAIN_SECRET,
          }),
        });
        if (!res.ok) {
          const text = await res.text();
          console.error(`[CHAIN ERROR] ${res.status}: ${text}`);
          // Mark job as error so it doesn't stay stuck
          await base44.asServiceRole.entities.Job.update(job_db_id, {
            status: 'error',
            error: `Chain call failed (${res.status}): ${text.substring(0, 200)}`,
          });
        }
      } catch (err) {
        console.error('[CHAIN NETWORK ERROR]', err.message);
        await base44.asServiceRole.entities.Job.update(job_db_id, {
          status: 'error',
          error: `Chain network error: ${err.message}`,
        });
      }
    }

    // ── ACTION: START ────────────────────────────────────────────────────────
    if (action === 'start') {
      if (!transcript_id) return Response.json({ error: 'transcript_id required for start' }, { status: 400 });

      console.log(`[START] Fetching transcript ${transcript_id} for job ${job_db_id}`);
      await addLog(base44, job_db_id, '1_transcribe', 'ok', 'AssemblyAI transcription completed.');

      const aaiRes = await fetch(`https://api.assemblyai.com/v2/transcript/${transcript_id}`, {
        headers: { 'authorization': ASSEMBLYAI_API_KEY },
      });
      if (!aaiRes.ok) throw new Error(`AssemblyAI fetch failed: ${aaiRes.status}`);
      const transcript = await aaiRes.json();
      if (transcript.status !== 'completed') throw new Error(`Transcript not ready: ${transcript.status}`);

      const utterances = transcript.utterances || [];
      const language = transcript.language_code || 'en';
      const highlights = (transcript.auto_highlights_result?.results || []).map(h => h.text);
      const totalDurationMs = transcript.audio_duration ? transcript.audio_duration * 1000 : null;

      const segments = buildRawSegments(utterances);
      const gaps = findGaps(utterances, totalDurationMs);
      const batches = buildBatches(segments);
      const runId = newRunId();

      console.log(`[START] ${segments.length} segments, ${batches.length} batches, ${gaps.length} gaps, lang=${language}, runId=${runId}`);

      await base44.asServiceRole.entities.Job.update(job_db_id, {
        processingPlan: {
          batches: batches.map(b => b.map(s => ({ start: s.start, end: s.end, text: s.text, speaker: s.speaker }))),
          gaps, highlights, language,
          totalBatches: batches.length,
          polishedCues: [],
          runId,
          utterances: utterances.map(u => ({ start: u.start, end: u.end, text: u.text, speaker: u.speaker, words: u.words })),
        },
      });

      // Chain to process_batch using internal secret
      await chainToSelf({ action: 'process_batch', job_db_id, transcript_id, batch_index: 0, runId });

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

      // Chain to process_batch using internal secret
      await chainToSelf({ action: 'process_batch', job_db_id, transcript_id: job.railwayJobId, batch_index: 0, runId });

      return Response.json({ status: 'reprocessing', batches: batches.length });
    }

    // ── ACTION: PROCESS_BATCH ────────────────────────────────────────────────
    if (action === 'process_batch') {
      let batchIndex = body.batch_index ?? 0;

      const job = await base44.asServiceRole.entities.Job.get(job_db_id);
      if (job.status === 'done') {
        console.log(`[BATCH ${batchIndex}] Job already done, skipping.`);
        return Response.json({ status: 'done' });
      }

      const plan = job.processingPlan;
      if (!plan || !plan.batches) return Response.json({ error: 'No processing plan' }, { status: 400 });

      // ── Zombie/stale chain guard ──
      if (!plan.runId || body.runId !== plan.runId) {
        console.log(`[process_batch] Ignoring stale chain call. payload runId=${body?.runId} current runId=${plan?.runId}`);
        return Response.json({ status: 'stale_ignored' });
      }

      // Persist currentBatchIndex so recovery knows where we are
      await base44.asServiceRole.entities.Job.update(job_db_id, {
        processingPlan: { ...plan, currentBatchIndex: batchIndex },
      });

      const totalBatches = plan.totalBatches;
      const gaps = plan.gaps || [];
      const language = plan.language || 'en';
      const highlights = plan.highlights || [];

      // Process up to BATCHES_PER_INVOCATION batches in this call
      let processedCount = 0;
      let allNewCues = [];

      while (batchIndex < totalBatches && processedCount < BATCHES_PER_INVOCATION) {
        const batchSegments = plan.batches[batchIndex];
        if (!batchSegments || batchSegments.length === 0) { batchIndex++; continue; }

        const batchWindowStart = batchSegments[0].start;
        const batchWindowEnd = batchSegments[batchSegments.length - 1].end;
        const batchGaps = gaps.filter(g => g.start >= batchWindowStart - 2000 && g.end <= batchWindowEnd + 2000);

        console.log(`[BATCH ${batchIndex + 1}/${totalBatches}] Processing ${batchSegments.length} segments...`);
        await addLog(base44, job_db_id, `2_gpt_batch_${batchIndex + 1}_of_${totalBatches}`, 'running',
          `GPT-4o processing batch ${batchIndex + 1}/${totalBatches} (${batchSegments.length} segments)`);

        const polishedBatch = await polishBatchWithGPT(
          batchSegments, batchGaps, language, highlights, OPENAI_API_KEY, batchIndex, totalBatches
        );

        allNewCues.push(...polishedBatch);
        console.log(`[BATCH ${batchIndex + 1}/${totalBatches}] Got ${polishedBatch.length} cues`);

        await addLog(base44, job_db_id, `2_gpt_batch_${batchIndex + 1}_of_${totalBatches}`, 'ok',
          `Batch ${batchIndex + 1}/${totalBatches} done — ${polishedBatch.length} cues`);

        batchIndex++;
        processedCount++;

        // Small delay between batches
        if (processedCount < BATCHES_PER_INVOCATION && batchIndex < totalBatches) {
          await new Promise(r => setTimeout(r, 2000));
        }
      }

      // Save all new polished cues
      const freshJob = await base44.asServiceRole.entities.Job.get(job_db_id);
      const freshPlan = freshJob.processingPlan;
      const allPolished = [...(freshPlan.polishedCues || []), ...allNewCues];

      await base44.asServiceRole.entities.Job.update(job_db_id, {
        processingPlan: { ...freshPlan, polishedCues: allPolished },
      });

      // More batches remaining — chain to self with runId
      if (batchIndex < totalBatches) {
        console.log(`[CHAIN] Processed ${processedCount} batches, chaining to batch ${batchIndex}...`);
        await chainToSelf({ action: 'process_batch', job_db_id, transcript_id, batch_index: batchIndex, runId: body.runId });
        return Response.json({ status: 'batch_chunk_done', next_batch: batchIndex, total: totalBatches });
      }

      // All batches done — chain to finalize in its own invocation to avoid timeout
      console.log(`[CHAIN] All ${totalBatches} batches done. Chaining to finalize...`);
      await chainToSelf({ action: 'finalize', job_db_id, runId: body.runId });
      return Response.json({ status: 'finalizing', total: totalBatches });
    }

    // ── ACTION: FINALIZE ───────────────────────────────────────────────────
    if (action === 'finalize') {
      const job = await base44.asServiceRole.entities.Job.get(job_db_id);
      if (job.status === 'done') return Response.json({ status: 'already_done' });

      const plan = job.processingPlan;
      if (!plan) return Response.json({ error: 'No processing plan' }, { status: 400 });

      // Zombie guard
      if (!plan.runId || body.runId !== plan.runId) {
        console.log(`[finalize] Ignoring stale call. payload runId=${body?.runId} current runId=${plan?.runId}`);
        return Response.json({ status: 'stale_ignored' });
      }

      const allPolished = plan.polishedCues || [];
      const language = plan.language || 'en';

      console.log(`[FINALIZE] Enforcing rules on ${allPolished.length} cues...`);
      await addLog(base44, job_db_id, '3_finalize', 'running', 'Applying final formatting rules and QC...');

      const enforced = finalEnforce(allPolished);
      const qc = runQC(enforced);
      const srt = buildSRT(enforced);
      const vtt = buildVTT(enforced);
      const scc = buildSCC(enforced);
      const durationMs = enforced.length > 0 ? enforced[enforced.length - 1].end : 0;

      // Chunk large export strings to avoid field size limits
      const srtChunks = chunkString(srt);
      const vttChunks = chunkString(vtt);
      const sccChunks = chunkString(scc);

      await base44.asServiceRole.entities.Job.update(job_db_id, {
        status: 'done',
        result: {
          cues: enforced,
          srt_chunks: srtChunks,
          vtt_chunks: vttChunks,
          scc_chunks: sccChunks,
          qc, language,
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
    try {
      if (job_db_id) {
        await base44.asServiceRole.entities.Job.update(job_db_id, { status: 'error', error: error.message });
      }
    } catch (_) {}
    return Response.json({ error: error.message }, { status: 500 });
  }
});