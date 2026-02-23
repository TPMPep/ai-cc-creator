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

// ─── FETCH ASSEMBLYAI SRT ────────────────────────────────────────────────────
async function getAssemblyAISRT(transcriptId, apiKey) {
  const res = await fetch(`${ASSEMBLYAI_BASE}/transcript/${transcriptId}/srt`, {
    headers: { 'authorization': apiKey },
  });
  if (!res.ok) throw new Error(`AssemblyAI SRT fetch failed: ${res.status}`);
  return res.text();
}

// ─── PARSE SRT INTO CUE OBJECTS ──────────────────────────────────────────────
function parseSRT(srtText) {
  const cues = [];
  const blocks = srtText.trim().split(/\n\n+/);
  for (const block of blocks) {
    const lines = block.trim().split('\n');
    if (lines.length < 3) continue;
    // lines[0] = index, lines[1] = timecode, lines[2+] = text
    const tcMatch = lines[1].match(/(\d{2}):(\d{2}):(\d{2})[,.](\d{3})\s*-->\s*(\d{2}):(\d{2}):(\d{2})[,.](\d{3})/);
    if (!tcMatch) continue;
    const toMs = (h, m, s, ms) => (+h * 3600 + +m * 60 + +s) * 1000 + +ms;
    const start = toMs(tcMatch[1], tcMatch[2], tcMatch[3], tcMatch[4]);
    const end = toMs(tcMatch[5], tcMatch[6], tcMatch[7], tcMatch[8]);
    const text = lines.slice(2).join(' ').trim();
    if (text) cues.push({ start, end, text, speaker: null });
  }
  return cues;
}

