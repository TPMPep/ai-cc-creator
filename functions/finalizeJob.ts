import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

// Standalone finalize function — runs finalize logic directly for a job
// that already has polishedCues in its processingPlan.
// This bypasses the chain_secret requirement entirely.

function chunkString(str, size = 40000) {
  const chunks = [];
  for (let i = 0; i < str.length; i += size) chunks.push(str.slice(i, i + size));
  return chunks;
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
      if (candidate.length <= limit) cur = candidate;
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
    if (lines.length >= 2 && lines.every(l => l.startsWith('- ')) && c.speaker) c.text = lines.map(l => l.replace(/^- /, '')).join('\n');
    if (lines.length === 1 && lines[0].startsWith('- ') && c.speaker) c.text = c.text.replace(/^- /, '');
  }
  return result.filter(c => c.text && c.text.trim().length > 0);
}

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
    if (dur < 500) issues.push({ cue: i, type: 'cue_too_short', value: `${dur}ms` });
    if (dur > 8000) issues.push({ cue: i, type: 'cue_too_long', value: `${(dur/1000).toFixed(1)}s` });
    if (!isSoundCue && charCount / (dur / 1000) > 25) issues.push({ cue: i, type: 'reading_speed', value: `${(charCount/(dur/1000)).toFixed(1)} CPS` });
    if (i > 0) {
      const gap = c.start - cues[i - 1].end;
      if (gap < 0) issues.push({ cue: i, type: 'overlap', value: `${Math.abs(gap)}ms` });
      else if (gap < 67) issues.push({ cue: i, type: 'gap_too_small', value: `${gap}ms` });
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

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);

  const user = await base44.auth.me();
  if (!user || user.role !== 'admin') {
    return Response.json({ error: 'Forbidden: Admin access required' }, { status: 403 });
  }

  let body;
  try { body = await req.json(); } catch { return Response.json({ error: 'Invalid JSON' }, { status: 400 }); }

  const job_db_id = body.job_db_id;
  if (!job_db_id) return Response.json({ error: 'job_db_id required' }, { status: 400 });

  try {
    const job = await base44.asServiceRole.entities.Job.get(job_db_id);
    const plan = job.processingPlan;

    if (!plan) return Response.json({ error: 'No processingPlan on this job' }, { status: 400 });

    const allPolished = plan.polishedCues || [];
    if (!allPolished.length) return Response.json({ error: `No polishedCues found (${allPolished.length})` }, { status: 400 });

    const language = plan.language || 'en';

    console.log(`[finalizeJob] Enforcing rules on ${allPolished.length} cues for job ${job_db_id}...`);

    const diagnosticData = {
      assemblyUtterances: plan.utterances || [],
      assemblyRawCues: plan.utterances ? plan.utterances.map(u => ({ start: u.start, end: u.end, text: u.text, speaker: u.speaker })) : [],
      openaiReformattedCues: allPolished.map(c => ({ start: c.start, end: c.end, text: c.text, speaker: c.speaker })),
    };

    const enforced = finalEnforce(allPolished);
    const qc = runQC(enforced);
    const srt = buildSRT(enforced);
    const vtt = buildVTT(enforced);
    const scc = buildSCC(enforced);
    const durationMs = enforced.length > 0 ? enforced[enforced.length - 1].end : 0;

    const cueJson = JSON.stringify(enforced);
    console.log(`[finalizeJob] Cue JSON size: ${cueJson.length}`);

    async function uploadText(text, filename) {
      const tmpPath = `/tmp/${filename}`;
      await Deno.writeTextFile(tmpPath, text);
      const bytes = await Deno.readFile(tmpPath);
      const file = new File([bytes], filename, { type: 'text/plain' });
      const { file_url } = await base44.asServiceRole.integrations.Core.UploadFile({ file });
      return file_url;
    }

    let resultPayload;

    if (cueJson.length > 30000) {
      console.log("[finalizeJob] Large output — uploading as files");
      const [cueUrl, srtUrl, vttUrl, sccUrl] = await Promise.all([
        uploadText(cueJson, `job_${job_db_id}_cues.json`),
        uploadText(srt, `job_${job_db_id}.srt`),
        uploadText(vtt, `job_${job_db_id}.vtt`),
        uploadText(scc, `job_${job_db_id}.scc`),
      ]);
      const diagUrl = await uploadText(JSON.stringify(diagnosticData), `job_${job_db_id}_diagnostic.json`);
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
        qc, language,
      };
    }

    const audioDurationSec = durationMs / 1000;
    const openaiInputTokens = plan.openaiInputTokens || 0;
    const openaiOutputTokens = plan.openaiOutputTokens || 0;
    const assemblyaiCost = (audioDurationSec / 60) * (0.65 / 60);
    const openaiCost = (openaiInputTokens / 1_000_000) * 2.50 + (openaiOutputTokens / 1_000_000) * 10.00;
    const costEstimate = {
      assemblyai: Math.round(assemblyaiCost * 10000) / 10000,
      openai: Math.round(openaiCost * 10000) / 10000,
      total: Math.round((assemblyaiCost + openaiCost) * 10000) / 10000,
      audioDurationSec: Math.round(audioDurationSec),
      openaiInputTokens,
      openaiOutputTokens,
    };

    await base44.asServiceRole.entities.Job.update(job_db_id, {
      status: 'done',
      result: resultPayload,
      durationMs,
      issuesCount: qc.issuesCount,
      processingPlan: null,
      costEstimate,
    });

    console.log(`[finalizeJob] Job ${job_db_id} complete: ${enforced.length} cues, ${qc.issuesCount} QC issues`);
    return Response.json({ status: 'done', cues: enforced.length, issues: qc.issuesCount });

  } catch (error) {
    console.error('[finalizeJob] Error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});