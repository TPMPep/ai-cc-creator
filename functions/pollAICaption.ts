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

  let framesPerMin = fps * 60;
  let framesPerTenMin = framesPerMin * 10 - dropFrames * 9;

  let d = Math.floor(totalFrames / framesPerTenMin);
  let m = totalFrames % framesPerTenMin;

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

// Encode text to SCC (CEA-608) byte pairs
function textToSCCBytes(text) {
  // CEA-608 character encoding (simplified ASCII printable range)
  const bytes = [];
  const clean = text.replace(/\r/g, '').substring(0, 64);

  for (let i = 0; i < clean.length; i++) {
    const code = clean.charCodeAt(i);
    if (code >= 0x20 && code <= 0x7e) {
      // Pair consecutive characters
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
  // Erase Non-Displayed Memory (ENM): 942c
  // Resume Caption Loading (RCL): 9420
  // End of Caption (EOC / flip): 942f
  // Erase Displayed Memory (EDM): 942e

  const bytePairs = textToSCCBytes(text);
  const data = ['942c', '9420', ...bytePairs, '942f'].join(' ');
  return `${tc}\t${data}`;
}

// Build SRT from cues
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

// Build VTT from cues
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

// Build SCC from cues
function buildSCC(cues) {
  const lines = ['Scenarist_SCC V1.0', ''];
  for (const cue of cues) {
    // Erase displayed at cue start
    lines.push(`${msToSCCTimecode(cue.start)}\t942e`);
    // Write text
    const textLines = cue.text.split('\n');
    for (const line of textLines) {
      if (line.trim()) {
        lines.push(buildSCCLine(cue.start, line.trim()));
      }
    }
    // Clear at end
    lines.push(`${msToSCCTimecode(cue.end)}\t942e`);
    lines.push('');
  }
  return lines.join('\n');
}

// Hard-enforce 32-char line limit and 2-line/8s cue limit on GPT output
// This is a safety net — GPT doesn't always follow formatting rules precisely
function enforceLineLimits(cues) {
  const MAX_CHARS = 32;
  const MAX_LINES = 2;
  const MAX_DUR = 8000;
  const MIN_DUR = 500;
  const result = [];

  for (const cue of cues) {
    // Split text into words, respecting existing \n as soft hints
    const rawLines = cue.text.split('\n');
    // Re-flow all words respecting 32-char max
    const words = rawLines.join(' ').split(/\s+/).filter(Boolean);

    if (words.length === 0) { result.push(cue); continue; }

    // Pack words into lines of max 32 chars
    const packedLines = [];
    let currentLine = '';
    for (const word of words) {
      const candidate = currentLine ? `${currentLine} ${word}` : word;
      if (candidate.length <= MAX_CHARS) {
        currentLine = candidate;
      } else {
        if (currentLine) packedLines.push(currentLine);
        // If a single word is longer than 32 chars, truncate it (edge case)
        currentLine = word.length > MAX_CHARS ? word.substring(0, MAX_CHARS) : word;
      }
    }
    if (currentLine) packedLines.push(currentLine);

    // Now chunk packedLines into cues of max 2 lines
    const totalDur = cue.end - cue.start;
    const chunkCount = Math.ceil(packedLines.length / MAX_LINES);
    const durPerChunk = Math.max(MIN_DUR, Math.floor(totalDur / chunkCount));

    for (let i = 0; i < packedLines.length; i += MAX_LINES) {
      const chunk = packedLines.slice(i, i + MAX_LINES);
      const chunkIndex = Math.floor(i / MAX_LINES);
      const chunkStart = cue.start + chunkIndex * durPerChunk;
      const chunkEnd = (chunkIndex === chunkCount - 1)
        ? cue.end
        : Math.min(cue.start + (chunkIndex + 1) * durPerChunk, cue.end);

      result.push({
        start: chunkStart,
        end: Math.max(chunkStart + MIN_DUR, chunkEnd),
        text: chunk.join('\n'),
        speaker: cue.speaker,
      });
    }
  }

  // Fix any overlaps introduced by min duration expansion
  for (let i = 1; i < result.length; i++) {
    if (result[i].start < result[i - 1].end) {
      result[i].start = result[i - 1].end + 67;
      if (result[i].end <= result[i].start) {
        result[i].end = result[i].start + MIN_DUR;
      }
    }
  }

  return result;
}

// Apply NBCU rules via OpenAI
async function applyNBCURules(rawWords, utterances, language, highlights, contentSafety, apiKey) {
  // Build raw transcript text with timing info — send more words for longer videos
  const wordDump = rawWords.slice(0, 2500).map(w => `[${w.start}-${w.end}ms] ${w.text}`).join(' ');

  const utteranceDump = utterances ? utterances.slice(0, 120).map(u =>
    `[${u.start}-${u.end}ms] (Speaker ${u.speaker}): ${u.text}`
  ).join('\n') : '';

  // Auto highlights give GPT hints about music/key terms
  const highlightDump = highlights && highlights.length > 0
    ? highlights.slice(0, 30).map(h => `"${h.text}" (${h.timestamps.map(t => `${t.start}-${t.end}ms`).join(', ')})`).join('\n')
    : '';

  // Content safety labels help identify non-speech segments
  const safetySummary = contentSafety && contentSafety.results && contentSafety.results.length > 0
    ? contentSafety.results.slice(0, 10).map(r => `[${r.timestamp?.start}-${r.timestamp?.end}ms] ${r.labels?.map(l => l.label).join(', ')}`).join('\n')
    : '';

  const prompt = `You are a professional broadcast closed caption editor with 20+ years of experience following NBCU spec CM-051 and FCC closed caption standards. Your job is to produce BROADCAST-QUALITY, NATURAL-READING captions from a raw speech-to-text transcript. These captions will go directly to a human QC editor before broadcast — make them as close to final as possible.

════════════════════════════════════════
SECTION 1: GRAMMAR & PUNCTUATION (MANDATORY)
════════════════════════════════════════
- Every sentence MUST end with a period (.), question mark (?), or exclamation point (!). NEVER leave a sentence without terminal punctuation.
- Detect and CORRECT all homophones and speech-to-text errors:
  • "to" used as "also/as well" → "too"
  • "there/their/they're" — use correct form based on context
  • "its/it's", "your/you're", "were/we're", "then/than", "affect/effect"
  • "gonna" → "gonna" (keep contractions as spoken)
  • "wanna" → "wanna", "kinda" → "kinda" (preserve natural speech)
- PRESERVE contractions exactly as spoken: don't, can't, I'm, you're, we're, I'll, that's, it's, etc.
- Use commas to reflect natural speech pauses within sentences.
- Use em-dashes (—) for abrupt interruptions or strong pauses mid-thought.
- Use ellipsis (...) ONLY when a speaker trails off and the thought is incomplete.
- Do NOT use ALL CAPS unless the speaker is clearly shouting or emphasizing a word dramatically.
- Capitalize proper nouns, names, titles, and places correctly.

════════════════════════════════════════
SECTION 2: SOUND & MUSIC CUES (CRITICAL — DO NOT SKIP)
════════════════════════════════════════
Sound cues and music notation are MANDATORY for broadcast compliance. You MUST include them whenever applicable.

MUSIC RULES:
- When music or a song is playing (with or without lyrics), insert a music cue.
- Format: [ ♪ DESCRIPTION ♪ ] — use ALL CAPS for the description inside brackets.
- Examples:
  • [ ♪ UPBEAT MUSIC ♪ ]
  • [ ♪ TENSE ORCHESTRAL MUSIC ♪ ]
  • [ ♪ HIP HOP MUSIC ♪ ]
  • [ ♪ "SONG TITLE" BY ARTIST ♪ ] (if identifiable)
  • [ ♪ MUSIC PLAYING ♪ ] (if genre is unclear)
- If lyrics are sung: transcribe them with ♪ prefix and suffix on EACH LINE.
  • ♪ I can see clearly now ♪
  • ♪ The rain is gone ♪
- Place music cue cues at the correct timecode where music starts/ends.
- Music cues that last more than ~5 seconds should have an opening AND closing cue.

SOUND EFFECT (SDH) RULES:
- Bracket ALL significant non-speech audio that a deaf viewer needs to know about:
  • [DOOR SLAMS]
  • [PHONE RINGING]
  • [CROWD CHEERING]
  • [GUNSHOT]
  • [EXPLOSION]
  • [SIREN WAILING]
  • [LAUGHING]
  • [CRYING]
  • [APPLAUSE]
  • [INDISTINCT CHATTER]
  • [SPEAKING FOREIGN LANGUAGE] — for non-English speech
- Use ALL CAPS inside brackets for sound effects.
- Duration indicators: [SIGHS], [SCREAMS], [LAUGHS] for short sounds.
- Infer sound events from CONTEXT and GAPS in speech. If there's a long gap with no words, consider whether music, ambient sound, or a sound effect should be noted.

════════════════════════════════════════
SECTION 3: SPEAKER IDENTIFICATION RULES
════════════════════════════════════════
- Use speaker labels from utterance data (A, B, C, etc.).
- Single-speaker cues: NO dash prefix. Just the text.
- Two different speakers in the SAME cue: prefix EACH line with "- " (dash + space):
  CORRECT:
  - Are you sure about that?
  - Absolutely certain.
  WRONG: >> Are you sure? or >Are you sure?
- NEVER use ">>" or ">" for speaker changes.
- If speaker changes mid-sentence, split into separate cues at the changeover point.
- [OFF CAMERA] or [V.O.] — add these tags when a speaker is clearly off-camera or voiceover.

════════════════════════════════════════
SECTION 4: NBCU FORMATTING RULES (STRICT)
════════════════════════════════════════
- MAXIMUM 32 characters per line (count every character including spaces and brackets)
- MAXIMUM 2 lines per cue
- MINIMUM cue duration: 500ms
- MAXIMUM cue duration: 8 seconds
- Reading speed: target ~160-180 words per minute. If a cue is too long to read in the allotted time, split it.
- Minimum gap between cues: 2 frames (~67ms at 29.97fps)
- Foreign language speech: do NOT translate. Mark as [SPEAKING FRENCH] or appropriate language.
- Segment long utterances into multiple cues at natural sentence or clause breaks.
- Never cut a word mid-cue — always break at word boundaries.
- Prefer breaking at punctuation (comma, period, em-dash) when splitting.

════════════════════════════════════════
SECTION 5: FEW-SHOT EXAMPLES
════════════════════════════════════════
EXAMPLE 1 — Music + Dialogue:
Input utterance: "[0-3000ms] (no speech, music playing)" + "[3000-8000ms] Speaker A: welcome to the show"
Output cues:
{"start":0,"end":3000,"text":"[ ♪ UPBEAT INTRO MUSIC ♪ ]","speaker":null}
{"start":3000,"end":5500,"text":"Welcome to the show.","speaker":"A"}

EXAMPLE 2 — Two speakers in one cue:
Input: "[5500-7500ms] Speaker A: Are you ready? Speaker B: I was born ready."
Output cues:
{"start":5500,"end":7500,"text":"- Are you ready?\\n- I was born ready.","speaker":null}

EXAMPLE 3 — Homophone correction:
Input: "I went to the store to, and I got there to."
Output: "I went to the store, too, and I got there, too."

EXAMPLE 4 — Sound effect:
Input: "[10000-10500ms] (gap in speech, loud bang sound context)"
Output: {"start":10000,"end":10500,"text":"[GUN FIRES]","speaker":null}

EXAMPLE 5 — Long utterance split:
Input: "[12000-20000ms] Speaker A: I really think that we need to take a look at what's been happening over the last few months and determine if the direction we're heading is actually the right one for the company."
Output:
{"start":12000,"end":15000,"text":"I really think that we need to\ntake a look at what's been happening","speaker":"A"}
{"start":15000,"end":18000,"text":"over the last few months and determine\nif the direction we're heading","speaker":"A"}
{"start":18000,"end":20000,"text":"is actually the right one\nfor the company.","speaker":"A"}

EXAMPLE 6 — Trailing off / ellipsis:
Input: Speaker says "I just... I don't know..."
Output: {"start":X,"end":Y,"text":"I just... I don't know...","speaker":"A"}

════════════════════════════════════════
SECTION 6: INPUT DATA
════════════════════════════════════════
Detected language: ${language || 'en'}

RAW WORD-LEVEL TRANSCRIPT (with timings in ms):
${wordDump}

UTTERANCES WITH SPEAKER LABELS:
${utteranceDump}
${highlightDump ? `\nKEY TERMS/HIGHLIGHTS DETECTED BY AUDIO ANALYSIS (use for context):\n${highlightDump}` : ''}
${safetySummary ? `\nCONTENT ANALYSIS (may indicate music/sensitive content segments):\n${safetySummary}` : ''}

════════════════════════════════════════
SECTION 7: OUTPUT FORMAT
════════════════════════════════════════
Return ONLY a valid JSON array. No markdown, no explanation, no code fences, no comments.
Each element MUST have: {"start": number, "end": number, "text": string, "speaker": string|null}
- Use \\n (literal backslash-n) for line breaks within 2-line cues.
- "speaker" should be "A", "B", "C" etc. from utterances, or null for sound/music cues.
- CRITICALLY: Include ALL sound cues, music cues, and SDH annotations. Do not omit them.
- CRITICALLY: Fix ALL grammar errors, homophone errors, and missing punctuation.
- CRITICALLY: Every dialogue sentence must end with terminal punctuation.`;

  // Retry up to 3 times on rate limit errors (OpenAI TPM)
  let res;
  for (let attempt = 0; attempt < 3; attempt++) {
    res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: 'You are an expert broadcast closed caption editor. You output ONLY valid JSON arrays. Never output markdown, explanations, or code fences. Follow every instruction precisely.'
          },
          { role: 'user', content: prompt }
        ],
        temperature: 0.05,
        max_tokens: 16000,
      }),
    });

    if (res.status === 429) {
      // Rate limited — wait 35s and retry
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

  // Parse JSON from response
  const jsonMatch = content.match(/\[[\s\S]*\]/);
  if (!jsonMatch) throw new Error('OpenAI did not return valid JSON array');
  const cues = JSON.parse(jsonMatch[0]);
  return { cues, openaiRaw: cues }; // openaiRaw is the direct OpenAI output before any post-processing
}

