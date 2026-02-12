import React from "react";
import { CheckCircle2, AlertTriangle, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function QCPanel({ qc, onJumpToCue }) {
  if (!qc) return null;

  const issuesCount = qc.issuesCount || 0;

  return (
    <div className="space-y-3 h-full flex flex-col">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold text-zinc-400 uppercase tracking-wide">QC Issues</h3>
        {issuesCount > 0 && (
          <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-400 font-medium">{issuesCount}</span>
        )}
      </div>
      
      {issuesCount === 0 ? (
        <div className="flex items-center gap-2 p-3 rounded-lg bg-emerald-600/5 border border-emerald-500/10">
          <CheckCircle2 className="w-4 h-4 text-emerald-400" />
          <span className="text-sm text-emerald-400 font-medium">Broadcast Compliant</span>
        </div>
      ) : (
        <div className="flex-1 overflow-auto">
          {qc.issues && qc.issues.length > 0 && (
            <div className="rounded-lg border border-zinc-800/60 overflow-hidden">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-zinc-900">
                  <tr className="border-b border-zinc-800/60">
                    <th className="px-3 py-2 text-left text-zinc-500 font-medium">Cue #</th>
                    <th className="px-3 py-2 text-left text-zinc-500 font-medium">Issue</th>
                    <th className="px-3 py-2 text-left text-zinc-500 font-medium">Value</th>
                    <th className="px-3 py-2 w-8"></th>
                  </tr>
                </thead>
                <tbody>
                  {qc.issues.map((issue, i) => (
                    <tr key={i} className="border-b border-zinc-800/30 hover:bg-zinc-800/20 cursor-pointer" onClick={() => onJumpToCue(issue.cue ?? issue.cueIndex ?? i)}>
                      <td className="px-3 py-2 text-zinc-300 font-mono">{(issue.cue ?? issue.cueIndex ?? i) + 1}</td>
                      <td className="px-3 py-2 text-amber-400 text-[11px]">{issue.type}</td>
                      <td className="px-3 py-2 text-zinc-400 text-[10px]">{typeof issue.value !== "undefined" ? String(issue.value) : "-"}</td>
                      <td className="px-3 py-2">
                        <ArrowRight className="w-3 h-3 text-zinc-600" />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}