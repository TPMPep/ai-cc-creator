import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

const STUCK_THRESHOLD_MS = 10 * 60 * 1000; // 10 minutes

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    // Find all AI pipeline jobs still in processing/queued state
    const jobs = await base44.asServiceRole.entities.Job.filter({
      status: 'processing',
      pipeline: 'ai',
    });

    const now = Date.now();
    let recovered = 0;
    let errored = 0;

    for (const job of jobs) {
      const createdAt = new Date(job.created_date).getTime();
      const ageMs = now - createdAt;

      // Only look at jobs older than the stuck threshold
      if (ageMs < STUCK_THRESHOLD_MS) continue;

      const plan = job.processingPlan;

      // Case 1: Has a processing plan — GPT chain started but stalled on a batch
      if (plan && plan.batches && typeof plan.totalBatches === 'number') {
        const completedBatches = (plan.polishedCues || []).length > 0
          ? Math.floor((plan.polishedCues.length / Math.max(1, plan.batches.flat().length)) * plan.totalBatches)
          : 0;

        // Find the next unprocessed batch by checking pipelineLog
        const log = job.pipelineLog || [];
        const completedBatchNums = log
          .filter(e => e.step && e.step.startsWith('2_gpt_batch_'))
          .map(e => {
            const m = e.step.match(/2_gpt_batch_(\d+)_of_/);
            return m ? parseInt(m[1]) - 1 : -1;
          })
          .filter(n => n >= 0);

        let nextBatch = 0;
        for (let i = 0; i < plan.totalBatches; i++) {
          if (!completedBatchNums.includes(i)) { nextBatch = i; break; }
          if (i === plan.totalBatches - 1) { nextBatch = -1; } // all done?
        }

        if (nextBatch === -1) {
          // All batches logged but job not marked done — likely a finalize crash
          // Re-trigger the last batch to re-finalize
          nextBatch = plan.totalBatches - 1;
        }

        // Re-trigger the stalled batch
        const recoveryLog = {
          step: `recovery_batch_${nextBatch}`,
          status: 'running',
          detail: `Auto-recovery: re-triggering batch ${nextBatch + 1}/${plan.totalBatches} after ${Math.round(ageMs / 60000)}min stall.`,
          ts: new Date().toISOString(),
        };

        await base44.asServiceRole.entities.Job.update(job.id, {
          pipelineLog: [...log, recoveryLog],
        });

        base44.asServiceRole.functions.invoke('processAICaption', {
          transcript_id: job.railwayJobId,
          job_db_id: job.id,
          action: 'process_batch',
          batch_index: nextBatch,
        }).catch(() => {});

        recovered++;

      } else if (!plan && (!job.pipelineLog || job.pipelineLog.length === 0)) {
        // Case 2: No plan, no log — AssemblyAI never finished or start never ran
        // If job is very old (>20 min) with nothing started, mark as error
        if (ageMs > 20 * 60 * 1000) {
          await base44.asServiceRole.entities.Job.update(job.id, {
            status: 'error',
            error: 'Job timed out waiting for transcription after 20 minutes.',
          });
          errored++;
        }
        // Otherwise leave it — AssemblyAI may still be working
      }
    }

    return Response.json({
      checked: jobs.length,
      recovered,
      errored,
      ts: new Date().toISOString(),
    });

  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});