// Comprehensive QC check
function runQC(cues) {
  const issues = [];

  // Check if we have any sound/music cues at all for SDH compliance
  const hasSoundCues = cues.some(c => c.text.startsWith('[') || c.text.includes('♪'));

  for (let i = 0; i < cues.length; i++) {
    const c = cues[i];
    const lines = c.text.split('\n');
    const dur = c.end - c.start;
    const charCount = c.text.replace(/\n/g, '').length;
    const wordsInCue = c.text.split(/\s+/).filter(w => w.length > 0).length;
    const cps = charCount / (dur / 1000);

    // Line length check
    for (let li = 0; li < lines.length; li++) {
      if (lines[li].length > 32) {
        issues.push({ cue: i, type: 'line_too_long', value: `Line ${li + 1}: ${lines[li].length} chars` });
      }
    }

    // Line count check
    if (lines.length > 2) {
      issues.push({ cue: i, type: 'too_many_lines', value: `${lines.length} lines` });
    }

    // Duration checks
    if (dur < 500) {
      issues.push({ cue: i, type: 'cue_too_short', value: `${dur}ms (min 500ms)` });
    }
    if (dur > 8000) {
      issues.push({ cue: i, type: 'cue_too_long', value: `${(dur/1000).toFixed(1)}s (max 8s)` });
    }

    // Reading speed: characters per second (target max ~17 CPS for 32-char lines)
    if (cps > 25 && !c.text.startsWith('[')) {
      issues.push({ cue: i, type: 'reading_speed', value: `${cps.toFixed(1)} CPS (too fast)` });
    }

    // Gap / overlap check
    if (i > 0) {
      const gap = c.start - cues[i - 1].end;
      if (gap < 0) {
        issues.push({ cue: i, type: 'overlap', value: `${Math.abs(gap)}ms overlap with cue ${i}` });
      } else if (gap < 67) {
        issues.push({ cue: i, type: 'gap_too_small', value: `${gap}ms (min 67ms / 2 frames)` });
      }
    }

    // Missing terminal punctuation on dialogue cues
    const isDialogue = !c.text.startsWith('[') && !c.text.includes('♪') && c.text.trim().length > 0;
    if (isDialogue) {
      const trimmed = c.text.trim();
      const lastChar = trimmed[trimmed.length - 1];
      if (!['.', '?', '!', '…', '"', "'"].includes(lastChar) && !trimmed.endsWith('--') && !trimmed.endsWith('—')) {
        issues.push({ cue: i, type: 'missing_punctuation', value: `Ends with "${lastChar}"` });
      }
    }

    // Multi-speaker cue without dash prefix
    if (c.speaker === null && lines.length === 2 && !c.text.includes('♪') && !c.text.startsWith('[')) {
      // Might be a two-speaker cue missing dashes — flag for review
      const hasDash = lines.every(l => l.startsWith('- '));
      if (!hasDash) {
        issues.push({ cue: i, type: 'possible_missing_speaker_dash', value: 'Two lines, no speaker dashes' });
      }
    }

    // Empty cue
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

    // Still processing
    if (transcript.status === 'queued' || transcript.status === 'processing') {
      return Response.json({ status: transcript.status });
    }

    if (transcript.status === 'error') {
      return Response.json({ status: 'error', error: transcript.error || 'Transcription failed' });
    }

    // Build AssemblyAI raw cues (utterance-level, for diagnostic)
    const assemblyRawCues = (transcript.utterances || []).map(u => ({
      start: u.start,
      end: u.end,
      text: u.text,
      speaker: u.speaker,
    }));

    // Completed — apply NBCU rules via OpenAI
    const { cues: rawCues, openaiRaw } = await applyNBCURules(
      transcript.words || [],
      transcript.utterances || [],
      transcript.language_code,
      transcript.auto_highlights_result?.results || [],
      transcript.content_safety_labels || null,
      OPENAI_API_KEY
    );

    // Hard-enforce formatting constraints GPT may have missed
    const cues = enforceLineLimits(rawCues);

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
      diagnostic: {
        assemblyRawCues,
        openaiRawCues: openaiRaw,
      },
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});