import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

// Polishes a single batch of pre-segmented caption cues with GPT.
// Called repeatedly by the frontend, one small batch at a time.
// Each call is fast (< 30s) and well within timeout limits.

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const { batch, gaps = [], highlights = [], language, batch_index = 0, total_batches = 1 } = await req.json();
    if (!batch || !Array.isArray(batch)) return Response.json({ error: 'batch array required' }, { status: 400 });

    const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY');
    if (!OPENAI_API_KEY) return Response.json({ error: 'OPENAI_API_KEY not set' }, { status: 500 });

    const segmentInput = batch.map((s, i) =>
      `[${i}] START=${s.start}ms END=${s.end}ms SPEAKER=${s.speaker || 'null'}\nTEXT: ${s.text}`
    ).join('\n\n');

    const gapInput = gaps.length > 0
      ? 'SILENCE GAPS:\n' + gaps.map(g => `${g.start}ms → ${g.end}ms (${Math.round((g.end - g.start) / 1000)}s gap)`).join('\n')
      : '';

    const highlightDump = highlights.length > 0
      ? 'KEY AUDIO TERMS: ' + highlights.map(t => `"${t}"`).join(', ')
      : '';

    const batchNote = total_batches > 1
      ? `NOTE: Batch ${batch_index + 1} of ${total_batches}. Process only these segments.\n\n`
      : '';

    const prompt = `${batchNote}You are a professional broadcast closed caption editor (NBCU CM-051 / FCC standards).
Your job:
1. Fix grammar, punctuation, homophones
2. Format text: ≤32 chars/line, ≤2 lines/cue
3. Smart line breaks — keep context together, fill lines efficiently
4. Adjacent different-speaker segments may be combined with "- " prefix on each line if they fit
5. Insert sound/music cues into silence gaps

HARD RULES:
- TIMECODES LOCKED — use exact start/end ms from input (except when combining adjacent segments)
- MAX 32 chars/line, MAX 2 lines/cue, MIN 500ms duration
- Speaker prefix: "- " (2 chars) on each line when 2 speakers in one cue. NEVER use >> or >
- Every sentence ends with . ? or !
- Fix homophones. Preserve spoken contractions.

SOUND CUES: [ ♪ DESCRIPTION ♪ ] for music, [DESCRIPTION] for effects. ALL CAPS. Max 32 chars.

OUTPUT: ONLY a valid JSON array. No markdown, no fences.
Each: {"start":number,"end":number,"text":string,"speaker":string|null}
Use \\n for line breaks. Verify every line ≤32 chars.

Language: ${language || 'en'}

${segmentInput}

${gapInput}
${highlightDump}`;

    let res;
    for (let attempt = 0; attempt < 3; attempt++) {
      res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          messages: [
            { role: 'system', content: 'You are a broadcast caption editor. Output ONLY a valid JSON array. TIMECODES ARE LOCKED. Every line ≤32 chars, ≤2 lines per cue.' },
            { role: 'user', content: prompt },
          ],
          temperature: 0.1,
          max_tokens: 4000,
        }),
      });

      if (res.status === 429) {
        await new Promise(r => setTimeout(r, 20000 * (attempt + 1)));
        continue;
      }
      break;
    }

    if (!res.ok) throw new Error(`OpenAI error: ${await res.text()}`);

    const data = await res.json();
    const content = data.choices[0].message.content.trim();
    const jsonMatch = content.match(/\[[\s\S]*\]/);
    if (!jsonMatch) throw new Error('OpenAI did not return valid JSON');

    const cues = JSON.parse(jsonMatch[0]);
    console.log(`[BATCH ${batch_index + 1}/${total_batches}] OK — ${cues.length} cues returned`);
    
    return Response.json({ cues });

  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});