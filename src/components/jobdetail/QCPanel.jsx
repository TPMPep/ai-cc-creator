import React from "react";
import { CheckCircle2, AlertTriangle, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function QCPanel({ qc, onJumpToCue }) {
  if (!qc) return null;

  const issuesCount = qc.issuesCount || 0;

  return (
    <div className="space-y-3">
      <h3 className="text-xs font-semibold text-zinc-400 uppercase tracking-wide">QC Report</h3>
      {issuesCount === 0 ? (
        <div className="flex items-center gap-2 p-3 rounded-lg bg-emerald-600/5 border border-emerald-500/10">
          <CheckCircle2 className="w-4 h-4 text-emerald-400" />
          <span className="text-sm text-emerald-400 font-medium">No issues found</span>
        </div>
      ) : (
        <div className="space-y-2">
          <div className="flex items-center gap-2 p-3 rounded-lg bg-amber-600/5 border border-amber-500/10">
            <AlertTriangle className="w-4 h-4 text-amber-400" />
            <span className="text-sm text-amber-400 font-medium">{issuesCount} issue{issuesCount !== 1 ? "s" : ""} found</span>
          </div>
          {qc.issues && qc.issues.length > 0 && (
            <div className="rounded-lg border border-zinc-800/60 overflow-hidden">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-zinc-800/60 bg-zinc-900/40">
                    <th className="px-3 py-2 text-left text-zinc-500 font-medium">Cue</th>
                    <th className="px-3 py-2 text-left text-zinc-500 font-medium">Type</th>
                    <th className="px-3 py-2 text-left text-zinc-500 font-medium">Value</th>
                    <th className="px-3 py-2 w-8"></th>
                  </tr>
                </thead>
                <tbody>
                  {qc.issues.map((issue, i) => (
                    <tr key={i} className="border-b border-zinc-800/30 hover:bg-zinc-800/20">
                      <td className="px-3 py-2 text-zinc-300 font-mono">{issue.cue ?? issue.cueIndex ?? i}</td>
                      <td className="px-3 py-2 text-amber-400">{issue.type}</td>
                      <td className="px-3 py-2 text-zinc-400">{typeof issue.value !== "undefined" ? String(issue.value) : "-"}</td>
                      <td className="px-3 py-2">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-5 w-5 p-0 text-zinc-600 hover:text-blue-400"
                          onClick={() => onJumpToCue(issue.cue ?? issue.cueIndex ?? i)}
                        >
                          <ArrowRight className="w-3 h-3" />
                        </Button>
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