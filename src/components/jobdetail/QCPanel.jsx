import React from "react";
import { CheckCircle2, AlertTriangle, ArrowRight } from "lucide-react";

const ISSUE_LABELS = {
  line_too_long: "Line Too Long",
  too_many_lines: "Too Many Lines",
  cue_too_short: "Cue Too Short",
  cue_too_long: "Cue Too Long",
  reading_speed: "Reading Speed",
  overlap: "Overlap",
  gap_too_small: "Gap < 2 Frames",
  missing_punctuation: "Missing Punctuation",
  possible_missing_speaker_dash: "Speaker Dash?",
  empty_cue: "Empty Cue",
};

const SEVERITY = {
  overlap: "red",
  empty_cue: "red",
  line_too_long: "amber",
  too_many_lines: "amber",
  reading_speed: "amber",
  cue_too_short: "amber",
  cue_too_long: "amber",
  gap_too_small: "amber",
  missing_punctuation: "blue",
  possible_missing_speaker_dash: "blue",
};

export default function QCPanel({ qc, onJumpToCue }) {
  if (!qc) return null;

  const issuesCount = qc.issuesCount || 0;
  const redCount = (qc.issues || []).filter(i => SEVERITY[i.type] === "red").length;
  const amberCount = (qc.issues || []).filter(i => SEVERITY[i.type] === "amber").length;
  const blueCount = (qc.issues || []).filter(i => SEVERITY[i.type] === "blue").length;

  return (
    <div className="space-y-3 h-full flex flex-col">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold text-zinc-400 uppercase tracking-wide">QC Report</h3>
        {issuesCount > 0 && (
          <div className="flex items-center gap-1">
            {redCount > 0 && <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-500/20 text-red-400 font-medium">{redCount} critical</span>}
            {amberCount > 0 && <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-400 font-medium">{amberCount} warn</span>}
            {blueCount > 0 && <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-500/20 text-blue-400 font-medium">{blueCount} info</span>}
          </div>
        )}
      </div>
      
      {issuesCount === 0 ? (
        <div className="flex items-center gap-2 p-3 rounded-lg bg-emerald-600/5 border border-emerald-500/10">
          <CheckCircle2 className="w-4 h-4 text-emerald-400" />
          <span className="text-sm text-emerald-400 font-medium">Broadcast Compliant</span>
        </div>
      ) : (
        <div className="flex-1 overflow-auto">
          <div className="rounded-lg border border-zinc-800/60 overflow-hidden">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-zinc-900">
                <tr className="border-b border-zinc-800/60">
                  <th className="px-3 py-2 text-left text-zinc-500 font-medium">Cue</th>
                  <th className="px-3 py-2 text-left text-zinc-500 font-medium">Issue</th>
                  <th className="px-3 py-2 text-left text-zinc-500 font-medium">Detail</th>
                  <th className="px-3 py-2 w-6"></th>
                </tr>
              </thead>
              <tbody>
                {qc.issues.map((issue, i) => {
                  const cueNum = (issue.cue ?? issue.cueIndex ?? i);
                  const sev = SEVERITY[issue.type] || "amber";
                  const colorClass = sev === "red" ? "text-red-400" : sev === "blue" ? "text-blue-400" : "text-amber-400";
                  const dotClass = sev === "red" ? "bg-red-500" : sev === "blue" ? "bg-blue-500" : "bg-amber-500";
                  return (
                    <tr key={i} className="border-b border-zinc-800/30 hover:bg-zinc-800/20 cursor-pointer transition-colors" onClick={() => onJumpToCue(cueNum)}>
                      <td className="px-3 py-2 text-zinc-300 font-mono">{cueNum + 1}</td>
                      <td className="px-3 py-2">
                        <span className={`flex items-center gap-1.5 ${colorClass} text-[11px] font-medium`}>
                          <span className={`w-1.5 h-1.5 rounded-full ${dotClass} flex-shrink-0`} />
                          {ISSUE_LABELS[issue.type] || issue.type}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-zinc-500 text-[10px] max-w-[120px] truncate">{typeof issue.value !== "undefined" ? String(issue.value) : "-"}</td>
                      <td className="px-3 py-2">
                        <ArrowRight className="w-3 h-3 text-zinc-600" />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}