import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

// processAICaption v12 — Broadcast-Grade CC Builder
// Pipeline (per spec):
//   1. parse_srt_backbone (canonical timing)
//   2. align_words_to_cues (word-level JSON → backbone cues)
//   3. build_speaker_runs
//   4. extract_sound_events
//   5. insert_sound_cues (standalone, 800-1500ms clamp, no overlap)
//   6. pre_split_multispeaker_cues (dash formatting)
//   7. ai_linebreak_format (OpenAI — linguistic line breaking ONLY)
//   8. validate_and_split (hard failures → split + AI retry, soft failures → corrective retry)
//   9. broadcast_readability_gate (min duration, merge micro-cues, no one-word captions)
//  10. enforce_monotonic_timeline
//  11. run_acceptance_tests
//  12. export SRT/VTT/SCC

// ─── CONSTANTS ──────────────────────────────────────────────────────────────

const MAX_CHARS = 32;
const MAX_LINES = 2;
const MIN_CUE_DURATION_MS = 800;
const SOUND_CUE_MIN_MS = 800;
const SOUND_CUE_MAX_MS = 1500;
const MICRO_CUE_WORD_THRESHOLD = 2;
const MICRO_CUE_DURATION_THRESHOLD = 1000;

const FUNC_WORDS = new Set([
  'a','an','the','of','to','and','or','but','with','from','in','on','at','for','that',
  'is','it','by','as','if','so','no','do','up','my','we','he','be'
]);

const ALLOWED_SHORT_WORDS = new Set(['yes', 'no', 'ok', 'okay', 'yeah', 'nah', 'wow', 'hey', 'hi', 'bye', 'right', 'sure', 'thanks', 'absolutely', 'completely', 'really', 'nothing', 'both', 'hello', 'think']);

const PROTECTED_PHRASES = [
  'Watch What Happens Live',
  'Below Deck Mediterranean',
  'Below Deck Med',
  'Real Housewives',
  'Andy Cohen',
];

// ─── MODULE 1: parse_srt_backbone ───────────────────────────────────────────

function parseSrtBackbone(srtText) {
  const cues = [];
  const blocks = srtText.trim().split(/\n\n+/);
  for (const block of blocks) {
    const lines = block.trim().split('\n');
    if (lines.length < 2) continue;
    let tcLineIdx = -1;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].includes('-->')) { tcLineIdx = i; break; }
    }
    if (tcLineIdx === -1) continue;
    const match = lines[tcLineIdx].match(/(\d{2}:\d{2}:\d{2}[,\.]\d{3})\s*-->\s*(\d{2}:\d{2}:\d{2}[,\.]\d{3})/);
    if (!match) continue;
    cues.push({
      cue_id: cues.length,
      start_ms: srtTimeToMs(match[1]),
      end_ms: srtTimeToMs(match[2]),
      text_raw: lines.slice(tcLineIdx + 1).join('\n').trim(),
    });
  }
  return cues;
}

function srtTimeToMs(tc) {
  const parts = tc.replace(',', '.').split(':');
  const h = parseInt(parts[0], 10);
  const m = parseInt(parts[1], 10);
  const secParts = parts[2].split('.');
  const s = parseInt(secParts[0], 10);
  const ms = parseInt(secParts[1], 10);
  return h * 3600000 + m * 60000 + s * 1000 + ms;
}

// ─── MODULE 2: align_words_to_cues ──────────────────────────────────────────

function alignWordsToCues(backboneCues, words) {
  const speechWords = words.filter(w => !w.text.startsWith('['));
  for (const cue of backboneCues) {
    cue.aligned_words = [];
    for (const w of speechWords) {
      if (w.start < cue.end_ms && w.end > cue.start_ms) {
        cue.aligned_words.push(w);
      }
    }
  }
  return backboneCues;
}

// ─── MODULE 3: build_speaker_runs ───────────────────────────────────────────

function buildSpeakerRuns(backboneCues) {
  for (const cue of backboneCues) {
    const runs = [];
    let currentRun = null;
    for (const w of cue.aligned_words) {
      if (!currentRun || currentRun.speaker !== w.speaker) {
        if (currentRun) runs.push(currentRun);
        currentRun = { speaker: w.speaker, words: [w], start_ms: w.start, end_ms: w.end, text: w.text };
      } else {
        currentRun.words.push(w);
        currentRun.end_ms = w.end;
        currentRun.text += ' ' + w.text;
      }
    }
    if (currentRun) runs.push(currentRun);
    cue.runs = runs;
  }
  return backboneCues;
}

// ─── MODULE 4: extract_sound_events ─────────────────────────────────────────

function extractSoundEvents(words) {
  const events = [];
  for (const w of words) {
    if (w.text.startsWith('[') && w.text.endsWith(']')) {
      const label = w.text.slice(1, -1).toUpperCase().trim();
      if (label && label !== 'BLANK_AUDIO') {
        events.push({ label, start_ms: w.start, end_ms: w.end });
      }
    }
  }
  // Deduplicate/merge consecutive identical events
  const deduped = [];
  for (const e of events) {
    const last = deduped[deduped.length - 1];
    if (last && last.label === e.label && e.start_ms - last.end_ms < 500) {
      last.end_ms = e.end_ms;
    } else {
      deduped.push({ ...e });
    }
  }
  return deduped;
}

// ─── MODULE 5: insert_sound_cues ────────────────────────────────────────────
// Sound cues are standalone, clamped 800-1500ms, MUST NOT overlap dialogue

