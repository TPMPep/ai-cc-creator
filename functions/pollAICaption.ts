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
async function applyNBCURules(rawWords, utterances, language, apiKey) {
  // Build raw transcript text with timing info
  const wordDump = rawWords.slice(0, 1500).map(w => `[${w.start}-${w.end}ms] ${w.text}`).join(' ');

  const utteranceDump = utterances ? utterances.slice(0, 80).map(u =>
    `[${u.start}-${u.end}ms] (Speaker ${u.speaker}): ${u.text}`
  ).join('\n') : '';

  const prompt = `You are a professional broadcast closed caption editor following NBCU spec CM-051. Your job is to produce ACCURATE, NATURAL-READING captions from a raw transcript.

CRITICAL GRAMMAR & PUNCTUATION RULES (strictly enforce these):
- PRESERVE all correct punctuation. If a sentence is clearly a question, it MUST end with "?". If it is an exclamation, use "!".
- CORRECT homophones and common speech-to-text errors. Examples: "to" meaning "also/as well" should be "too". "there" vs "their" vs "they're" based on context. "its" vs "it's". "your" vs "you're". "we're" vs "were". Use correct grammar based on context.
- PRESERVE natural speech patterns, contractions (don't, can't, I'm, you're, we're, etc.)
- Do NOT drop punctuation. Every sentence must end with a period, question mark, or exclamation point as appropriate.
- Use commas, em-dashes, and ellipses naturally where the speaker pauses or trails off.

NBCU FORMATTING RULES:
- Max 32 characters per line
- Max 2 lines per cue
- Max reading speed ~180 words per minute (roughly 0.3-8 seconds per cue)
- Minimum cue gap: 2 frames at 29.97fps (~67ms)
- Use upper/lower case as spoken (not all caps unless shouting/emphasis)
- No translation of foreign language — mark it as [Speaking Spanish] or whichever language
- Include music cues where appropriate as [ ♪ MUSIC ♪ ] or [ ♪ song description ♪ ]
- Speaker identification: when two different speakers appear in the SAME cue, prefix EACH speaker's line with "- " (dash + space). Example:
  - Hello, how are you?
  - I'm doing great.
  Do NOT use ">>" — ONLY use "- " dashes for speaker changes within a single cue.
- Single-speaker cues do NOT get a dash prefix.
- Round timecodes to nearest frame at 29.97fps
- Format output as a JSON array of cues with: start (ms), end (ms), text (string, use \\n for line breaks within 2-line cues), speaker (string, e.g. "A", "B", or null)

Detected language: ${language || 'en'}

RAW WORD-LEVEL TRANSCRIPT (with timings in ms):
${wordDump}

UTTERANCES (speaker-separated, use these for speaker labels):
${utteranceDump}

Return ONLY a valid JSON array. No markdown, no explanation, no code fences. Each element: {"start": number, "end": number, "text": string, "speaker": string|null}
Ensure all cues follow the 32-char/line, 2-line max rules. Split long utterances into multiple cues. CRITICALLY: fix all grammar, punctuation, and homophone errors.`;

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