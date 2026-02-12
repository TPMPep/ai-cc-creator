import React, { useEffect, useMemo, useRef } from "react";

function formatTC(ms) {
  if (ms == null) return "—";
  const total = Math.max(0, Number(ms));
  const h = Math.floor(total / 3600000);
  const m = Math.floor((total % 3600000) / 60000);
  const s = Math.floor((total % 60000) / 1000);
  const mm = Math.floor(total % 1000);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(mm).padStart(3, "0")}`;
}

export default function CueList({
  cues = [],
  currentTimeMs = 0,
  onSeek,
  showSpeaker = true,
}) {
  const [autoFollow, setAutoFollow] = React.useState(true);
  const listRef = useRef(null);

  const rows = useMemo(() => {
    return (cues || []).map((c, idx) => {
      const speaker = c?.speaker ?? "";
      const rawText = (c?.text ?? "").toString();
      // Format text with speaker in brackets if present
      const displayText = speaker ? `[${speaker.toUpperCase()}] ${rawText}` : rawText;
      
      return {
        idx,
        number: idx + 1,
        start: c?.start ?? 0,
        end: c?.end ?? 0,
        speaker,
        text: displayText,
      };
    });
  }, [cues]);

  const activeCueIndex = useMemo(() => {
    return rows.findIndex(r => currentTimeMs >= r.start && currentTimeMs <= r.end);
  }, [rows, currentTimeMs]);

  useEffect(() => {
    if (!autoFollow) return;
    if (activeCueIndex === -1) return;
    const el = document.getElementById(`cue-row-${activeCueIndex}`);
    if (!el) return;

    // Keep the active row comfortably in view
    el.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [activeCueIndex, autoFollow]);

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-950/60 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800">
        <div className="text-xs tracking-widest text-zinc-400">
          CUES ({rows.length})
        </div>

        <div className="flex items-center gap-3">
          <div className="text-xs text-zinc-500">Auto-follow</div>
          <button
            type="button"
            onClick={() => setAutoFollow(!autoFollow)}
            className={[
              "relative inline-flex h-6 w-11 items-center rounded-full transition",
              autoFollow ? "bg-blue-600" : "bg-zinc-700",
            ].join(" ")}
            aria-label="Toggle auto-follow"
          >
            <span
              className={[
                "inline-block h-5 w-5 transform rounded-full bg-white transition",
                autoFollow ? "translate-x-5" : "translate-x-1",
              ].join(" ")}
            />
          </button>
        </div>
      </div>

      {/* Column header */}
      <div className="grid grid-cols-[56px_120px_120px_1fr] gap-3 px-4 py-2 border-b border-zinc-800 text-[11px] font-semibold text-zinc-500 bg-zinc-900/50">
        <div className="text-zinc-500">NO.</div>
        <div className="text-zinc-500">TC IN</div>
        <div className="text-zinc-500">TC OUT</div>
        <div className="text-zinc-500">TEXT</div>
      </div>

      {/* Rows */}
      <div ref={listRef} className="max-h-[520px] overflow-auto">
        {rows.map((r) => {
          const isActive = r.idx === activeCueIndex;

          return (
            <button
              key={r.idx}
              id={`cue-row-${r.idx}`}
              type="button"
              onClick={() => onSeek?.(r.start / 1000)}
              className={[
                "w-full text-left px-4 py-2 border-b border-zinc-900",
                "grid grid-cols-[56px_120px_120px_1fr] gap-3 items-start",
                "hover:bg-zinc-900/50 transition",
                isActive ? "bg-blue-500/10" : "",
              ].join(" ")}
            >
              <div className="text-xs text-zinc-400 tabular-nums">
                {r.number}
              </div>

              <div className="text-xs text-zinc-300 tabular-nums">
                {formatTC(r.start)}
              </div>

              <div className="text-xs text-zinc-300 tabular-nums">
                {formatTC(r.end)}
              </div>

              <div className="min-w-0">
                <div className="text-sm text-zinc-100 whitespace-pre-wrap leading-5 font-mono">
                  {r.text || "—"}
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}