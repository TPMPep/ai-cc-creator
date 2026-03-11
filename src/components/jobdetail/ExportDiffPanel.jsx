import React, { useState, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { X, ArrowRight } from "lucide-react";

function diffWord(a, b) {
  // Simple word-level diff: returns segments with type: same, added, removed
  const wordsA = a.split(/\s+/).filter(Boolean);
  const wordsB = b.split(/\s+/).filter(Boolean);
  
  // LCS-based diff
  const m = wordsA.length;
  const n = wordsB.length;
  const dp = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = wordsA[i - 1] === wordsB[j - 1]
        ? dp[i - 1][j - 1] + 1
        : Math.max(dp[i - 1][j], dp[i][j - 1]);
    }
  }

  const result = [];
  let i = m, j = n;
  const stack = [];
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && wordsA[i - 1] === wordsB[j - 1]) {
      stack.push({ type: "same", text: wordsA[i - 1] });
      i--; j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      stack.push({ type: "added", text: wordsB[j - 1] });
      j--;
    } else {
      stack.push({ type: "removed", text: wordsA[i - 1] });
      i--;
    }
  }
  stack.reverse();
  return stack;
}

function DiffLine({ rawText, editedText }) {
  const segments = diffWord(rawText, editedText);
  const hasChanges = segments.some(s => s.type !== "same");
  if (!hasChanges) return null;

  return (
    <div className="flex gap-3 items-start py-1.5 border-b border-zinc-800/30 text-[11px]">
      <div className="flex-1 min-w-0">
        {segments.map((seg, i) => (
          <span
            key={i}
            className={
              seg.type === "removed"
                ? "bg-red-500/20 text-red-300 line-through px-0.5 rounded"
                : seg.type === "added"
                ? "invisible h-0 overflow-hidden inline-block w-0"
                : "text-zinc-400"
            }
          >
            {seg.type !== "added" && (seg.text + " ")}
          </span>
        ))}
      </div>
      <ArrowRight className="w-3 h-3 text-zinc-600 flex-shrink-0 mt-0.5" />
      <div className="flex-1 min-w-0">
        {segments.map((seg, i) => (
          <span
            key={i}
            className={
              seg.type === "added"
                ? "bg-emerald-500/20 text-emerald-300 px-0.5 rounded"
                : seg.type === "removed"
                ? "invisible h-0 overflow-hidden inline-block w-0"
                : "text-zinc-400"
            }
          >
            {seg.type !== "removed" && (seg.text + " ")}
          </span>
        ))}
      </div>
    </div>
  );
}

export default function ExportDiffPanel({ cues, rawCues, onClose }) {
  const diffs = useMemo(() => {
    if (!rawCues || !rawCues.length || !cues || !cues.length) return [];
    
    const results = [];
    for (const cue of cues) {
      // Find closest raw cue by start time
      let best = null;
      let bestDiff = Infinity;
      for (const raw of rawCues) {
        const d = Math.abs(raw.start - cue.start);
        if (d < bestDiff) { best = raw; bestDiff = d; }
      }
      if (!best || bestDiff > 3000) continue;
      
      const rawNorm = best.text.replace(/\s+/g, " ").trim();
      const editNorm = cue.text.replace(/\s+/g, " ").trim();
      if (rawNorm !== editNorm) {
        results.push({ cueIndex: cues.indexOf(cue), rawText: rawNorm, editedText: editNorm, startMs: cue.start });
      }
    }
    return results;
  }, [cues, rawCues]);

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-lg overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 border-b border-zinc-800">
        <div className="flex items-center gap-2">
          <h3 className="text-xs font-semibold text-zinc-300">Edit Diff</h3>
          <span className="text-[10px] text-zinc-500">{diffs.length} changes</span>
        </div>
        <Button variant="ghost" size="sm" onClick={onClose} className="h-6 w-6 p-0 text-zinc-500 hover:text-white">
          <X className="w-3 h-3" />
        </Button>
      </div>
      <div className="max-h-[300px] overflow-auto px-3 py-1">
        {diffs.length === 0 ? (
          <p className="text-zinc-500 text-xs py-4 text-center">No differences from raw transcript</p>
        ) : (
          <div className="flex gap-3 text-[9px] text-zinc-600 uppercase tracking-wide py-1 border-b border-zinc-800/50">
            <span className="flex-1">Raw (AAI)</span>
            <span className="w-3" />
            <span className="flex-1">Edited</span>
          </div>
        )}
        {diffs.map((d, i) => (
          <DiffLine key={i} rawText={d.rawText} editedText={d.editedText} />
        ))}
      </div>
    </div>
  );
}