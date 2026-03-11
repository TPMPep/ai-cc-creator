import React, { useState, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { AlertTriangle, Volume2 } from "lucide-react";
import { base44 } from "@/api/base44Client";
import { toast } from "sonner";

const msToTimecode = (ms) => {
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const mil = ms % 1000;
  return `${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}:${String(s).padStart(2,"0")}.${String(mil).padStart(3,"0")}`;
};

const timecodeToMs = (tc) => {
  const parts = tc.split(":");
  if (parts.length !== 3) return 0;
  const [h, m, rest] = parts;
  const [s, mil] = rest.split(".");
  return (parseInt(h) * 3600 + parseInt(m) * 60 + parseInt(s)) * 1000 + parseInt(mil || 0);
};

const msToShortTC = (ms) => {
  const m = Math.floor(ms / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const mil = Math.floor((ms % 1000) / 10);
  return `${String(m).padStart(2,"0")}:${String(s).padStart(2,"0")}.${String(mil).padStart(2,"0")}`;
};

// Parse raw SRT string into array of {start, end, text}
function parseRawSRT(srtText) {
  if (!srtText) return [];
  const blocks = srtText.trim().split(/\n\n+/);
  const cues = [];
  for (const block of blocks) {
    const lines = block.split("\n");
    const tcLine = lines.find(l => l.includes("-->"));
    if (!tcLine) continue;
    const [startStr, endStr] = tcLine.split("-->").map(s => s.trim());
    const parseSrtTC = (tc) => {
      const [time, ms] = tc.split(",");
      const [h, m, s] = time.split(":");
      return parseInt(h)*3600000 + parseInt(m)*60000 + parseInt(s)*1000 + parseInt(ms || 0);
    };
    const start = parseSrtTC(startStr);
    const end = parseSrtTC(endStr);
    const textIdx = lines.indexOf(tcLine);
    const text = lines.slice(textIdx + 1).join("\n");
    cues.push({ start, end, text });
  }
  return cues;
}

// Find matching raw cue by closest start time
function findRawMatch(rawCues, start) {
  if (!rawCues.length) return null;
  let best = rawCues[0];
  let bestDiff = Math.abs(rawCues[0].start - start);
  for (let i = 1; i < rawCues.length; i++) {
    const diff = Math.abs(rawCues[i].start - start);
    if (diff < bestDiff) { best = rawCues[i]; bestDiff = diff; }
  }
  return bestDiff < 3000 ? best : null;
}

// Line char counts display
function CharCounts({ text }) {
  const lines = text.split("\n");
  return (
    <div className="flex flex-col gap-0.5">
      {lines.map((line, i) => {
        const len = line.length;
        const over = len > 32;
        return (
          <span key={i} className={`font-mono text-[10px] leading-tight ${over ? "text-red-400 font-bold" : "text-zinc-500"}`}>
            L{i+1}: {len}
          </span>
        );
      })}
    </div>
  );
}

export default function CaptionEditor({ 
  cues: initialCues, 
  currentTimeMs, 
  videoRef, 
  job,
  onCuesChanged,
  rawSrtText
}) {
  const [cues, setCues] = useState(initialCues || []);
  const [autoFollow, setAutoFollow] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editingCell, setEditingCell] = useState(null);
  const [editValue, setEditValue] = useState("");
  const [showRawCol, setShowRawCol] = useState(false);
  const tableRef = useRef(null);
  const activeRowRef = useRef(null);
  
  const rules = job?.rules || {};
  const rawCues = useRef([]);
  
  useEffect(() => {
    setCues(initialCues || []);
  }, [initialCues]);

  useEffect(() => {
    if (rawSrtText) {
      rawCues.current = parseRawSRT(rawSrtText);
      if (rawCues.current.length > 0) setShowRawCol(true);
    }
  }, [rawSrtText]);
  
  useEffect(() => {
    if (!autoFollow || !activeRowRef.current || !tableRef.current) return;
    const container = tableRef.current;
    const row = activeRowRef.current;
    const cTop = container.scrollTop;
    const cBot = cTop + container.clientHeight;
    const rTop = row.offsetTop;
    const rBot = rTop + row.offsetHeight;
    if (rTop < cTop || rBot > cBot) {
      container.scrollTop = rTop - container.clientHeight / 2 + row.offsetHeight / 2;
    }
  }, [currentTimeMs, autoFollow]);
  
  const activeCueIndex = cues.findIndex(c => c.start <= currentTimeMs && currentTimeMs <= c.end);
  
  const handleSaveCues = async () => {
    setSaving(true);
    const cueChunks = [];
    const cueStr = JSON.stringify(cues);
    for (let i = 0; i < cueStr.length; i += 75000) cueChunks.push(cueStr.slice(i, i + 75000));
    const updatedResult = { ...job.result, cue_chunks: cueChunks };
    delete updatedResult.cues;
    await base44.entities.Job.update(job.id, { result: updatedResult });
    onCuesChanged?.(cues);
    toast.success("Captions saved");
    setSaving(false);
  };
  
  const handleCellEdit = (cueIndex, field, value) => {
    const newCues = [...cues];
    const cue = newCues[cueIndex];
    if (field === "start" || field === "end") {
      const ms = timecodeToMs(value);
      if (field === "start") {
        cue.start = ms;
        if (cueIndex > 0 && cue.start < newCues[cueIndex - 1].end) cue.start = newCues[cueIndex - 1].end + 1;
      } else {
        cue.end = ms;
        if (cue.end <= cue.start) cue.end = cue.start + (rules.minDurationMs || 1000);
        if (cueIndex < newCues.length - 1 && cue.end > newCues[cueIndex + 1].start) cue.end = newCues[cueIndex + 1].start - 1;
      }
    } else if (field === "speaker") {
      cue.speaker = value;
    } else if (field === "type") {
      cue.kind = value;
      if (value !== "dialogue" && !cue.text.startsWith("[")) {
        cue.text = value === "music" ? `[♪ ${cue.text.toUpperCase()} ♪]` : `[${cue.text.toUpperCase()}]`;
      }
    } else if (field === "text") {
      cue.text = value;
    }
    setCues(newCues);
  };
  
  const startEdit = (cueIndex, field) => {
    const cue = cues[cueIndex];
    let value = "";
    if (field === "start") value = msToTimecode(cue.start);
    else if (field === "end") value = msToTimecode(cue.end);
    else if (field === "text") value = cue.text;
    setEditingCell({ cueIndex, field });
    setEditValue(value);
  };
  
  const commitEdit = () => {
    if (!editingCell) return;
    handleCellEdit(editingCell.cueIndex, editingCell.field, editValue);
    setEditingCell(null);
  };
  
  const handleKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey && editingCell?.field !== "text") { e.preventDefault(); commitEdit(); }
    else if (e.key === "Tab") { e.preventDefault(); commitEdit(); }
    else if (e.key === "Escape") { setEditingCell(null); }
  };
  
  const insertSDHCue = () => {
    if (!videoRef.current) return;
    const timeMs = videoRef.current.currentTime * 1000;
    const newCue = { start: timeMs, end: timeMs + 2000, text: "[SOUND EFFECT]", kind: "sdh", speaker: null };
    const insertIndex = cues.findIndex(c => c.start > timeMs);
    const newCues = [...cues];
    if (insertIndex === -1) newCues.push(newCue); else newCues.splice(insertIndex, 0, newCue);
    setCues(newCues);
    toast.success("SDH cue inserted");
  };

  const seekTo = (ms) => {
    if (videoRef.current) videoRef.current.currentTime = ms / 1000;
  };
  
  const SPEAKER_OPTIONS = ["none", "A", "B", "C", "D", "E"];
  const TYPE_OPTIONS = [
    { value: "dialogue", label: "DLG" },
    { value: "sdh", label: "SDH" },
    { value: "music", label: "MUS" },
    { value: "foreign_language", label: "FRN" },
    { value: "sound_effect", label: "SFX" },
  ];

  return (
    <div className="space-y-0">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-3 py-2 bg-zinc-900/50 border-b border-zinc-800">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5">
            <Switch checked={autoFollow} onCheckedChange={setAutoFollow} className="data-[state=checked]:bg-blue-600 scale-75" />
            <Label className="text-[10px] text-zinc-400">Follow</Label>
          </div>
          <span className="text-[10px] text-zinc-600">{cues.length} cues</span>
          {rawCues.current.length > 0 && (
            <div className="flex items-center gap-1.5">
              <Switch checked={showRawCol} onCheckedChange={setShowRawCol} className="data-[state=checked]:bg-amber-600 scale-75" />
              <Label className="text-[10px] text-zinc-400">Raw AAI</Label>
            </div>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={insertSDHCue} className="bg-transparent border-zinc-800 text-zinc-400 hover:bg-zinc-800 hover:text-white text-[10px] h-7 px-2">
            <Volume2 className="w-3 h-3 mr-1" /> SDH
          </Button>
          <Button onClick={handleSaveCues} disabled={saving} size="sm" className="bg-blue-600 hover:bg-blue-700 text-white text-[10px] h-7 px-3">
            {saving ? "Saving..." : "Save"}
          </Button>
        </div>
      </div>
      
      {/* Table */}
      <div ref={tableRef} className="overflow-auto" style={{ maxHeight: "60vh" }}>
        <table className="w-full text-[11px] border-collapse table-fixed">
          <thead className="sticky top-0 z-10 bg-zinc-900 shadow-md">
            <tr className="border-b border-zinc-800">
              <th className="px-1.5 py-1.5 text-left text-zinc-500 font-medium" style={{width:"32px"}}>#</th>
              <th className="px-1.5 py-1.5 text-left text-zinc-500 font-medium" style={{width:"80px"}}>IN</th>
              <th className="px-1.5 py-1.5 text-left text-zinc-500 font-medium" style={{width:"80px"}}>OUT</th>
              <th className="px-1.5 py-1.5 text-left text-zinc-500 font-medium" style={{width:"42px"}}>DUR</th>
              <th className="px-1.5 py-1.5 text-left text-zinc-500 font-medium" style={{width:"48px"}}>SPK</th>
              <th className="px-1.5 py-1.5 text-left text-zinc-500 font-medium" style={{width:"48px"}}>TYPE</th>
              <th className="px-1.5 py-1.5 text-left text-zinc-500 font-medium" style={{width:"40px"}}>CHR</th>
              <th className="px-1.5 py-1.5 text-left text-zinc-500 font-medium">TEXT</th>
              {showRawCol && <th className="px-1.5 py-1.5 text-left text-zinc-500 font-medium" style={{width:"25%"}}>RAW (AAI)</th>}
            </tr>
          </thead>
          <tbody>
            {cues.map((cue, idx) => {
              const isActive = idx === activeCueIndex;
              const duration = cue.end - cue.start;
              const durationSec = (duration / 1000).toFixed(1);
              const lines = cue.text.split("\n");
              const anyLineOver32 = lines.some(l => l.length > 32);
              const isSDH = cue.kind === "sdh";
              const rawMatch = showRawCol ? findRawMatch(rawCues.current, cue.start) : null;
              
              return (
                <tr 
                  key={idx}
                  ref={isActive ? activeRowRef : null}
                  className={`border-b border-zinc-800/30 hover:bg-zinc-800/20 transition-colors ${isActive ? "bg-blue-600/10" : ""} ${anyLineOver32 ? "border-l-2 border-l-red-500/60" : ""} ${isSDH ? "bg-blue-950/20" : ""}`}
                >
                  {/* # */}
                  <td className="px-1.5 py-1 text-zinc-500 font-mono cursor-pointer" onClick={() => seekTo(cue.start)}>{idx + 1}</td>
                  
                  {/* IN */}
                  <td className="px-1.5 py-1 text-zinc-300 font-mono">
                    {editingCell?.cueIndex === idx && editingCell?.field === "start" ? (
                      <input type="text" value={editValue} onChange={(e) => setEditValue(e.target.value)} onBlur={commitEdit} onKeyDown={handleKeyDown}
                        className="w-full bg-zinc-800 border border-blue-500 rounded px-1 py-0.5 text-[10px] text-white font-mono focus:outline-none" autoFocus />
                    ) : (
                      <div onDoubleClick={() => startEdit(idx, "start")} className="cursor-pointer hover:bg-zinc-800/50 rounded px-1 py-0.5 text-[10px]" onClick={() => seekTo(cue.start)}>
                        {msToShortTC(cue.start)}
                      </div>
                    )}
                  </td>
                  
                  {/* OUT */}
                  <td className="px-1.5 py-1 text-zinc-300 font-mono">
                    {editingCell?.cueIndex === idx && editingCell?.field === "end" ? (
                      <input type="text" value={editValue} onChange={(e) => setEditValue(e.target.value)} onBlur={commitEdit} onKeyDown={handleKeyDown}
                        className="w-full bg-zinc-800 border border-blue-500 rounded px-1 py-0.5 text-[10px] text-white font-mono focus:outline-none" autoFocus />
                    ) : (
                      <div onDoubleClick={() => startEdit(idx, "end")} className="cursor-pointer hover:bg-zinc-800/50 rounded px-1 py-0.5 text-[10px]">
                        {msToShortTC(cue.end)}
                      </div>
                    )}
                  </td>
                  
                  {/* DUR */}
                  <td className="px-1.5 py-1 font-mono text-zinc-500 text-[10px]">{durationSec}s</td>
                  
                  {/* SPEAKER - using native select to avoid event issues */}
                  <td className="px-1 py-1" onClick={(e) => e.stopPropagation()}>
                    <select 
                      value={cue.speaker || "none"} 
                      onChange={(e) => handleCellEdit(idx, "speaker", e.target.value === "none" ? null : e.target.value)}
                      className="w-full h-6 text-[10px] bg-zinc-900 border border-zinc-800 rounded text-zinc-300 focus:outline-none focus:border-blue-500 px-0.5"
                    >
                      {SPEAKER_OPTIONS.map(v => <option key={v} value={v}>{v === "none" ? "—" : v}</option>)}
                    </select>
                  </td>
                  
                  {/* TYPE - using native select to avoid event issues */}
                  <td className="px-1 py-1" onClick={(e) => e.stopPropagation()}>
                    <select 
                      value={cue.kind || "dialogue"} 
                      onChange={(e) => handleCellEdit(idx, "type", e.target.value)}
                      className="w-full h-6 text-[10px] bg-zinc-900 border border-zinc-800 rounded text-zinc-300 focus:outline-none focus:border-blue-500 px-0.5"
                    >
                      {TYPE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                  </td>
                  
                  {/* CHAR COUNTS */}
                  <td className="px-1.5 py-1">
                    <CharCounts text={cue.text} />
                  </td>
                  
                  {/* TEXT */}
                  <td className="px-1.5 py-1">
                    {editingCell?.cueIndex === idx && editingCell?.field === "text" ? (
                      <textarea value={editValue} onChange={(e) => setEditValue(e.target.value)} onBlur={commitEdit}
                        onKeyDown={(e) => { if (e.key === "Escape") setEditingCell(null); }}
                        className="w-full bg-zinc-800 border border-blue-500 rounded px-1.5 py-1 text-[11px] text-white focus:outline-none min-h-[50px]" autoFocus />
                    ) : (
                      <div onDoubleClick={() => startEdit(idx, "text")} 
                        className="cursor-pointer hover:bg-zinc-800/50 rounded px-1.5 py-0.5 text-zinc-200 whitespace-pre-wrap min-h-[28px] text-[11px] leading-relaxed">
                        {cue.text}
                        {anyLineOver32 && <AlertTriangle className="inline w-3 h-3 ml-1.5 text-red-400" />}
                      </div>
                    )}
                  </td>
                  
                  {/* RAW AAI */}
                  {showRawCol && (
                    <td className="px-1.5 py-1 text-zinc-500 text-[10px] whitespace-pre-wrap leading-relaxed">
                      {rawMatch ? rawMatch.text : <span className="text-zinc-700 italic">—</span>}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}