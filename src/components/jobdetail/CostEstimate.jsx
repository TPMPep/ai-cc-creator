import React from "react";
import { DollarSign } from "lucide-react";

function fmt(val) {
  if (val == null) return "—";
  if (val < 0.01) return "<$0.01";
  return "$" + val.toFixed(4);
}

function fmtTokens(n) {
  if (!n) return "0";
  if (n >= 1000000) return (n / 1000000).toFixed(1) + "M";
  if (n >= 1000) return (n / 1000).toFixed(1) + "K";
  return String(n);
}

export default function CostEstimate({ costEstimate }) {
  if (!costEstimate) return null;

  const { assemblyai, openai, total, audioDurationSec, openaiInputTokens, openaiOutputTokens } = costEstimate;

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1.5 mb-2">
        <DollarSign className="w-3.5 h-3.5 text-zinc-500" />
        <span className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">Cost Estimate</span>
      </div>

      <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
        <span className="text-zinc-500">AssemblyAI</span>
        <span className="text-zinc-300 text-right font-mono">{fmt(assemblyai)}</span>

        {audioDurationSec > 0 && (
          <>
            <span className="text-zinc-600 pl-2">Duration</span>
            <span className="text-zinc-500 text-right font-mono">{(audioDurationSec / 60).toFixed(1)} min</span>
            <span className="text-zinc-600 pl-2">Rate</span>
            <span className="text-zinc-500 text-right font-mono">$0.0108/min</span>
          </>
        )}

        <span className="text-zinc-500">OpenAI GPT-4o</span>
        <span className="text-zinc-300 text-right font-mono">{fmt(openai)}</span>

        {(openaiInputTokens > 0 || openaiOutputTokens > 0) && (
          <>
            <span className="text-zinc-600 pl-2">Tokens</span>
            <span className="text-zinc-500 text-right font-mono">{fmtTokens(openaiInputTokens)} in / {fmtTokens(openaiOutputTokens)} out</span>
          </>
        )}

        <div className="col-span-2 border-t border-zinc-800 my-1" />

        <span className="text-zinc-400 font-medium">Total</span>
        <span className="text-emerald-400 text-right font-mono font-medium">{fmt(total)}</span>
      </div>
    </div>
  );
}