function insertSoundCues(dialogueCues, soundEvents) {
  const allCues = dialogueCues.map(c => ({ ...c, cue_type: 'dialogue' }));

  for (const se of soundEvents) {
    let label = se.label;
    if (label.length > 28) label = label.substring(0, 28);
    const text = `[${label}]`;
    const desiredDur = Math.max(SOUND_CUE_MIN_MS, Math.min(SOUND_CUE_MAX_MS, se.end_ms - se.start_ms));

    // Find the best gap to place this sound cue
    let bestGap = null;
    let bestDist = Infinity;

    // Check before first cue
    if (allCues.length > 0 && allCues[0].start_ms > desiredDur) {
      const gapStart = Math.max(0, allCues[0].start_ms - desiredDur);
      const gapEnd = allCues[0].start_ms - 1;
      const dist = Math.abs(se.start_ms - gapStart);
      if (gapEnd - gapStart >= SOUND_CUE_MIN_MS && dist < bestDist) {
        bestGap = { start: gapStart, end: gapEnd, insertAt: 0 };
        bestDist = dist;
      }
    }

    // Check gaps between cues
    for (let i = 0; i < allCues.length - 1; i++) {
      const gapStart = allCues[i].end_ms + 1;
      const gapEnd = allCues[i + 1].start_ms - 1;
      const gapSize = gapEnd - gapStart;
      if (gapSize >= SOUND_CUE_MIN_MS) {
        const dist = Math.abs(se.start_ms - gapStart);
        if (dist < bestDist) {
          bestGap = { start: gapStart, end: Math.min(gapEnd, gapStart + desiredDur), insertAt: i + 1 };
          bestDist = dist;
        }
      }
    }

    // Check after last cue
    if (allCues.length > 0) {
      const gapStart = allCues[allCues.length - 1].end_ms + 1;
      const dist = Math.abs(se.start_ms - gapStart);
      if (dist < bestDist) {
        bestGap = { start: gapStart, end: gapStart + desiredDur, insertAt: allCues.length };
        bestDist = dist;
      }
    }

    if (bestGap) {
      // Ensure minimum duration
      if (bestGap.end - bestGap.start < SOUND_CUE_MIN_MS) {
        bestGap.end = bestGap.start + SOUND_CUE_MIN_MS;
      }
      allCues.splice(bestGap.insertAt, 0, {
        start_ms: bestGap.start,
        end_ms: bestGap.end,
        text,
        cue_type: 'sound',
        runs: [],
        speaker: null,
      });
    }
    // If no gap found at all, skip this sound cue rather than create an overlap
  }

  return allCues;
}

// ─── MODULE 6: pre_split_multispeaker_cues ──────────────────────────────────

function preSplitMultispeakerCues(cues) {
  const result = [];
  for (const cue of cues) {
    if (cue.cue_type === 'sound') { result.push(cue); continue; }
    const runs = cue.runs || [];
    if (runs.length <= 1) { result.push(cue); continue; }

    // Get unique speakers
    const speakers = [...new Set(runs.map(r => r.speaker))];

    if (speakers.length === 2 && runs.length === 2) {
      // Two speakers — try dash format in one cue
      const lineA = '- ' + runs[0].text;
      const lineB = '- ' + runs[1].text;
      if (lineA.length <= MAX_CHARS && lineB.length <= MAX_CHARS) {
        result.push({ ...cue, runs, multi_speaker_dash: true, speakerCount: 2 });
        continue;
      }
    }

    // Doesn't fit or 3+ runs — split into separate cues
    const totalDur = cue.end_ms - cue.start_ms;
    const totalChars = Math.max(1, runs.reduce((s, r) => s + r.text.length, 0));
    let offset = cue.start_ms;
    for (let ri = 0; ri < runs.length; ri++) {
      const run = runs[ri];
      const dur = Math.max(MIN_CUE_DURATION_MS, Math.round(totalDur * (run.text.length / totalChars)));
      const end = ri === runs.length - 1 ? cue.end_ms : Math.min(offset + dur, cue.end_ms);
      result.push({
        start_ms: offset,
        end_ms: Math.max(end, offset + MIN_CUE_DURATION_MS),
        runs: [run],
        cue_type: 'dialogue',
        speakerCount: 1,
      });
      offset = end;
    }
  }
  return result;
}

// ─── MODULE 7: AI line breaking (OpenAI) ────────────────────────────────────

const AI_SYSTEM_PROMPT = `You are a professional broadcast caption formatter.
Rules:
- Maximum 2 lines per output
- Maximum 32 characters per line
- One speaker per line
- Dash prefix "- " for each speaker line when dash_for_each_speaker_line is true
- Do not split these named entities across lines: ${PROTECTED_PHRASES.join(', ')}
- Do not end non-final lines with function words: a, an, the, of, to, and, or, but, with, from, in, on, at, for, that, is, it, by, as, if, so, no, do, up, my, we, he, be
- Prefer line breaks at punctuation (. ? ! ,) then phrase boundaries
- Preserve ALL spoken words exactly — never drop, add, or paraphrase
- Add proper punctuation if missing
- Return JSON only — an array of objects.

For each input cue, return:
{"idx": <same idx>, "lines": ["line1", "line2"], "needs_split": false}

If text cannot fit in 2 lines of 32 chars without violating rules, return:
{"idx": <same idx>, "lines": [], "needs_split": true}

Return a JSON array. No markdown fences.`;

const AI_SOFT_RETRY_PROMPT = `You are a professional broadcast caption formatter doing a CORRECTION pass.
The previous formatting had a soft failure (function word at line end, orphan line, or imbalanced lines).
Choose a DIFFERENT breakpoint that avoids these issues.
Rules:
- Maximum 2 lines, maximum 32 characters per line
- Do NOT end non-final lines with: a, an, the, of, to, and, or, but, with, from, in, on, at, for, that, is, it, by, as, if, so, no, do, up, my, we, he, be
- Avoid orphan lines (1-2 very short words on a line)
- Aim for balanced line lengths
- Preserve ALL words exactly
- Return JSON array. No markdown fences.

For each input: {"idx": <idx>, "lines": ["line1", "line2"], "needs_split": false}`;

async function callOpenAIBatch(cueInputs, apiKey, systemPrompt) {
  const prompt = JSON.stringify(cueInputs);
  let res;
  for (let attempt = 0; attempt < 3; attempt++) {
    res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'gpt-4o',
        messages: [
          { role: 'system', content: systemPrompt || AI_SYSTEM_PROMPT },
          { role: 'user', content: prompt },
        ],
        temperature: 0.15,
        max_tokens: 8000,
      }),
    });
    if (res.status === 429) {
      await new Promise(r => setTimeout(r, 15000 * (attempt + 1)));
      continue;
    }
    break;
  }
  if (!res || !res.ok) {
    console.error(`[AI] OpenAI error: ${res ? await res.text() : 'no response'}`);
    return null;
  }
  const data = await res.json();
  const content = data.choices[0].message.content.trim();
  const jsonMatch = content.match(/\[[\s\S]*\]/);
  if (!jsonMatch) { console.error('[AI] No JSON array'); return null; }
  return JSON.parse(jsonMatch[0]);
}

