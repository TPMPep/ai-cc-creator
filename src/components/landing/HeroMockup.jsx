import React from "react";
import { Play, CheckCircle2 } from "lucide-react";

export default function HeroMockup() {
  return (
    <div className="relative rounded-xl border border-zinc-800 bg-zinc-900/50 overflow-hidden shadow-2xl shadow-blue-500/5">
      {/* Mock video player */}
      <div className="aspect-video bg-zinc-900 relative flex items-center justify-center">
        <div className="absolute inset-0 bg-gradient-to-br from-zinc-800/30 to-zinc-900/80" />
        <div className="relative z-10 w-16 h-16 rounded-full bg-blue-600/20 border border-blue-500/30 flex items-center justify-center">
          <Play className="w-7 h-7 text-blue-400 ml-1" />
        </div>
        {/* Mock caption overlay */}
        <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-10">
          <div className="bg-black/75 backdrop-blur-sm rounded-md px-4 py-2 border border-zinc-700/50">
            <p className="text-white text-sm font-medium text-center">Welcome to the broadcast — this is</p>
            <p className="text-white text-sm font-medium text-center">your caption preview overlay.</p>
          </div>
        </div>
        {/* Timecode bar */}
        <div className="absolute bottom-0 left-0 right-0 h-1 bg-zinc-800">
          <div className="h-full w-1/3 bg-blue-500 rounded-r-full" />
        </div>
      </div>
      {/* Mock cue list */}
      <div className="border-t border-zinc-800 p-3 space-y-1.5">
        <div className="flex items-center gap-3 px-2.5 py-1.5 rounded-md bg-blue-600/10 border border-blue-500/20">
          <span className="font-mono text-[10px] text-blue-400">00:01.000</span>
          <span className="text-xs text-zinc-300 flex-1 truncate">Welcome to the broadcast — this is</span>
          <span className="text-[10px] text-zinc-600">A</span>
        </div>
        <div className="flex items-center gap-3 px-2.5 py-1.5 rounded-md">
          <span className="font-mono text-[10px] text-zinc-600">00:03.800</span>
          <span className="text-xs text-zinc-500 flex-1 truncate">your caption preview overlay.</span>
          <span className="text-[10px] text-zinc-600">A</span>
        </div>
        <div className="flex items-center gap-3 px-2.5 py-1.5 rounded-md">
          <span className="font-mono text-[10px] text-zinc-600">00:06.200</span>
          <span className="text-xs text-zinc-500 flex-1 truncate">Let's review the QC report now.</span>
          <span className="text-[10px] text-zinc-600">B</span>
        </div>
      </div>
      {/* Mock QC bar */}
      <div className="border-t border-zinc-800 px-3 py-2 flex items-center gap-2">
        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
        <span className="text-[11px] text-emerald-400 font-medium">QC Passed — 0 issues</span>
      </div>
    </div>
  );
}