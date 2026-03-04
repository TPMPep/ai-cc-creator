import React from "react";
import { CheckCircle2, XCircle, Loader2, ChevronDown, ChevronUp } from "lucide-react";
import { useState } from "react";

const STEP_LABELS = {
  "init": "Initialize",
  "1_transcribe": "Step 1 — AssemblyAI Transcription",
  "1_parse": "Step 1 — Parse SRT Backbone",
  "2_align": "Step 2 — Align Words to Cues",
  "3_runs": "Step 3 — Build Speaker Runs",
  "4_sound": "Step 4 — Insert Sound Cues",
  "5_split": "Step 5 — Pre-split Multi-speaker",
  "6_ai": "Step 6 — AI Line Breaking",
  "7_validate": "Step 7 — Validation Gate",
  "8_export": "Step 8 — Export & QC",
  "9_done": "Step 9 — Complete",
  "3_finalize": "Step 3 — Final Enforce & QC",
};

function getLabel(step) {
  if (STEP_LABELS[step]) return STEP_LABELS[step];
  const gptMatch = step.match(/^2_gpt_batch_(\d+)_of_(\d+)$/);
  if (gptMatch) return `Step 2 — GPT Batch ${gptMatch[1]} of ${gptMatch[2]}`;
  return step;
}

export default function PipelineLog({ pipelineLog = [], jobStatus }) {
  const [expanded, setExpanded] = useState(false);

  if (!pipelineLog || pipelineLog.length === 0) {
    if (jobStatus === "processing" || jobStatus === "queued") {
      return (
        <div className="flex items-center gap-2 text-xs text-zinc-500 mt-1">
          <Loader2 className="w-3 h-3 animate-spin text-blue-400" />
          Pipeline starting…
        </div>
      );
    }
    return null;
  }

  const hasError = pipelineLog.some(l => l.status === "error");
  const allOk = pipelineLog.every(l => l.status === "ok");
  const latestStep = pipelineLog[pipelineLog.length - 1];
  // If job is done, treat pipeline as complete regardless of stale "running" entries
  const isComplete = jobStatus === "done" || (allOk && jobStatus === "done");

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-4 py-2.5 text-xs hover:bg-zinc-800/40 transition-colors"
      >
        <div className="flex items-center gap-2">
          {hasError && jobStatus !== "done" ? (
            <XCircle className="w-3.5 h-3.5 text-red-400" />
          ) : isComplete ? (
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
          ) : (
            <Loader2 className="w-3.5 h-3.5 text-blue-400 animate-spin" />
          )}
          <span className={hasError && jobStatus !== "done" ? "text-red-300" : isComplete ? "text-emerald-300" : "text-blue-300"}>
            {hasError && jobStatus !== "done" ? "Pipeline error detected" : isComplete ? "All pipeline steps completed ✓" : `Running: ${getLabel(latestStep.step)}`}
          </span>
          <span className="text-zinc-600">({pipelineLog.length} steps logged)</span>
        </div>
        {expanded ? <ChevronUp className="w-3 h-3 text-zinc-600" /> : <ChevronDown className="w-3 h-3 text-zinc-600" />}
      </button>

      {expanded && (
        <div className="border-t border-zinc-800 divide-y divide-zinc-800/60">
          {pipelineLog.map((log, i) => (
            <div key={i} className="flex items-start gap-3 px-4 py-2 text-xs">
              {log.status === "ok" ? (
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 mt-0.5 flex-shrink-0" />
              ) : log.status === "error" ? (
                <XCircle className="w-3.5 h-3.5 text-red-400 mt-0.5 flex-shrink-0" />
              ) : (
                <Loader2 className="w-3.5 h-3.5 text-blue-400 mt-0.5 flex-shrink-0 animate-spin" />
              )}
              <div className="flex-1 min-w-0">
                <span className="text-zinc-300 font-medium">{getLabel(log.step)}</span>
                {log.detail && <p className="text-zinc-500 mt-0.5">{log.detail}</p>}
              </div>
              <span className="text-zinc-700 flex-shrink-0">
                {log.ts ? new Date(log.ts).toLocaleTimeString() : ""}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}