function buildAICueInput(idx, text, dashMode) {
  return {
    idx,
    text,
    constraints: { max_lines: MAX_LINES, max_chars_per_line: MAX_CHARS, dash_for_each_speaker_line: dashMode },
    protected_phrases: PROTECTED_PHRASES,
  };
}

async function aiLinebreakBatch(cues, apiKey) {
  const BATCH_SIZE = 40;
  const results = new Array(cues.length);

  for (let batchStart = 0; batchStart < cues.length; batchStart += BATCH_SIZE) {
    const batchEnd = Math.min(batchStart + BATCH_SIZE, cues.length);
    const batch = cues.slice(batchStart, batchEnd);

    const cueInputs = batch.map((cue, localIdx) => {
      const globalIdx = batchStart + localIdx;
      if (cue.cue_type === 'sound') {
        results[globalIdx] = { lines: [cue.text], needs_split: false };
        return null;
      }
      const runs = cue.runs || [];
      if (runs.length === 0) { results[globalIdx] = { lines: [], needs_split: false }; return null; }

      // Multi-speaker dash cue — format deterministically if fits
      if (cue.multi_speaker_dash && runs.length === 2) {
        const lineA = '- ' + runs[0].text;
        const lineB = '- ' + runs[1].text;
        if (lineA.length <= MAX_CHARS && lineB.length <= MAX_CHARS) {
          results[globalIdx] = { lines: [lineA, lineB], needs_split: false, isDash: true };
          return null;
        }
      }

      const fullText = runs.map(r => r.text).join(' ');
      if (fullText.length <= MAX_CHARS) {
        results[globalIdx] = { lines: [fullText], needs_split: false };
        return null;
      }

      return buildAICueInput(globalIdx, fullText, (cue.speakerCount || runs.length) > 1);
    }).filter(Boolean);

    if (cueInputs.length > 0) {
      const parsed = await callOpenAIBatch(cueInputs, apiKey, AI_SYSTEM_PROMPT);
      if (parsed) {
        for (const r of parsed) {
          if (r.idx !== undefined && r.idx < results.length) results[r.idx] = r;
        }
      }
      // Fill missing with deterministic
      for (const ci of cueInputs) {
        if (!results[ci.idx]) results[ci.idx] = deterministicLineBreak(ci.text);
      }
    }

    if (batchEnd < cues.length) await new Promise(r => setTimeout(r, 1200));
  }

  // Fill any remaining nulls
  for (let i = 0; i < results.length; i++) {
    if (!results[i]) {
      const cue = cues[i];
      const text = cue.cue_type === 'sound' ? cue.text : (cue.runs || []).map(r => r.text).join(' ');
      results[i] = deterministicLineBreak(text);
    }
  }
  return results;
}

// AI retry for split children and soft failures — single batch
async function aiRetryBatch(items, apiKey, systemPrompt) {
  if (items.length === 0) return [];
  const inputs = items.map((item, i) => buildAICueInput(i, item.text, false));
  const parsed = await callOpenAIBatch(inputs, apiKey, systemPrompt || AI_SYSTEM_PROMPT);
  return items.map((item, i) => {
    const match = parsed?.find(r => r.idx === i);
    return match || deterministicLineBreak(item.text);
  });
}

// ─── Deterministic line breaker ─────────────────────────────────────────────

