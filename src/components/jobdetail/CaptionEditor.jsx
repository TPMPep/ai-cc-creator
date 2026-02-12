import React, { useState, useEffect, useRef, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { AlertTriangle, Music, Volume2, Languages } from "lucide-react";
import { base44 } from "@/api/base44Client";
import { toast } from "sonner";

// Timecode conversion utilities
const msToTimecode = (ms) => {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const milliseconds = ms % 1000;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${String(milliseconds).padStart(3, "0")}`;
};

const timecodeToMs = (tc) => {
  const parts = tc.split(":");
  if (parts.length !== 3) return 0;
  const [h, m, rest] = parts;
  const [s, ms] = rest.split(".");
  return (parseInt(h) * 3600 + parseInt(m) * 60 + parseInt(s)) * 1000 + parseInt(ms || 0);
};

// Validation helpers
const validateCue = (cue, rules, allCues, cueIndex) => {
  const violations = [];
  const duration = cue.end - cue.start;
  const lines = cue.text.split("\n");
  const charCount = cue.text.length;
  
  // Duration checks
  if (rules.minDurationMs && duration < rules.minDurationMs) {
    violations.push({ type: "min_duration", value: duration });
  }
  if (rules.maxDurationMs && duration > rules.maxDurationMs) {
    violations.push({ type: "max_duration", value: duration });
  }
  
  // CPS check
  const cps = (charCount / (duration / 1000)).toFixed(1);
  if (rules.maxCPS && parseFloat(cps) > rules.maxCPS) {
    violations.push({ type: "max_cps", value: cps });
  }
  
  // Line checks
  if (rules.maxLines && lines.length > rules.maxLines) {
    violations.push({ type: "max_lines", value: lines.length });
  }
  
  lines.forEach((line, idx) => {
    if (rules.maxCharsPerLine && line.length > rules.maxCharsPerLine) {
      violations.push({ type: "max_chars_per_line", line: idx + 1, value: line.length });
    }
  });
  
  // Overlap check
  if (cueIndex < allCues.length - 1) {
    const nextCue = allCues[cueIndex + 1];
    if (cue.end > nextCue.start) {
      violations.push({ type: "overlap", value: "Overlaps next cue" });
    }
  }
  
  return violations;
};

export default function CaptionEditor({ 
  cues: initialCues, 
  currentTimeMs, 
  videoRef, 
  job,
  onCuesChanged 
}) {
  const [cues, setCues] = useState(initialCues || []);
  const [autoFollow, setAutoFollow] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editingCell, setEditingCell] = useState(null);
  const [editValue, setEditValue] = useState("");
  const tableRef = useRef(null);
  const activeRowRef = useRef(null);
  
  const rules = job?.rules || {};
  
  useEffect(() => {
    setCues(initialCues || []);
  }, [initialCues]);
  
  // Auto-scroll active cue into view
  useEffect(() => {
    if (!autoFollow || !activeRowRef.current) return;
    activeRowRef.current.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [currentTimeMs, autoFollow]);
  
  const activeCueIndex = cues.findIndex(c => c.start <= currentTimeMs && currentTimeMs <= c.end);
  
  const handleSaveCues = async () => {
    setSaving(true);
    try {
      // Update job result with new cues
      const updatedResult = { ...job.result, cues };
      await base44.entities.Job.update(job.id, { result: updatedResult });
      onCuesChanged?.(cues);
      toast.success("Captions saved successfully");
    } catch (err) {
      toast.error("Failed to save captions");
    }
    setSaving(false);
  };
  
  const handleCellEdit = (cueIndex, field, value) => {
    const newCues = [...cues];
    const cue = newCues[cueIndex];
    
    if (field === "start" || field === "end") {
      const ms = timecodeToMs(value);
      if (field === "start") {
        cue.start = ms;
        // Prevent overlap with previous cue
        if (cueIndex > 0 && cue.start < newCues[cueIndex - 1].end) {
          cue.start = newCues[cueIndex - 1].end + 1;
        }
      } else {
        cue.end = ms;
        // Ensure end > start
        if (cue.end <= cue.start) {
          cue.end = cue.start + (rules.minDurationMs || 1000);
        }
        // Prevent overlap with next cue
        if (cueIndex < newCues.length - 1 && cue.end > newCues[cueIndex + 1].start) {
          cue.end = newCues[cueIndex + 1].start - 1;
        }
      }
    } else if (field === "speaker") {
      cue.speaker = value;
    } else if (field === "type") {
      cue.kind = value;
      // Auto-bracket non-dialogue
      if (value !== "dialogue" && !cue.text.startsWith("[")) {
        if (value === "music") cue.text = `[♪ ${cue.text.toUpperCase()} ♪]`;
        else cue.text = `[${cue.text.toUpperCase()}]`;
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
  
  const handleKeyDown = (e, cueIndex) => {
    if (e.key === "Enter" && !e.shiftKey && editingCell?.field !== "text") {
      e.preventDefault();
      commitEdit();
    } else if (e.key === "Tab") {
      e.preventDefault();
      commitEdit();
      // Move to next field (simplified)
    } else if (e.key === "Escape") {
      setEditingCell(null);
    }
  };
  
  const insertSDHCue = () => {
    if (!videoRef.current) return;
    const timeMs = videoRef.current.currentTime * 1000;
    const newCue = {
      start: timeMs,
      end: timeMs + 2000,
      text: "[SOUND EFFECT]",
      kind: "sdh",
      speaker: null
    };
    const insertIndex = cues.findIndex(c => c.start > timeMs);
    const newCues = [...cues];
    if (insertIndex === -1) newCues.push(newCue);
    else newCues.splice(insertIndex, 0, newCue);
    setCues(newCues);
    toast.success("SDH cue inserted");
  };
  
  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-4 py-3 bg-zinc-900/50 border-b border-zinc-800">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <Switch checked={autoFollow} onCheckedChange={setAutoFollow} className="data-[state=checked]:bg-blue-600" />
            <Label className="text-xs text-zinc-400">Auto-follow</Label>
          </div>
          <div className="h-4 w-px bg-zinc-800" />
          <span className="text-xs text-zinc-500">{cues.length} cues</span>
        </div>
        
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={insertSDHCue} className="bg-transparent border-zinc-800 text-zinc-400 hover:bg-zinc-800 hover:text-white text-xs h-8">
            <Volume2 className="w-3 h-3 mr-1.5" /> Insert SDH Cue
          </Button>
          <Button onClick={handleSaveCues} disabled={saving} size="sm" className="bg-blue-600 hover:bg-blue-700 text-white text-xs h-8">
            {saving ? "Saving..." : "Save Changes"}
          </Button>
        </div>
      </div>
      
      {/* Editable table */}
      <div ref={tableRef} className="overflow-auto" style={{ maxHeight: "60vh" }}>
        <table className="w-full text-xs border-collapse">
          <thead className="sticky top-0 z-10 bg-zinc-900 shadow-md">
            <tr className="border-b border-zinc-800">
              <th className="px-3 py-2 text-left text-zinc-500 font-medium w-12">#</th>
              <th className="px-3 py-2 text-left text-zinc-500 font-medium w-32">TC IN</th>
              <th className="px-3 py-2 text-left text-zinc-500 font-medium w-32">TC OUT</th>
              <th className="px-3 py-2 text-left text-zinc-500 font-medium w-24">DUR</th>
              <th className="px-3 py-2 text-left text-zinc-500 font-medium w-24">SPEAKER</th>
              <th className="px-3 py-2 text-left text-zinc-500 font-medium w-32">TYPE</th>
              <th className="px-3 py-2 text-left text-zinc-500 font-medium">TEXT</th>
            </tr>
          </thead>
          <tbody>
            {cues.map((cue, idx) => {
              const isActive = idx === activeCueIndex;
              const violations = validateCue(cue, rules, cues, idx);
              const hasViolations = violations.length > 0;
              const duration = cue.end - cue.start;
              const durationSec = (duration / 1000).toFixed(2);
              const cps = (cue.text.length / (duration / 1000)).toFixed(1);
              const cpsViolation = rules.maxCPS && parseFloat(cps) > rules.maxCPS;
              const isSDH = cue.kind === "sdh";
              
              return (
                <tr 
                  key={idx}
                  ref={isActive ? activeRowRef : null}
                  className={`
                    border-b border-zinc-800/30 hover:bg-zinc-800/30 transition-colors
                    ${isActive ? "bg-blue-600/10" : ""}
                    ${hasViolations ? "border-l-4 border-l-red-500/50" : ""}
                    ${isSDH ? "bg-blue-950/20" : ""}
                  `}
                  onClick={() => {
                    if (videoRef.current) videoRef.current.currentTime = cue.start / 1000;
                  }}
                >
                  {/* Cue # */}
                  <td className="px-3 py-2 text-zinc-400 font-mono">{idx + 1}</td>
                  
                  {/* TC IN */}
                  <td className="px-3 py-2 text-zinc-300 font-mono">
                    {editingCell?.cueIndex === idx && editingCell?.field === "start" ? (
                      <input
                        type="text"
                        value={editValue}
                        onChange={(e) => setEditValue(e.target.value)}
                        onBlur={commitEdit}
                        onKeyDown={(e) => handleKeyDown(e, idx)}
                        className="w-full bg-zinc-800 border border-blue-500 rounded px-2 py-1 text-xs text-white font-mono focus:outline-none"
                        autoFocus
                      />
                    ) : (
                      <div onDoubleClick={() => startEdit(idx, "start")} className="cursor-pointer hover:bg-zinc-800/50 rounded px-2 py-1">
                        {msToTimecode(cue.start)}
                      </div>
                    )}
                  </td>
                  
                  {/* TC OUT */}
                  <td className="px-3 py-2 text-zinc-300 font-mono">
                    {editingCell?.cueIndex === idx && editingCell?.field === "end" ? (
                      <input
                        type="text"
                        value={editValue}
                        onChange={(e) => setEditValue(e.target.value)}
                        onBlur={commitEdit}
                        onKeyDown={(e) => handleKeyDown(e, idx)}
                        className="w-full bg-zinc-800 border border-blue-500 rounded px-2 py-1 text-xs text-white font-mono focus:outline-none"
                        autoFocus
                      />
                    ) : (
                      <div onDoubleClick={() => startEdit(idx, "end")} className="cursor-pointer hover:bg-zinc-800/50 rounded px-2 py-1">
                        {msToTimecode(cue.end)}
                      </div>
                    )}
                  </td>
                  
                  {/* DUR */}
                  <td className={`px-3 py-2 font-mono ${cpsViolation ? "text-red-400" : "text-zinc-500"}`}>
                    {durationSec}s
                    {cpsViolation && (
                      <span className="ml-2 text-[10px] bg-red-500/20 text-red-400 px-1.5 py-0.5 rounded">
                        {cps} CPS
                      </span>
                    )}
                  </td>
                  
                  {/* SPEAKER */}
                  <td className="px-3 py-2">
                    <Select 
                      value={cue.speaker || "none"} 
                      onValueChange={(v) => handleCellEdit(idx, "speaker", v === "none" ? null : v)}
                      disabled={isSDH}
                    >
                      <SelectTrigger className="h-7 text-xs bg-zinc-900 border-zinc-800 text-white">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent className="bg-zinc-900 border-zinc-800">
                        <SelectItem value="none">None</SelectItem>
                        <SelectItem value="A">A</SelectItem>
                        <SelectItem value="B">B</SelectItem>
                        <SelectItem value="C">C</SelectItem>
                      </SelectContent>
                    </Select>
                  </td>
                  
                  {/* TYPE */}
                  <td className="px-3 py-2">
                    <Select 
                      value={cue.kind || "dialogue"} 
                      onValueChange={(v) => handleCellEdit(idx, "type", v)}
                    >
                      <SelectTrigger className="h-7 text-xs bg-zinc-900 border-zinc-800 text-white">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent className="bg-zinc-900 border-zinc-800">
                        <SelectItem value="dialogue">Dialogue</SelectItem>
                        <SelectItem value="sdh">SDH</SelectItem>
                        <SelectItem value="music">Music</SelectItem>
                        <SelectItem value="foreign_language">Foreign</SelectItem>
                        <SelectItem value="sound_effect">Sound FX</SelectItem>
                      </SelectContent>
                    </Select>
                  </td>
                  
                  {/* TEXT */}
                  <td className="px-3 py-2">
                    {editingCell?.cueIndex === idx && editingCell?.field === "text" ? (
                      <textarea
                        value={editValue}
                        onChange={(e) => setEditValue(e.target.value)}
                        onBlur={commitEdit}
                        onKeyDown={(e) => {
                          if (e.key === "Escape") {
                            setEditingCell(null);
                          }
                        }}
                        className="w-full bg-zinc-800 border border-blue-500 rounded px-2 py-1 text-xs text-white focus:outline-none min-h-[60px]"
                        autoFocus
                      />
                    ) : (
                      <div 
                        onDoubleClick={() => startEdit(idx, "text")} 
                        className="cursor-pointer hover:bg-zinc-800/50 rounded px-2 py-1 text-zinc-200 whitespace-pre-wrap min-h-[40px]"
                      >
                        {cue.text}
                        {violations.some(v => v.type === "max_chars_per_line" || v.type === "max_lines") && (
                          <AlertTriangle className="inline w-3 h-3 ml-2 text-amber-400" />
                        )}
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}