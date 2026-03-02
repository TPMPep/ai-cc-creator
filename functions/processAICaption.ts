import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

// processAICaption v10 — 2026-03-02
// FULLY SELF-CONTAINED: No worker chaining. Processes all GPT batches + finalize inline.
// Handles START and REPROCESS actions.

function chunkString(str, size = 40000) {
  const chunks = [];
  for (let i = 0; i < str.length; i += size) chunks.push(str.slice(i, i + size));
  return chunks;
}

// ─── TIMECODE UTILITIES ─────────────────────────────────────────────────────

function msToSCCTimecode(ms) {
  const totalFrames = Math.floor(ms / (1000 / 29.97));
  const fps = 30, dropFrames = 2;
  const framesPerMin = fps * 60;
  const framesPerTenMin = framesPerMin * 10 - dropFrames * 9;
  const d = Math.floor(totalFrames / framesPerTenMin);
  const m = totalFrames % framesPerTenMin;
  let frames;
  if (m < dropFrames) frames = m + d * framesPerTenMin;
  else frames = totalFrames + dropFrames * 9 * d + dropFrames * (Math.floor((m - dropFrames) / (framesPerMin - dropFrames)));
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
      } else bytes.push(`${code.toString(16).padStart(2,'0')}80`);
    }
  }
  return bytes;
}

function buildSCCLine(ms, text) {
  const tc = msToSCCTimecode(ms);
  return `${tc}\t${ ['942c','9420',...textToSCCBytes(text),'942f'].join(' ') }`;
}

