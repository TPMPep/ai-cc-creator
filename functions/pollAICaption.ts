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

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.1,
      max_tokens: 8000,
    }),
  });

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

// Simple QC check
function runQC(cues) {
  const issues = [];
  for (let i = 0; i < cues.length; i++) {
    const c = cues[i];
    const lines = c.text.split('\n');
    for (const line of lines) {
      if (line.length > 32) {
        issues.push({ cue: i + 1, type: 'line_too_long', value: `${line.length} chars: "${line}"` });
      }
    }
    if (lines.length > 2) {
      issues.push({ cue: i + 1, type: 'too_many_lines', value: `${lines.length} lines` });
    }
    const dur = c.end - c.start;
    if (dur < 500) {
      issues.push({ cue: i + 1, type: 'cue_too_short', value: `${dur}ms` });
    }
    if (i > 0) {
      const gap = c.start - cues[i - 1].end;
      if (gap < 0) {
        issues.push({ cue: i + 1, type: 'overlap', value: `${gap}ms gap` });
      }
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
    const { cues, openaiRaw } = await applyNBCURules(
      transcript.words || [],
      transcript.utterances || [],
      transcript.language_code,
      OPENAI_API_KEY
    );

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