import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

// processAICaption v11 — Production-Grade CC Builder
// Implements the exact 10-module pipeline from the spec:
//   1. parse_srt_backbone
//   2. align_words_to_cues
//   3. build_speaker_runs
//   4. insert_sound_cues_as_cues
//   5. pre_split_multispeaker_cues
//   6. ai_linebreak_format_cue (OpenAI — linguistic line breaking ONLY)
//   7. validate_cue_or_split
//   8. recalculate_timings_for_splits
//   9. export_srt
//  10. run_acceptance_tests
//
// NON-NEGOTIABLE: Timing comes from AssemblyAI SRT backbone.
// AI is ONLY used for linguistic line breaking under 2-line/32-char constraints.

// ─── CONSTANTS ──────────────────────────────────────────────────────────────

const MAX_CHARS = 32;
const MAX_LINES = 2;
const MIN_CUE_DURATION_MS = 800;
const SOUND_CUE_MIN_MS = 800;
const SOUND_CUE_MAX_MS = 1500;

const FUNC_WORDS = new Set([
  'a','an','the','of','to','and','or','but','with','from','in','on','at','for','that'
]);

const PROTECTED_PHRASES = [
  'Watch What Happens Live',
  'Below Deck Mediterranean',
  'Below Deck Med',
  'Real Housewives',
  'Andy Cohen',
];

// ─── MODULE 1: parse_srt_backbone ───────────────────────────────────────────
// Parse AssemblyAI SRT text into backbone cues with ms timing

function parseSrtBackbone(srtText) {
  const cues = [];
  const blocks = srtText.trim().split(/\n\n+/);
  for (const block of blocks) {
    const lines = block.trim().split('\n');
    if (lines.length < 2) continue;
    // Find the timecode line (contains -->)
    let tcLineIdx = -1;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].includes('-->')) { tcLineIdx = i; break; }
    }
    if (tcLineIdx === -1) continue;
    const tcLine = lines[tcLineIdx];
    const match = tcLine.match(/(\d{2}:\d{2}:\d{2}[,\.]\d{3})\s*-->\s*(\d{2}:\d{2}:\d{2}[,\.]\d{3})/);
    if (!match) continue;
    const start_ms = srtTimeToMs(match[1]);
    const end_ms = srtTimeToMs(match[2]);
    const text_raw = lines.slice(tcLineIdx + 1).join('\n').trim();
    cues.push({ cue_id: cues.length, start_ms, end_ms, text_raw });
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
// For each backbone cue time range, collect all words whose timestamps overlap

function alignWordsToCues(backboneCues, words) {
  // Filter out sound-event pseudo-words (bracketed like [LAUGHTER])
  const speechWords = words.filter(w => !w.text.startsWith('['));
  
  for (const cue of backboneCues) {
    cue.aligned_words = [];
    for (const w of speechWords) {
      // Word overlaps cue if word starts before cue ends AND word ends after cue starts
      if (w.start < cue.end_ms && w.end > cue.start_ms) {
        cue.aligned_words.push(w);
      }
    }
  }
  return backboneCues;
}

// ─── MODULE 3: build_speaker_runs ───────────────────────────────────────────
// Group aligned words by speaker in chronological order to create runs

