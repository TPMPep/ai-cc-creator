import React, { useRef, useEffect, useState } from "react";
import { formatMs } from "../shared/TimeDisplay";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { FileText, User } from "lucide-react";

export default function SourceTranscriptPanel({ utterances, currentTimeMs, onSeek }) {
  const [autoFollow, setAutoFollow] = useState(true);
  const listRef = useRef(null);
  const activeRef = useRef(null);

  const activeIndex = utterances?.findIndex(
    (u) => u.start <= currentTimeMs && currentTimeMs <= u.end
  ) ?? -1;

  useEffect(() => {
    if (!autoFollow || !activeRef.current || !listRef.current) return;
    const container = listRef.current;
    const row = activeRef.current;
    const cTop = container.scrollTop;
    const cBot = cTop + container.clientHeight;
    const rTop = row.offsetTop;
    const rBot = rTop + row.offsetHeight;
    if (rTop < cTop || rBot > cBot) {
      container.scrollTop = rTop - container.clientHeight / 2 + row.offsetHeight / 2;
    }
  }, [activeIndex, autoFollow]);

  if (!utterances || utterances.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full py-16 text-zinc-500">
        <FileText className="w-8 h-8 mb-3 text-zinc-600" />
        <p className="text-sm">Raw transcript will appear here</p>
        <p className="text-xs text-zinc-600 mt-1">Waiting for transcription…</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-zinc-800/60">
        <h3 className="text-xs font-semibold text-zinc-400 uppercase tracking-wide">
          Source Transcript ({utterances.length} utterances)
        </h3>
        <div className="flex items-center gap-2">
          <Label className="text-[10px] text-zinc-600">Follow</Label>
          <Switch
            checked={autoFollow}
            onCheckedChange={setAutoFollow}
            className="data-[state=checked]:bg-blue-600 h-4 w-7"
          />
        </div>
      </div>
      <div ref={listRef} className="flex-1 overflow-y-auto">
        {utterances.map((utt, i) => {
          const isActive = i === activeIndex;
          return (
            <div
              key={i}
              ref={isActive ? activeRef : null}
              onClick={() => onSeek(utt.start / 1000)}
              className={`px-4 py-3 border-b border-zinc-800/30 cursor-pointer transition-colors ${
                isActive
                  ? "bg-blue-600/10 border-l-2 border-l-blue-500"
                  : "hover:bg-zinc-800/30 border-l-2 border-l-transparent"
              }`}
            >
              <div className="flex items-center gap-3 mb-1.5">
                <span className={`font-mono text-[10px] ${isActive ? "text-blue-400" : "text-zinc-600"}`}>
                  {formatMs(utt.start)}
                </span>
                <span className="text-zinc-700 text-[10px]">→</span>
                <span className={`font-mono text-[10px] ${isActive ? "text-blue-400" : "text-zinc-600"}`}>
                  {formatMs(utt.end)}
                </span>
                {utt.speaker && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-500 font-medium ml-auto flex items-center gap-1">
                    <User className="w-2.5 h-2.5" />
                    {utt.speaker}
                  </span>
                )}
              </div>
              <p className={`text-xs leading-relaxed ${isActive ? "text-zinc-200" : "text-zinc-400"}`}>
                {utt.text}
              </p>
            </div>
          );
        })}
      </div>
    </div>
  );
}