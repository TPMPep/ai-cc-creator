import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

const ASSEMBLYAI_BASE = 'https://api.assemblyai.com/v2';

async function getTranscript(transcriptId, apiKey) {
  const res = await fetch(`${ASSEMBLYAI_BASE}/transcript/${transcriptId}`, {
    headers: { 'authorization': apiKey },
  });
  if (!res.ok) throw new Error(`AssemblyAI poll failed: ${res.status}`);
  return res.json();
}

// Convert ms to SCC timecode HH:MM:SS:FF at 29.97fps (drop-frame)
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
  const ss = secs % 60;
  const mins = Math.floor(secs / 60);
  const mm = mins % 60;
  const hh = Math.floor(mins / 60);
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}:${String(ff).padStart(2, '0')}`;
}

function textToSCCBytes(text) {
  const bytes = [];
  const clean = text.replace(/\r/g, '').substring(0, 64);
  for (let i = 0; i < clean.length; i++) {
    const code = clean.charCodeAt(i);
    if (code >= 0x20 && code <= 0x7e) {
      if (i + 1 < clean.length && clean.charCodeAt(i + 1) >= 0x20 && clean.charCodeAt(i + 1) <= 0x7e) {
        bytes.push(`${code.toString(16).padStart(2, '0')}${clean.charCodeAt(i + 1).toString(16).padStart(2, '0')}`);
        i++;
      } else {
        bytes.push(`${code.toString(16).padStart(2, '0')}80`);
      }
    }
  }
  return bytes;
}

function buildSCCLine(ms, text) {
  const tc = msToSCCTimecode(ms);
  const bytePairs = textToSCCBytes(text);
  const data = ['942c', '9420', ...bytePairs, '942f'].join(' ');
  return `${tc}\t${data}`;
}

function buildSRT(cues) {
  return cues.map((c, i) => {
    const fmt = (ms) => {
      const h = Math.floor(ms / 3600000);
      const m = Math.floor((ms % 3600000) / 60000);
      const s = Math.floor((ms % 60000) / 1000);
      const ms2 = ms % 1000;
      return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')},${String(ms2).padStart(3,'0')}`;
    };
    return `${i + 1}\n${fmt(c.start)} --> ${fmt(c.end)}\n${c.text}\n`;
  }).join('\n');
}