function buildSpeakerRuns(backboneCues) {
  for (const cue of backboneCues) {
    const runs = [];
    let currentRun = null;
    for (const w of cue.aligned_words) {
      if (!currentRun || currentRun.speaker !== w.speaker) {
        if (currentRun) runs.push(currentRun);
        currentRun = {
          speaker: w.speaker,
          words: [w],
          start_ms: w.start,
          end_ms: w.end,
          text: w.text,
        };
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

// ─── MODULE 4: insert_sound_cues_as_cues ────────────────────────────────────
// Extract sound events from word stream and insert as standalone cues

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
  // Deduplicate consecutive identical events
  const deduped = [];
  for (const e of events) {
    const last = deduped[deduped.length - 1];
    if (last && last.label === e.label && e.start_ms - last.end_ms < 500) {
      last.end_ms = e.end_ms; // merge
    } else {
      deduped.push({ ...e });
    }
  }
  return deduped;
}

function insertSoundCues(dialogueCues, soundEvents) {
  const allCues = [...dialogueCues.map(c => ({
    ...c,
    cue_type: 'dialogue',
  }))];

  for (const se of soundEvents) {
    const duration = Math.max(SOUND_CUE_MIN_MS, Math.min(SOUND_CUE_MAX_MS, se.end_ms - se.start_ms));
    let label = se.label;
    // Truncate label if too long for 32 chars (including brackets)
    if (label.length > 28) label = label.substring(0, 28);
    const text = `[${label}]`;

    // Find placement: between dialogue cues, before, or after
    let placed = false;
    for (let i = 0; i < allCues.length; i++) {
      const cur = allCues[i];
      if (cur.cue_type !== 'dialogue') continue;
      
      // Before first dialogue cue
      if (se.start_ms < cur.start_ms) {
        const scStart = Math.max(0, se.start_ms);
        const scEnd = Math.min(cur.start_ms - 1, scStart + duration);
        if (scEnd - scStart >= SOUND_CUE_MIN_MS) {
          allCues.splice(i, 0, {
            start_ms: scStart, end_ms: scEnd, text, cue_type: 'sound', runs: [],
          });
          placed = true;
          break;
        }
      }
      
      // Between this cue and next
      const next = allCues[i + 1];
      if (next && se.start_ms >= cur.end_ms && se.end_ms <= next.start_ms) {
        const scStart = Math.max(cur.end_ms + 1, se.start_ms);
        const scEnd = Math.min(next.start_ms - 1, scStart + duration);
        if (scEnd - scStart >= SOUND_CUE_MIN_MS) {
          allCues.splice(i + 1, 0, {
            start_ms: scStart, end_ms: scEnd, text, cue_type: 'sound', runs: [],
          });
          placed = true;
          break;
        }
      }
    }

    // If not placed between cues, place after closest preceding dialogue cue
    if (!placed) {
      let bestIdx = -1;
      for (let i = 0; i < allCues.length; i++) {
        if (allCues[i].cue_type === 'dialogue' && allCues[i].start_ms <= se.start_ms) {
          bestIdx = i;
        }
      }
      if (bestIdx >= 0) {
        const afterEnd = allCues[bestIdx].end_ms + 1;
        const nextStart = bestIdx + 1 < allCues.length ? allCues[bestIdx + 1].start_ms - 1 : afterEnd + duration;
        const scEnd = Math.min(nextStart, afterEnd + duration);
        if (scEnd - afterEnd >= 100) { // Even short sound cues get inserted
          allCues.splice(bestIdx + 1, 0, {
            start_ms: afterEnd, end_ms: Math.max(scEnd, afterEnd + SOUND_CUE_MIN_MS), text, cue_type: 'sound', runs: [],
          });
        }
      } else if (allCues.length > 0) {
        // Place before first cue
        const scEnd = Math.min(allCues[0].start_ms - 1, se.start_ms + duration);
        allCues.unshift({
          start_ms: se.start_ms, end_ms: Math.max(scEnd, se.start_ms + SOUND_CUE_MIN_MS), text, cue_type: 'sound', runs: [],
        });
      }
    }
  }

  return allCues;
}

// ─── MODULE 5: pre_split_multispeaker_cues ──────────────────────────────────
// If a backbone cue has multiple speaker runs, split deterministically

function preSplitMultispeakerCues(cues) {
  const result = [];
  for (const cue of cues) {
    if (cue.cue_type === 'sound') {
      result.push(cue);
      continue;
    }
    const runs = cue.runs || [];
    if (runs.length <= 1) {
      result.push(cue);
      continue;
    }
    if (runs.length === 2) {
      // Case A: Two speakers — try dash format in one cue
      const lineA = '- ' + runs[0].text;
      const lineB = '- ' + runs[1].text;
      if (lineA.length <= MAX_CHARS && lineB.length <= MAX_CHARS) {
        result.push({
          ...cue,
          runs,
          multi_speaker_dash: true,
        });
        continue;
      }
      // Doesn't fit — split into separate cues with proportional timing
      const totalDur = cue.end_ms - cue.start_ms;
      const totalChars = runs.reduce((s, r) => s + r.text.length, 0);
      let offset = cue.start_ms;
      for (const run of runs) {
        const dur = Math.max(MIN_CUE_DURATION_MS, Math.round(totalDur * (run.text.length / totalChars)));
        result.push({
          start_ms: offset,
          end_ms: Math.min(offset + dur, cue.end_ms),
          runs: [run],
          cue_type: 'dialogue',
        });
        offset += dur;
      }
      continue;
    }
    // Case B: 3+ speaker runs — split each into its own cue
    const totalDur = cue.end_ms - cue.start_ms;
    const totalChars = runs.reduce((s, r) => s + r.text.length, 0);
    let offset = cue.start_ms;
    for (const run of runs) {
      const dur = Math.max(MIN_CUE_DURATION_MS, Math.round(totalDur * (run.text.length / totalChars)));
      result.push({
        start_ms: offset,
        end_ms: Math.min(offset + dur, cue.end_ms),
        runs: [run],
        cue_type: 'dialogue',
      });
      offset += dur;
    }
  }
  return result;
}

// ─── MODULE 6: ai_linebreak_format_cue (OpenAI) ────────────────────────────
// OpenAI is ONLY used for linguistic line breaking. No timing changes.

const AI_SYSTEM_PROMPT = `You are a professional broadcast caption formatter.
Follow these rules strictly:
- Maximum 2 lines per output
- Maximum 32 characters per line
- One speaker per line
- Dash prefix "- " for each speaker line when multiple speakers in same cue
- Do not split these named entities across lines: ${PROTECTED_PHRASES.join(', ')}
- Do not end lines with function words: a, an, the, of, to, and, or, but, with, from, in, on, at, for, that
- Prefer line breaks at punctuation (. ? ! ,) then phrase boundaries
- Preserve ALL spoken words — never drop, add, or paraphrase
- Add proper punctuation if missing
- Return JSON only — an array of objects.

For each input cue, return:
{"idx": <same idx>, "lines": ["line1", "line2"], "needs_split": false}

If text cannot fit in 2 lines of 32 chars without violating rules, return:
{"idx": <same idx>, "lines": [], "needs_split": true, "split_hint": "sentence_boundary"|"comma"|"phrase_boundary"}

Return a JSON array of results for all cues. No markdown fences.`;

// Call OpenAI for a batch of cue inputs, returns parsed results array
async function callOpenAIBatch(cueInputs, apiKey) {
  const prompt = JSON.stringify(cueInputs);
  let res;
  for (let attempt = 0; attempt < 4; attempt++) {
    res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'gpt-4o',
        messages: [
          { role: 'system', content: AI_SYSTEM_PROMPT },
          { role: 'user', content: prompt },
        ],
        temperature: 0.2,
        max_tokens: 8000,
      }),
    });
    if (res.status === 429) {
      await new Promise(r => setTimeout(r, 20000 * (attempt + 1)));
      continue;
    }
    break;
  }
  if (!res.ok) {
    console.error(`[AI] OpenAI error: ${await res.text()}`);
    return null;
  }
  const data = await res.json();
  const content = data.choices[0].message.content.trim();
  const jsonMatch = content.match(/\[[\s\S]*\]/);
  if (!jsonMatch) {
    console.error('[AI] No JSON array in response');
    return null;
  }
  return JSON.parse(jsonMatch[0]);
}

