import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

// reprocessJob v1 — Self-contained reprocess that does everything in one function.
// No chain_secret needed. Admin-only. Processes all batches + finalize inline.

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

function buildBatches(segments) {
  if (segments.length === 0) return [];
  const BATCH_WINDOW_MS = 5 * 60 * 1000;
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

// ─── GPT POLISH ─────────────────────────────────────────────────────────────

async function polishBatchWithGPT(segments, gaps, language, highlights, apiKey, batchIndex, totalBatches) {
  const segmentInput = segments.map((s, i) => `[${i}] START=${s.start}ms END=${s.end}ms SPEAKER=${s.speaker || 'null'}\nTEXT: ${s.text}`).join('\n\n');
  const gapInput = gaps.length > 0 ? 'SILENCE GAPS:\n' + gaps.map(g => `${g.start}ms → ${g.end}ms (${Math.round((g.end - g.start)/1000)}s gap)`).join('\n') : '';
  const highlightDump = highlights?.length > 0 ? 'KEY AUDIO TERMS: ' + highlights.slice(0, 20).map(h => typeof h === 'string' ? `"${h}"` : `"${h.text}"`).join(', ') : '';
  const batchNote = totalBatches > 1 ? `NOTE: This is batch ${batchIndex + 1} of ${totalBatches}.\n\n` : '';

  const prompt = `${batchNote}You are a professional broadcast closed caption editor (NBCU CM-051 / FCC standards).

TASKS: 1) Be TRUE — never drop/paraphrase. 2) Fix grammar/punctuation. 3) ≤32 chars/line, ≤2 lines/cue. 4) Smart line breaks. 5) Sound cues in gaps. 6) Timecodes match speech.

═══════════════════════════════════════
ABSOLUTE RULE — FUNCTION WORD LINE-END BAN:
═══════════════════════════════════════
A line must NEVER end with: a, an, the, of, to, and, or, but, with, from, in, on, at, for, that
If needed, split into a new caption event instead.
❌ "had a\\nfacelift" → ✓ "had\\na facelift"
❌ "not even a\\nbrand label" → ✓ "not even\\na brand label"

PRIORITY 1 — NEVER SPLIT THESE:
• Proper nouns — atomic across lines AND cues
• Titles & named works (TV shows, films, songs) — atomic. "Watch What Happens Live" must NEVER be split.
  ❌ "Welcome to Watch\\nwhat Happens Live" → ✓ "Welcome to\\nWatch What Happens Live."
• Detect titles by context even if capitalization is wrong
• Hyphenated words stay together
• Number + unit pairs stay together
• Multi-word constructs: "a lot of", "kind of", "in front of"

PRIORITY 2 — Sound cues on their own line.
PRIORITY 3 — Break after: sentences > commas > clauses > phrase boundaries. NEVER between article+noun, adjective+noun, aux+verb, inside phrases.
PRIORITY 4 — If 2-line layout violates rules, create another cue.

SPEAKER DASHES: "- " prefix each line only for 2-speaker cues.
ORPHAN WORDS: Never 1-3 word cues mid-sentence.
HARD: Never drop content. Timecodes locked. ≤32 chars, ≤2 lines. Duration ≥500ms. End sentences with .?!
SOUND CUES: [DESC] ALL CAPS, max 32 chars, only in gaps.
SELF-CHECK: Before outputting, verify no line ends with a/an/the/of/to/and/or/but/with/from/in/on/at/for/that, and no title is split.

OUTPUT: ONLY valid JSON array. {"start": number, "end": number, "text": string, "speaker": string|null}. Use \\n for line breaks.

Language: ${language || 'en'}

${segmentInput}

${gapInput}
${highlightDump}`;

  let res;
  for (let attempt = 0; attempt < 5; attempt++) {
    res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'gpt-4o',
        messages: [
          { role: 'system', content: 'You are a broadcast caption editor using intelligent linguistic segmentation. Output ONLY a valid JSON array. TIMECODES ARE LOCKED. ≤32 chars/line, ≤2 lines/cue. Never drop content. CRITICAL: NEVER split proper nouns, show/film/song titles, branded phrases, or hyphenated words across lines. NEVER break between article+noun, adjective+noun, auxiliary+main verb, inside verb/prepositional phrases, or number+unit. Prefer breaks after sentences, commas, clauses, then phrase boundaries. Sound cues get their own line. Favor semantic correctness over visual balance.' },
          { role: 'user', content: prompt },
        ],
        temperature: 0.1,
        max_tokens: 16000,
      }),
    });
    if (res.status === 429) { await new Promise(r => setTimeout(r, 30000 * (attempt + 1))); continue; }
    break;
  }
  if (!res.ok) throw new Error(`OpenAI error (batch ${batchIndex + 1}): ${await res.text()}`);
  const data = await res.json();
  const content = data.choices[0].message.content.trim();
  const jsonMatch = content.match(/\[[\s\S]*\]/);
  if (!jsonMatch) throw new Error(`No valid JSON from OpenAI (batch ${batchIndex + 1})`);

  const usage = data.usage || {};
  const parsed = JSON.parse(jsonMatch[0]);

  // Post-GPT cleanup
  for (const cue of parsed) {
    if (!cue.text) continue;
    const lines = cue.text.split('\n');
    if (lines.length >= 2 && lines.every(l => l.trimStart().startsWith('- ')) && cue.speaker) cue.text = lines.map(l => l.replace(/^- /, '')).join('\n');
    if (lines.length === 1 && lines[0].startsWith('- ') && cue.speaker) cue.text = cue.text.replace(/^- /, '');
  }

  // Merge orphan cues
  const isSC = (t) => t.startsWith('[') || t.includes('♪');
  const isComplete = (t) => /[.?!]$/.test(t.replace(/\n/g, ' ').trim()) && t.split(/\s+/).length >= 2;
  const repack = (text) => {
    const words = text.split(/\s+/).filter(Boolean);
    let l1 = '', l2 = '';
    for (const w of words) {
      if (!l1 || (l1 + ' ' + w).length <= 32) l1 = l1 ? l1 + ' ' + w : w;
      else if (!l2 || (l2 + ' ' + w).length <= 32) l2 = l2 ? l2 + ' ' + w : w;
      else return null;
    }
    const r = l2 ? l1 + '\n' + l2 : l1;
    return r.split('\n').every(l => l.length <= 32) ? r : null;
  };

  const merged = [];
  for (let i = 0; i < parsed.length; i++) {
    const cue = parsed[i];
    if (!cue.text?.trim()) continue;
    if (isSC(cue.text)) { merged.push(cue); continue; }
    const plain = cue.text.replace(/\n/g, ' ').trim();
    const wc = plain.split(/\s+/).length;
    const prev = merged.length > 0 ? merged[merged.length - 1] : null;
    if (wc <= 3 && !isComplete(plain) && prev && !isSC(prev.text)) {
      const combo = prev.text.replace(/\n/g, ' ').trim() + ' ' + plain;
      const rp = repack(combo);
      if (rp) { merged[merged.length - 1] = { ...prev, end: cue.end, text: rp }; continue; }
    }
    if (plain.length < 20 && !/[.?!]$/.test(plain) && prev && !isSC(prev.text)) {
      const combo = prev.text.replace(/\n/g, ' ').trim() + ' ' + plain;
      const rp = repack(combo);
      if (rp) { merged[merged.length - 1] = { ...prev, end: cue.end, text: rp }; continue; }
    }
    merged.push(cue);
  }

  return { cues: merged, tokens: { inputTokens: usage.prompt_tokens || 0, outputTokens: usage.completion_tokens || 0 } };
}

