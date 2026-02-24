import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

// Jobs are "stuck" if updated_date hasn't moved in this long
const STUCK_THRESHOLD_MS = 10 * 60 * 1000; // 10 minutes
// Jobs with no processing plan at all get errored after this
const NO_START_THRESHOLD_MS = 20 * 60 * 1000; // 20 minutes

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
      const staleDuration = now - updatedAt;

      // Only look at jobs whose DB record hasn't been touched recently
      if (staleDuration < STUCK_THRESHOLD_MS) continue;

      const plan = job.processingPlan;

      // Case 1: Has a processing plan — GPT chain started but stalled
      if (plan && plan.batches && typeof plan.totalBatches === 'number') {
        const completedCues = (plan.polishedCues || []).length;
        const currentBatch = plan.currentBatchIndex ?? 0;
        const totalBatches = plan.totalBatches;

        // Determine what to do: resume from currentBatchIndex or finalize
        let nextAction = 'process_batch';
        let nextBatch = currentBatch;

        // If all batches seem done (polishedCues exist for all), try finalize
        if (completedCues > 0 && currentBatch >= totalBatches - 1) {
          // Check pipeline log to see if last batch completed
          const log = job.pipelineLog || [];
          const lastBatchDone = log.some(e =>
            e.step === `2_gpt_batch_${totalBatches}_of_${totalBatches}` && e.status === 'ok'
          );
          if (lastBatchDone) {
            nextAction = 'finalize';
          }
        }

        // Generate a fresh runId so the zombie guard accepts it
        const newRunId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;

        // Update the plan with the new runId so the function accepts the call
        await base44.asServiceRole.entities.Job.update(job.id, {
          processingPlan: { ...plan, runId: newRunId },
          pipelineLog: [
            ...(job.pipelineLog || []),
            {
              step: `recovery_${nextAction}`,
              status: 'running',
              detail: `Auto-recovery: ${nextAction} at batch ${nextBatch + 1}/${totalBatches} after ${Math.round(staleDuration / 60000)}min stall. New runId assigned.`,
              ts: new Date().toISOString(),
            },
          ],
        });

        // Invoke the WORKER function (not processAICaption) to avoid 508 loop detection
        const payload = {
          job_db_id: job.id,
          action: nextAction,
          runId: newRunId,
        };
        if (nextAction === 'process_batch') {
          payload.batch_index = nextBatch;
          payload.transcript_id = job.railwayJobId;
        }

        base44.asServiceRole.functions.invoke('processAICaptionWorker', payload).catch(() => {});

        recovered++;
        details.push({
          jobId: job.id,
          title: job.title,
          action: nextAction,
          batch: nextBatch,
          staleMins: Math.round(staleDuration / 60000),
        });

      } else if (!plan && (!job.pipelineLog || job.pipelineLog.length === 0)) {
        // Case 2: No plan, no log — AssemblyAI never finished or start never ran
        const createdAt = new Date(job.created_date).getTime();
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