// ─── MAP SPEAKERS ONTO SRT CUES ──────────────────────────────────────────────
// For each SRT cue, find ALL overlapping utterances. If multiple speakers overlap
// significantly, SPLIT the SRT cue at the speaker boundary so each output segment
// has exactly one speaker. This prevents the old bug where a cue spanning two
// utterances from speakers B and C would just get assigned to whichever had more overlap.
function mapSpeakers(srtCues, utterances) {
  const result = [];
  for (const cue of srtCues) {
    // Find all utterances that overlap this SRT cue
    const overlapping = [];
    for (const utt of utterances) {
      const os = Math.max(cue.start, utt.start);
      const oe = Math.min(cue.end, utt.end);
      if (oe > os) {
        overlapping.push({ ...utt, overlapStart: os, overlapEnd: oe, overlap: oe - os });
      }
    }

    if (overlapping.length === 0) {
      result.push({ ...cue, speaker: null });
      continue;
    }

    // Check if multiple DIFFERENT speakers overlap this cue
    const speakerMap = {};
    for (const o of overlapping) {
      const spk = o.speaker || 'unknown';
      if (!speakerMap[spk]) speakerMap[spk] = { overlap: 0, segments: [] };
      speakerMap[spk].overlap += o.overlap;
      speakerMap[spk].segments.push(o);
    }
    const speakers = Object.keys(speakerMap);

    if (speakers.length <= 1) {
      // Single speaker — assign directly
      result.push({ ...cue, speaker: overlapping[0].speaker || null });
      continue;
    }

    // Multiple speakers — split the SRT cue text proportionally at the boundary
    // Sort overlapping by start time to find speaker boundary
    overlapping.sort((a, b) => a.overlapStart - b.overlapStart);
    
    // Find the first speaker transition point
    let boundaryTime = -1;
    let firstSpeaker = overlapping[0].speaker;
    let secondSpeaker = null;
    for (let i = 1; i < overlapping.length; i++) {
      if (overlapping[i].speaker !== firstSpeaker) {
        secondSpeaker = overlapping[i].speaker;
        boundaryTime = overlapping[i].overlapStart;
        break;
      }
    }

    if (boundaryTime <= 0 || !secondSpeaker) {
      // Couldn't find a clear boundary — use dominant
      const dominant = speakers.reduce((a, b) => speakerMap[a].overlap > speakerMap[b].overlap ? a : b);
      result.push({ ...cue, speaker: dominant === 'unknown' ? null : dominant });
      continue;
    }

    // Split the text proportionally at the boundary
    const cueDur = cue.end - cue.start;
    if (cueDur <= 0) {
      result.push({ ...cue, speaker: firstSpeaker });
      continue;
    }

    const frac = (boundaryTime - cue.start) / cueDur;
    const words = cue.text.split(/\s+/);
    
    if (words.length <= 1) {
      // Single word — can't split, assign to dominant
      const dominant = speakers.reduce((a, b) => speakerMap[a].overlap > speakerMap[b].overlap ? a : b);
      result.push({ ...cue, speaker: dominant === 'unknown' ? null : dominant });
      continue;
    }

    const splitWordIndex = Math.max(1, Math.min(words.length - 1, Math.round(words.length * frac)));
    const text1 = words.slice(0, splitWordIndex).join(' ');
    const text2 = words.slice(splitWordIndex).join(' ');

    // Calculate proportional timecodes
    const charTotal = text1.length + text2.length;
    const splitTime = cue.start + Math.round(cueDur * (text1.length / charTotal));

    if (text1.trim()) {
      result.push({ start: cue.start, end: splitTime, text: text1.trim(), speaker: firstSpeaker });
    }
    if (text2.trim()) {
      result.push({ start: splitTime, end: cue.end, text: text2.trim(), speaker: secondSpeaker });
    }
  }
  return result;
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

// ─── EXTRACT AUDIO EVENTS ────────────────────────────────────────────────────
// With Universal-3 Pro + prompting, audio events appear as tagged text like [laughter]
// in the transcript words/utterances. We also check the legacy audio_events_result field.
function extractAudioEvents(transcript) {
  const events = [];

  // Method 1: Legacy audio_events_result (older API / universal-2)
  const raw = transcript.audio_events_result?.results || [];
  for (const ev of raw) {
    if (ev.confidence >= 0.6) {
      events.push({ start: ev.start, end: ev.end, label: ev.label, confidence: ev.confidence });
    }
  }

  // Method 2: Scan transcript words for tagged audio events like [laughter], [applause], etc.
  // These appear in the word-level data when using universal-3-pro with prompting
  const audioTagPattern = /^\[(?:laughter|applause|music|silence|noise|cough|sigh|cheering|clapping)\]$/i;
  const words = transcript.words || [];
  let i = 0;
  while (i < words.length) {
    const w = words[i];
    if (audioTagPattern.test(w.text)) {
      // Group consecutive same-tag words
      const label = w.text.replace(/[\[\]]/g, '').toUpperCase();
      let end = w.end;
      let j = i + 1;
      while (j < words.length && audioTagPattern.test(words[j].text) && words[j].text.toLowerCase() === w.text.toLowerCase()) {
        end = words[j].end;
        j++;
      }
      // Avoid duplicates from method 1
      const isDuplicate = events.some(e => Math.abs(e.start - w.start) < 500 && e.label.toUpperCase() === label);
      if (!isDuplicate) {
        events.push({ start: w.start, end, label, confidence: 0.9 });
      }
      i = j;
    } else {
      i++;
    }
  }

  // Method 3: Scan utterances for inline tags that weren't captured at word level
  const utterances = transcript.utterances || [];
  const inlinePattern = /\[(laughter|applause|music|silence|noise|cough|sigh|cheering|clapping)\]/gi;
  for (const utt of utterances) {
    let match;
    while ((match = inlinePattern.exec(utt.text)) !== null) {
      const label = match[1].toUpperCase();
      const isDuplicate = events.some(e => Math.abs(e.start - utt.start) < 1000 && e.label === label);
      if (!isDuplicate) {
        events.push({ start: utt.start, end: utt.end, label, confidence: 0.8 });
      }
    }
  }

  events.sort((a, b) => a.start - b.start);
  return events;
}

// ─── GPT POLISH (single batch, server-side) ──────────────────────────────────

async function polishBatchWithGPT(segments, gaps, language, highlights, audioEvents, apiKey, batchIndex, totalBatches) {
  const segmentInput = segments.map((s, i) =>
    `[${i}] START=${s.start}ms END=${s.end}ms SPEAKER=${s.speaker || 'UNKNOWN'}\nTEXT: ${s.text}`
  ).join('\n\n');

  const gapInput = gaps.length > 0
    ? 'SILENCE GAPS:\n' +
      gaps.map(g => `${g.start}ms → ${g.end}ms (${Math.round((g.end - g.start)/1000)}s gap)`).join('\n')
    : '';

  // Filter audio events relevant to this batch window
  const batchStart = segments[0]?.start ?? 0;
  const batchEnd = segments[segments.length - 1]?.end ?? 0;
  const batchEvents = (audioEvents || []).filter(e => e.start >= batchStart - 5000 && e.start <= batchEnd + 5000);
  const audioEventInput = batchEvents.length > 0
    ? 'DETECTED AUDIO EVENTS (from audio analysis — these are REAL, not guesses):\n' +
      batchEvents.map(e => `${e.start}ms → ${e.end}ms: ${e.label} (confidence: ${Math.round(e.confidence * 100)}%)`).join('\n')
    : '';

  const highlightDump = highlights && highlights.length > 0
    ? 'KEY AUDIO TERMS: ' + highlights.slice(0, 20).map(h => `"${h}"`).join(', ')
    : '';

  const batchNote = totalBatches > 1
    ? `NOTE: This is batch ${batchIndex + 1} of ${totalBatches} from a longer video. Process only the segments provided.\n\n`
    : '';

  const prompt = `${batchNote}You are a professional broadcast closed caption editor. Your output will be used DIRECTLY on broadcast television, following NBCU CM-051 and FCC closed caption standards. Every caption you produce must be production-ready — a real viewer is reading these in real time.

ABSOLUTE RULE — SPEAKER LABELS: NEVER put [A], [B], [C] or any speaker label in the "text" field. Speaker identity ONLY goes in the separate "speaker" field. Text field = spoken words only.

ABSOLUTE RULE — TRUST INPUT SPEAKERS: Each input segment has a SPEAKER field (A, B, C, etc.) from the transcription engine. You MUST preserve this speaker assignment exactly. If segment [3] says SPEAKER=C, your output cue for that segment MUST have "speaker": "C". NEVER reassign speakers based on your own judgment.

═══════════════════════════════════════
TIMING RULES (BROADCAST CRITICAL):
═══════════════════════════════════════
1. TIMECODES ARE LOCKED. Never change start/end ms from the input.
   - ONLY exception: combining two consecutive same-speaker segments → use first.start, last.end.
   - ONLY exception: sound/music cues in silence gaps → use gap's start/end ms.
2. MINIMUM cue duration: 500ms. If input segment is under 500ms, extend end to start+500.
3. MAXIMUM cue duration: 7000ms. If input is longer, you MUST split it.
4. MINIMUM gap between cues: 67ms (2 frames at 29.97fps). Never overlap cues.
5. Reading speed: target 130–180 words per minute. A 1-second cue should have ≤3 words. A 3-second cue should have ≤8–9 words. Never exceed ~20 chars/sec.
6. SEGMENT ATOMICITY: Each input segment [N]'s text is locked to that segment's start/end ms. You CANNOT move any words from segment [N] to segment [N+1] or any other cue. The only exception is merging: when you merge two adjacent segments, combine ALL their text and use the merged timecode.

═══════════════════════════════════════
CHARACTER/LINE RULES (BROADCAST CRITICAL):
═══════════════════════════════════════
6. MAXIMUM 32 characters per line. Count EVERY character including spaces, dashes, brackets, ♪.
7. MAXIMUM 2 lines per cue. NEVER output 3 lines.
8. Short segments (≤4 words): use 1 line only. Do NOT force 2 lines on short cues.
9. Longer segments: use 2 lines, breaking at a natural syntactic boundary.
9b. CRITICAL: If a segment's text CANNOT fit in 2 lines × 32 chars (i.e. >~60 chars total), you MUST split it into 2 separate output cues. Divide the text at a natural sentence or clause boundary, and divide the timecode proportionally. NEVER output a cue whose text exceeds 2 lines × 32 chars.

═══════════════════════════════════════
SEGMENTATION STRATEGY (NO FRAGMENTATION):
═══════════════════════════════════════
PRIMARY RULE: Do NOT split an input segment's text across multiple output cues.
- Each input segment [N]'s complete text MUST stay together as one cue, using that segment's start/end ms.
- EXCEPTION 1: Merge — If segment [N] and [N+1] are same speaker with gap ≤300ms and form one continuous sentence, merge them into one cue (first.start, last.end), containing ALL text from both.
- EXCEPTION 2: Reformat within a cue — if a single input segment's text won't fit in 2 lines ≤32 chars, reformat the line breaks and punctuation WITHIN that text. Do NOT move any words to another cue.
- EXCEPTION 3: Line overflow — if text is truly too long for 2 lines × 32 chars, SPLIT IT into multiple output cues. Divide the timecode proportionally by character count. Never truncate or drop words.
- WRONG: Input segment [5] has "Thank you for letting me try out". Splitting it to put "try out" in cue [6] — this moves words out of segment 5.
- RIGHT: Keep "Thank you for letting me try out" in segment [5]'s timecode. Reformat as "Thank you for letting me\ntry out" if needed, but DO NOT move to another cue.
- WRONG: Merging "This is Chris and" from segment [8] with "George." from segment [9] if they're not adjacent or have a gap >300ms.
- RIGHT: If segments are same speaker, gap ≤300ms, and one sentence: "This is Chris and\nGeorge." all at the merged timecode.

═══════════════════════════════════════
LINE BREAK STRATEGY WITHIN A CUE (2-line formatting):
═══════════════════════════════════════
When a single sentence must span 2 lines within one cue:
- Break AFTER: comma, conjunction (and/but/or/so/because), or at clause boundary
- Break BEFORE: verb phrase, prepositional phrase when it's a natural pause point
- Keep subject + verb together on same line when possible
- Aim for balanced line lengths. A 25+22 char split is better than 5+32.
- NEVER split: "the [noun]", "a [noun]", "to [verb]" across lines
- GOOD: "Oh, yeah." (1 line, short cue — do NOT force a 2nd line)
- GOOD: "Every week I get emails\nfrom you guys asking about cheap cars."
- BAD: "Every week I\nget emails from you guys asking about cheap cars." ← unbalanced

═══════════════════════════════════════
GRAMMAR & ACCURACY:
═══════════════════════════════════════
10. Fix ALL homophones in context: to/too/two, there/their/they're, its/it's, your/you're, than/then, etc.
11. Preserve natural spoken contractions: gonna, wanna, kinda, gotta, don't, can't, I'm, etc.
12. Every complete sentence must end with terminal punctuation: . ? ! … or —
13. Incomplete sentences / mid-sentence cues: NO terminal punctuation — the sentence continues.
14. Proper nouns and brand names must be correctly capitalized.

═══════════════════════════════════════
TEXT INTEGRITY (CRITICAL — READ CAREFULLY):
═══════════════════════════════════════
17. THE WORDS IN EACH CUE ARE LOCKED TO THAT CUE'S TIMECODE. You MUST NOT move words from one input cue into another. The text belongs to those timestamps because that is literally when it was spoken.
    - You may REFORMAT (line breaks, punctuation, capitalization) within a cue.
    - You may MERGE two adjacent cues into one (combining their text + using first.start/last.end) — ONLY under rule 18.
    - You may SPLIT one cue into two — ONLY to fix duration or line length violations.
    - You MUST NEVER take words from cue [N] and put them in cue [N+1] or [N-1] unless you are merging those two cues per rule 18.
    - WRONG: Moving "Now we've got" from cue 5 to the start of cue 6's text.
    - RIGHT: Keep "Now we've got" in cue 5 where it was spoken, reformat within its timecode.

═══════════════════════════════════════
MERGING CUES (IMPORTANT):
═══════════════════════════════════════
18. You MUST merge adjacent cues when ALL of these are true:
    a. Same speaker
    b. Gap between them is ≤300ms (they are continuous speech, no real pause)
    c. It is clearly one continuing sentence (no sentence-ending punctuation between them)
    d. Combined text fits in 2 lines ≤32 chars each
    e. Combined duration is ≤7000ms
    When merging: use first cue's start and last cue's end. The merged cue contains ONLY the words from both input cues — no words from any other cue.
19. Do NOT merge if there is a gap >300ms — that gap is a real pause, keep them separate.

═══════════════════════════════════════
SPEAKER FORMATTING (CRITICAL — BROADCAST STANDARD):
═══════════════════════════════════════
15. Single-speaker cue: NO dash prefix. Set speaker field to "A", "B", or "C".
16. Two-speaker cue (speaker change within a cue):
    - When one speaker CONTINUES from the previous cue and a NEW speaker starts mid-cue:
      * The CONTINUING speaker's line gets NO dash (they are already identified).
      * ONLY the NEW speaker's line gets a "- " dash prefix.
      * Set speaker field to null.
      * Example: Speaker A was speaking in previous cue. This cue has A finishing + B starting:
        {"text": "I love this.\n- Thank you.", "speaker": null}
    - When BOTH speakers are new (neither spoke in the previous cue):
      * BOTH lines get "- " dash prefix.
      * Example: {"text": "- Hello there.\n- Hi, how are you?", "speaker": null}
    - NEVER add dashes to a single-speaker cue, even if the previous cue had a different speaker.

═══════════════════════════════════════
FOREIGN LANGUAGE (NBCU CM-051 CRITICAL):
═══════════════════════════════════════
19. If a cue contains speech in a language OTHER than the primary language (${language || 'en'}), you MUST:
    a. REPLACE the spoken text entirely — do NOT transcribe or transliterate the foreign words.
    b. Output ONLY the descriptor: [SPEAKING FOREIGN LANGUAGE]
    c. Keep the original start/end timecodes.
    d. Set speaker to the appropriate letter (A/B/C) as normal.
    e. Examples:
       - Spanish in an English show → [SPEAKING FOREIGN LANGUAGE]
       - Brief foreign phrase mid-sentence → split into separate cue: [SPEAKING FOREIGN LANGUAGE]
    f. EXCEPTION: If the entire program IS in a foreign language (i.e., language detected = non-English and consistent throughout), transcribe normally — do NOT apply this rule.
20. If a speaker switches back and forth between English and a foreign language, apply rule 19 to each foreign-language segment individually.

═══════════════════════════════════════
SOUND/MUSIC CUES (FROM AUDIO EVENTS):
═══════════════════════════════════════
CRITICAL: Audio events are SUPPLEMENTARY INFORMATION. Dialogue text is ALWAYS the priority. Audio events must NEVER displace, fragment, or push out dialogue text.

21. You are provided DETECTED AUDIO EVENTS from actual audio analysis — these are REAL detected sounds.
22. Audio event placement rules (in order of priority):
    a. If a MUSIC event overlaps with or immediately precedes a dialogue segment (within 2 seconds), insert a [♪ MUSIC ♪] cue BEFORE that dialogue cue. Place it in the nearest gap. Music is important context for the viewer.
    b. If a sound event falls in a SILENCE GAP (no dialogue), insert a standalone sound cue:
       - Music/singing → [♪ MUSIC ♪] (≤32 chars)
       - Laughter → [LAUGHTER]
       - Applause → [APPLAUSE]
       - Other → [SOUND IN CAPS] (≤32 chars)
       - Use the gap's start/end or the event's start/end, whichever is shorter.
    c. If a non-music sound event OVERLAPS with dialogue:
       - SHORT events (< 5 seconds): IGNORE them.
       - LONG events (≥ 5 seconds): Insert ONE sound cue BEFORE or AFTER the dialogue, in the nearest gap.
    d. If sustained music plays THROUGHOUT a long dialogue section:
       - Caption [♪ MUSIC ♪] ONCE at the beginning (before dialogue starts)
       - Do NOT repeat it on every cue.
    e. CRITICAL: Every MUSIC audio event that appears in the DETECTED AUDIO EVENTS list MUST produce at least one [♪ MUSIC ♪] cue somewhere in the output. Do NOT silently drop music events.
23. ONLY insert sound cues for events in the DETECTED AUDIO EVENTS list. NEVER guess or invent sounds.
24. NEVER create a sound cue that causes a dialogue cue to be split, shortened, or displaced.
25. The total number of dialogue output cues should match or exceed the input segments. Sound cues are ADDITIONS, not replacements.

═══════════════════════════════════════
OUTPUT FORMAT — STRICT JSON:
═══════════════════════════════════════
Return ONLY a raw JSON array. No markdown, no explanation, no code fences.
Schema: [{"start": number, "end": number, "text": string, "speaker": string|null}, ...]
- "\\n" = line break between line 1 and line 2 within a cue
- speaker: "A" / "B" / "C" for single-speaker; null for multi-speaker or sound cues
- BEFORE outputting each cue, mentally count characters on each line. If >32, reformat.
- DO NOT drop any input segment. Return the same number of cues or more (if you split).

═══════════════════════════════════════
INPUT SEGMENTS:
═══════════════════════════════════════
Language: ${language || 'en'}
${highlightDump}

${segmentInput}

${gapInput}

${audioEventInput}`;

  let res;
  for (let attempt = 0; attempt < 3; attempt++) {
    res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
              model: 'gpt-4o',
              messages: [
                { role: 'system', content: 'You are a professional broadcast closed caption editor for NBCU/FCC standards. Output ONLY a valid JSON array — no markdown, no explanation. Rules: (1) TIMECODES LOCKED — never change start/end ms. (2) Every line ≤32 chars — count every character. (3) Max 2 lines per cue. (4) Short cues (≤4 words) use 1 line. (5) Never put [A]/[B]/[C] in text field — speaker label goes in speaker field only. (6) Mid-sentence cues get no terminal punctuation. (7) Complete sentences end with . ? ! … or — (8) Foreign language speech: replace with [SPEAKING FOREIGN LANGUAGE], never transcribe foreign words. (9) Speaker change mid-cue: continuing speaker gets NO dash, only the NEW speaker gets "- " prefix. Both get dashes only when neither spoke in the previous cue. (10) CRITICAL: Dialogue is ALWAYS priority over sound cues. Sound cues go in GAPS only. Never split or displace dialogue for a sound cue. Short overlapping sounds (<5s) during speech are IGNORED.' },
                { role: 'user', content: prompt },
              ],
              temperature: 0.05,
              max_tokens: 8000,
            }),
    });
    if (res.status === 429) {
      await new Promise(r => setTimeout(r, 5000 * (attempt + 1)));
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

// ─── STRIP SPEAKER LABELS FROM TEXT ─────────────────────────────────────────
// GPT sometimes leaks [A], [B], [C] into the text field — strip them out
function cleanCueText(text) {
  // Remove leading [A], [B], [C], [SPEAKER_A] etc. from each line
  return text.split('\n').map(line =>
    line.replace(/^\s*\[[A-Z](?:PEAKER_[A-Z])?\]\s*/g, '').trimStart()
  ).join('\n');
}

// ─── FINAL ENFORCEMENT (ZERO TOLERANCE) ─────────────────────────────────────
// This pass deterministically fixes ALL QC issues so the output is always broadcast-ready.
// It handles: line length, line count, timing, gaps, overlaps, reading speed,
// multi-speaker dash formatting, and short-cue consolidation.

function finalEnforce(cues, originalSegments) {
  const MAX_CHARS = 32;
  const MIN_DUR = 500;
  const MAX_DUR = 7000;
  const MIN_GAP = 67;
  const MAX_CPS = 25;
  const MIN_WORDS_STANDALONE = 3; // cues with fewer words get merged
  const MERGE_GAP_LIMIT = 800;    // ms — max gap for short-cue merging

  // Helper: check if text is a sound/music cue
  function isSound(text) {
    if (!text) return false;
    const s = text.replace(/\n/g, ' ').trim();
    return s.includes('♪') || /^\[.+\](\s*\[.+\])*$/.test(s);
  }

  // Helper: unconditionally strip all dash prefixes from text
  function stripDashes(text) {
    return text.split('\n').map(l => l.replace(/^-\s*/, '').trimStart()).join('\n');
  }

  // ── STEP 0: Speaker detection ──
  // Use the speaker that GPT assigned (from the input SRT segments).
  // Only mark multi-speaker if GPT explicitly set speaker=null AND the cue has dashes.
  // We trust GPT's speaker assignment over time-overlap heuristics because
  // overlap-based detection was producing wrong results (e.g. assigning speaker B
  // when the utterance data says speaker C).
  function getSpeakersForCue(cue) {
    // If GPT assigned a specific speaker, trust it
    if (cue.speaker) return [cue.speaker];

    // If speaker is null, check if GPT intended multi-speaker (has dashes)
    const hasDashes = (cue.text || '').split('\n').some(l => l.trimStart().startsWith('- '));
    if (hasDashes) {
      // Find the two speakers from utterance overlap
      const sources = originalSegments || [];
      const speakerOverlap = {};
      for (const seg of sources) {
        const os = Math.max(cue.start, seg.start);
        const oe = Math.min(cue.end, seg.end);
        const overlap = oe - os;
        if (overlap > 0 && seg.speaker) {
          speakerOverlap[seg.speaker] = (speakerOverlap[seg.speaker] || 0) + overlap;
        }
      }
      const speakers = Object.keys(speakerOverlap);
      speakers.sort((a, b) => speakerOverlap[b] - speakerOverlap[a]);
      if (speakers.length >= 2) return speakers.slice(0, 2);
      return speakers;
    }

    // No speaker, no dashes — try to find dominant from utterances
    const dom = getDominantSpeaker(cue);
    return dom ? [dom] : [];
  }

  // Get single dominant speaker for a cue
  function getDominantSpeaker(cue) {
    const sources = originalSegments || [];
    let best = null, bestOv = 0;
    for (const seg of sources) {
      const os = Math.max(cue.start, seg.start);
      const oe = Math.min(cue.end, seg.end);
      const ov = oe - os;
      if (ov > bestOv && seg.speaker) { bestOv = ov; best = seg.speaker; }
    }
    return best;
  }

  // ── STEP 1: Clean text + preserve GPT's speaker/dash decisions ──
  // PHILOSOPHY CHANGE: GPT was given the correct speaker labels in the input segments.
  // GPT's output speaker field and dash formatting should be TRUSTED, not overridden.
  // finalEnforce should only CLEAN (remove leaked [A] tags) and FIX formatting issues,
  // not re-derive speaker assignments from time-overlap heuristics.
  const step1 = [];
  for (const cue of cues) {
    const cleanedText = cleanCueText(cue.text || '');
    if (!cleanedText || !cleanedText.trim()) continue;

    // Sound cues — no speaker attribution, no dashes
    if (isSound(cleanedText)) {
      step1.push({ ...cue, text: stripDashes(cleanedText), speaker: null });
      continue;
    }

    // Trust GPT's speaker assignment and dash formatting.
    // Only clean leaked [A]/[B]/[C] tags from text.
    // If GPT set speaker=null and has dashes, it's a multi-speaker cue — preserve it.
    // If GPT set a specific speaker, it's single-speaker — strip any accidental dashes.
    const hasDashes = cleanedText.split('\n').some(l => l.trimStart().startsWith('- '));

    if (cue.speaker === null && hasDashes) {
      // GPT intended multi-speaker — preserve dashes as-is
      step1.push({ ...cue, text: cleanedText, speaker: null });
    } else if (cue.speaker) {
      // GPT assigned a specific speaker — single speaker, strip any accidental dashes
      const stripped = stripDashes(cleanedText);
      step1.push({ ...cue, text: stripped, speaker: cue.speaker });
    } else {
      // No speaker, no dashes — try to resolve from utterance data
      const dom = getDominantSpeaker(cue);
      step1.push({ ...cue, text: cleanedText, speaker: dom || null });
    }
  }

  // ── STEP 1b: Consolidate short cues (1-2 word fragments) ──
  // Merge very short text cues into their neighbors to prevent fragmentation.
  // CRITICAL: NEVER merge cues with different speakers. Speaker identity is sacred.
  const step1b = [];
  for (let i = 0; i < step1.length; i++) {
    const cue = step1[i];
    const flatText = cue.text.replace(/\n/g, ' ').trim();
    const wordCount = flatText.split(/\s+/).filter(Boolean).length;
    const cueIsSound = isSound(cue.text);
    const hasDashes = cue.text.split('\n').some(l => l.trimStart().startsWith('- '));

    // Skip sound cues, dashed (multi-speaker) cues, and cues long enough
    if (cueIsSound || hasDashes || wordCount >= MIN_WORDS_STANDALONE) {
      step1b.push(cue);
      continue;
    }

    // For very short text (1-2 words), shrink overly long durations
    const maxDurForShort = Math.max(MIN_DUR, wordCount * 1000);
    const actualDur = cue.end - cue.start;
    const shrunkEnd = actualDur > maxDurForShort ? cue.start + maxDurForShort : cue.end;

    // STRICT speaker matching: both must have a speaker and they must match.
    // null/undefined speakers NEVER match — they are unresolved and must not be merged.
    function strictSameSpeaker(spkA, spkB) {
      return spkA && spkB && spkA === spkB;
    }

    // Try merge with previous
    if (step1b.length > 0) {
      const prev = step1b[step1b.length - 1];
      const prevIsSound = isSound(prev.text);
      const prevHasDashes = prev.text.split('\n').some(l => l.trimStart().startsWith('- '));
      const gap = cue.start - prev.end;
      const prevFlat = prev.text.replace(/\n/g, ' ').trim();
      const combined = `${prevFlat} ${flatText}`;
      const combinedDur = shrunkEnd - prev.start;

      if (strictSameSpeaker(prev.speaker, cue.speaker) && gap <= MERGE_GAP_LIMIT
          && !prevIsSound && !prevHasDashes
          && combinedDur <= MAX_DUR && combined.length <= MAX_CHARS * 2 + 1) {
        prev.end = shrunkEnd;
        prev.text = combined;
        continue;
      }
    }

    // Try merge with next
    if (i + 1 < step1.length) {
      const next = step1[i + 1];
      const nextIsSound = isSound(next.text);
      const nextHasDashes = next.text.split('\n').some(l => l.trimStart().startsWith('- '));
      const gap = next.start - shrunkEnd;
      const nextFlat = next.text.replace(/\n/g, ' ').trim();
      const combined = `${flatText} ${nextFlat}`;
      const combinedDur = next.end - cue.start;

      if (strictSameSpeaker(next.speaker, cue.speaker) && gap <= MERGE_GAP_LIMIT
          && !nextIsSound && !nextHasDashes
          && combinedDur <= MAX_DUR && combined.length <= MAX_CHARS * 2 + 1) {
        next.start = cue.start;
        next.text = combined;
        continue;
      }
    }

    // Can't merge — keep but use shrunk duration
    cue.end = shrunkEnd;
    step1b.push(cue);
  }

  // ── STEP 2: Fix line count and line length ──
  function reflowText(words, limit) {
    if (words.length === 0) return null;
    const full = words.join(' ');
    if (full.length <= limit) return full;

    let bestSplit = -1, bestBalance = Infinity;
    for (let split = 1; split < words.length; split++) {
      const l1 = words.slice(0, split).join(' ');
      const l2 = words.slice(split).join(' ');
      if (l1.length <= limit && l2.length <= limit) {
        const balance = Math.abs(l1.length - l2.length);
        if (balance < bestBalance) { bestBalance = balance; bestSplit = split; }
      }
    }
    if (bestSplit >= 0) {
      return `${words.slice(0, bestSplit).join(' ')}\n${words.slice(bestSplit).join(' ')}`;
    }

    let line1 = '', wi = 0;
    while (wi < words.length) {
      const candidate = line1 ? `${line1} ${words[wi]}` : words[wi];
      if (candidate.length <= limit) { line1 = candidate; wi++; }
      else break;
    }
    if (!line1 && wi < words.length) { line1 = words[wi]; wi++; }
    const line2 = words.slice(wi).join(' ');
    if (line2.length <= limit) return `${line1}\n${line2}`;
    return null;
  }

  const step2 = [];
  for (const cue of step1b) {
    const cueIsSound = isSound(cue.text);
    let lines = cue.text.split('\n');

    if (lines.length > 2) {
      const hasDashes = lines.every(l => l.trimStart().startsWith('- '));
      if (hasDashes) {
        const stripped = lines.map(l => l.replace(/^- /, '').trim());
        lines = [`- ${stripped[0]}`, `- ${stripped.slice(1).join(' ')}`];
      } else {
        lines = [lines[0], lines.slice(1).join(' ')];
      }
    }

    const allFit = lines.every(l => l.length <= MAX_CHARS);
    if (lines.length <= 2 && allFit) {
      step2.push({ ...cue, text: lines.join('\n') });
      continue;
    }

    if (cueIsSound) {
      step2.push({ ...cue, text: lines.slice(0, 2).map(l => l.substring(0, MAX_CHARS)).join('\n') });
      continue;
    }

    const hasDashes = lines.length >= 2 && lines.every(l => l.trimStart().startsWith('- '));
    const stripped = lines.map(l => l.replace(/^- /, '').trim()).join(' ');
    const words = stripped.split(/\s+/).filter(Boolean);
    const prefix = hasDashes ? '- ' : '';
    const limit = MAX_CHARS - prefix.length;

    const reflowed = reflowText(words, limit);
    if (reflowed !== null) {
      const prefixed = reflowed.split('\n').map(l => `${prefix}${l}`).join('\n');
      step2.push({ ...cue, text: prefixed });
    } else {
      const midWord = Math.ceil(words.length / 2);
      const half1Words = words.slice(0, midWord);
      const half2Words = words.slice(midWord);
      const text1 = reflowText(half1Words, limit);
      const text2 = reflowText(half2Words, limit);
      const fmt1 = text1 !== null
        ? text1.split('\n').map(l => `${prefix}${l}`).join('\n')
        : `${prefix}${half1Words.join(' ')}`;
      const fmt2 = text2 !== null
        ? text2.split('\n').map(l => `${prefix}${l}`).join('\n')
        : `${prefix}${half2Words.join(' ')}`;
      const totalChars = stripped.length;
      const half1Chars = half1Words.join(' ').length;
      const splitTime = cue.start + Math.round((cue.end - cue.start) * (half1Chars / totalChars));
      step2.push(
        { start: cue.start, end: splitTime, text: fmt1, speaker: cue.speaker },
        { start: splitTime, end: cue.end, text: fmt2, speaker: cue.speaker },
      );
    }
  }

  // ── STEP 3: Fix timing ──
  const result = step2.filter(c => c.text && c.text.trim().length > 0);
  result.sort((a, b) => a.start - b.start);

  for (let i = 0; i < result.length; i++) {
    const c = result[i];
    if (c.end - c.start < MIN_DUR) c.end = c.start + MIN_DUR;
    if (c.end - c.start > MAX_DUR) c.end = c.start + MAX_DUR;

    if (i > 0) {
      const prev = result[i - 1];
      if (c.start < prev.end + MIN_GAP) {
        const canShrinkTo = prev.start + MIN_DUR;
        if (prev.end > canShrinkTo && c.start - MIN_GAP >= canShrinkTo) {
          prev.end = c.start - MIN_GAP;
        } else {
          c.start = prev.end + MIN_GAP;
          if (c.end <= c.start) c.end = c.start + MIN_DUR;
        }
      }
    }

    const charCount = c.text.replace(/\n/g, '').length;
    const dur = c.end - c.start;
    const cueIsSound = isSound(c.text);
    if (!cueIsSound && dur > 0 && charCount / (dur / 1000) > MAX_CPS) {
      const neededDur = Math.ceil((charCount / MAX_CPS) * 1000);
      const maxEnd = (i + 1 < result.length) ? result[i + 1].start - MIN_GAP : c.start + MAX_DUR;
      c.end = Math.min(c.start + neededDur, maxEnd, c.start + MAX_DUR);
    }
  }

  return result;
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
    // Note: missing_punctuation is informational only — mid-sentence cues intentionally omit terminal punctuation
    if (!c.text || c.text.trim().length === 0) issues.push({ cue: i, type: 'empty_cue', value: 'No text content' });
  }
  return { issuesCount: issues.length, issues };
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────
//
// action="start"        → fetch transcript, build plan, kick off batch 0, save plan to DB
// action="process_batch"→ process one GPT batch, save progress, trigger next batch or finalize
//
// Everything runs server-side. Frontend just polls the DB.

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json();
    const { transcript_id, job_db_id, action = 'start', batch_index } = body;
    if (!transcript_id || !job_db_id) return Response.json({ error: 'transcript_id and job_db_id required' }, { status: 400 });

    const ASSEMBLYAI_API_KEY = Deno.env.get('ASSEMBLYAI_API_KEY');
    const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY');

    // ── START: fetch transcript, build plan, save to DB, kick off batch 0 ──
    if (action === 'start') {
      const [transcript, srtText] = await Promise.all([
        getTranscript(transcript_id, ASSEMBLYAI_API_KEY),
        getAssemblyAISRT(transcript_id, ASSEMBLYAI_API_KEY),
      ]);
      if (transcript.status !== 'completed') return Response.json({ status: transcript.status });

      const utterances = transcript.utterances || [];
      const srtCues = parseSRT(srtText);
      const rawSegments = mapSpeakers(srtCues, utterances);
      const gaps = findGaps(utterances, transcript.audio_duration ? transcript.audio_duration * 1000 : null);
      const highlights = (transcript.auto_highlights_result?.results || []).slice(0, 20).map(h => h.text);
      const audioEvents = extractAudioEvents(transcript);
      const assemblyRawCues = utterances.map(u => ({ start: u.start, end: u.end, text: u.text, speaker: u.speaker, words: u.words || [] }));
      const assemblySRTCues = rawSegments;

      const BATCH_SIZE = 20;
      const batches = [];
      for (let i = 0; i < rawSegments.length; i += BATCH_SIZE) {
        batches.push(rawSegments.slice(i, i + BATCH_SIZE).map(({ start, end, text, speaker }) => ({ start, end, text, speaker })));
      }

      const prepareLog = { step: '1_transcribe', status: 'ok', detail: `AssemblyAI completed. SRT: ${srtCues.length} cues, ${utterances.length} utterances, ${audioEvents.length} audio events → ${batches.length} GPT batches.`, ts: new Date().toISOString() };

      await base44.asServiceRole.entities.Job.update(job_db_id, {
        pipelineLog: [prepareLog],
        processingPlan: {
          batches,
          gaps,
          highlights,
          audioEvents,
          language: transcript.language_code,
          assemblyRawCues,
          assemblySRTCues,
          polishedCues: [],
          totalBatches: batches.length,
        },
      });

      base44.functions.invoke('processAICaption', {
        transcript_id,
        job_db_id,
        action: 'process_batch',
        batch_index: 0,
      }).catch(() => {});

      return Response.json({ status: 'started', totalBatches: batches.length });
    }

    // ── REPROCESS: re-run GPT pipeline using saved AssemblyAI data (no new charge) ──
    if (action === 'reprocess') {
      const job = await base44.asServiceRole.entities.Job.get(job_db_id);
      if (!job) return Response.json({ error: 'Job not found' }, { status: 404 });

      // Check if we have diagnostic data (either inline, as URL, or in processingPlan)
      const hasDiagnostic = job.result?.assemblyRawCues?.length > 0 || job.result?.diagnostic_url || job.processingPlan?.assemblyRawCues?.length > 0;
      if (!hasDiagnostic) return Response.json({ error: 'No saved AssemblyAI data found. You must reprocess from AssemblyAI.' }, { status: 400 });

      // Always re-fetch SRT + utterances from AssemblyAI (cached, no new charge)
      const [transcript, srtText] = await Promise.all([
        getTranscript(transcript_id, ASSEMBLYAI_API_KEY),
        getAssemblyAISRT(transcript_id, ASSEMBLYAI_API_KEY),
      ]);
      if (transcript.status !== 'completed') return Response.json({ error: 'Transcript not ready' }, { status: 400 });

      const utterances = transcript.utterances || [];
      const srtCues = parseSRT(srtText);
      const rawSegments = mapSpeakers(srtCues, utterances);
      const gaps = findGaps(utterances, transcript.audio_duration ? transcript.audio_duration * 1000 : null);
      const highlights = (transcript.auto_highlights_result?.results || []).slice(0, 20).map(h => h.text);
      const audioEvents = extractAudioEvents(transcript);
      const assemblyRawCues = utterances.map(u => ({ start: u.start, end: u.end, text: u.text, speaker: u.speaker, words: u.words || [] }));
      const assemblySRTCues = rawSegments;

      const BATCH_SIZE = 20;
      const batches = [];
      for (let i = 0; i < rawSegments.length; i += BATCH_SIZE) {
        batches.push(rawSegments.slice(i, i + BATCH_SIZE).map(({ start, end, text, speaker }) => ({ start, end, text, speaker })));
      }

      const reprocessLog = { step: '1_transcribe', status: 'ok', detail: `Reprocess using AssemblyAI SRT base (cached — no new charge). SRT: ${srtCues.length} cues, ${audioEvents.length} audio events → ${batches.length} GPT batches.`, ts: new Date().toISOString() };

      await base44.asServiceRole.entities.Job.update(job_db_id, {
        status: 'processing',
        pipelineLog: [reprocessLog],
        processingPlan: {
          batches,
          gaps,
          highlights,
          audioEvents,
          language: transcript.language_code,
          assemblyRawCues,
          assemblySRTCues,
          polishedCues: [],
          totalBatches: batches.length,
        },
      });

      base44.functions.invoke('processAICaption', {
        transcript_id,
        job_db_id,
        action: 'process_batch',
        batch_index: 0,
      }).catch(() => {});

      return Response.json({ status: 'reprocess_started', totalBatches: batches.length });
    }

    // ── PROCESS_BATCH: run one GPT batch, save progress, trigger next ──
    if (action === 'process_batch') {
      const batchIndex = typeof batch_index === 'number' ? batch_index : 0;

      const job = await base44.asServiceRole.entities.Job.get(job_db_id);
      if (!job) return Response.json({ error: 'Job not found' }, { status: 404 });

      // If job errored or was cancelled, stop
      if (job.status === 'error' || job.status === 'done') return Response.json({ status: job.status });

      const plan = job.processingPlan;
      if (!plan) return Response.json({ error: 'No processing plan found' }, { status: 400 });

      const { batches, gaps, highlights, audioEvents, language, assemblyRawCues, assemblySRTCues, totalBatches } = plan;
      const polishedCues = plan.polishedCues || [];
      const batch = batches[batchIndex];

      // Get gaps relevant to this batch window
      const batchWindowStart = batch[0].start;
      const batchWindowEnd = batch[batch.length - 1].end;
      const batchGaps = (gaps || []).filter(g => g.start >= batchWindowStart - 2000 && g.end <= batchWindowEnd + 2000);

      // Call GPT for this batch
      const batchResult = await polishBatchWithGPT(batch, batchGaps, language, highlights, audioEvents, OPENAI_API_KEY, batchIndex, totalBatches);

      // Append results and update log
      const newPolishedCues = [...polishedCues, ...batchResult];
      const existingLog = job.pipelineLog || [];
      const batchLog = { step: `2_gpt_batch_${batchIndex + 1}_of_${totalBatches}`, status: 'ok', detail: `gpt-4o batch ${batchIndex + 1}/${totalBatches} returned ${batchResult.length} cues.`, ts: new Date().toISOString() };

      await base44.asServiceRole.entities.Job.update(job_db_id, {
        pipelineLog: [...existingLog, batchLog],
        processingPlan: { ...plan, polishedCues: newPolishedCues },
      });

      const nextBatch = batchIndex + 1;
      if (nextBatch < totalBatches) {
        // Trigger next batch asynchronously
        base44.functions.invoke('processAICaption', {
          transcript_id,
          job_db_id,
          action: 'process_batch',
          batch_index: nextBatch,
        }).catch(() => {});
        return Response.json({ status: 'batch_done', next: nextBatch });
      }

      // All batches done — finalize
      // Gather all original input segments (flat) for speaker detection
      // Also include raw utterances for better speaker boundary detection
      const allOriginalSegments = batches.flat();
      // Prefer utterance data (has real speaker labels from AssemblyAI)
      const utteranceSegments = (assemblyRawCues || []).map(u => ({
        start: u.start, end: u.end, text: u.text, speaker: u.speaker
      }));
      // Use utterances if available, fall back to SRT-mapped segments
      const speakerSource = utteranceSegments.length > 0 ? utteranceSegments : allOriginalSegments;
      const cues = finalEnforce(newPolishedCues, speakerSource);
      const srt = buildSRT(cues);
      const vtt = buildVTT(cues);
      const scc = buildSCC(cues);
      const qc = runQC(cues);

      // Upload large text files (SRT/VTT/SCC) and large JSON data as files
      // to avoid hitting entity field size limits on long videos
      async function uploadTextFile(content, filename, mimeType) {
        const blob = new Blob([content], { type: mimeType });
        const file = new File([blob], filename, { type: mimeType });
        const { file_url } = await base44.asServiceRole.integrations.Core.UploadFile({ file });
        return file_url;
      }

      const [srtUrl, vttUrl, sccUrl, diagnosticUrl] = await Promise.all([
        uploadTextFile(srt, `${job_db_id}.srt`, 'text/plain'),
        uploadTextFile(vtt, `${job_db_id}.vtt`, 'text/plain'),
        uploadTextFile(scc, `${job_db_id}.scc`, 'text/plain'),
        uploadTextFile(JSON.stringify({
          assemblyRawCues: assemblySRTCues || assemblyRawCues,
          assemblyUtterances: assemblyRawCues,
          openaiReformattedCues: newPolishedCues,
          rawAudioEvents: audioEvents || [],
        }), `${job_db_id}_diagnostic.json`, 'application/json'),
      ]);

      const finalLog = { step: '3_finalize', status: 'ok', detail: `Final enforce done. ${cues.length} cues. QC issues: ${qc.issuesCount}.`, ts: new Date().toISOString() };

      await base44.asServiceRole.entities.Job.update(job_db_id, {
        status: 'done',
        result: {
          cues,
          srt_url: srtUrl,
          vtt_url: vttUrl,
          scc_url: sccUrl,
          diagnostic_url: diagnosticUrl,
          qc,
        },
        durationMs: cues.length > 0 ? cues[cues.length - 1].end : 0,
        issuesCount: qc.issuesCount || 0,
        lastPolledAt: new Date().toISOString(),
        pipelineLog: [...(job.pipelineLog || []), batchLog, finalLog],
        processingPlan: null, // clean up
      });

      return Response.json({ status: 'completed', cues: cues.length, qcIssues: qc.issuesCount });
    }

    return Response.json({ error: 'Invalid action' }, { status: 400 });

  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});