// ─── FINAL ENFORCEMENT ──────────────────────────────────────────────────────

function finalEnforce(cues) {
  const MAX_CHARS = 32, MIN_DUR = 500, MIN_GAP = 67;
  const result = [];
  for (const cue of cues) {
    if (!cue.text?.trim()) continue;
    const lines = cue.text.split('\n').filter(l => l.trim().length > 0);
    if (!lines.length) continue;
    const isSC = cue.text.startsWith('[') || cue.text.includes('♪');
    if (lines.length <= 2 && lines.every(l => l.length <= MAX_CHARS)) { result.push({ ...cue, text: lines.join('\n') }); continue; }
    if (isSC) {
      const tr = lines.map(l => l.substring(0, MAX_CHARS));
      const totalDur = cue.end - cue.start;
      const gc = Math.ceil(tr.length / 2);
      for (let g = 0; g < gc; g++) {
        const gl = tr.slice(g * 2, g * 2 + 2);
        const gs = cue.start + Math.round((g / gc) * totalDur);
        const ge = g === gc - 1 ? cue.end : cue.start + Math.round(((g + 1) / gc) * totalDur);
        result.push({ start: gs, end: Math.max(gs + MIN_DUR, ge), text: gl.join('\n'), speaker: cue.speaker });
      }
      continue;
    }
    const hasDashes = lines.length >= 2 && lines.every(l => l.startsWith('- '));
    const stripped = lines.map(l => l.replace(/^- /, '')).join(' ');
    const words = stripped.split(/\s+/).filter(Boolean);
    if (!words.length) continue;
    const prefix = hasDashes ? '- ' : '';
    const limit = MAX_CHARS - prefix.length;
    const packed = [];
    let cur = '';
    for (const word of words) {
      const c = cur ? `${cur} ${word}` : word;
      if (c.length <= limit) cur = c;
      else { if (cur) packed.push(cur); cur = word; }
    }
    if (cur) packed.push(cur);
    const totalDur = cue.end - cue.start;
    const cc = Math.ceil(packed.length / 2);
    for (let i = 0; i < packed.length; i += 2) {
      const chunk = packed.slice(i, i + 2);
      const ci = Math.floor(i / 2);
      const cs = cue.start + Math.round((ci / cc) * totalDur);
      const ce = ci === cc - 1 ? cue.end : cue.start + Math.round(((ci + 1) / cc) * totalDur);
      result.push({ start: cs, end: Math.max(cs + MIN_DUR, ce), text: chunk.map(l => prefix + l).join('\n'), speaker: cue.speaker });
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
  // Merge remaining orphans
  const isSndCue = (t) => t.startsWith('[') || t.includes('♪');
  const repack2 = (text) => {
    const words = text.split(/\s+/).filter(Boolean);
    let l1 = '', l2 = '';
    for (const w of words) {
      if (!l1 || (l1 + ' ' + w).length <= MAX_CHARS) l1 = l1 ? l1 + ' ' + w : w;
      else if (!l2 || (l2 + ' ' + w).length <= MAX_CHARS) l2 = l2 ? l2 + ' ' + w : w;
      else return null;
    }
    const r = l2 ? l1 + '\n' + l2 : l1;
    return r.split('\n').every(l => l.length <= MAX_CHARS) ? r : null;
  };
  for (let i = result.length - 1; i >= 0; i--) {
    const c = result[i];
    if (!c.text || isSndCue(c.text)) continue;
    const plain = c.text.replace(/\n/g, ' ').trim();
    if (plain.split(/\s+/).length > 2) continue;
    if (i > 0 && !isSndCue(result[i-1].text)) {
      const rp = repack2(result[i-1].text.replace(/\n/g, ' ').trim() + ' ' + plain);
      if (rp) { result[i-1] = { ...result[i-1], end: c.end, text: rp }; result.splice(i, 1); continue; }
    }
    if (i < result.length - 1 && !isSndCue(result[i+1].text)) {
      const rp = repack2(plain + ' ' + result[i+1].text.replace(/\n/g, ' ').trim());
      if (rp) { result[i+1] = { ...result[i+1], start: c.start, text: rp }; result.splice(i, 1); continue; }
    }
  }
  for (const c of result) {
    if (!c.text || isSndCue(c.text)) continue;
    const lines = c.text.split('\n');
    if (lines.length >= 2 && lines.every(l => l.startsWith('- ')) && c.speaker) c.text = lines.map(l => l.replace(/^- /, '')).join('\n');
    if (lines.length === 1 && lines[0].startsWith('- ') && c.speaker) c.text = c.text.replace(/^- /, '');
  }
  return result.filter(c => c.text?.trim().length > 0);
}

function runQC(cues) {
  const issues = [];
  for (let i = 0; i < cues.length; i++) {
    const c = cues[i]; const lines = c.text.split('\n'); const dur = c.end - c.start;
    const charCount = c.text.replace(/\n/g, '').length;
    const isSC = c.text.startsWith('[') || c.text.includes('♪');
    for (let li = 0; li < lines.length; li++) { if (lines[li].length > 32) issues.push({ cue: i, type: 'line_too_long', value: `${lines[li].length}` }); }
    if (lines.length > 2) issues.push({ cue: i, type: 'too_many_lines', value: `${lines.length}` });
    if (dur < 500) issues.push({ cue: i, type: 'cue_too_short', value: `${dur}ms` });
    if (dur > 8000) issues.push({ cue: i, type: 'cue_too_long', value: `${(dur/1000).toFixed(1)}s` });
    if (!isSC && charCount / (dur / 1000) > 25) issues.push({ cue: i, type: 'reading_speed', value: `${(charCount/(dur/1000)).toFixed(1)} CPS` });
    if (i > 0) { const gap = c.start - cues[i - 1].end; if (gap < 0) issues.push({ cue: i, type: 'overlap' }); else if (gap < 67) issues.push({ cue: i, type: 'gap_too_small' }); }
  }
  return { issuesCount: issues.length, issues };
}

// ─── MAIN HANDLER ───────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const user = await base44.auth.me();
  if (!user || user.role !== 'admin') return Response.json({ error: 'Forbidden' }, { status: 403 });

  let body;
  try { body = await req.json(); } catch { return Response.json({ error: 'Invalid JSON' }, { status: 400 }); }

  const { job_db_id } = body;
  if (!job_db_id) return Response.json({ error: 'job_db_id required' }, { status: 400 });

  const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY');
  const ASSEMBLYAI_API_KEY = Deno.env.get('ASSEMBLYAI_API_KEY');

  try {
    const job = await base44.asServiceRole.entities.Job.get(job_db_id);
    let plan = job.processingPlan || {};
    let utterances = plan.utterances;

    // Re-fetch from AssemblyAI if no utterances saved
    if (!utterances || utterances.length === 0) {
      const tid = job.railwayJobId;
      if (!tid) return Response.json({ error: 'No transcript ID' }, { status: 400 });
      console.log(`[reprocessJob] Fetching transcript ${tid} from AssemblyAI...`);
      const aaiRes = await fetch(`https://api.assemblyai.com/v2/transcript/${tid}`, { headers: { 'authorization': ASSEMBLYAI_API_KEY } });
      if (!aaiRes.ok) return Response.json({ error: `AAI fetch failed: ${aaiRes.status}` }, { status: 500 });
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
    const gaps = plan.gaps || [];
    const language = plan.language || 'en';
    const highlights = plan.highlights || [];

    console.log(`[reprocessJob] ${segments.length} segments, ${batches.length} batches`);

    await base44.asServiceRole.entities.Job.update(job_db_id, {
      status: 'processing',
      result: null,
      error: null,
      pipelineLog: [{ step: '1_transcribe', status: 'ok', detail: 'Reprocess — using saved transcript data.', ts: new Date().toISOString() }],
    });

    // Process ALL batches inline
    const allCues = [];
    let totalInputTokens = 0, totalOutputTokens = 0;

    for (let bi = 0; bi < batches.length; bi++) {
      const batchSegs = batches[bi].map(s => ({ start: s.start, end: s.end, text: s.text, speaker: s.speaker }));
      const batchWindowStart = batchSegs[0].start;
      const batchWindowEnd = batchSegs[batchSegs.length - 1].end;
      const batchGaps = gaps.filter(g => g.start >= batchWindowStart - 2000 && g.end <= batchWindowEnd + 2000);

      console.log(`[reprocessJob] Batch ${bi + 1}/${batches.length}: ${batchSegs.length} segments`);

      const result = await polishBatchWithGPT(batchSegs, batchGaps, language, highlights, OPENAI_API_KEY, bi, batches.length);
      allCues.push(...result.cues);
      totalInputTokens += result.tokens.inputTokens;
      totalOutputTokens += result.tokens.outputTokens;

      console.log(`[reprocessJob] Batch ${bi + 1} done: ${result.cues.length} cues`);

      if (bi < batches.length - 1) await new Promise(r => setTimeout(r, 2000));
    }

    // Finalize
    console.log(`[reprocessJob] Finalizing ${allCues.length} cues...`);
    const enforced = finalEnforce(allCues);
    const qc = runQC(enforced);
    const srt = buildSRT(enforced);
    const vtt = buildVTT(enforced);
    const scc = buildSCC(enforced);
    const durationMs = enforced.length > 0 ? enforced[enforced.length - 1].end : 0;
    const cueJson = JSON.stringify(enforced);

    async function uploadText(text, filename) {
      // Use File constructor directly from text (no /tmp needed)
      const encoder = new TextEncoder();
      const uint8 = encoder.encode(text);
      const file = new File([uint8], filename, { type: 'text/plain' });
      const { file_url } = await base44.asServiceRole.integrations.Core.UploadFile({ file });
      return file_url;
    }

    // Build diagnostic data
    const diagnosticData = {
      assemblyRawCues: segments.map(s => ({ start: s.start, end: s.end, text: s.text, speaker: s.speaker })),
      assemblyUtterances: utterances.map(u => ({ start: u.start, end: u.end, text: u.text, speaker: u.speaker })),
      openaiReformattedCues: allCues.map(c => ({ start: c.start, end: c.end, text: c.text, speaker: c.speaker })),
    };

    let resultPayload;
    if (cueJson.length > 30000) {
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
        cue_chunks: [cueJson], srt_chunks: chunkString(srt), vtt_chunks: chunkString(vtt), scc_chunks: chunkString(scc),
        assemblyRawCues: diagnosticData.assemblyRawCues,
        assemblyUtterances: diagnosticData.assemblyUtterances,
        openaiReformattedCues: diagnosticData.openaiReformattedCues,
        qc, language,
      };
    }

    const audioDurationSec = durationMs / 1000;
    const assemblyaiCost = (audioDurationSec / 60) * (0.65 / 60);
    const openaiCost = (totalInputTokens / 1_000_000) * 2.50 + (totalOutputTokens / 1_000_000) * 10.00;

    await base44.asServiceRole.entities.Job.update(job_db_id, {
      status: 'done',
      result: resultPayload,
      durationMs,
      issuesCount: qc.issuesCount,
      processingPlan: null,
      costEstimate: {
        assemblyai: Math.round(assemblyaiCost * 10000) / 10000,
        openai: Math.round(openaiCost * 10000) / 10000,
        total: Math.round((assemblyaiCost + openaiCost) * 10000) / 10000,
        audioDurationSec: Math.round(audioDurationSec),
        openaiInputTokens: totalInputTokens,
        openaiOutputTokens: totalOutputTokens,
      },
    });

    console.log(`[reprocessJob] Done! ${enforced.length} cues, ${qc.issuesCount} QC issues`);
    return Response.json({ status: 'done', cues: enforced.length, issues: qc.issuesCount });

  } catch (error) {
    console.error('[reprocessJob] Error:', error.message);
    await base44.asServiceRole.entities.Job.update(job_db_id, { status: 'error', error: error.message }).catch(() => {});
    return Response.json({ error: error.message }, { status: 500 });
  }
});