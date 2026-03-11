import React from "react";
import { AlertTriangle } from "lucide-react";

const msToShortTC = (ms) => {
  const m = Math.floor(ms / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const mil = Math.floor((ms % 1000) / 10);
  return `${String(m).padStart(2,"0")}:${String(s).padStart(2,"0")}.${String(mil).padStart(2,"0")}`;
};

const SPEAKER_OPTIONS = [
  { value: "none", label: "\u2014" },
  { value: "A", label: "A" },
  { value: "B", label: "B" },
  { value: "C", label: "C" },
  { value: "D", label: "D" },
  { value: "E", label: "E" },
];

const TYPE_OPTIONS = [
  { value: "dialogue", label: "DL" },
  { value: "sdh", label: "SDH" },
  { value: "music", label: "MUS" },
  { value: "foreign_language", label: "FOR" },
  { value: "sound_effect", label: "SFX" },
];

function CharCounts({ text }) {
  const lines = text.split("\n");
  return (
    <div className="flex flex-col items-center gap-0">
      {lines.map((line, i) => (
        <span key={i} className={`font-mono text-[10px] leading-tight ${line.length > 32 ? "text-red-400 font-bold" : "text-zinc-500"}`}>
          {line.length}
        </span>
      ))}
    </div>
  );
}

function RawCharCounts({ text }) {
  if (!text) return <span className="text-zinc-700">{"\u2014"}</span>;
  const lines = text.split("\n");
  return (
    <div className="flex flex-col items-center gap-0">
      {lines.map((line, i) => (
        <span key={i} className={`font-mono text-[10px] leading-tight ${line.length > 32 ? "text-red-400 font-bold" : "text-zinc-500"}`}>
          {line.length}
        </span>
      ))}
    </div>
  );
}

function getCPS(text, durationMs) {
  if (durationMs <= 0) return 0;
  const totalChars = text.replace(/\n/g, "").length;
  return totalChars / (durationMs / 1000);
}

function ReadingSpeedBar({ cps }) {
  const pct = Math.min((cps / 25) * 100, 100);
  let color = "bg-emerald-500";
  if (cps > 20) color = "bg-red-500";
  else if (cps > 15) color = "bg-amber-500";
  return (
    <div className="w-full h-1 bg-zinc-800 rounded-full overflow-hidden" title={cps.toFixed(1) + " CPS"}>
      <div className={`h-full ${color} transition-all`} style={{ width: pct + "%" }} />
    </div>
  );
}

const CaptionEditorRow = React.forwardRef(function CaptionEditorRowInner(props, ref) {
  const {
    cue, idx, isActive, nextCue, selected, onToggleSelect,
    editingCell, editValue, setEditValue,
    onStartEdit, onCommitEdit, onKeyDown,
    onCellEdit, onSeek,
    showRawCol, rawMatch,
  } = props;

  const duration = cue.end - cue.start;
  const durationSec = (duration / 1000).toFixed(1);
  const lines = cue.text.split("\n");
  const anyLineOver32 = lines.some(function(l) { return l.length > 32; });
  const isSDH = cue.kind === "sdh";
  const cps = getCPS(cue.text, duration);

  const gapMs = nextCue ? nextCue.start - cue.end : null;
  const gapTooShort = gapMs !== null && gapMs < 0;
  const gapWarning = gapMs !== null && gapMs > 0 && gapMs < 80;

  const isEditingField = function(field) {
    return editingCell && editingCell.cueIndex === idx && editingCell.field === field;
  };

  let rowClass = "border-b border-zinc-800/30 hover:bg-zinc-800/20 transition-colors";
  if (isActive) rowClass += " bg-blue-600/10";
  if (anyLineOver32) rowClass += " border-l-2 border-l-red-500/60";
  if (isSDH) rowClass += " bg-blue-950/20";
  if (selected) rowClass += " bg-purple-600/10";

  return (
    <React.Fragment>
      <tr ref={ref} className={rowClass}>
        <td className="px-1 py-1 text-zinc-500 font-mono text-center">
          <div className="flex items-center gap-0.5">
            <input
              type="checkbox"
              checked={selected}
              onChange={function() { onToggleSelect(idx); }}
              className="w-3 h-3 accent-purple-500 cursor-pointer"
              onClick={function(e) { e.stopPropagation(); }}
            />
            <span className="cursor-pointer text-[10px]" onClick={function() { onSeek(cue.start); }}>{idx + 1}</span>
          </div>
        </td>

        <td className="px-1 py-1 text-zinc-300 font-mono">
          {isEditingField("start") ? (
            <input
              type="text"
              value={editValue}
              onChange={function(e) { setEditValue(e.target.value); }}
              onBlur={onCommitEdit}
              onKeyDown={onKeyDown}
              className="w-full bg-zinc-800 border border-blue-500 rounded px-1 py-0.5 text-[10px] text-white font-mono focus:outline-none"
              autoFocus
            />
          ) : (
            <div
              onDoubleClick={function() { onStartEdit(idx, "start"); }}
              className="cursor-pointer hover:bg-zinc-800/50 rounded px-1 py-0.5 text-[10px]"
              onClick={function() { onSeek(cue.start); }}
            >
              {msToShortTC(cue.start)}
            </div>
          )}
        </td>

        <td className="px-1 py-1 text-zinc-300 font-mono">
          {isEditingField("end") ? (
            <input
              type="text"
              value={editValue}
              onChange={function(e) { setEditValue(e.target.value); }}
              onBlur={onCommitEdit}
              onKeyDown={onKeyDown}
              className="w-full bg-zinc-800 border border-blue-500 rounded px-1 py-0.5 text-[10px] text-white font-mono focus:outline-none"
              autoFocus
            />
          ) : (
            <div
              onDoubleClick={function() { onStartEdit(idx, "end"); }}
              className="cursor-pointer hover:bg-zinc-800/50 rounded px-1 py-0.5 text-[10px]"
            >
              {msToShortTC(cue.end)}
            </div>
          )}
        </td>

        <td className="px-1 py-1 font-mono text-zinc-500 text-[10px]">{durationSec}s</td>

        <td className="px-1 py-1" onClick={function(e) { e.stopPropagation(); }}>
          <select
            value={cue.speaker || "none"}
            onChange={function(e) { e.stopPropagation(); onCellEdit(idx, "speaker", e.target.value === "none" ? null : e.target.value); }}
            className="w-full h-6 text-[11px] bg-zinc-800 border border-zinc-700 rounded text-zinc-200 focus:outline-none focus:border-blue-500 px-1 cursor-pointer appearance-auto"
          >
            {SPEAKER_OPTIONS.map(function(o) { return <option key={o.value} value={o.value}>{o.label}</option>; })}
          </select>
        </td>

        <td className="px-1 py-1" onClick={function(e) { e.stopPropagation(); }}>
          <select
            value={cue.kind || "dialogue"}
            onChange={function(e) { e.stopPropagation(); onCellEdit(idx, "type", e.target.value); }}
            className="w-full h-6 text-[11px] bg-zinc-800 border border-zinc-700 rounded text-zinc-200 focus:outline-none focus:border-blue-500 px-1 cursor-pointer appearance-auto"
          >
            {TYPE_OPTIONS.map(function(o) { return <option key={o.value} value={o.value}>{o.label}</option>; })}
          </select>
        </td>

        <td className="px-1 py-1 text-center">
          <span className={"font-mono text-[10px] " + (cps > 20 ? "text-red-400 font-bold" : cps > 15 ? "text-amber-400" : "text-zinc-500")}>
            {cps.toFixed(0)}
          </span>
        </td>

        <td className="px-1 py-1 text-center">
          <CharCounts text={cue.text} />
        </td>

        <td className="px-1.5 py-1">
          {isEditingField("text") ? (
            <textarea
              value={editValue}
              onChange={function(e) { setEditValue(e.target.value); }}
              onBlur={onCommitEdit}
              onKeyDown={function(e) { if (e.key === "Escape") onCommitEdit(); }}
              className="w-full bg-zinc-800 border border-blue-500 rounded px-1.5 py-1 text-[11px] text-white focus:outline-none min-h-[50px]"
              autoFocus
            />
          ) : (
            <div
              onDoubleClick={function() { onStartEdit(idx, "text"); }}
              className="cursor-pointer hover:bg-zinc-800/50 rounded px-1.5 py-0.5 text-zinc-200 whitespace-pre-wrap text-[11px] leading-relaxed"
            >
              {cue.text}
              {anyLineOver32 && <AlertTriangle className="inline w-3 h-3 ml-1.5 text-red-400" />}
            </div>
          )}
          <div className="mt-0.5">
            <ReadingSpeedBar cps={cps} />
          </div>
        </td>

        {showRawCol && (
          <React.Fragment>
            <td className="px-1 py-1 text-center">
              <RawCharCounts text={rawMatch ? rawMatch.text : null} />
            </td>
            <td className="px-1.5 py-1 text-zinc-200 text-[11px] whitespace-pre-wrap leading-relaxed">
              {rawMatch ? rawMatch.text : <span className="text-zinc-700 italic">{"\u2014"}</span>}
            </td>
          </React.Fragment>
        )}
      </tr>
      {gapMs !== null && (gapTooShort || gapWarning) && (
        <tr className="border-0">
          <td colSpan={showRawCol ? 11 : 9} className="px-0 py-0">
            <div
              className={"h-[2px] mx-8 " + (gapTooShort ? "bg-red-500" : "bg-amber-500/50")}
              title={gapTooShort ? "Overlap: " + Math.abs(gapMs) + "ms" : "Gap: " + gapMs + "ms (< 80ms)"}
            />
          </td>
        </tr>
      )}
    </React.Fragment>
  );
});

export default CaptionEditorRow;