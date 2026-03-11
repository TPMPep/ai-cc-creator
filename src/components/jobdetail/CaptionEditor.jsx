import React, { useState, useEffect, useRef, useCallback } from "react";
import { base44 } from "@/api/base44Client";
import { toast } from "sonner";
import useUndoRedo from "./useUndoRedo";
import EditorToolbar from "./EditorToolbar";
import CaptionEditorRow from "./CaptionEditorRow";

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

export default function CaptionEditor({ 
  cues: initialCues, 
  currentTimeMs, 
  videoRef, 
  job,
  onCuesChanged,
  rawSrtText
}) {
  const { current: cues, push: pushCues, undo, redo, canUndo, canRedo, reset: resetHistory } = useUndoRedo(initialCues || []);
  const [autoFollow, setAutoFollow] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editingCell, setEditingCell] = useState(null);
  const [editValue, setEditValue] = useState("");
  const [showRawCol, setShowRawCol] = useState(false);
  const [findReplaceOpen, setFindReplaceOpen] = useState(false);
  const [bulkSpeakerOpen, setBulkSpeakerOpen] = useState(false);
  const [selectedCues, setSelectedCues] = useState(new Set());
  const [violationIdx, setViolationIdx] = useState(-1);
  const tableRef = useRef(null);
  const activeRowRef = useRef(null);
  const rawCues = useRef([]);
  const rules = job?.rules || {};
  
  // Sync with external cues changes
  useEffect(() => { resetHistory(initialCues || []); }, [initialCues]);

  useEffect(() => {
    if (rawSrtText) {
      rawCues.current = parseRawSRT(rawSrtText);
      if (rawCues.current.length > 0) setShowRawCol(true);
    }
  }, [rawSrtText]);

  // Auto-follow
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

  // Keyboard shortcuts (global)
  useEffect(() => {
    const handler = (e) => {
      // Only trigger when not typing in inputs
      const tag = e.target.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;

      // Ctrl+Z / Cmd+Z = Undo
      if ((e.ctrlKey || e.metaKey) && e.key === "z" && !e.shiftKey) { e.preventDefault(); undo(); return; }
      // Ctrl+Shift+Z / Ctrl+Y = Redo
      if ((e.ctrlKey || e.metaKey) && (e.key === "Z" || e.key === "y")) { e.preventDefault(); redo(); return; }
      // Ctrl+F = Find
      if ((e.ctrlKey || e.metaKey) && e.key === "f") { e.preventDefault(); setFindReplaceOpen(true); return; }
      // M = Merge selected
      if (e.key === "m" && selectedCues.size >= 2) { e.preventDefault(); handleMerge(); return; }
      // S = Split at cursor time
      if (e.key === "s" && !e.ctrlKey && !e.metaKey && activeCueIndex >= 0) { e.preventDefault(); handleSplit(activeCueIndex); return; }
      // Enter = advance to next cue and seek
      if (e.key === "Enter" && activeCueIndex >= 0 && activeCueIndex < cues.length - 1) {
        e.preventDefault();
        const nextCue = cues[activeCueIndex + 1];
        if (videoRef.current) videoRef.current.currentTime = nextCue.start / 1000;
        return;
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [cues, selectedCues, activeCueIndex]);

  // --- Actions ---
  
  const updateCues = (newCues) => {
    pushCues(newCues);
  };

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
    const newCues = cues.map(c => ({ ...c }));
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
    updateCues(newCues);
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
    const newCues = cues.map(c => ({ ...c }));
    if (insertIndex === -1) newCues.push(newCue); else newCues.splice(insertIndex, 0, newCue);
    updateCues(newCues);
    toast.success("SDH cue inserted");
  };

  const seekTo = (ms) => {
    if (videoRef.current) videoRef.current.currentTime = ms / 1000;
  };

  // --- Merge selected cues ---
  const handleMerge = () => {
    if (selectedCues.size < 2) { toast.error("Select 2+ cues to merge"); return; }
    const indices = Array.from(selectedCues).sort((a, b) => a - b);
    // Check contiguous
    for (let i = 1; i < indices.length; i++) {
      if (indices[i] !== indices[i - 1] + 1) { toast.error("Select contiguous cues to merge"); return; }
    }
    const first = cues[indices[0]];
    const last = cues[indices[indices.length - 1]];
    const mergedText = indices.map(i => cues[i].text).join("\n");
    const merged = { ...first, end: last.end, text: mergedText };
    const newCues = cues.filter((_, i) => !selectedCues.has(i));
    newCues.splice(indices[0], 0, merged);
    updateCues(newCues);
    setSelectedCues(new Set());
    toast.success(`Merged ${indices.length} cues`);
  };

  // --- Split cue at current time ---
  const handleSplit = (cueIndex) => {
    const cue = cues[cueIndex];
    const splitTime = videoRef.current ? videoRef.current.currentTime * 1000 : (cue.start + cue.end) / 2;
    if (splitTime <= cue.start || splitTime >= cue.end) { toast.error("Playhead must be within the cue to split"); return; }
    const words = cue.text.split(" ");
    const mid = Math.ceil(words.length / 2);
    const first = { ...cue, end: splitTime, text: words.slice(0, mid).join(" ") };
    const second = { ...cue, start: splitTime + 1, text: words.slice(mid).join(" ") };
    const newCues = cues.map(c => ({ ...c }));
    newCues.splice(cueIndex, 1, first, second);
    updateCues(newCues);
    toast.success("Cue split");
  };

  // --- Find & Replace ---
  const handleFindReplace = (find, replace, all) => {
    if (!find) return;
    let count = 0;
    const newCues = cues.map(c => {
      if (c.text.includes(find)) {
        count++;
        if (all) return { ...c, text: c.text.replaceAll(find, replace) };
        if (count === 1) return { ...c, text: c.text.replace(find, replace) };
      }
      return { ...c };
    });
    if (count === 0) { toast.error(`"${find}" not found`); return; }
    updateCues(newCues);
    toast.success(all ? `Replaced ${count} occurrences` : `Replaced 1 occurrence`);
  };

  // --- Jump to next violation ---
  const handleJumpToNextViolation = () => {
    const startFrom = violationIdx + 1;
    for (let i = 0; i < cues.length; i++) {
      const idx = (startFrom + i) % cues.length;
      const cue = cues[idx];
      const lines = cue.text.split("\n");
      const over32 = lines.some(l => l.length > 32);
      const dur = cue.end - cue.start;
      const cps = dur > 0 ? cue.text.replace(/\n/g, "").length / (dur / 1000) : 0;
      const cpsOver = cps > 20;
      const nextCue = cues[idx + 1];
      const overlap = nextCue && cue.end > nextCue.start;
      if (over32 || cpsOver || overlap) {
        setViolationIdx(idx);
        seekTo(cue.start);
        // Scroll to that row
        if (tableRef.current) {
          const rows = tableRef.current.querySelectorAll("tr");
          const row = rows[idx + 1]; // +1 for thead
          if (row) row.scrollIntoView({ block: "center", behavior: "smooth" });
        }
        toast(`Issue at cue ${idx + 1}: ${over32 ? "line >32 chars" : cpsOver ? "CPS >20" : "overlap"}`, { duration: 2000 });
        return;
      }
    }
    toast.success("No violations found!");
    setViolationIdx(-1);
  };

  // --- Bulk speaker ---
  const handleBulkSpeaker = (speaker) => {
    if (selectedCues.size === 0) { toast.error("Select cues first"); return; }
    const newCues = cues.map((c, i) => selectedCues.has(i) ? { ...c, speaker } : { ...c });
    updateCues(newCues);
    setSelectedCues(new Set());
    setBulkSpeakerOpen(false);
    toast.success(`Speaker set for ${selectedCues.size} cues`);
  };

  const toggleSelect = (idx) => {
    const next = new Set(selectedCues);
    if (next.has(idx)) next.delete(idx); else next.add(idx);
    setSelectedCues(next);
  };

  return (
    <div className="space-y-0">
      <EditorToolbar
        cueCount={cues.length}
        autoFollow={autoFollow} setAutoFollow={setAutoFollow}
        showRawCol={showRawCol} setShowRawCol={setShowRawCol} hasRawCues={rawCues.current.length > 0}
        onInsertSDH={insertSDHCue}
        onSave={handleSaveCues} saving={saving}
        canUndo={canUndo} canRedo={canRedo} onUndo={undo} onRedo={redo}
        onFindReplace={handleFindReplace} findReplaceOpen={findReplaceOpen} setFindReplaceOpen={setFindReplaceOpen}
        onJumpToNextViolation={handleJumpToNextViolation}
        onBulkSpeaker={handleBulkSpeaker} bulkSpeakerOpen={bulkSpeakerOpen} setBulkSpeakerOpen={setBulkSpeakerOpen}
        selectedCount={selectedCues.size}
      />

      {/* Keyboard hints */}
      <div className="px-3 py-1 bg-zinc-900/30 border-b border-zinc-800/30 flex items-center gap-4 text-[9px] text-zinc-600">
        <span>Ctrl+Z Undo</span>
        <span>Ctrl+Shift+Z Redo</span>
        <span>Ctrl+F Find</span>
        <span>M Merge selected</span>
        <span>S Split at playhead</span>
        <span>Enter Next cue</span>
        <span>Double-click to edit cell</span>
      </div>

      {/* Table */}
      <div ref={tableRef} className="overflow-auto" style={{ maxHeight: "60vh" }}>
        <table className="w-full text-[11px] border-collapse">
          <thead className="sticky top-0 z-10 bg-zinc-900 shadow-md">
            <tr className="border-b border-zinc-800">
              <th className="px-1 py-1.5 text-left text-zinc-500 font-medium w-[44px]">#</th>
              <th className="px-1 py-1.5 text-left text-zinc-500 font-medium w-[68px]">IN</th>
              <th className="px-1 py-1.5 text-left text-zinc-500 font-medium w-[68px]">OUT</th>
              <th className="px-1 py-1.5 text-left text-zinc-500 font-medium w-[36px]">DUR</th>
              <th className="px-1 py-1.5 text-left text-zinc-500 font-medium w-[64px]">SPK</th>
              <th className="px-1 py-1.5 text-left text-zinc-500 font-medium w-[64px]">TYPE</th>
              <th className="px-1 py-1.5 text-center text-zinc-500 font-medium w-[28px]" title="Characters per second">CPS</th>
              <th className="px-1 py-1.5 text-center text-zinc-500 font-medium w-[28px]">CHR</th>
              <th className="px-1 py-1.5 text-left text-zinc-500 font-medium">TEXT</th>
              {showRawCol && (
                <>
                  <th className="px-1 py-1.5 text-center text-zinc-500 font-medium w-[28px]">CHR</th>
                  <th className="px-1 py-1.5 text-left text-zinc-500 font-medium">RAW (AAI)</th>
                </>
              )}
            </tr>
          </thead>
          <tbody>
            {cues.map((cue, idx) => (
              <CaptionEditorRow
                key={idx}
                cue={cue}
                idx={idx}
                isActive={idx === activeCueIndex}
                nextCue={cues[idx + 1] || null}
                selected={selectedCues.has(idx)}
                onToggleSelect={toggleSelect}
                editingCell={editingCell}
                editValue={editValue}
                setEditValue={setEditValue}
                onStartEdit={startEdit}
                onCommitEdit={commitEdit}
                onKeyDown={handleKeyDown}
                onCellEdit={handleCellEdit}
                onSeek={seekTo}
                showRawCol={showRawCol}
                rawMatch={showRawCol ? findRawMatch(rawCues.current, cue.start) : null}
                ref={idx === activeCueIndex ? activeRowRef : null}
              />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}