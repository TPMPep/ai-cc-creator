import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

// recoverStuckJobs v2 — Works with processAICaption v10 (no worker chain)
// Jobs are "stuck" if they've been processing for too long without progress.

const STUCK_THRESHOLD_MS = 15 * 60 * 1000; // 15 minutes
const NO_START_THRESHOLD_MS = 25 * 60 * 1000; // 25 minutes (waitAndProcess handles up to 15 min)

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (user?.role !== 'admin') {
      return Response.json({ error: 'Forbidden: Admin access required' }, { status: 403 });
    }

    const jobs = await base44.asServiceRole.entities.Job.filter({
      status: 'processing',
      pipeline: 'ai',
    });

    const now = Date.now();
    let recovered = 0;
    let errored = 0;
    const details = [];

    for (const job of jobs) {
      const updatedAt = new Date(job.updated_date).getTime();
      const createdAt = new Date(job.created_date).getTime();
      const staleDuration = now - updatedAt;

      // Skip jobs that are still actively being updated
      if (staleDuration < STUCK_THRESHOLD_MS) continue;

      const plan = job.processingPlan;
      const hasPipelineLog = job.pipelineLog && job.pipelineLog.length > 0;

      if (plan || hasPipelineLog) {
        // Job started processing but stalled — mark as error so user can manually reprocess
        await base44.asServiceRole.entities.Job.update(job.id, {
          status: 'error',
          error: `Processing stalled after ${Math.round(staleDuration / 60000)} minutes. Click "Reprocess" to try again.`,
          processingPlan: null,
        });
        errored++;
        details.push({
          jobId: job.id,
          title: job.title,
          action: 'errored_stalled',
          staleMins: Math.round(staleDuration / 60000),
        });

      } else if (!plan && !hasPipelineLog) {
        // No plan, no log — never started
        if (now - createdAt > NO_START_THRESHOLD_MS) {
          await base44.asServiceRole.entities.Job.update(job.id, {
            status: 'error',
            error: 'Job timed out waiting for transcription after 20 minutes.',
          });
          errored++;
          details.push({ jobId: job.id, title: job.title, action: 'errored_no_start' });
        }
      }
    }

    return Response.json({
      checked: jobs.length,
      recovered,
      errored,
      details,
      ts: new Date().toISOString(),
    });

  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});