function fmtMs(ms, sep = ',') {
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const ms2 = ms % 1000;
  return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}${sep}${String(ms2).padStart(3,'0')}`;
}

function buildSRT(cues) { return cues.map((c,i) => `${i+1}\n${fmtMs(c.start)} --> ${fmtMs(c.end)}\n${c.text}\n`).join('\n'); }
function buildVTT(cues) { return `WEBVTT\n\n${cues.map(c => `${fmtMs(c.start,'.')} --> ${fmtMs(c.end,'.')}\n${c.text}`).join('\n\n')}`; }
function buildSCC(cues) {
  const lines = ['Scenarist_SCC V1.0', ''];
  for (const cue of cues) {
    lines.push(`${msToSCCTimecode(cue.start)}\t942e`);
    for (const line of cue.text.split('\n')) { if (line.trim()) lines.push(buildSCCLine(cue.start, line.trim())); }
    lines.push(`${msToSCCTimecode(cue.end)}\t942e`);
    lines.push('');
  }
  return lines.join('\n');
}

// ─── PRE-SEGMENT ────────────────────────────────────────────────────────────

function buildRawSegments(utterances) {
  const MAX_DUR = 7500;
  const segments = [];
  for (const utt of utterances) {
    const words = utt.words || [];
    if (!words.length) { segments.push({ start: utt.start, end: utt.end, text: utt.text, speaker: utt.speaker, words }); continue; }
    const uttDur = words[words.length - 1].end - words[0].start;
    if (uttDur <= MAX_DUR) {
      segments.push({ start: words[0].start, end: words[words.length - 1].end, text: words.map(w => w.text).join(' '), speaker: utt.speaker, words });
      continue;
    }
    let chunkStart = 0;
    while (chunkStart < words.length) {
      let chunkEnd = chunkStart;
      const firstWordStart = words[chunkStart].start;
      for (let j = chunkStart; j < words.length; j++) { if (words[j].end - firstWordStart <= MAX_DUR) chunkEnd = j; else break; }
      const remainingCount = words.length - (chunkEnd + 1);
      if (remainingCount > 0 && remainingCount < 4) {
        const allWords = words.slice(chunkStart);
        segments.push({ start: allWords[0].start, end: allWords[allWords.length - 1].end, text: allWords.map(w => w.text).join(' '), speaker: utt.speaker, words: allWords });
        chunkStart = words.length;
        continue;
      }
      const chunkWords = words.slice(chunkStart, chunkEnd + 1);
      segments.push({ start: chunkWords[0].start, end: chunkWords[chunkWords.length - 1].end, text: chunkWords.map(w => w.text).join(' '), speaker: utt.speaker, words: chunkWords });
      chunkStart = chunkEnd + 1;
    }
  }
  return segments;
}

function findGaps(utterances, totalDurationMs) {
  const gaps = [];
  let prevEnd = 0;
  for (const utt of utterances) { if (utt.start - prevEnd > 2000) gaps.push({ start: prevEnd, end: utt.start }); prevEnd = utt.end; }
  if (totalDurationMs && totalDurationMs - prevEnd > 2000) gaps.push({ start: prevEnd, end: totalDurationMs });
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
    if (crossedWindow || isLast) { batches.push(segments.slice(batchStart, i)); batchStart = i; }
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

// ─── GPT POLISH ─────────────────────────────────────────────────────────────

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

You will receive pre-timed caption segments from a transcription API. Your job is to produce broadcast-quality closed captions using intelligent, linguistically-aware segmentation.

═══════════════════════════════════════
YOUR TASKS:
═══════════════════════════════════════
1. Be TRUE to what is said. Every spoken word MUST appear in the output. NEVER drop, paraphrase, or summarize.
2. Fix grammar, punctuation, and homophones — but preserve how people actually speak (gonna, wanna, don't, ain't, etc.)
3. Format each cue: ≤32 characters per line, ≤2 lines per cue
4. Choose SMART line breaks using the HIERARCHICAL RULES below
5. Insert sound/music cues into SILENCE GAPS where appropriate
6. Timecodes on screen must match when words are actually spoken

═══════════════════════════════════════
PRIORITY 1 — PRESERVE SEMANTIC UNITS
(NON-NEGOTIABLE — NEVER SPLIT THESE):
═══════════════════════════════════════
A. PROPER NOUNS: Never split person names, city/country names, organization names, or brand names across lines.
   ❌ "Los\\nAngeles"  ❌ "New\\nYork City"  ❌ "Andy\\nCohen"
   ✓ Keep the full name on one line.

B. TITLES & NAMED WORKS: Never split TV show names, film titles, book titles, episode names, song titles, franchise names, or event names.
   ❌ "Watch What\\nHappens Live"  ❌ "Below\\nDeck Med"  ❌ "Game of\\nThrones"
   ✓ Treat multi-word titles as single atomic units that must stay on one line.

C. CONTEXTUAL TITLES & BRANDED PHRASES: Use contextual inference to detect when a phrase functions as a show title, program name, product name, or branded segment — even if capitalization is inconsistent in the transcript input.
   Example: "Watch What Happens Live" must never be split even if transcript says "watch what happens live."

D. SPEAKER LABELS: Never separate a speaker identifier (dash prefix) from its dialogue.

E. HYPHENATED/COMPOUND WORDS: Never split hyphenated words across lines (e.g., "award-winning" stays together).

═══════════════════════════════════════
PRIORITY 2 — SOUND CUE SEPARATION:
═══════════════════════════════════════
When a cue contains BOTH a sound cue and dialogue, separate them:
   ✓ Preferred: "[LAUGHTER]\\nThat was so funny!"
   ❌ Avoid: "[LAUGHTER] That was\\nso funny!"
Sound cues ([...] or ♪) are independent semantic units. Give them their own line when possible. Only merge mid-line if character constraints make separation impossible.

═══════════════════════════════════════
PRIORITY 3 — SMART LINE BREAKING
(Linguistic Boundary Preference):
═══════════════════════════════════════
When splitting text into two lines within a cue, choose breakpoints in this order:
  1. After a full sentence (. ? !)
  2. After a comma
  3. After a complete clause
  4. At a natural phrase boundary

NEVER break between:
  • Article + noun ("the\\nshow" ❌)
  • Adjective + noun ("beautiful\\nday" ❌)
  • Auxiliary verb + main verb ("was\\ngoing" ❌)
  • Inside verb phrases ("should have\\nbeen" ❌)
  • Inside prepositional phrases ("in the\\nmorning" ❌)
  • Inside idiomatic expressions
  • Number + unit ("20\\nyears" ❌)

FALLBACK ORDER when no ideal break exists:
  1. Preserve named entities (hard constraint)
  2. Preserve phrase integrity
  3. Choose least disruptive grammatical boundary
  4. Only then consider character symmetry

Favor SEMANTIC CORRECTNESS over visual line balance.

═══════════════════════════════════════
PRIORITY 4 — EVENT SPLITTING:
═══════════════════════════════════════
If text must be split across multiple cues:
  • Prefer splitting at sentence boundaries
  • Avoid splitting mid-thought across cues
  • Each cue must remain semantically coherent
  • Only split mid-sentence when absolutely required by duration constraints

═══════════════════════════════════════
SPEAKER DASHES — CRITICAL:
═══════════════════════════════════════
- When TWO DIFFERENT SPEAKERS share the SAME cue, EACH speaker's text MUST start on its own line with "- " prefix.
- Example of correct dual-speaker cue: "- Speaker A's text\\n- Speaker B's text"
- The second speaker MUST ALWAYS start on a NEW LINE. Never put two speakers on the same line.
- NEVER put a dash on a single-speaker cue (only one speaker in the cue = no dashes).

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
            content: 'You are a broadcast caption editor using intelligent linguistic segmentation. Output ONLY a valid JSON array. TIMECODES ARE LOCKED. Every line ≤32 chars, ≤2 lines per cue. Never drop content. Combine orphan cues. No dashes on single-speaker cues. When two speakers share a cue, each speaker MUST start on a separate line prefixed with "- ". CRITICAL LINE-BREAK RULES: NEVER split proper nouns, show/film/song titles, branded phrases, or hyphenated words across lines. NEVER break between article+noun, adjective+noun, auxiliary+main verb, inside verb/prepositional phrases, or number+unit. Prefer breaks after sentences, commas, clauses, then phrase boundaries. Favor semantic correctness over visual balance. Sound cues get their own line when possible.',
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

  const usage = data.usage || {};
  const batchTokens = {
    inputTokens: usage.prompt_tokens || 0,
    outputTokens: usage.completion_tokens || 0,
  };

  const parsed = JSON.parse(jsonMatch[0]);

  // Post-GPT cleanup: Strip dashes from single-speaker cues
  for (const cue of parsed) {
    if (!cue.text) continue;
    const lines = cue.text.split('\n');
    const dashedLines = lines.filter(l => l.trimStart().startsWith('- '));
    if (dashedLines.length >= 2) continue; // multi-speaker — keep dashes
    if (lines.length === 1 && lines[0].startsWith('- ')) {
      cue.text = cue.text.replace(/^- /, '');
    }
  }

  // Merge orphan cues — SPEAKER-AWARE: never plain-merge across different speakers
  const isSoundCueFn = (text) => text.startsWith('[') || text.includes('♪');
  const containsSoundCue = (text) => /\[[^\]]*\]/.test(text) || text.includes('♪');
  const isMultiSpeakerCue = (cue) => {
    if (!cue.text) return false;
    const lines = cue.text.split('\n');
    return lines.length >= 2 && lines.filter(l => l.startsWith('- ')).length >= 2;
  };
  const isCompleteSentence = (text) => {
    const trimmed = text.replace(/\n/g, ' ').trim();
    return /[.?!]$/.test(trimmed) && trimmed.split(/\s+/).length >= 2;
  };
  const repackLines = (text) => {
    // NEVER repack text that contains sound cues — it destroys sound cue line separation
    if (containsSoundCue(text)) return null;
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
  // Build a dual-speaker cue with dashes on each line
  const buildDualSpeakerCue = (textA, textB) => {
    // Never merge if either side contains sound cues
    if (containsSoundCue(textA) || containsSoundCue(textB)) return null;
    const lineA = '- ' + textA.replace(/\n/g, ' ').replace(/^- /, '').trim();
    const lineB = '- ' + textB.replace(/\n/g, ' ').replace(/^- /, '').trim();
    if (lineA.length > 32 || lineB.length > 32) return null;
    return lineA + '\n' + lineB;
  };

  const merged = [];
  for (let i = 0; i < parsed.length; i++) {
    const cue = parsed[i];
    if (!cue.text || !cue.text.trim()) continue;
    // Never merge sound cues or cues containing sound cues
    if (isSoundCueFn(cue.text) || containsSoundCue(cue.text)) { merged.push(cue); continue; }
    // Never merge multi-speaker cues
    if (isMultiSpeakerCue(cue)) { merged.push(cue); continue; }

    const plainText = cue.text.replace(/\n/g, ' ').replace(/^- /, '').trim();
    const wordCount = plainText.split(/\s+/).length;
    const prevIdx = merged.length - 1;
    const prevCue = prevIdx >= 0 ? merged[prevIdx] : null;
    const prevIsSound = prevCue && (isSoundCueFn(prevCue.text) || containsSoundCue(prevCue.text));
    const prevIsMultiSpeaker = prevCue && isMultiSpeakerCue(prevCue);
    const sameSpeaker = prevCue && cue.speaker && prevCue.speaker && cue.speaker === prevCue.speaker;
    const differentSpeaker = prevCue && cue.speaker && prevCue.speaker && cue.speaker !== prevCue.speaker;

    // If different speaker from prev, try to build a dual-speaker cue with dashes
    const cueDuration = cue.end - cue.start;
    const gapFromPrev = prevCue ? cue.start - prevCue.end : Infinity;
    const shouldMergeDiffSpeaker = differentSpeaker && !prevIsSound && !prevIsMultiSpeaker && (
      (wordCount <= 4) ||
      (cueDuration < 1500) ||
      (gapFromPrev < 500)
    );
    if (shouldMergeDiffSpeaker) {
      const prevPlain = prevCue.text.replace(/\n/g, ' ').replace(/^- /, '').trim();
      const dual = buildDualSpeakerCue(prevPlain, plainText);
      if (dual) { merged[prevIdx] = { ...prevCue, end: cue.end, text: dual, speaker: null }; continue; }
    }

    // Only plain-merge if SAME speaker (or no speaker info)
    if (wordCount <= 3 && !isCompleteSentence(plainText) && prevCue && !prevIsSound && !prevIsMultiSpeaker && (sameSpeaker || !cue.speaker || !prevCue.speaker)) {
      const combinedText = prevCue.text.replace(/\n/g, ' ').replace(/^- /, '').trim() + ' ' + plainText;
      const repacked = repackLines(combinedText);
      if (repacked) { merged[prevIdx] = { ...prevCue, end: cue.end, text: repacked }; continue; }
    }
    if (plainText.length < 20 && !/[.?!]$/.test(plainText) && prevCue && !prevIsSound && !prevIsMultiSpeaker && (sameSpeaker || !cue.speaker || !prevCue.speaker)) {
      const combinedText = prevCue.text.replace(/\n/g, ' ').replace(/^- /, '').trim() + ' ' + plainText;
      const repacked = repackLines(combinedText);
      if (repacked) { merged[prevIdx] = { ...prevCue, end: cue.end, text: repacked }; continue; }
    }
    merged.push(cue);
  }

  // Forward merge — also speaker-aware
  const finalMerged = [];
  for (let i = 0; i < merged.length; i++) {
    const cue = merged[i];
    if (isSoundCueFn(cue.text) || containsSoundCue(cue.text)) { finalMerged.push(cue); continue; }
    if (isMultiSpeakerCue(cue)) { finalMerged.push(cue); continue; }
    const plainText = cue.text.replace(/\n/g, ' ').replace(/^- /, '').trim();
    const wordCount = plainText.split(/\s+/).length;
    const nextCue = i + 1 < merged.length ? merged[i + 1] : null;
    const nextIsSound = nextCue && (isSoundCueFn(nextCue.text) || containsSoundCue(nextCue.text));
    const nextIsMultiSpeaker = nextCue && isMultiSpeakerCue(nextCue);
    const sameSpeaker = nextCue && cue.speaker && nextCue.speaker && cue.speaker === nextCue.speaker;
    const differentSpeaker = nextCue && cue.speaker && nextCue.speaker && cue.speaker !== nextCue.speaker;

    const fwdCueDuration = cue.end - cue.start;
    const fwdGapToNext = nextCue ? nextCue.start - cue.end : Infinity;
    const shouldFwdMerge = nextCue && !nextIsSound && !nextIsMultiSpeaker && (
      wordCount <= 2 || fwdCueDuration < 1500 || fwdGapToNext < 500
    );
    if (shouldFwdMerge && !isCompleteSentence(plainText)) {
      // Different speaker? Build dual-speaker cue
      if (differentSpeaker) {
        const nextPlain = nextCue.text.replace(/\n/g, ' ').replace(/^- /, '').trim();
        const dual = buildDualSpeakerCue(plainText, nextPlain);
        if (dual) { merged[i + 1] = { ...nextCue, start: cue.start, text: dual, speaker: null }; continue; }
      }
      // Same speaker — plain merge
      if ((sameSpeaker || !cue.speaker || !nextCue.speaker) && wordCount <= 2) {
        const combinedText = plainText + ' ' + nextCue.text.replace(/\n/g, ' ').replace(/^- /, '').trim();
        const repacked = repackLines(combinedText);
        if (repacked) { merged[i + 1] = { ...nextCue, start: cue.start, text: repacked }; continue; }
      }
    }
    finalMerged.push(cue);
  }

  return { cues: finalMerged, tokens: batchTokens };
}

// ─── FINAL ENFORCEMENT ──────────────────────────────────────────────────────

function finalEnforce(cues) {
  const MAX_CHARS = 32, MIN_DUR = 500, MIN_GAP = 67;
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

    const hasDashes = lines.length >= 2 && lines.filter(l => l.startsWith('- ')).length >= 2;

    // Multi-speaker cues with dashes: repack each speaker's line independently
    if (hasDashes) {
      const repackedLines = lines.map(l => {
        if (l.length <= MAX_CHARS) return l;
        // Truncate the speaker line to fit (rare, but safety)
        return l.substring(0, MAX_CHARS);
      });
      // If it still fits in ≤2 lines, emit as-is
      if (repackedLines.length <= 2) {
        result.push({ ...cue, text: repackedLines.join('\n'), speaker: cue.speaker });
      } else {
        // More than 2 dashed lines — split into multiple cues
        const totalDur = cue.end - cue.start;
        const chunkCount = Math.ceil(repackedLines.length / 2);
        for (let ci = 0; ci < chunkCount; ci++) {
          const chunk = repackedLines.slice(ci * 2, ci * 2 + 2);
          const chunkStart = cue.start + Math.round((ci / chunkCount) * totalDur);
          const chunkEnd = ci === chunkCount - 1 ? cue.end : cue.start + Math.round(((ci + 1) / chunkCount) * totalDur);
          result.push({ start: chunkStart, end: Math.max(chunkStart + MIN_DUR, chunkEnd), text: chunk.join('\n'), speaker: cue.speaker });
        }
      }
      continue;
    }

    // Single-speaker cue that's too long — repack without dashes
    const stripped = lines.map(l => l.replace(/^- /, '')).join(' ');
    const words = stripped.split(/\s+/).filter(Boolean);
    if (words.length === 0) continue;
    const packed = [];
    let cur = '';
    for (const word of words) {
      const candidate = cur ? `${cur} ${word}` : word;
      if (candidate.length <= MAX_CHARS) { cur = candidate; }
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
      result.push({ start: chunkStart, end: Math.max(chunkStart + MIN_DUR, chunkEnd), text: chunk.join('\n'), speaker: cue.speaker });
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
  const hasSndCue = (t) => /\[[^\]]*\]/.test(t) || t.includes('♪');
  const isMultiSpk = (c) => {
    if (!c.text) return false;
    const lines = c.text.split('\n');
    return lines.length >= 2 && lines.filter(l => l.startsWith('- ')).length >= 2;
  };
  const repack = (text) => {
    // Never repack text containing sound cues
    if (hasSndCue(text)) return null;
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

  // Build dual-speaker cue helper for finalEnforce
  const buildDual = (textA, textB) => {
    if (hasSndCue(textA) || hasSndCue(textB)) return null;
    const lineA = '- ' + textA.replace(/\n/g, ' ').replace(/^- /, '').trim();
    const lineB = '- ' + textB.replace(/\n/g, ' ').replace(/^- /, '').trim();
    if (lineA.length > MAX_CHARS || lineB.length > MAX_CHARS) return null;
    return lineA + '\n' + lineB;
  };

  for (let i = result.length - 1; i >= 0; i--) {
    const c = result[i];
    if (!c.text || isSndCue(c.text) || hasSndCue(c.text)) continue;
    // Never merge multi-speaker cues or merge INTO multi-speaker cues
    if (isMultiSpk(c)) continue;
    const plain = c.text.replace(/\n/g, ' ').replace(/^- /, '').trim();
    const wc = plain.split(/\s+/).length;
    const cDur = c.end - c.start;
    const isShortCue = wc <= 4 || cDur < 1500;
    if (!isShortCue) continue;

    // Try backward merge — skip if neighbor contains sound cues
    if (i > 0 && !isSndCue(result[i-1].text) && !hasSndCue(result[i-1].text) && !isMultiSpk(result[i-1])) {
      const prev = result[i-1];
      const sameSpeaker = c.speaker && prev.speaker && c.speaker === prev.speaker;
      const differentSpeaker = c.speaker && prev.speaker && c.speaker !== prev.speaker;
      const noSpeakerInfo = !c.speaker || !prev.speaker;
      const gapFromPrev = c.start - prev.end;

      // Different speaker + close proximity → dual-speaker cue
      if (differentSpeaker && (gapFromPrev < 500 || cDur < 1500 || wc <= 4)) {
        const prevPlain = prev.text.replace(/\n/g, ' ').replace(/^- /, '').trim();
        const dual = buildDual(prevPlain, plain);
        if (dual) { result[i-1] = { ...prev, end: c.end, text: dual, speaker: null }; result.splice(i, 1); continue; }
      }
      // Same speaker → plain merge
      if ((sameSpeaker || noSpeakerInfo) && wc <= 2) {
        const combo = prev.text.replace(/\n/g, ' ').replace(/^- /, '').trim() + ' ' + plain;
        const repacked = repack(combo);
        if (repacked) { result[i-1] = { ...prev, end: c.end, text: repacked }; result.splice(i, 1); continue; }
      }
    }
    // Try forward merge — skip if neighbor contains sound cues
    if (i < result.length - 1 && !isSndCue(result[i+1].text) && !hasSndCue(result[i+1].text) && !isMultiSpk(result[i+1])) {
      const next = result[i+1];
      const sameSpeaker = c.speaker && next.speaker && c.speaker === next.speaker;
      const differentSpeaker = c.speaker && next.speaker && c.speaker !== next.speaker;
      const noSpeakerInfo = !c.speaker || !next.speaker;
      const gapToNext = next.start - c.end;

      // Different speaker + close proximity → dual-speaker cue
      if (differentSpeaker && (gapToNext < 500 || cDur < 1500 || wc <= 4)) {
        const nextPlain = next.text.replace(/\n/g, ' ').replace(/^- /, '').trim();
        const dual = buildDual(plain, nextPlain);
        if (dual) { result[i+1] = { ...next, start: c.start, text: dual, speaker: null }; result.splice(i, 1); continue; }
      }
      // Same speaker → plain merge
      if ((sameSpeaker || noSpeakerInfo) && wc <= 2) {
        const combo = plain + ' ' + next.text.replace(/\n/g, ' ').replace(/^- /, '').trim();
        const repacked = repack(combo);
        if (repacked) { result[i+1] = { ...next, start: c.start, text: repacked }; result.splice(i, 1); continue; }
      }
    }
  }

  // Strip dashes from single-speaker cues
  for (const c of result) {
    if (!c.text || isSndCue(c.text)) continue;
    const lines = c.text.split('\n');
    const dashedLines = lines.filter(l => l.startsWith('- '));
    if (dashedLines.length >= 2) continue;
    if (lines.length === 1 && lines[0].startsWith('- ')) {
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

// ─── MAIN HANDLER ────────────────────────────────────────────────────────────

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
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const transcript_id = body.transcript_id;
    job_db_id = body.job_db_id;

    if (!action || !job_db_id) {
      return Response.json({ error: 'action and job_db_id required' }, { status: 400 });
    }

    const ASSEMBLYAI_API_KEY = Deno.env.get('ASSEMBLYAI_API_KEY');
    const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY');
    console.log(`[v10 processAICaption] action=${action}, job=${job_db_id}, ts=${Date.now()}`);

    let utterances, language, highlights, gaps, rawAudioEvents = [];

    // ── SHARED: Get transcript data (for both start and reprocess) ─────────

    if (action === 'start') {
      if (!transcript_id) return Response.json({ error: 'transcript_id required for start' }, { status: 400 });

      console.log(`[START] Fetching transcript ${transcript_id}`);
      const aaiRes = await fetch(`https://api.assemblyai.com/v2/transcript/${transcript_id}`, {
        headers: { 'authorization': ASSEMBLYAI_API_KEY },
      });
      if (!aaiRes.ok) return Response.json({ error: `AssemblyAI fetch failed: ${aaiRes.status}` }, { status: 500 });
      const transcript = await aaiRes.json();
      if (transcript.status !== 'completed') return Response.json({ error: `Transcript not ready: ${transcript.status}` }, { status: 400 });

      utterances = (transcript.utterances || []).map(u => ({
        start: u.start, end: u.end, text: u.text, speaker: u.speaker, words: u.words,
      }));
      language = transcript.language_code || 'en';
      highlights = (transcript.auto_highlights_result?.results || []).map(h => h.text);
      const totalDurationMs = transcript.audio_duration ? transcript.audio_duration * 1000 : null;
      gaps = findGaps(utterances, totalDurationMs);

      // Extract audio events
      const AUDIO_EVENT_PATTERN = /\[([^\]]{1,40})\]/gi;
      for (const utt of utterances) {
        const matches = [...(utt.text || '').matchAll(AUDIO_EVENT_PATTERN)];
        for (const match of matches) {
          rawAudioEvents.push({
            label: match[1].toUpperCase(), start: utt.start, end: utt.end, text: utt.text, speaker: utt.speaker,
          });
        }
      }

      await addLog(base44, job_db_id, '1_transcribe', 'ok',
        `Transcript ready: ${utterances.length} utterances, lang=${language}, ${gaps.length} gaps`);

    } else if (action === 'reprocess') {
      console.log(`[REPROCESS] Re-running GPT for job ${job_db_id}`);

      const job = await base44.asServiceRole.entities.Job.get(job_db_id);
      const plan = job.processingPlan || {};
      utterances = plan.utterances;

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
        language = transcript.language_code || 'en';
        highlights = (transcript.auto_highlights_result?.results || []).map(h => h.text);
        const totalDurationMs = transcript.audio_duration ? transcript.audio_duration * 1000 : null;
        gaps = findGaps(utterances, totalDurationMs);
      } else {
        language = plan.language || 'en';
        highlights = plan.highlights || [];
        gaps = plan.gaps || [];
      }

      rawAudioEvents = plan.rawAudioEvents || [];

      // Extract audio events if not already present
      if (!rawAudioEvents.length) {
        const AUDIO_EVENT_PATTERN_R = /\[([^\]]{1,40})\]/gi;
        for (const utt of utterances) {
          const matches = [...(utt.text || '').matchAll(AUDIO_EVENT_PATTERN_R)];
          for (const match of matches) {
            rawAudioEvents.push({
              label: match[1].toUpperCase(), start: utt.start, end: utt.end, text: utt.text, speaker: utt.speaker,
            });
          }
        }
      }

    } else {
      return Response.json({ error: `Unknown action: ${action}` }, { status: 400 });
    }

    // ── BUILD SEGMENTS & BATCHES ─────────────────────────────────────────────

    const segments = buildRawSegments(utterances);
    const batches = buildBatches(segments);

    console.log(`[${action.toUpperCase()}] ${segments.length} segments, ${batches.length} batches, ${gaps.length} gaps, lang=${language}`);

    // Save processing plan (for pipeline log tracking and utterance preservation)
    const isReprocess = action === 'reprocess';
    await base44.asServiceRole.entities.Job.update(job_db_id, {
      status: 'processing',
      result: isReprocess ? null : undefined,
      error: null,
      pipelineLog: isReprocess
        ? [{ step: '1_transcribe', status: 'ok', detail: 'Reprocess — using saved transcript data.', ts: new Date().toISOString() }]
        : (await base44.asServiceRole.entities.Job.get(job_db_id)).pipelineLog || [],
      processingPlan: {
        utterances,
        gaps,
        language,
        highlights,
        rawAudioEvents,
        totalBatches: batches.length,
      },
    });

    // ── PROCESS ALL BATCHES INLINE ───────────────────────────────────────────

    const allCues = [];
    let totalInputTokens = 0, totalOutputTokens = 0;

    for (let bi = 0; bi < batches.length; bi++) {
      const batchSegs = batches[bi].map(s => ({ start: s.start, end: s.end, text: s.text, speaker: s.speaker }));
      const batchWindowStart = batchSegs[0].start;
      const batchWindowEnd = batchSegs[batchSegs.length - 1].end;
      const batchGaps = gaps.filter(g => g.start >= batchWindowStart - 2000 && g.end <= batchWindowEnd + 2000);

      console.log(`[BATCH ${bi + 1}/${batches.length}] Processing ${batchSegs.length} segments...`);
      await addLog(base44, job_db_id, `2_gpt_batch_${bi + 1}_of_${batches.length}`, 'running',
        `GPT-4o processing batch ${bi + 1}/${batches.length} (${batchSegs.length} segments)`);

      const batchResult = await polishBatchWithGPT(
        batchSegs, batchGaps, language, highlights, OPENAI_API_KEY, bi, batches.length
      );

      allCues.push(...batchResult.cues);
      totalInputTokens += batchResult.tokens.inputTokens;
      totalOutputTokens += batchResult.tokens.outputTokens;

      console.log(`[BATCH ${bi + 1}/${batches.length}] Got ${batchResult.cues.length} cues, tokens: in=${batchResult.tokens.inputTokens} out=${batchResult.tokens.outputTokens}`);
      await addLog(base44, job_db_id, `2_gpt_batch_${bi + 1}_of_${batches.length}`, 'ok',
        `Batch ${bi + 1}/${batches.length} done — ${batchResult.cues.length} cues`);

      // Small delay between batches to avoid rate limits
      if (bi < batches.length - 1) {
        await new Promise(r => setTimeout(r, 2000));
      }
    }

    // ── FINALIZE ─────────────────────────────────────────────────────────────

    if (!allCues.length) {
      console.error(`[FINALIZE] Zero cues for job ${job_db_id}. Marking as error.`);
      await addLog(base44, job_db_id, '3_finalize', 'error', 'Zero polished cues after all batches.');
      await base44.asServiceRole.entities.Job.update(job_db_id, {
        status: 'error',
        error: 'Zero polished cues. GPT batches may have returned empty results.',
      });
      return Response.json({ error: 'No cues produced' }, { status: 500 });
    }

    console.log(`[FINALIZE] Enforcing rules on ${allCues.length} cues...`);
    await addLog(base44, job_db_id, '3_finalize', 'running', 'Applying final formatting rules and QC...');

    // Diagnostic data
    const diagnosticData = {
      assemblyUtterances: utterances.map(u => ({ start: u.start, end: u.end, text: u.text, speaker: u.speaker })),
      assemblyRawCues: segments.map(s => ({ start: s.start, end: s.end, text: s.text, speaker: s.speaker })),
      openaiReformattedCues: allCues.map(c => ({ start: c.start, end: c.end, text: c.text, speaker: c.speaker })),
      rawAudioEvents,
    };

    const enforced = finalEnforce(allCues);
    const qc = runQC(enforced);
    const srt = buildSRT(enforced);
    const vtt = buildVTT(enforced);
    const scc = buildSCC(enforced);
    const durationMs = enforced.length > 0 ? enforced[enforced.length - 1].end : 0;
    const cueJson = JSON.stringify(enforced);

    console.log(`[FINALIZE] Cue JSON size: ${cueJson.length}, ${enforced.length} cues, ${qc.issuesCount} QC issues`);

    // Upload large text content as files
    async function uploadText(text, filename) {
      const encoder = new TextEncoder();
      const uint8 = encoder.encode(text);
      const file = new File([uint8], filename, { type: 'text/plain' });
      const { file_url } = await base44.asServiceRole.integrations.Core.UploadFile({ file });
      return file_url;
    }

    let resultPayload;
    if (cueJson.length > 30000) {
      console.log('[FINALIZE] Large output — uploading as files');
      const diagJson = JSON.stringify(diagnosticData);
      const [cueUrl, srtUrl, vttUrl, sccUrl, diagUrl] = await Promise.all([
        uploadText(cueJson, `job_${job_db_id}_cues.json`),
        uploadText(srt, `job_${job_db_id}.srt`),
        uploadText(vtt, `job_${job_db_id}.vtt`),
        uploadText(scc, `job_${job_db_id}.scc`),
        uploadText(diagJson, `job_${job_db_id}_diagnostic.json`),
      ]);
      resultPayload = { cue_url: cueUrl, srt_url: srtUrl, vtt_url: vttUrl, scc_url: sccUrl, diagnostic_url: diagUrl, qc, language };
    } else {
      resultPayload = {
        cue_chunks: [cueJson],
        srt_chunks: chunkString(srt),
        vtt_chunks: chunkString(vtt),
        scc_chunks: chunkString(scc),
        assemblyRawCues: diagnosticData.assemblyRawCues,
        assemblyUtterances: diagnosticData.assemblyUtterances,
        openaiReformattedCues: diagnosticData.openaiReformattedCues,
        rawAudioEvents: diagnosticData.rawAudioEvents,
        qc, language,
      };
    }

    // Cost estimate
    const audioDurationSec = durationMs / 1000;
    const assemblyaiCost = (audioDurationSec / 60) * (0.65 / 60);
    const openaiCost = (totalInputTokens / 1_000_000) * 2.50 + (totalOutputTokens / 1_000_000) * 10.00;
    const costEstimate = {
      assemblyai: Math.round(assemblyaiCost * 10000) / 10000,
      openai: Math.round(openaiCost * 10000) / 10000,
      total: Math.round((assemblyaiCost + openaiCost) * 10000) / 10000,
      audioDurationSec: Math.round(audioDurationSec),
      openaiInputTokens: totalInputTokens,
      openaiOutputTokens: totalOutputTokens,
    };

    await base44.asServiceRole.entities.Job.update(job_db_id, {
      status: 'done',
      result: resultPayload,
      durationMs,
      issuesCount: qc.issuesCount,
      processingPlan: null,
      costEstimate,
    });

    await addLog(base44, job_db_id, '3_finalize', 'ok',
      `Done! ${enforced.length} cues, ${qc.issuesCount} QC issues.`);

    console.log(`[DONE] Job ${job_db_id}: ${enforced.length} cues, ${qc.issuesCount} issues, cost=$${costEstimate.total}`);
    return Response.json({ status: 'done', cues: enforced.length, issues: qc.issuesCount, cost: costEstimate.total });

  } catch (error) {
    console.error('[processAICaption] Error:', error.message);
    try {
      if (job_db_id) {
        await addLog(base44, job_db_id, 'error', 'error', error.message).catch(() => {});
        await base44.asServiceRole.entities.Job.update(job_db_id, { status: 'error', error: error.message });
      }
    } catch (_) {}
    return Response.json({ error: error.message }, { status: 500 });
  }
});