function deterministicLineBreak(text) {
  if (!text || text.trim().length === 0) return { lines: [], needs_split: false };
  text = text.trim();
  if (text.length <= MAX_CHARS) return { lines: [text], needs_split: false };

  const words = text.split(/\s+/);
  let bestBp = -1;
  let bestScore = -Infinity;

  for (let bp = 1; bp < words.length; bp++) {
    const l1 = words.slice(0, bp).join(' ');
    const l2 = words.slice(bp).join(' ');
    if (l1.length > MAX_CHARS || l2.length > MAX_CHARS) continue;

    let score = 0;
    const lastWord = words[bp - 1].replace(/[.,!?;:'"]+$/, '').toLowerCase();

    if (FUNC_WORDS.has(lastWord)) score -= 100;
    const lastChar = l1[l1.length - 1];
    if ('.?!'.includes(lastChar)) score += 50;
    else if (',;:'.includes(lastChar)) score += 30;
    score -= Math.abs(l1.length - l2.length) * 0.5;

    // Protected phrase check
    let phraseViolation = false;
    for (const phrase of PROTECTED_PHRASES) {
      const pWords = phrase.toLowerCase().split(' ');
      for (let pw = 0; pw < pWords.length - 1; pw++) {
        if (lastWord === pWords[pw] && words[bp]?.toLowerCase().replace(/[.,!?;:'"]+$/, '') === pWords[pw + 1]) {
          phraseViolation = true;
        }
      }
    }
    if (phraseViolation) score -= 200;

    if (score > bestScore) { bestScore = score; bestBp = bp; }
  }

  if (bestBp !== -1) {
    return { lines: [words.slice(0, bestBp).join(' '), words.slice(bestBp).join(' ')], needs_split: false };
  }
  return { lines: [], needs_split: true, split_hint: 'phrase_boundary' };
}

function splitCueText(text) {
  const sentences = text.match(/[^.!?]+[.!?]+/g);
  if (sentences && sentences.length >= 2) {
    const mid = Math.floor(sentences.length / 2);
    return [sentences.slice(0, mid).join(' ').trim(), sentences.slice(mid).join(' ').trim()];
  }
  const commaIdx = text.indexOf(',', Math.floor(text.length / 3));
  if (commaIdx > 0) {
    return [text.substring(0, commaIdx + 1).trim(), text.substring(commaIdx + 1).trim()];
  }
  const words = text.split(/\s+/);
  const mid = Math.floor(words.length / 2);
  return [words.slice(0, mid).join(' '), words.slice(mid).join(' ')];
}

// ─── Validation helpers ─────────────────────────────────────────────────────

function validateLines(lines) {
  const errors = [];
  if (lines.length > MAX_LINES) errors.push('too_many_lines');
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].length > MAX_CHARS) errors.push(`line_${i}_too_long`);
  }
  const hasSound = lines.some(l => l.startsWith('[') && l.endsWith(']'));
  const hasDialogue = lines.some(l => !(l.startsWith('[') && l.endsWith(']')));
  if (hasSound && hasDialogue && lines.length > 1) errors.push('sound_mixed');

  for (const phrase of PROTECTED_PHRASES) {
    const pWords = phrase.split(' ');
    for (let w = 0; w < pWords.length - 1; w++) {
      for (let li = 0; li < lines.length - 1; li++) {
        const lineEnd = lines[li].trim().split(/\s+/);
        const nextStart = lines[li + 1].trim().replace(/^- /, '').split(/\s+/);
        if (lineEnd[lineEnd.length - 1] === pWords[w] && nextStart[0] === pWords[w + 1]) {
          errors.push('protected_phrase_split');
        }
      }
    }
  }
  return errors;
}

function hasSoftFailures(lines) {
  for (let li = 0; li < lines.length - 1; li++) {
    const lineWords = lines[li].replace(/^- /, '').trim().split(/\s+/);
    const lastWord = lineWords[lineWords.length - 1].replace(/[.,!?;:'"]+$/, '').toLowerCase();
    if (FUNC_WORDS.has(lastWord)) return true;
  }
  // Check orphan lines
  for (const line of lines) {
    const clean = line.replace(/^- /, '').trim();
    const wc = clean.split(/\s+/).length;
    if (wc <= 1 && clean.length < 6 && !/[.!?]$/.test(clean)) return true;
  }
  return false;
}

// ─── Timing helpers ─────────────────────────────────────────────────────────

function recalculateTimingsForSplit(originalCue, textParts) {
  const totalDur = originalCue.end_ms - originalCue.start_ms;
  const totalChars = Math.max(1, textParts.reduce((s, t) => s + t.length, 0));
  const newCues = [];
  let offset = originalCue.start_ms;

  for (let i = 0; i < textParts.length; i++) {
    const dur = Math.max(MIN_CUE_DURATION_MS + 1, Math.round(totalDur * (textParts[i].length / totalChars)));
    const end = i === textParts.length - 1 ? originalCue.end_ms : Math.min(offset + dur, originalCue.end_ms);
    newCues.push({
      start_ms: offset,
      end_ms: Math.max(end, offset + MIN_CUE_DURATION_MS + 1),
      text: textParts[i],
      cue_type: 'dialogue',
      runs: [{ speaker: originalCue.runs?.[0]?.speaker || null, text: textParts[i] }],
      speaker: originalCue.runs?.[0]?.speaker || originalCue.speaker || null,
    });
    offset = Math.max(end, offset + MIN_CUE_DURATION_MS);
  }
  return newCues;
}

// ─── MODULE 9: Broadcast Readability Gate ───────────────────────────────────
// Post-pass that merges micro-cues, enforces min duration, eliminates one-word function-word captions

function broadcastReadabilityGate(cues) {
  let changed = true;
  let passes = 0;
  const MAX_PASSES = 3;

  while (changed && passes < MAX_PASSES) {
    changed = false;
    passes++;
    const newCues = [];

    for (let i = 0; i < cues.length; i++) {
      const cue = cues[i];
      const dur = cue.end_ms - cue.start_ms;
      const isSoundCue = cue.cue_type === 'sound';
      const lines = cue.text.split('\n');
      const plainText = lines.map(l => l.replace(/^- /, '').trim()).join(' ');
      const words = plainText.split(/\s+/).filter(w => w.length > 0);
      const wordCount = words.length;

      // Check: is this a function-word-only cue?
      const isFuncWordOnly = wordCount === 1 && FUNC_WORDS.has(words[0].replace(/[.,!?;:'"]+$/, '').toLowerCase());

      // Check: is this a micro-cue? (1-2 words, short duration, NOT an allowed short word)
      const isAllowedShort = wordCount === 1 && ALLOWED_SHORT_WORDS.has(words[0].replace(/[.,!?;:'"]+$/, '').toLowerCase()) && dur >= MIN_CUE_DURATION_MS;
      const isMicroCue = !isSoundCue && !isAllowedShort && (
        isFuncWordOnly ||
        (wordCount <= MICRO_CUE_WORD_THRESHOLD && dur < MICRO_CUE_DURATION_THRESHOLD)
      );

      // Check: too short duration
      const isTooShort = dur < MIN_CUE_DURATION_MS;

      if (isMicroCue || (isTooShort && !isSoundCue)) {
        // Try merge with next cue (same speaker, close gap)
        const next = cues[i + 1];
        const prev = newCues[newCues.length - 1];

        if (next && next.cue_type === 'dialogue' && next.speaker === cue.speaker) {
          const gap = next.start_ms - cue.end_ms;
          if (gap < 2000) {
            // Merge forward: combine text and timing
            const mergedText = mergeTexts(cue.text, next.text);
            const mergedLines = deterministicLineBreak(mergedText);
            if (!mergedLines.needs_split && mergedLines.lines.length > 0) {
              cues[i + 1] = {
                ...next,
                start_ms: cue.start_ms,
                text: mergedLines.lines.join('\n'),
                runs: [...(cue.runs || []), ...(next.runs || [])],
              };
              changed = true;
              continue; // skip adding current cue
            }
          }
        }

        if (prev && prev.cue_type === 'dialogue' && prev.speaker === cue.speaker) {
          const gap = cue.start_ms - prev.end_ms;
          if (gap < 2000) {
            // Merge backward
            const mergedText = mergeTexts(prev.text, cue.text);
            const mergedLines = deterministicLineBreak(mergedText);
            if (!mergedLines.needs_split && mergedLines.lines.length > 0) {
              prev.end_ms = cue.end_ms;
              prev.text = mergedLines.lines.join('\n');
              changed = true;
              continue; // skip adding current cue
            }
          }
        }

        // Can't merge — extend duration if too short
        if (isTooShort && !isFuncWordOnly) {
          const nextCue = cues[i + 1];
          const maxEnd = nextCue ? nextCue.start_ms - 1 : cue.start_ms + MIN_CUE_DURATION_MS;
          cue.end_ms = Math.min(cue.start_ms + MIN_CUE_DURATION_MS, maxEnd);
          changed = true;
        }
      }

      // Sound cue duration clamp
      if (isSoundCue && dur < SOUND_CUE_MIN_MS) {
        const nextCue = cues[i + 1];
        const maxEnd = nextCue ? nextCue.start_ms - 1 : cue.start_ms + SOUND_CUE_MIN_MS;
        cue.end_ms = Math.min(cue.start_ms + SOUND_CUE_MIN_MS, maxEnd);
        changed = true;
      }

      newCues.push(cue);
    }

    cues = newCues;
  }

  return cues;
}

function mergeTexts(textA, textB) {
  // Strip dash prefixes for merge, recombine as plain text
  const cleanA = textA.split('\n').map(l => l.replace(/^- /, '').trim()).join(' ').trim();
  const cleanB = textB.split('\n').map(l => l.replace(/^- /, '').trim()).join(' ').trim();
  return (cleanA + ' ' + cleanB).trim();
}

// ─── MODULE 10: enforce_monotonic_timeline ──────────────────────────────────

function enforceMonotonicTimeline(cues) {
  cues.sort((a, b) => a.start_ms - b.start_ms);
  for (let i = 1; i < cues.length; i++) {
    if (cues[i].start_ms <= cues[i - 1].end_ms) {
      cues[i].start_ms = cues[i - 1].end_ms + 1;
      if (cues[i].end_ms <= cues[i].start_ms) {
        cues[i].end_ms = cues[i].start_ms + MIN_CUE_DURATION_MS;
      }
    }
  }
  return cues.filter(c => c.end_ms > c.start_ms);
}

// ─── Multi-speaker dash enforcement (post-AI) ──────────────────────────────

function enforceDashFormatting(cues) {
  for (const cue of cues) {
    if (cue.cue_type === 'sound') continue;
    const lines = cue.text.split('\n');
    if (lines.length !== 2) continue;

    // Check if this cue has multiple speakers from runs
    const speakers = new Set((cue.runs || []).map(r => r.speaker).filter(Boolean));
    const isDashCue = cue.multi_speaker_dash || speakers.size >= 2;

    if (isDashCue) {
      // Ensure both lines have dash prefix
      const fixedLines = lines.map(l => {
        if (!l.startsWith('- ')) return '- ' + l;
        return l;
      });
      // Validate they still fit
      if (fixedLines.every(l => l.length <= MAX_CHARS)) {
        cue.text = fixedLines.join('\n');
      }
    } else {
      // Single speaker — ensure NO dash prefixes (inconsistent dash check)
      const dashCount = lines.filter(l => l.startsWith('- ')).length;
      if (dashCount === 1) {
        // Inconsistent — remove all dashes for single speaker
        cue.text = lines.map(l => l.replace(/^- /, '')).join('\n');
      }
    }
  }
  return cues;
}

// ─── MODULE 11: run_acceptance_tests ────────────────────────────────────────

function runAcceptanceTests(finalCues) {
  const issues = [];
  let prevEnd = -1;

  for (let i = 0; i < finalCues.length; i++) {
    const cue = finalCues[i];
    const lines = cue.text.split('\n');
    const isSoundCue = cue.cue_type === 'sound' || (lines.length === 1 && lines[0].startsWith('[') && lines[0].endsWith(']'));
    const dur = cue.end_ms - cue.start_ms;

    // HARD: Every line ≤ 32 chars
    for (let li = 0; li < lines.length; li++) {
      if (lines[li].length > MAX_CHARS) {
        issues.push({ cue: i, type: 'line_too_long', severity: 'hard', value: `Line ${li+1}: ${lines[li].length}ch` });
      }
    }

    // HARD: Every cue ≤ 2 lines
    if (lines.length > MAX_LINES) {
      issues.push({ cue: i, type: 'too_many_lines', severity: 'hard', value: `${lines.length} lines` });
    }

    // HARD: Cue duration ≥ 800ms
    if (dur < MIN_CUE_DURATION_MS) {
      issues.push({ cue: i, type: 'cue_too_short', severity: 'hard', value: `${dur}ms` });
    }

    // HARD: Sound cues standalone
    if (isSoundCue) {
      const hasNonSound = lines.some(l => !(l.startsWith('[') && l.endsWith(']')));
      if (hasNonSound) {
        issues.push({ cue: i, type: 'sound_mixed', severity: 'hard', value: cue.text.substring(0, 50) });
      }
    }
    if (!isSoundCue) {
      const hasBracket = lines.some(l => /^\[.*\]$/.test(l.trim()));
      if (hasBracket) {
        issues.push({ cue: i, type: 'sound_mixed', severity: 'hard', value: cue.text.substring(0, 50) });
      }
    }

    // HARD: No overlapping timestamps
    if (cue.start_ms < prevEnd) {
      issues.push({ cue: i, type: 'overlap', severity: 'hard', value: `start=${cue.start_ms} prev_end=${prevEnd}` });
    }
    prevEnd = cue.end_ms;

    // HARD: Multi-speaker dash consistency
    if (!isSoundCue && lines.length === 2) {
      const dashCount = lines.filter(l => l.startsWith('- ')).length;
      if (dashCount === 1) {
        issues.push({ cue: i, type: 'inconsistent_dash', severity: 'hard', value: 'One dash, one without' });
      }
    }

    // HARD: Protected phrases never split
    if (!isSoundCue && lines.length === 2) {
      for (const phrase of PROTECTED_PHRASES) {
        const pWords = phrase.split(' ');
        for (let pw = 0; pw < pWords.length - 1; pw++) {
          const l0Words = lines[0].replace(/^- /, '').trim().split(/\s+/);
          const l1Words = lines[1].replace(/^- /, '').trim().split(/\s+/);
          if (l0Words[l0Words.length - 1]?.replace(/[.,!?;:'"]+$/, '') === pWords[pw] &&
              l1Words[0]?.replace(/[.,!?;:'"]+$/, '') === pWords[pw + 1]) {
            issues.push({ cue: i, type: 'protected_phrase_split', severity: 'hard', value: phrase });
          }
        }
      }
    }

    // HARD: No function-word-only cues (unless it's an allowed short word like "No")
    if (!isSoundCue) {
      const plainText = lines.map(l => l.replace(/^- /, '').trim()).join(' ').trim();
      const cueWords = plainText.split(/\s+/);
      const cleanWord = cueWords.length === 1 ? cueWords[0].replace(/[.,!?;:'"]+$/, '').toLowerCase() : '';
      if (cueWords.length === 1 && FUNC_WORDS.has(cleanWord) && !ALLOWED_SHORT_WORDS.has(cleanWord)) {
        issues.push({ cue: i, type: 'function_word_only', severity: 'hard', value: plainText });
      }
    }

    // SOFT: Function word line endings
    if (!isSoundCue && lines.length > 1) {
      for (let li = 0; li < lines.length - 1; li++) {
        const lineWords = lines[li].replace(/^- /, '').trim().split(/\s+/);
        const lastWord = lineWords[lineWords.length - 1].replace(/[.,!?;:'"]+$/, '').toLowerCase();
        if (FUNC_WORDS.has(lastWord)) {
          issues.push({ cue: i, type: 'func_word_line_end', severity: 'soft', value: `"${lastWord}"` });
        }
      }
    }

    // SOFT: One-word cues (not function word, but still flagged)
    if (!isSoundCue) {
      const plainText = lines.map(l => l.replace(/^- /, '').trim()).join(' ').trim();
      const cueWords = plainText.split(/\s+/);
      if (cueWords.length === 1 && !ALLOWED_SHORT_WORDS.has(cueWords[0].replace(/[.,!?;:'"]+$/, '').toLowerCase())) {
        issues.push({ cue: i, type: 'one_word_cue', severity: 'soft', value: plainText });
      }
    }

    // SOFT: Duration warnings
    if (dur > 8000 && !isSoundCue) issues.push({ cue: i, type: 'cue_too_long', severity: 'soft', value: `${(dur/1000).toFixed(1)}s` });
  }

  const hardCount = issues.filter(i => i.severity === 'hard').length;
  const softCount = issues.filter(i => i.severity === 'soft').length;
  return { issuesCount: issues.length, hardCount, softCount, issues };
}

// ─── Export functions ───────────────────────────────────────────────────────

function msToSrtTime(ms) {
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const r = ms % 1000;
  return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')},${String(r).padStart(3,'0')}`;
}

function exportSrt(cues) {
  return cues.map((c, i) => `${i+1}\n${msToSrtTime(c.start_ms)} --> ${msToSrtTime(c.end_ms)}\n${c.text}`).join('\n\n');
}

function exportVtt(cues) {
  const fmt = ms => msToSrtTime(ms).replace(',', '.');
  return `WEBVTT\n\n${cues.map(c => `${fmt(c.start_ms)} --> ${fmt(c.end_ms)}\n${c.text}`).join('\n\n')}`;
}

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
  return `${String(Math.floor(secs/3600)).padStart(2,'0')}:${String(Math.floor((secs%3600)/60)).padStart(2,'0')}:${String(secs%60).padStart(2,'0')}:${String(ff).padStart(2,'0')}`;
}

function textToSCCBytes(text) {
  const bytes = [];
  const clean = text.replace(/\r/g, '').substring(0, 64);
  for (let i = 0; i < clean.length; i++) {
    const code = clean.charCodeAt(i);
    if (code >= 0x20 && code <= 0x7e) {
      if (i+1 < clean.length && clean.charCodeAt(i+1) >= 0x20 && clean.charCodeAt(i+1) <= 0x7e) {
        bytes.push(`${code.toString(16).padStart(2,'0')}${clean.charCodeAt(i+1).toString(16).padStart(2,'0')}`);
        i++;
      } else bytes.push(`${code.toString(16).padStart(2,'0')}80`);
    }
  }
  return bytes;
}

function exportScc(cues) {
  const lines = ['Scenarist_SCC V1.0', ''];
  for (const cue of cues) {
    lines.push(`${msToSCCTimecode(cue.start_ms)}\t942e`);
    for (const line of cue.text.split('\n')) {
      if (line.trim()) {
        const tc = msToSCCTimecode(cue.start_ms);
        lines.push(`${tc}\t${ ['942c','9420',...textToSCCBytes(line.trim()),'942f'].join(' ') }`);
      }
    }
    lines.push(`${msToSCCTimecode(cue.end_ms)}\t942e`);
    lines.push('');
  }
  return lines.join('\n');
}

// ─── Pipeline helpers ───────────────────────────────────────────────────────

async function addLog(base44, jobId, step, status, detail) {
  const job = await base44.asServiceRole.entities.Job.get(jobId);
  const log = job.pipelineLog || [];
  log.push({ step, status, detail, ts: new Date().toISOString() });
  await base44.asServiceRole.entities.Job.update(jobId, { pipelineLog: log });
}

async function uploadText(base44, text, filename) {
  const file = new File([new TextEncoder().encode(text)], filename, { type: 'text/plain' });
  const { file_url } = await base44.asServiceRole.integrations.Core.UploadFile({ file });
  return file_url;
}

// ─── MAIN HANDLER ───────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  let job_db_id = null;

  try {
    const body = await req.json();
    const action = body?.action;
    job_db_id = body?.job_db_id;

    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    if (!action || !job_db_id) return Response.json({ error: 'action and job_db_id required' }, { status: 400 });

    const ASSEMBLYAI_API_KEY = Deno.env.get('ASSEMBLYAI_API_KEY');
    const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY');
    console.log(`[v12] action=${action}, job=${job_db_id}`);

    if (action !== 'start' && action !== 'reprocess') {
      return Response.json({ error: `Unknown action: ${action}` }, { status: 400 });
    }

    // ── STEP 0: Fetch transcript data from AssemblyAI ─────────────────────
    const transcript_id = body.transcript_id;
    let transcriptData;

    if (action === 'start') {
      if (!transcript_id) return Response.json({ error: 'transcript_id required' }, { status: 400 });
      const aaiRes = await fetch(`https://api.assemblyai.com/v2/transcript/${transcript_id}`, {
        headers: { 'authorization': ASSEMBLYAI_API_KEY },
      });
      if (!aaiRes.ok) return Response.json({ error: `AAI fetch failed: ${aaiRes.status}` }, { status: 500 });
      transcriptData = await aaiRes.json();
    } else {
      const job = await base44.asServiceRole.entities.Job.get(job_db_id);
      const tid = transcript_id || job.railwayJobId;
      if (!tid) return Response.json({ error: 'No transcript data available' }, { status: 400 });
      const aaiRes = await fetch(`https://api.assemblyai.com/v2/transcript/${tid}`, {
        headers: { 'authorization': ASSEMBLYAI_API_KEY },
      });
      if (!aaiRes.ok) return Response.json({ error: `AAI re-fetch failed: ${aaiRes.status}` }, { status: 500 });
      transcriptData = await aaiRes.json();
    }

    if (transcriptData.status !== 'completed') {
      return Response.json({ error: `Transcript not ready: ${transcriptData.status}` }, { status: 400 });
    }

    // Fetch SRT backbone
    const srtRes = await fetch(`https://api.assemblyai.com/v2/transcript/${transcriptData.id}/srt`, {
      headers: { 'authorization': ASSEMBLYAI_API_KEY },
    });
    const srtText = await srtRes.text();

    const words = (transcriptData.words || []).map(w => ({ text: w.text, start: w.start, end: w.end, speaker: w.speaker }));
    const soundEvents = extractSoundEvents(transcriptData.words || []);
    const language = transcriptData.language_code || 'en';

    await base44.asServiceRole.entities.Job.update(job_db_id, {
      status: 'processing',
      result: null,
      error: null,
      pipelineLog: [{ step: 'init', status: 'ok', detail: `v12 ${action}`, ts: new Date().toISOString() }],
      processingPlan: { language, soundEventCount: soundEvents.length, wordCount: words.length },
    });

    // ── STEP 1: Parse SRT Backbone ──────────────────────────────────────
    await addLog(base44, job_db_id, '1_parse', 'running', 'Parsing SRT backbone...');
    const backboneCues = parseSrtBackbone(srtText);
    console.log(`[1] ${backboneCues.length} backbone cues`);
    await addLog(base44, job_db_id, '1_parse', 'ok', `${backboneCues.length} backbone cues`);

    // ── STEP 2: Align words ─────────────────────────────────────────────
    await addLog(base44, job_db_id, '2_align', 'running', 'Aligning words...');
    alignWordsToCues(backboneCues, words);
    await addLog(base44, job_db_id, '2_align', 'ok', 'Words aligned');

    // ── STEP 3: Build speaker runs ──────────────────────────────────────
    await addLog(base44, job_db_id, '3_runs', 'running', 'Building speaker runs...');
    buildSpeakerRuns(backboneCues);
    const totalRuns = backboneCues.reduce((s, c) => s + (c.runs?.length || 0), 0);
    console.log(`[3] ${totalRuns} speaker runs`);
    await addLog(base44, job_db_id, '3_runs', 'ok', `${totalRuns} runs`);

    // ── STEP 4: Insert sound cues ───────────────────────────────────────
    await addLog(base44, job_db_id, '4_sound', 'running', 'Inserting sound cues...');
    const withSoundCues = insertSoundCues(backboneCues, soundEvents);
    const soundCount = withSoundCues.filter(c => c.cue_type === 'sound').length;
    console.log(`[4] ${soundCount} sound cues, ${withSoundCues.length} total`);
    await addLog(base44, job_db_id, '4_sound', 'ok', `${soundCount} sound cues`);

    // ── STEP 5: Pre-split multi-speaker ─────────────────────────────────
    await addLog(base44, job_db_id, '5_multispeaker', 'running', 'Multi-speaker handling...');
    const preSplit = preSplitMultispeakerCues(withSoundCues);
    console.log(`[5] ${preSplit.length} cues after multi-speaker`);
    await addLog(base44, job_db_id, '5_multispeaker', 'ok', `${preSplit.length} cues`);

    // ── STEP 6: AI line breaking ────────────────────────────────────────
    await addLog(base44, job_db_id, '6_ai', 'running', 'AI line breaking...');
    const aiResults = await aiLinebreakBatch(preSplit, OPENAI_API_KEY);
    console.log(`[6] AI line breaking done`);
    await addLog(base44, job_db_id, '6_ai', 'ok', 'AI line breaking complete');

    // ── STEP 7: Validate, split, and retry ──────────────────────────────
    await addLog(base44, job_db_id, '7_validate', 'running', 'Validation + split + retry...');

    let finalCues = [];
    let splitCount = 0;
    const childCuesForAI = [];
    const softFailureCues = [];

    for (let i = 0; i < preSplit.length; i++) {
      const cue = preSplit[i];
      const aiResult = aiResults[i];

      if (cue.cue_type === 'sound') {
        finalCues.push({ start_ms: cue.start_ms, end_ms: cue.end_ms, text: cue.text, cue_type: 'sound', speaker: null });
        continue;
      }

      if (aiResult.needs_split) {
        const fullText = (cue.runs || []).map(r => r.text).join(' ');
        const parts = splitCueText(fullText);
        const children = recalculateTimingsForSplit(cue, parts);
        for (const child of children) {
          const idx = finalCues.length;
          child._needsAIRetry = true;
          finalCues.push(child);
          childCuesForAI.push({ idx, text: child.text });
        }
        splitCount++;
        continue;
      }

      const lines = aiResult.lines || [];
      const errors = validateLines(lines);

      if (errors.length > 0) {
        const fullText = (cue.runs || []).map(r => r.text).join(' ');
        const parts = splitCueText(fullText);
        const children = recalculateTimingsForSplit(cue, parts);
        for (const child of children) {
          const idx = finalCues.length;
          child._needsAIRetry = true;
          finalCues.push(child);
          childCuesForAI.push({ idx, text: child.text });
        }
        splitCount++;
        continue;
      }

      // Check soft failures — queue for corrective retry
      if (lines.length > 1 && hasSoftFailures(lines)) {
        const idx = finalCues.length;
        finalCues.push({
          start_ms: cue.start_ms, end_ms: cue.end_ms,
          text: lines.join('\n'),
          cue_type: cue.cue_type || 'dialogue',
          speaker: cue.runs?.[0]?.speaker || null,
          runs: cue.runs,
          multi_speaker_dash: cue.multi_speaker_dash,
        });
        const fullText = (cue.runs || []).map(r => r.text).join(' ');
        softFailureCues.push({ idx, text: fullText });
        continue;
      }

      finalCues.push({
        start_ms: cue.start_ms, end_ms: cue.end_ms,
        text: lines.join('\n'),
        cue_type: cue.cue_type || 'dialogue',
        speaker: cue.runs?.[0]?.speaker || null,
        runs: cue.runs,
        multi_speaker_dash: cue.multi_speaker_dash,
      });
    }

    // AI retry for split children (up to 40)
    if (childCuesForAI.length > 0) {
      // First: deterministic pass on all children
      const needsAI = [];
      for (const { idx, text } of childCuesForAI) {
        const fb = deterministicLineBreak(text);
        if (!fb.needs_split && fb.lines.length > 0) {
          finalCues[idx].text = fb.lines.join('\n');
          if (fb.lines.length > 1 && hasSoftFailures(fb.lines) && needsAI.length < 40) {
            needsAI.push({ idx, text });
          }
        } else if (needsAI.length < 40) {
          needsAI.push({ idx, text });
        } else {
          // Force fit
          const w = text.split(/\s+/);
          const half = Math.ceil(w.length / 2);
          finalCues[idx].text = `${w.slice(0, half).join(' ').substring(0, MAX_CHARS)}\n${w.slice(half).join(' ').substring(0, MAX_CHARS)}`;
        }
        delete finalCues[idx]._needsAIRetry;
      }

      if (needsAI.length > 0) {
        console.log(`[7] AI retry on ${needsAI.length} split children`);
        const retryResults = await aiRetryBatch(needsAI, OPENAI_API_KEY, AI_SYSTEM_PROMPT);
        for (let j = 0; j < needsAI.length; j++) {
          const r = retryResults[j];
          if (r && !r.needs_split && r.lines?.length > 0 && validateLines(r.lines).length === 0) {
            finalCues[needsAI[j].idx].text = r.lines.join('\n');
          }
        }
      }
    }

    // Soft-failure corrective retry (up to 40)
    if (softFailureCues.length > 0) {
      const batch = softFailureCues.slice(0, 40);
      console.log(`[7] Soft-failure retry on ${batch.length} cues`);
      const retryResults = await aiRetryBatch(batch, OPENAI_API_KEY, AI_SOFT_RETRY_PROMPT);
      for (let j = 0; j < batch.length; j++) {
        const r = retryResults[j];
        if (r && !r.needs_split && r.lines?.length > 0) {
          const errs = validateLines(r.lines);
          if (errs.length === 0 && !hasSoftFailures(r.lines)) {
            finalCues[batch[j].idx].text = r.lines.join('\n');
          }
        }
      }
    }

    console.log(`[7] ${splitCount} splits, ${childCuesForAI.length} children, ${softFailureCues.length} soft retries, ${finalCues.length} cues`);
    await addLog(base44, job_db_id, '7_validate', 'ok', `${splitCount} splits, ${finalCues.length} cues`);

    // ── STEP 8: Enforce dash formatting (post-AI guarantee) ─────────────
    enforceDashFormatting(finalCues);

    // ── STEP 9: Broadcast Readability Gate ──────────────────────────────
    await addLog(base44, job_db_id, '8_readability', 'running', 'Readability gate...');
    finalCues = broadcastReadabilityGate(finalCues);
    console.log(`[9] After readability gate: ${finalCues.length} cues`);
    await addLog(base44, job_db_id, '8_readability', 'ok', `${finalCues.length} cues after readability gate`);

    // ── STEP 10: Enforce monotonic timeline ─────────────────────────────
    finalCues = enforceMonotonicTimeline(finalCues);

    // ── STEP 11: Run acceptance tests ───────────────────────────────────
    const qc = runAcceptanceTests(finalCues);
    console.log(`[11] QC: ${qc.hardCount} hard, ${qc.softCount} soft across ${finalCues.length} cues`);

    // ── STEP 12: Export ─────────────────────────────────────────────────
    await addLog(base44, job_db_id, '9_export', 'running', 'Exporting...');

    const outputCues = finalCues.map(c => ({ start: c.start_ms, end: c.end_ms, text: c.text, speaker: c.speaker }));
    const srt = exportSrt(finalCues);
    const vtt = exportVtt(finalCues);
    const scc = exportScc(finalCues);

    const cueJson = JSON.stringify(outputCues);
    let resultPayload;

    if (cueJson.length > 30000) {
      const [cueUrl, srtUrl, vttUrl, sccUrl] = await Promise.all([
        uploadText(base44, cueJson, `job_${job_db_id}_cues.json`),
        uploadText(base44, srt, `job_${job_db_id}.srt`),
        uploadText(base44, vtt, `job_${job_db_id}.vtt`),
        uploadText(base44, scc, `job_${job_db_id}.scc`),
      ]);
      resultPayload = { cue_url: cueUrl, srt_url: srtUrl, vtt_url: vttUrl, scc_url: sccUrl, qc, language };
    } else {
      resultPayload = { cue_chunks: [cueJson], srt_chunks: [srt], vtt_chunks: [vtt], scc_chunks: [scc], qc, language };
    }

    const durationMs = finalCues.length > 0 ? finalCues[finalCues.length - 1].end_ms : 0;

    await base44.asServiceRole.entities.Job.update(job_db_id, {
      status: 'done',
      result: resultPayload,
      durationMs,
      issuesCount: qc.issuesCount,
      processingPlan: null,
    });

    await addLog(base44, job_db_id, '9_export', 'ok', `Done! ${finalCues.length} cues, ${qc.hardCount} hard / ${qc.softCount} soft`);
    console.log(`[DONE] ${finalCues.length} cues, ${qc.issuesCount} issues`);

    return Response.json({ status: 'done', cues: finalCues.length, issues: qc.issuesCount, hard: qc.hardCount, soft: qc.softCount });

  } catch (error) {
    console.error('[v12] Error:', error.message, error.stack);
    try {
      if (job_db_id) {
        await addLog(base44, job_db_id, 'error', 'error', error.message).catch(() => {});
        await base44.asServiceRole.entities.Job.update(job_db_id, { status: 'error', error: error.message });
      }
    } catch (_) {}
    return Response.json({ error: error.message }, { status: 500 });
  }
});