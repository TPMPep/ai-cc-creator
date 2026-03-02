import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

// waitAndProcess — Server-side polling loop for AssemblyAI transcription.
// Polls until transcription is complete, then kicks off processAICaption.
// This ensures jobs complete even if the user closes their browser tab.

const MAX_WAIT_MS = 15 * 60 * 1000; // 15 minutes max wait
const POLL_INTERVAL_MS = 15 * 1000;  // Check every 15 seconds

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);

  try {
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const { transcript_id, job_db_id } = await req.json();
    if (!transcript_id || !job_db_id) {
      return Response.json({ error: 'transcript_id and job_db_id required' }, { status: 400 });
    }

    const ASSEMBLYAI_API_KEY = Deno.env.get('ASSEMBLYAI_API_KEY');
    if (!ASSEMBLYAI_API_KEY) {
      return Response.json({ error: 'ASSEMBLYAI_API_KEY not set' }, { status: 500 });
    }

    console.log(`[waitAndProcess] Starting poll for transcript ${transcript_id}, job ${job_db_id}`);

    const startTime = Date.now();
    let transcriptStatus = 'queued';

    // Poll AssemblyAI until done or timeout
    while (Date.now() - startTime < MAX_WAIT_MS) {
      await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));

      // Check if job was already completed or errored (e.g., by browser-side polling)
      const job = await base44.asServiceRole.entities.Job.get(job_db_id);
      if (job.status === 'done') {
        console.log(`[waitAndProcess] Job ${job_db_id} already done — skipping.`);
        return Response.json({ status: 'already_done' });
      }
      if (job.status === 'error') {
        console.log(`[waitAndProcess] Job ${job_db_id} already errored — skipping.`);
        return Response.json({ status: 'already_errored' });
      }
      // If processing plan exists, processAICaption was already kicked off
      if (job.processingPlan || (job.pipelineLog && job.pipelineLog.length > 0)) {
        console.log(`[waitAndProcess] Job ${job_db_id} already has processing plan/log — skipping.`);
        return Response.json({ status: 'already_processing' });
      }

      // Poll AssemblyAI
      const aaiRes = await fetch(`https://api.assemblyai.com/v2/transcript/${transcript_id}`, {
        headers: { 'authorization': ASSEMBLYAI_API_KEY },
      });
      if (!aaiRes.ok) {
        console.error(`[waitAndProcess] AAI poll failed: ${aaiRes.status}`);
        continue;
      }
      const transcript = await aaiRes.json();
      transcriptStatus = transcript.status;
      console.log(`[waitAndProcess] Transcript ${transcript_id} status: ${transcriptStatus} (elapsed: ${Math.round((Date.now() - startTime) / 1000)}s)`);

      if (transcriptStatus === 'completed') {
        // Kick off GPT processing
        console.log(`[waitAndProcess] Transcript ready — starting processAICaption for job ${job_db_id}`);
        const processRes = await base44.functions.invoke('processAICaption', {
          transcript_id,
          job_db_id,
          action: 'start',
        });
        console.log(`[waitAndProcess] processAICaption result:`, processRes.data);
        return Response.json({ status: 'processed', result: processRes.data });
      }

      if (transcriptStatus === 'error') {
        const errorMsg = transcript.error || 'Transcription failed';
        console.error(`[waitAndProcess] Transcript error: ${errorMsg}`);
        await base44.asServiceRole.entities.Job.update(job_db_id, {
          status: 'error',
          error: errorMsg,
        });
        return Response.json({ status: 'error', error: errorMsg });
      }

      // Otherwise it's queued/processing — continue polling
    }

    // Timed out
    console.error(`[waitAndProcess] Timed out after ${MAX_WAIT_MS / 60000} minutes for job ${job_db_id}`);
    await base44.asServiceRole.entities.Job.update(job_db_id, {
      status: 'error',
      error: `Transcription timed out after ${MAX_WAIT_MS / 60000} minutes. Try reprocessing.`,
    });
    return Response.json({ status: 'timeout' });

  } catch (error) {
    console.error(`[waitAndProcess] Error:`, error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});