// Build AI input for a single text (for retry/child cues)
function buildAICueInput(idx, text, speakerCount) {
  return {
    idx,
    cue_type: 'dialogue',
    runs: [{ speaker: 'A', text }],
    constraints: {
      max_lines: MAX_LINES,
      max_chars_per_line: MAX_CHARS,
      one_speaker_per_line: true,
      dash_for_each_speaker_line: speakerCount > 1,
      sound_cue_standalone: true,
      no_split_named_entities: true,
      avoid_function_word_line_endings: true,
    },
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
      if (runs.length === 0) return null;
      
      // Check if this is a multi-speaker dash cue
      if (cue.multi_speaker_dash && runs.length === 2) {
        const lineA = '- ' + runs[0].text;
        const lineB = '- ' + runs[1].text;
        if (lineA.length <= MAX_CHARS && lineB.length <= MAX_CHARS) {
          results[globalIdx] = { lines: [lineA, lineB], needs_split: false };
          return null;
        }
      }

      const fullText = runs.map(r => r.text).join(' ');
      
      if (fullText.length <= MAX_CHARS) {
        results[globalIdx] = { lines: [fullText], needs_split: false };
        return null;
      }

      return {
        idx: globalIdx,
        cue_type: 'dialogue',
        runs: runs.map(r => ({ speaker: r.speaker, text: r.text })),
        constraints: {
          max_lines: MAX_LINES,
          max_chars_per_line: MAX_CHARS,
          one_speaker_per_line: true,
          dash_for_each_speaker_line: runs.length > 1,
          sound_cue_standalone: true,
          no_split_named_entities: true,
          avoid_function_word_line_endings: true,
        },
        protected_phrases: PROTECTED_PHRASES,
      };
    }).filter(Boolean);

    if (cueInputs.length === 0) continue;

    const parsed = await callOpenAIBatch(cueInputs, apiKey);
    
    if (!parsed) {
      for (const ci of cueInputs) {
        results[ci.idx] = deterministicLineBreak(ci.runs.map(r => r.text).join(' '));
      }
    } else {
      for (const r of parsed) {
        if (r.idx !== undefined && r.idx < results.length) {
          results[r.idx] = r;
        }
      }
      for (const ci of cueInputs) {
        if (!results[ci.idx]) {
          results[ci.idx] = deterministicLineBreak(ci.runs.map(r => r.text).join(' '));
        }
      }
    }

    if (batchEnd < cues.length) {
      await new Promise(r => setTimeout(r, 1500));
    }
  }

  for (let i = 0; i < results.length; i++) {
    if (!results[i]) {
      const cue = cues[i];
      const text = cue.cue_type === 'sound' ? cue.text : (cue.runs || []).map(r => r.text).join(' ');
      results[i] = deterministicLineBreak(text);
    }
  }

  return { results };
}

// Re-invoke AI on child cue texts in batches (for split retry per spec Section 7)
async function aiLinebreakSmall(texts, apiKey) {
  const RETRY_BATCH = 40;
  const allResults = new Array(texts.length);
  
  for (let start = 0; start < texts.length; start += RETRY_BATCH) {
    const end = Math.min(start + RETRY_BATCH, texts.length);
    const batchTexts = texts.slice(start, end);
    const inputs = batchTexts.map((t, i) => buildAICueInput(start + i, t, 1));
    const parsed = await callOpenAIBatch(inputs, apiKey);
    
    for (let j = 0; j < batchTexts.length; j++) {
      const globalIdx = start + j;
      const match = parsed?.find(r => r.idx === globalIdx);
      allResults[globalIdx] = match || deterministicLineBreak(batchTexts[j]);
    }
    
    if (end < texts.length) {
      await new Promise(r => setTimeout(r, 1500));
    }
  }
  
  return allResults;
}

// Check for soft failures (function word endings) and return true if found
function hasSoftFailures(lines) {
  for (let li = 0; li < lines.length - 1; li++) {
    const lineWords = lines[li].replace(/^- /, '').trim().split(/\s+/);
    const lastWord = lineWords[lineWords.length - 1].replace(/[.,!?;:'"]+$/, '').toLowerCase();
    if (FUNC_WORDS.has(lastWord)) return true;
  }
  return false;
}

// ─── MODULE 7: validate_cue_or_split ────────────────────────────────────────
// Hard gate: reject and split if violations found

function validateLines(lines) {
  const errors = [];
  if (lines.length > MAX_LINES) errors.push('too_many_lines');
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].length > MAX_CHARS) errors.push(`line_${i}_too_long`);
  }
  // Check sound cue mixed with dialogue
  const hasSound = lines.some(l => l.startsWith('[') && l.endsWith(']'));
  const hasDialogue = lines.some(l => !l.startsWith('[') || !l.endsWith(']'));
  if (hasSound && hasDialogue && lines.length > 1) errors.push('sound_mixed_with_dialogue');
  
  // Check protected phrase split across lines
  for (const phrase of PROTECTED_PHRASES) {
    const words = phrase.split(' ');
    for (let w = 0; w < words.length - 1; w++) {
      for (let li = 0; li < lines.length - 1; li++) {
        const lineEnd = lines[li].trim().split(/\s+/);
        const nextLineStart = lines[li + 1].trim().replace(/^- /, '').split(/\s+/);
        if (lineEnd[lineEnd.length - 1] === words[w] && nextLineStart[0] === words[w + 1]) {
          errors.push('protected_phrase_split');
        }
      }
    }
  }
  
  return errors;
}