function buildVTT(cues) {
  const fmt = (ms) => {
    const h = Math.floor(ms / 3600000);
    const m = Math.floor((ms % 3600000) / 60000);
    const s = Math.floor((ms % 60000) / 1000);
    const ms2 = ms % 1000;
    return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}.${String(ms2).padStart(3,'0')}`;
  };
  const body = cues.map(c => `${fmt(c.start)} --> ${fmt(c.end)}\n${c.text}`).join('\n\n');
  return `WEBVTT\n\n${body}`;
}

function buildSCC(cues) {
  const lines = ['Scenarist_SCC V1.0', ''];
  for (const cue of cues) {
    lines.push(`${msToSCCTimecode(cue.start)}\t942e`);
    const textLines = cue.text.split('\n');
    for (const line of textLines) {
      if (line.trim()) lines.push(buildSCCLine(cue.start, line.trim()));
    }
    lines.push(`${msToSCCTimecode(cue.end)}\t942e`);
    lines.push('');
  }
  return lines.join('\n');
}

// ─────────────────────────────────────────────────────────────────────────────
// POST-PROCESSOR: Hard guardrail enforcement
// GPT is responsible for intelligent splitting/timing. This layer only fixes
// cases GPT still gets wrong: lines over 32 chars, cues over 2 lines, or
// overlapping timecodes. It uses the word index to find accurate retime points.
// ─────────────────────────────────────────────────────────────────────────────
function postProcess(cues, wordIndex) {
  const MAX_CHARS = 32;
  const MIN_DUR = 500;
  const MIN_GAP = 67;
  const result = [];

  for (const cue of cues) {
    // Sound / music cues — pass through unchanged, just validate length
    const isSoundCue = cue.text.startsWith('[') || cue.text.includes('♪');
    if (isSoundCue) {
      // Truncate if over 32 chars but don't re-flow (they're short by design)
      result.push(cue);
      continue;
    }

    const rawLines = cue.text.split('\n');
    const allOk = rawLines.length <= 2 && rawLines.every(l => l.length <= MAX_CHARS);
    if (allOk) {
      result.push(cue);
      continue;
    }

    // Need to re-flow this cue — pack words into 32-char lines
    // Preserve dash prefixes (speaker indicators)
    const hasDashes = rawLines.every(l => l.startsWith('- '));
    const words = rawLines.map(l => l.replace(/^- /, '')).join(' ').split(/\s+/).filter(Boolean);

    const packedLines = [];
    let currentLine = '';
    for (const word of words) {
      const candidate = currentLine ? `${currentLine} ${word}` : word;
      if (candidate.length <= MAX_CHARS) {
        currentLine = candidate;
      } else {
        if (currentLine) packedLines.push(currentLine);
        currentLine = word.length > MAX_CHARS ? word.substring(0, MAX_CHARS) : word;
      }
    }
    if (currentLine) packedLines.push(currentLine);

    // Restore dashes only if original was a 2-speaker cue and we still have 2 lines
    if (hasDashes && packedLines.length === 2) {
      packedLines[0] = '- ' + packedLines[0];
      packedLines[1] = '- ' + packedLines[1];
      // Re-check 32 chars with dashes
      if (packedLines[0].length > MAX_CHARS) packedLines[0] = packedLines[0].substring(0, MAX_CHARS);
      if (packedLines[1].length > MAX_CHARS) packedLines[1] = packedLines[1].substring(0, MAX_CHARS);
    }

    // Split into groups of 2 lines, retiming using word index
    const totalDur = cue.end - cue.start;
    const chunkCount = Math.ceil(packedLines.length / 2);

    for (let i = 0; i < packedLines.length; i += 2) {
      const chunk = packedLines.slice(i, i + 2);
      const chunkIndex = Math.floor(i / 2);

      // Try to find word-accurate start/end from word index
      let chunkStart = cue.start + Math.floor((chunkIndex / chunkCount) * totalDur);
      let chunkEnd = chunkIndex === chunkCount - 1
        ? cue.end
        : cue.start + Math.floor(((chunkIndex + 1) / chunkCount) * totalDur);

      // Look up actual word timings for the first word in this chunk
      const chunkText = chunk.join(' ').replace(/^- /, '').toLowerCase().replace(/[^a-z0-9 ]/g, '');
      const firstWord = chunkText.split(' ')[0];
      if (firstWord && wordIndex[firstWord]) {
        // Find word timing within cue's range
        const match = wordIndex[firstWord].find(w => w.start >= cue.start - 500 && w.start <= cue.end + 500);
        if (match) chunkStart = match.start;
      }

      result.push({
        start: chunkStart,
        end: Math.max(chunkStart + MIN_DUR, chunkEnd),
        text: chunk.join('\n'),
        speaker: cue.speaker,
      });
    }
  }

  // Fix overlaps and gaps
  for (let i = 1; i < result.length; i++) {
    const gap = result[i].start - result[i - 1].end;
    if (gap < 0) {
      // Overlap — push this cue's start forward
      result[i].start = result[i - 1].end + MIN_GAP;
      if (result[i].end <= result[i].start) {
        result[i].end = result[i].start + MIN_DUR;
      }
    } else if (gap < MIN_GAP && gap > 0) {
      result[i].start = result[i - 1].end + MIN_GAP;
    }
  }

  return result;
}

// Build a word index: { normalizedWord -> [{start, end}] } for fast lookup
function buildWordIndex(words) {
  const index = {};
  for (const w of words) {
    const key = w.text.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (!key) continue;
    if (!index[key]) index[key] = [];
    index[key].push({ start: w.start, end: w.end });
  }
  return index;
}

// ─────────────────────────────────────────────────────────────────────────────
// GPT PROMPT — The core intelligence layer
// ─────────────────────────────────────────────────────────────────────────────
async function applyNBCURules(rawWords, utterances, language, highlights, contentSafety, apiKey) {
  // Send word-level timings — this is the key data for GPT to make accurate splits
  // Format: each word with its exact start/end so GPT can anchor cue boundaries to real word times
  const wordDump = rawWords.slice(0, 3000).map(w =>
    `${w.start}|${w.end}|${w.text}`
  ).join('\n');

  // Utterances with speaker labels — GPT uses these for speaker attribution and sentence context
  const utteranceDump = utterances ? utterances.slice(0, 150).map(u =>
    `[${u.start}-${u.end}ms] Speaker ${u.speaker}: ${u.text}`
  ).join('\n') : '';

  const highlightDump = highlights && highlights.length > 0
    ? highlights.slice(0, 30).map(h => `"${h.text}" (${h.timestamps.map(t => `${t.start}-${t.end}ms`).join(', ')})`).join('\n')
    : '';

  const safetySummary = contentSafety && contentSafety.results && contentSafety.results.length > 0
    ? contentSafety.results.slice(0, 10).map(r => `[${r.timestamp?.start}-${r.timestamp?.end}ms] ${r.labels?.map(l => l.label).join(', ')}`).join('\n')
    : '';

  const prompt = `You are a professional broadcast closed caption editor (20+ years, NBCU CM-051 / FCC standards). Your output will go to a human QC editor before air — make it broadcast-ready.

You have been given WORD-LEVEL timing data (format: startMs|endMs|word). Use these exact timestamps to anchor your cue start/end times to real spoken words. NEVER fabricate or approximate a timecode — always base it on the actual word timing data provided.

════════════════════════════════════════
TIMING RULES (MOST IMPORTANT)
════════════════════════════════════════
- A cue's "start" MUST equal the start time of the first spoken word in that cue.
- A cue's "end" MUST equal the end time of the last spoken word in that cue (or the start of the next cue minus 67ms — whichever is earlier).
- NEVER show text before the word is spoken. NEVER keep text on screen after the last word has been said.
- For gaps between utterances (silence, music, ambient sound), create a sound/music cue that fills the gap — or leave a natural gap with NO caption if it is brief silence.
- If a gap between two speech segments is longer than 2 seconds, insert an appropriate sound cue (music, ambient, etc.) for SDH compliance.

════════════════════════════════════════
LINE & CUE FORMATTING (STRICT HARD LIMITS)
════════════════════════════════════════
- MAXIMUM 32 characters per line. Count EVERY character: letters, spaces, punctuation, brackets, dashes.
- MAXIMUM 2 lines per cue.
- MINIMUM cue duration: 500ms.
- MAXIMUM cue duration: 8 seconds. Split any utterance longer than 8s into multiple cues.
- Minimum gap between cues: 67ms (2 frames at 29.97fps).
- When splitting a long utterance, break at natural sentence or clause boundaries (comma, period, conjunction). NEVER split mid-word or mid-phrase awkwardly.
- Fill lines efficiently — aim for both lines to be close to 32 chars when a 2-line cue makes sense. Do not leave 4-word lines when 6 words would fit and still be ≤32 chars.
- Two-line cues are preferred over many short single-line cues when the speech is continuous.

════════════════════════════════════════
SPEAKER IDENTIFICATION
════════════════════════════════════════
- Single speaker in a cue: NO dash prefix. Just the text.
- Two DIFFERENT speakers sharing one cue (allowed when their speech is brief and adjacent): prefix EACH line with "- " (dash space). This uses 2 chars of your 32-char budget per line.
  CORRECT: "- Are you sure?\n- Absolutely."
  WRONG: ">> Are you sure?" or ">Are you sure?"
- NEVER use >> or > for speaker changes.
- When speakers overlap in timing and can be combined into one 2-line cue without exceeding 32 chars per line, combine them with "- " dashes.
- If a speaker change happens mid-utterance, split cues at the exact word boundary where the speaker changes (use word timing data to find the exact ms).

════════════════════════════════════════
GRAMMAR & PUNCTUATION
════════════════════════════════════════
- Every sentence MUST end with . ? or ! — no exceptions.
- Fix homophones contextually: to/too/two, there/their/they're, its/it's, your/you're, etc.
- Preserve natural contractions: gonna, wanna, kinda, don't, can't, I'm, etc.
- Use commas for natural speech pauses within a sentence.
- Use em-dash (—) for abrupt cut-offs or strong mid-thought pauses.
- Use ellipsis (...) ONLY when a speaker trails off and the thought is genuinely incomplete.
- Capitalize proper nouns, brand names, place names correctly.
- Do NOT use ALL CAPS for regular dialogue (only for sound/music cues inside brackets).

════════════════════════════════════════
SOUND & MUSIC CUES (SDH — MANDATORY)
════════════════════════════════════════
- Detect gaps in speech from the word timing data. If a gap > 2 seconds has no dialogue, insert a sound/music cue.
- Music: [ ♪ DESCRIPTION ♪ ] — description in ALL CAPS.
  Examples: [ ♪ UPBEAT MUSIC ♪ ] / [ ♪ ROCK MUSIC ♪ ] / [ ♪ DRAMATIC STING ♪ ]
- If lyrics: ♪ lyric line ♪ (one line per sung line)
- Sound effects: [DESCRIPTION IN CAPS] — e.g., [ENGINE REVVING], [DOOR SLAMS], [CROWD CHEERING], [TIRES SCREECHING], [LAUGHS]
- For long music segments: open cue at music start, close cue at music end.
- Infer sounds from context: car video → [ENGINE REVVING], interview → [AMBIENT NOISE], etc.
- Keep sound cues ≤ 32 characters per line.

════════════════════════════════════════
EXAMPLES
════════════════════════════════════════
EXAMPLE A — Correct timing-anchored split of a long utterance:
Word data: 12000|12300|I  12350|12500|really  12550|12900|think  12950|13200|that  13250|13600|we  13650|13900|need  ...
Utterance [12000-20000ms] Speaker A: "I really think that we need to take a look at what's been happening over the last few months."
Output:
{"start":12000,"end":15200,"text":"I really think that we need\nto take a look at what's been","speaker":"A"}
{"start":15267,"end":18000,"text":"happening over the last\nfew months.","speaker":"A"}

EXAMPLE B — Two speakers combined with dashes:
Word data: 5500|5800|Are  5850|6000|you  6050|6300|ready  6800|7000|I  7050|7200|was  7250|7500|born  7550|7800|ready
Utterance [5500-6300ms] Speaker A: "Are you ready?"
Utterance [6800-7800ms] Speaker B: "I was born ready."
Output:
{"start":5500,"end":7800,"text":"- Are you ready?\n- I was born ready.","speaker":null}

EXAMPLE C — Music gap fill:
Word data shows no words from 27000ms to 32000ms (5-second gap):
{"start":27000,"end":32000,"text":"[ ♪ UPBEAT MUSIC ♪ ]","speaker":null}

EXAMPLE D — Sound effect:
Context suggests car engine noise during driving segment with no speech:
{"start":45000,"end":48000,"text":"[ENGINE REVVING]","speaker":null}

EXAMPLE E — Homophone correction:
Raw: "I went to the store to and I got there to."
Corrected: "I went to the store, too,\nand I got there, too."

════════════════════════════════════════
INPUT DATA
════════════════════════════════════════
Detected language: ${language || 'en'}

WORD-LEVEL TIMING (startMs|endMs|word) — USE THESE FOR ALL TIMECODES:
${wordDump}

UTTERANCES WITH SPEAKER LABELS (for context and speaker attribution):
${utteranceDump}
${highlightDump ? `\nKEY TERMS FROM AUDIO ANALYSIS:\n${highlightDump}` : ''}
${safetySummary ? `\nCONTENT SAFETY ANALYSIS (helps identify music/noise segments):\n${safetySummary}` : ''}

════════════════════════════════════════
OUTPUT FORMAT
════════════════════════════════════════
Return ONLY a valid JSON array. Zero markdown. Zero explanation. Zero code fences.
Each element: {"start": number, "end": number, "text": string, "speaker": string|null}
- \\n for line breaks within 2-line cues (literal backslash-n in JSON)
- speaker: "A"/"B"/"C" for single-speaker cues, null for multi-speaker or sound cues
- EVERY line of text ≤ 32 characters — verify before outputting
- EVERY cue ≤ 2 lines — verify before outputting
- Start/end MUST be real word timestamps from the data above
- Include ALL sound cues, music cues, SDH annotations
- Fix ALL grammar and punctuation`;

  let res;
  for (let attempt = 0; attempt < 3; attempt++) {
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
            content: 'You are an expert broadcast closed caption editor. Output ONLY a valid JSON array. No markdown, no explanations, no code fences. Every line of text must be ≤32 characters. Every cue must have ≤2 lines. Every timecode must be anchored to the actual word timing data provided. These are hard constraints — verify each cue before including it.',
          },
          { role: 'user', content: prompt }
        ],
        temperature: 0.1,
        max_tokens: 16000,
      }),
    });

    if (res.status === 429) {
      await new Promise(r => setTimeout(r, 35000));
      continue;
    }
    break;
  }

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`OpenAI error: ${err}`);
  }

  const data = await res.json();
  const content = data.choices[0].message.content.trim();

  const jsonMatch = content.match(/\[[\s\S]*\]/);
  if (!jsonMatch) throw new Error('OpenAI did not return valid JSON array');
  const cues = JSON.parse(jsonMatch[0]);
  return { cues, openaiRaw: JSON.parse(JSON.stringify(cues)) };
}

// Comprehensive QC check
function runQC(cues) {
  const issues = [];

  for (let i = 0; i < cues.length; i++) {
    const c = cues[i];
    const lines = c.text.split('\n');
    const dur = c.end - c.start;
    const charCount = c.text.replace(/\n/g, '').length;
    const cps = charCount / (dur / 1000);

    for (let li = 0; li < lines.length; li++) {
      if (lines[li].length > 32) {
        issues.push({ cue: i, type: 'line_too_long', value: `Line ${li + 1}: ${lines[li].length} chars` });
      }
    }

    if (lines.length > 2) {
      issues.push({ cue: i, type: 'too_many_lines', value: `${lines.length} lines` });
    }

    if (dur < 500) {
      issues.push({ cue: i, type: 'cue_too_short', value: `${dur}ms (min 500ms)` });
    }
    if (dur > 8000) {
      issues.push({ cue: i, type: 'cue_too_long', value: `${(dur/1000).toFixed(1)}s (max 8s)` });
    }

    if (cps > 25 && !c.text.startsWith('[') && !c.text.includes('♪')) {
      issues.push({ cue: i, type: 'reading_speed', value: `${cps.toFixed(1)} CPS (too fast)` });
    }

    if (i > 0) {
      const gap = c.start - cues[i - 1].end;
      if (gap < 0) {
        issues.push({ cue: i, type: 'overlap', value: `${Math.abs(gap)}ms overlap with cue ${i}` });
      } else if (gap < 67) {
        issues.push({ cue: i, type: 'gap_too_small', value: `${gap}ms (min 67ms)` });
      }
    }

    const isDialogue = !c.text.startsWith('[') && !c.text.includes('♪') && c.text.trim().length > 0;
    if (isDialogue) {
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

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const { transcript_id } = await req.json();
    if (!transcript_id) return Response.json({ error: 'transcript_id is required' }, { status: 400 });

    const ASSEMBLYAI_API_KEY = Deno.env.get('ASSEMBLYAI_API_KEY');
    const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY');

    const transcript = await getTranscript(transcript_id, ASSEMBLYAI_API_KEY);

    if (transcript.status === 'queued' || transcript.status === 'processing') {
      return Response.json({ status: transcript.status });
    }

    if (transcript.status === 'error') {
      return Response.json({ status: 'error', error: transcript.error || 'Transcription failed' });
    }

    const assemblyRawCues = (transcript.utterances || []).map(u => ({
      start: u.start, end: u.end, text: u.text, speaker: u.speaker,
    }));

    const words = transcript.words || [];
    const wordIndex = buildWordIndex(words);

    const { cues: rawCues, openaiRaw } = await applyNBCURules(
      words,
      transcript.utterances || [],
      transcript.language_code,
      transcript.auto_highlights_result?.results || [],
      transcript.content_safety_labels || null,
      OPENAI_API_KEY
    );

    // Post-process: enforce hard limits, fix any remaining violations GPT missed
    const cues = postProcess(rawCues, wordIndex);

    const srt = buildSRT(cues);
    const vtt = buildVTT(cues);
    const scc = buildSCC(cues);
    const qc = runQC(cues);

    return Response.json({
      status: 'completed',
      cues,
      exports: { srt, vtt, scc },
      qc,
      language: transcript.language_code,
      diagnostic: { assemblyRawCues, openaiRawCues: openaiRaw },
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});