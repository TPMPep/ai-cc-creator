import React, { useRef, useEffect, useState } from "react";
import { formatMs } from "../shared/TimeDisplay";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";

export default function CueList({ cues, currentTimeMs, onSeek }) {
  const [autoFollow, setAutoFollow] = useState(true);
  const listRef = useRef(null);
  const activeRef = useRef(null);

  const activeCueIndex = cues?.findIndex((c) => c.start <= currentTimeMs && currentTimeMs <= c.end) ?? -1;

  useEffect(() => {
    if (!autoFollow || !activeRef.current || !listRef.current) return;
    const container = listRef.current;
    const row = activeRef.current;
    const containerTop = container.scrollTop;
    const containerBottom = containerTop + container.clientHeight;
    const rowTop = row.offsetTop;
    const rowBottom = rowTop + row.offsetHeight;
    if (rowTop < containerTop || rowBottom > containerBottom) {
      container.scrollTop = rowTop - container.clientHeight / 2 + row.offsetHeight / 2;
    }
  }, [activeCueIndex, autoFollow]);

  if (!cues || cues.length === 0) return null;

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-zinc-800/60">
        <h3 className="text-xs font-semibold text-zinc-400 uppercase tracking-wide">Cues ({cues.length})</h3>
        <div className="flex items-center gap-2">
          <Label className="text-[10px] text-zinc-600">Auto-follow</Label>
          <Switch checked={autoFollow} onCheckedChange={setAutoFollow} className="data-[state=checked]:bg-blue-600 h-4 w-7" />
        </div>
      </div>
      <div ref={listRef} className="flex-1 overflow-y-auto">
        {cues.map((cue, i) => {
          const isActive = i === activeCueIndex;
          return (
            <div
              key={i}
              ref={isActive ? activeRef : null}
              onClick={() => onSeek(cue.start / 1000)}
              className={`px-4 py-2.5 border-b border-zinc-800/30 cursor-pointer transition-colors ${
                isActive
                  ? "bg-blue-600/10 border-l-2 border-l-blue-500"
                  : "hover:bg-zinc-800/30 border-l-2 border-l-transparent"
              }`}
            >
              <div className="flex items-center gap-3 mb-1">
                <span className={`font-mono text-[10px] ${isActive ? "text-blue-400" : "text-zinc-600"}`}>
                  {formatMs(cue.start)}
                </span>
                <span className="text-zinc-700 text-[10px]">→</span>
                <span className={`font-mono text-[10px] ${isActive ? "text-blue-400" : "text-zinc-600"}`}>
                  {formatMs(cue.end)}
                </span>
                {cue.speaker && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-500 font-medium ml-auto">
                    {cue.speaker}
                  </span>
                )}
              </div>
              <p className={`text-xs leading-relaxed ${isActive ? "text-zinc-200" : "text-zinc-400"}`}>
                {cue.text}
              </p>
            </div>
          );
        })}
      </div>
    </div>
  );
}