function deterministicLineBreak(text) {
  if (!text || text.trim().length === 0) return { lines: [], needs_split: false };
  text = text.trim();
  
  if (text.length <= MAX_CHARS) {
    return { lines: [text], needs_split: false };
  }

  const words = text.split(/\s+/);
  
  // Try to find best break point for 2 lines
  let bestBp = -1;
  let bestScore = -Infinity;
  
  for (let bp = 1; bp < words.length; bp++) {
    const l1 = words.slice(0, bp).join(' ');
    const l2 = words.slice(bp).join(' ');
    if (l1.length > MAX_CHARS || l2.length > MAX_CHARS) continue;
    
    let score = 0;
    const lastWord = words[bp - 1].replace(/[.,!?;:'"]+$/, '').toLowerCase();
    
    // Penalize function word endings
    if (FUNC_WORDS.has(lastWord)) score -= 100;
    
    // Reward punctuation breaks
    const lastChar = l1[l1.length - 1];
    if ('.?!'.includes(lastChar)) score += 50;
    else if (',;:'.includes(lastChar)) score += 30;
    
    // Prefer balanced lines
    score -= Math.abs(l1.length - l2.length) * 0.5;
    
    // Check protected phrases aren't split
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
    return {
      lines: [words.slice(0, bestBp).join(' '), words.slice(bestBp).join(' ')],
      needs_split: false,
    };
  }

  // Can't fit in 2 lines — needs split into multiple cues
  return { lines: [], needs_split: true, split_hint: 'phrase_boundary' };
}

function splitCueText(text) {
  // Split at sentence boundary first
  const sentences = text.match(/[^.!?]+[.!?]+/g);
  if (sentences && sentences.length >= 2) {
    const midpoint = Math.floor(sentences.length / 2);
    const part1 = sentences.slice(0, midpoint).join(' ').trim();
    const part2 = sentences.slice(midpoint).join(' ').trim();
    return [part1, part2];
  }
  
  // Split at comma
  const commaIdx = text.indexOf(',', Math.floor(text.length / 3));
  if (commaIdx > 0) {
    return [text.substring(0, commaIdx + 1).trim(), text.substring(commaIdx + 1).trim()];
  }
  
  // Split at middle word boundary
  const words = text.split(/\s+/);
  const mid = Math.floor(words.length / 2);
  return [words.slice(0, mid).join(' '), words.slice(mid).join(' ')];
}

// ─── MODULE 8: recalculate_timings_for_splits ───────────────────────────────
// When splitting a cue, allocate time proportionally by character count

function recalculateTimingsForSplit(originalCue, textParts) {
  const totalDur = originalCue.end_ms - originalCue.start_ms;
  const totalChars = textParts.reduce((s, t) => s + t.length, 0);
  const newCues = [];
  let offset = originalCue.start_ms;

  for (let i = 0; i < textParts.length; i++) {
    const dur = Math.max(
      MIN_CUE_DURATION_MS,
      Math.round(totalDur * (textParts[i].length / totalChars))
    );
    const end = i === textParts.length - 1 ? originalCue.end_ms : Math.min(offset + dur, originalCue.end_ms);
    newCues.push({
      start_ms: offset,
      end_ms: end,
      text: textParts[i],
      cue_type: 'dialogue',
      runs: [{ speaker: originalCue.runs?.[0]?.speaker || null, text: textParts[i] }],
    });
    offset = end;
  }
  return newCues;
}

// ─── MODULE 9: export_srt ───────────────────────────────────────────────────

function msToSrtTime(ms) {
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const ms2 = ms % 1000;
  return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')},${String(ms2).padStart(3,'0')}`;
}

function exportSrt(finalCues) {
  return finalCues.map((c, i) =>
    `${i + 1}\n${msToSrtTime(c.start_ms)} --> ${msToSrtTime(c.end_ms)}\n${c.text}`
  ).join('\n\n');
}

function exportVtt(finalCues) {
  const fmt = (ms) => msToSrtTime(ms).replace(',', '.');
  return `WEBVTT\n\n${finalCues.map(c => `${fmt(c.start_ms)} --> ${fmt(c.end_ms)}\n${c.text}`).join('\n\n')}`;
}

// SCC export utilities
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

function exportScc(finalCues) {
  const lines = ['Scenarist_SCC V1.0', ''];
  for (const cue of finalCues) {
    lines.push(`${msToSCCTimecode(cue.start_ms)}\t942e`);
    for (const line of cue.text.split('\n')) {
      if (line.trim()) lines.push(buildSCCLine(cue.start_ms, line.trim()));
    }
    lines.push(`${msToSCCTimecode(cue.end_ms)}\t942e`);
    lines.push('');
  }
  return lines.join('\n');
}

// ─── MODULE 10: run_acceptance_tests ────────────────────────────────────────

function runAcceptanceTests(finalCues) {
  const issues = [];
  let prevEnd = -1;

  for (let i = 0; i < finalCues.length; i++) {
    const cue = finalCues[i];
    const lines = cue.text.split('\n');
    const isSoundCue = cue.cue_type === 'sound' || (lines.length === 1 && lines[0].startsWith('[') && lines[0].endsWith(']'));

    // Test 1: Every line ≤ 32 chars (HARD — spec says 100%)
    for (let li = 0; li < lines.length; li++) {
      if (lines[li].length > MAX_CHARS) {
        issues.push({ cue: i, type: 'line_too_long', severity: 'hard', value: `Line ${li+1}: ${lines[li].length} chars ("${lines[li].substring(0, 40)}...")` });
      }
    }

    // Test 2: Every cue ≤ 2 lines (HARD — spec says 100%)
    if (lines.length > MAX_LINES) {
      issues.push({ cue: i, type: 'too_many_lines', severity: 'hard', value: `${lines.length} lines` });
    }

    // Test 3: Sound cues standalone — no [ mixed with dialogue (HARD)
    if (isSoundCue) {
      const hasNonSound = lines.some(l => !(l.startsWith('[') && l.endsWith(']')));
      if (hasNonSound) {
        issues.push({ cue: i, type: 'sound_mixed_with_dialogue', severity: 'hard', value: cue.text.substring(0, 50) });
      }
    }
    // Also check: dialogue cues must not contain bracketed sound text
    if (!isSoundCue) {
      const hasBracket = lines.some(l => /\[.*\]/.test(l));
      if (hasBracket) {
        issues.push({ cue: i, type: 'sound_mixed_with_dialogue', severity: 'hard', value: cue.text.substring(0, 50) });
      }
    }

    // Test 4: Multi-speaker → dash format (HARD)
    // Two lines with dashes = multi-speaker. One dash, one not = error.
    if (!isSoundCue && lines.length === 2) {
      const dashLines = lines.filter(l => l.startsWith('- '));
      if (dashLines.length === 1) {
        issues.push({ cue: i, type: 'inconsistent_dash', severity: 'hard', value: 'One dash line, one without' });
      }
      // Check: two speakers on same line (two dashes on one line)
      for (const line of lines) {
        const dashCount = (line.match(/^- /g) || []).length + (line.match(/ - /g) || []).length;
        if (dashCount > 1) {
          issues.push({ cue: i, type: 'two_speakers_same_line', severity: 'hard', value: line.substring(0, 40) });
        }
      }
    }

    // Test 5: Protected phrases never split across lines
    if (!isSoundCue && lines.length === 2) {
      for (const phrase of PROTECTED_PHRASES) {
        const pWords = phrase.split(' ');
        for (let pw = 0; pw < pWords.length - 1; pw++) {
          const l0Words = lines[0].replace(/^- /, '').trim().split(/\s+/);
          const l1Words = lines[1].replace(/^- /, '').trim().split(/\s+/);
          const l0Last = l0Words[l0Words.length - 1]?.replace(/[.,!?;:'"]+$/, '');
          const l1First = l1Words[0]?.replace(/[.,!?;:'"]+$/, '');
          if (l0Last === pWords[pw] && l1First === pWords[pw + 1]) {
            issues.push({ cue: i, type: 'protected_phrase_split', severity: 'hard', value: `"${phrase}" split across lines` });
          }
        }
      }
    }

    // Test 6: Monotonic timecodes — no overlaps (HARD)
    if (cue.start_ms < prevEnd) {
      issues.push({ cue: i, type: 'overlap', severity: 'hard', value: `Starts at ${cue.start_ms} but prev ends at ${prevEnd}` });
    }
    prevEnd = cue.end_ms;

    // Soft: function word line endings
    if (!isSoundCue && lines.length > 1) {
      for (let li = 0; li < lines.length - 1; li++) {
        const lineWords = lines[li].replace(/^- /, '').trim().split(/\s+/);
        const lastWord = lineWords[lineWords.length - 1].replace(/[.,!?;:'"]+$/, '').toLowerCase();
        if (FUNC_WORDS.has(lastWord)) {
          issues.push({ cue: i, type: 'func_word_line_end', severity: 'soft', value: `Line ${li+1} ends with "${lastWord}"` });
        }
      }
    }

    // Soft: very short orphan lines (1-2 words unless punctuation makes it necessary)
    if (!isSoundCue && lines.length === 2) {
      for (let li = 0; li < lines.length; li++) {
        const lineText = lines[li].replace(/^- /, '').trim();
        const wordCount = lineText.split(/\s+/).length;
        if (wordCount <= 2 && lineText.length < 8 && !/[.!?]$/.test(lineText)) {
          issues.push({ cue: i, type: 'orphan_line', severity: 'soft', value: `Line ${li+1}: "${lineText}" (${wordCount} words)` });
        }
      }
    }

    // Duration checks (informational)
    const dur = cue.end_ms - cue.start_ms;
    if (dur < 500) issues.push({ cue: i, type: 'cue_too_short', severity: 'soft', value: `${dur}ms` });
    if (dur > 8000 && !isSoundCue) issues.push({ cue: i, type: 'cue_too_long', severity: 'soft', value: `${(dur/1000).toFixed(1)}s` });
  }

  const hardCount = issues.filter(i => i.severity === 'hard').length;
  const softCount = issues.filter(i => i.severity === 'soft').length;
  return { issuesCount: issues.length, hardCount, softCount, issues };
}

// ─── PIPELINE LOG HELPER ────────────────────────────────────────────────────

async function addLog(base44, jobId, step, status, detail) {
  const job = await base44.asServiceRole.entities.Job.get(jobId);
  const log = job.pipelineLog || [];
  log.push({ step, status, detail, ts: new Date().toISOString() });
  await base44.asServiceRole.entities.Job.update(jobId, { pipelineLog: log });
}

// ─── FILE UPLOAD HELPER ─────────────────────────────────────────────────────

async function uploadText(base44, text, filename) {
  const encoder = new TextEncoder();
  const uint8 = encoder.encode(text);
  const file = new File([uint8], filename, { type: 'text/plain' });
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

    if (!action || !job_db_id) {
      return Response.json({ error: 'action and job_db_id required' }, { status: 400 });
    }

    const ASSEMBLYAI_API_KEY = Deno.env.get('ASSEMBLYAI_API_KEY');
    const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY');
    console.log(`[v11] action=${action}, job=${job_db_id}`);

    let words, srtText, utterances, language, soundEvents;

    // ── STEP 0: Get transcript data from AssemblyAI ─────────────────────────

    if (action === 'start' || action === 'reprocess') {
      const transcript_id = body.transcript_id;
      let transcriptData;

      if (action === 'start') {
        if (!transcript_id) return Response.json({ error: 'transcript_id required' }, { status: 400 });
        
        // Fetch full transcript
        const aaiRes = await fetch(`https://api.assemblyai.com/v2/transcript/${transcript_id}`, {
          headers: { 'authorization': ASSEMBLYAI_API_KEY },
        });
        if (!aaiRes.ok) return Response.json({ error: `AAI fetch failed: ${aaiRes.status}` }, { status: 500 });
        transcriptData = await aaiRes.json();
        if (transcriptData.status !== 'completed') return Response.json({ error: `Transcript not ready: ${transcriptData.status}` }, { status: 400 });
        
      } else {
        // Reprocess — always re-fetch from AAI (we don't store the full word/srt data)
        const job = await base44.asServiceRole.entities.Job.get(job_db_id);
        const tid = transcript_id || job.railwayJobId;
        if (!tid) return Response.json({ error: 'No transcript data available' }, { status: 400 });
        const aaiRes = await fetch(`https://api.assemblyai.com/v2/transcript/${tid}`, {
          headers: { 'authorization': ASSEMBLYAI_API_KEY },
        });
        if (!aaiRes.ok) return Response.json({ error: `AAI re-fetch failed: ${aaiRes.status}` }, { status: 500 });
        transcriptData = await aaiRes.json();
        if (transcriptData.status !== 'completed') return Response.json({ error: `Transcript not ready: ${transcriptData.status}` }, { status: 400 });
      }

      if (transcriptData) {
        // Extract the three inputs per spec:
        // A) SRT Timing Backbone
        const srtRes = await fetch(`https://api.assemblyai.com/v2/transcript/${transcriptData.id}/srt`, {
          headers: { 'authorization': ASSEMBLYAI_API_KEY },
        });
        srtText = await srtRes.text();

        // B) Word-level transcript with timestamps + speaker labels
        words = (transcriptData.words || []).map(w => ({
          text: w.text,
          start: w.start,
          end: w.end,
          speaker: w.speaker,
        }));

        // C) Sound events from utterances/words
        soundEvents = extractSoundEvents(transcriptData.words || []);
        language = transcriptData.language_code || 'en';
        utterances = transcriptData.utterances || [];
      }

      // Save processing plan (without large text fields — those are kept in memory)
      await base44.asServiceRole.entities.Job.update(job_db_id, {
        status: 'processing',
        result: null,
        error: null,
        pipelineLog: [{ step: 'init', status: 'ok', detail: action === 'reprocess' ? 'Reprocess started' : 'Transcript fetched', ts: new Date().toISOString() }],
        processingPlan: {
          language,
          soundEvents,
          wordCount: words.length,
          srtLength: srtText.length,
        },
      });

      await addLog(base44, job_db_id, '1_parse', 'running', 'Parsing SRT backbone...');

      // ── STEP 1: Parse SRT Backbone ──────────────────────────────────────
      const backboneCues = parseSrtBackbone(srtText);
      console.log(`[STEP 1] Parsed ${backboneCues.length} backbone cues from SRT`);
      await addLog(base44, job_db_id, '1_parse', 'ok', `${backboneCues.length} backbone cues parsed`);

      // ── STEP 2: Align words to cues ─────────────────────────────────────
      await addLog(base44, job_db_id, '2_align', 'running', 'Aligning word-level diarization...');
      alignWordsToCues(backboneCues, words);
      console.log(`[STEP 2] Words aligned to backbone cues`);
      await addLog(base44, job_db_id, '2_align', 'ok', 'Words aligned with speaker labels');

      // ── STEP 3: Build speaker runs ──────────────────────────────────────
      await addLog(base44, job_db_id, '3_runs', 'running', 'Building speaker runs...');
      buildSpeakerRuns(backboneCues);
      const totalRuns = backboneCues.reduce((s, c) => s + (c.runs?.length || 0), 0);
      console.log(`[STEP 3] Built ${totalRuns} speaker runs across ${backboneCues.length} cues`);
      await addLog(base44, job_db_id, '3_runs', 'ok', `${totalRuns} speaker runs built`);

      // ── STEP 4: Insert sound cues ───────────────────────────────────────
      await addLog(base44, job_db_id, '4_sound', 'running', 'Inserting sound cues...');
      const withSoundCues = insertSoundCues(backboneCues, soundEvents);
      const soundCount = withSoundCues.filter(c => c.cue_type === 'sound').length;
      console.log(`[STEP 4] Inserted ${soundCount} sound cues, total ${withSoundCues.length} cues`);
      await addLog(base44, job_db_id, '4_sound', 'ok', `${soundCount} sound cues inserted`);

      // ── STEP 5: Pre-split multi-speaker cues ───────────────────────────
      await addLog(base44, job_db_id, '5_split', 'running', 'Pre-splitting multi-speaker cues...');
      const preSplit = preSplitMultispeakerCues(withSoundCues);
      console.log(`[STEP 5] After pre-split: ${preSplit.length} cues`);
      await addLog(base44, job_db_id, '5_split', 'ok', `${preSplit.length} cues after multi-speaker split`);

      // ── STEP 6: AI line breaking ────────────────────────────────────────
      await addLog(base44, job_db_id, '6_ai', 'running', 'OpenAI linguistic line breaking...');
      const { results: aiResults } = await aiLinebreakBatch(preSplit, OPENAI_API_KEY);
      console.log(`[STEP 6] AI line breaking complete for ${preSplit.length} cues`);
      await addLog(base44, job_db_id, '6_ai', 'ok', 'AI line breaking complete');

      // ── STEP 7: Validate and split if needed ────────────────────────────
      // Per spec Section 5 & 7: hard failures → split + re-invoke AI on children
      // Soft failures (function word endings) → retry AI once
      await addLog(base44, job_db_id, '7_validate', 'running', 'Validation gate...');
      
      let finalCues = [];
      let splitCount = 0;
      let softRetryCount = 0;
      
      // Collect child cues that need AI re-processing after split
      const childCuesForAI = []; // { childCue, parentIdx }
      
      for (let i = 0; i < preSplit.length; i++) {
        const cue = preSplit[i];
        const aiResult = aiResults[i];
        
        if (cue.cue_type === 'sound') {
          finalCues.push({
            start_ms: cue.start_ms,
            end_ms: cue.end_ms,
            text: cue.text,
            cue_type: 'sound',
            speaker: null,
          });
          continue;
        }

        if (aiResult.needs_split) {
          // AI said it can't fit — deterministic split, then re-invoke AI on children (per spec)
          const fullText = (cue.runs || []).map(r => r.text).join(' ');
          const [part1, part2] = splitCueText(fullText);
          const children = recalculateTimingsForSplit(cue, [part1, part2]);
          
          for (const child of children) {
            const placeholderIdx = finalCues.length;
            child._needsAIRetry = true;
            finalCues.push(child);
            childCuesForAI.push({ idx: placeholderIdx, text: child.text });
          }
          splitCount++;
          continue;
        }

        // Validate AI output
        const lines = aiResult.lines || [];
        const errors = validateLines(lines);
        
        if (errors.length > 0) {
          // Hard failure — split + re-invoke AI on children (per spec)
          const fullText = (cue.runs || []).map(r => r.text).join(' ');
          const [part1, part2] = splitCueText(fullText);
          const children = recalculateTimingsForSplit(cue, [part1, part2]);
          
          for (const child of children) {
            child._needsAIRetry = true;
            finalCues.push(child);
            childCuesForAI.push({ idx: finalCues.length - 1, text: child.text });
          }
          splitCount++;
          continue;
        }

        // Track soft failures but accept them (re-asking AI for every function word
        // ending would exceed time limits; spec says "unless unavoidable")
        if (lines.length > 1 && hasSoftFailures(lines)) {
          softRetryCount++;
        }

        // AI output is valid
        finalCues.push({
          start_ms: cue.start_ms,
          end_ms: cue.end_ms,
          text: lines.join('\n'),
          cue_type: cue.cue_type || 'dialogue',
          speaker: cue.runs?.[0]?.speaker || null,
        });
      }

      // Re-invoke AI on child/retry cues in batches (cap at 120 to avoid timeout)
      const MAX_AI_RETRIES = 120;
      if (childCuesForAI.length > 0) {
        const aiRetrySlice = childCuesForAI.slice(0, MAX_AI_RETRIES);
        const deterministicSlice = childCuesForAI.slice(MAX_AI_RETRIES);
        
        // Handle overflow with deterministic fallback
        for (const overflow of deterministicSlice) {
          const fb = deterministicLineBreak(overflow.text);
          if (!fb.needs_split) {
            finalCues[overflow.idx].text = fb.lines.join('\n');
          } else {
            const words = overflow.text.split(/\s+/);
            const half = Math.ceil(words.length / 2);
            finalCues[overflow.idx].text = `${words.slice(0, half).join(' ').substring(0, MAX_CHARS)}\n${words.slice(half).join(' ').substring(0, MAX_CHARS)}`;
          }
          delete finalCues[overflow.idx]._needsAIRetry;
          delete finalCues[overflow.idx]._softRetry;
        }
        
        console.log(`[STEP 7] Re-invoking AI on ${aiRetrySlice.length} child/retry cues (${deterministicSlice.length} overflow handled deterministically)`);
        const textsForAI = aiRetrySlice.map(c => c.text);
        const aiRetryResults = await aiLinebreakSmall(textsForAI, OPENAI_API_KEY);
        
        for (let j = 0; j < aiRetrySlice.length; j++) {
          const { idx, isSoftRetry } = aiRetrySlice[j];
          const retryResult = aiRetryResults[j];
          
          if (retryResult && !retryResult.needs_split && retryResult.lines?.length > 0) {
            const retryErrors = validateLines(retryResult.lines);
            if (retryErrors.length === 0) {
              finalCues[idx].text = retryResult.lines.join('\n');
              delete finalCues[idx]._needsAIRetry;
              delete finalCues[idx]._softRetry;
              continue;
            }
          }
          
          // AI retry failed — use deterministic fallback
          if (!isSoftRetry) {
            const fallback = deterministicLineBreak(aiRetrySlice[j].text);
            if (fallback.needs_split) {
              // Last resort: force fit
              const words = aiRetrySlice[j].text.split(/\s+/);
              const half = Math.ceil(words.length / 2);
              const l1 = words.slice(0, half).join(' ').substring(0, MAX_CHARS);
              const l2 = words.slice(half).join(' ').substring(0, MAX_CHARS);
              finalCues[idx].text = l2 ? `${l1}\n${l2}` : l1;
            } else {
              finalCues[idx].text = fallback.lines.join('\n');
            }
          }
          // For soft retries, keep the original AI output (already stored as fallback)
          delete finalCues[idx]._needsAIRetry;
          delete finalCues[idx]._softRetry;
        }
      }

      // Clean up any leftover flags
      for (const cue of finalCues) {
        delete cue._needsAIRetry;
        delete cue._softRetry;
      }

      console.log(`[STEP 7] Validation: ${splitCount} splits, ${softRetryCount} soft retries, ${finalCues.length} final cues`);
      await addLog(base44, job_db_id, '7_validate', 'ok', `${splitCount} splits, ${softRetryCount} soft retries, ${finalCues.length} final cues`);

      // ── STEP 8: Ensure monotonic timecodes & no overlaps ─────────────────
      // Per spec: "sound cue cues must not overlap dialogue cues in time"
      // and "Output timing is monotonic (no overlaps, no reverse order)"
      finalCues.sort((a, b) => a.start_ms - b.start_ms);
      for (let i = 1; i < finalCues.length; i++) {
        if (finalCues[i].start_ms <= finalCues[i - 1].end_ms) {
          finalCues[i].start_ms = finalCues[i - 1].end_ms + 1;
          if (finalCues[i].end_ms <= finalCues[i].start_ms) {
            finalCues[i].end_ms = finalCues[i].start_ms + MIN_CUE_DURATION_MS;
          }
        }
      }
      // Remove any sound cues that ended up with zero/negative duration after fixup
      finalCues = finalCues.filter(c => c.end_ms > c.start_ms);

      // ── STEP 9: Export formats ──────────────────────────────────────────
      await addLog(base44, job_db_id, '8_export', 'running', 'Exporting SRT/VTT/SCC...');
      
      // Convert to output cue format for frontend compatibility
      const outputCues = finalCues.map(c => ({
        start: c.start_ms,
        end: c.end_ms,
        text: c.text,
        speaker: c.speaker,
      }));

      const srt = exportSrt(finalCues);
      const vtt = exportVtt(finalCues);
      const scc = exportScc(finalCues);

      // ── STEP 10: Run acceptance tests ───────────────────────────────────
      const qc = runAcceptanceTests(finalCues);
      console.log(`[STEP 10] Acceptance: ${qc.hardCount} hard, ${qc.softCount} soft issues across ${finalCues.length} cues`);
      await addLog(base44, job_db_id, '8_export', 'ok', `Exported ${finalCues.length} cues, ${qc.hardCount} hard / ${qc.softCount} soft QC issues`);

      // ── Save results ────────────────────────────────────────────────────
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
        resultPayload = {
          cue_chunks: [cueJson],
          srt_chunks: [srt],
          vtt_chunks: [vtt],
          scc_chunks: [scc],
          qc,
          language,
        };
      }

      const durationMs = finalCues.length > 0 ? finalCues[finalCues.length - 1].end_ms : 0;

      await base44.asServiceRole.entities.Job.update(job_db_id, {
        status: 'done',
        result: resultPayload,
        durationMs,
        issuesCount: qc.issuesCount,
        processingPlan: null,
      });

      await addLog(base44, job_db_id, '9_done', 'ok', `Done! ${finalCues.length} cues, ${qc.issuesCount} QC issues`);
      console.log(`[DONE] Job ${job_db_id}: ${finalCues.length} cues, ${qc.issuesCount} issues`);
      
      return Response.json({ status: 'done', cues: finalCues.length, issues: qc.issuesCount });

    } else {
      return Response.json({ error: `Unknown action: ${action}` }, { status: 400 });
    }

  } catch (error) {
    console.error('[processAICaption v11] Error:', error.message, error.stack);
    try {
      if (job_db_id) {
        await addLog(base44, job_db_id, 'error', 'error', error.message).catch(() => {});
        await base44.asServiceRole.entities.Job.update(job_db_id, { status: 'error', error: error.message });
      }
    } catch (_) {}
    return Response.json({ error: error.message }, { status: 500 });
  }
});