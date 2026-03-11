import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { 
  Search, Replace, Undo2, Redo2, Volume2, ChevronDown, ChevronUp,
  AlertTriangle, Users, X
} from "lucide-react";

export default function EditorToolbar({
  cueCount,
  autoFollow, setAutoFollow,
  showRawCol, setShowRawCol, hasRawCues,
  onInsertSDH,
  onSave, saving,
  canUndo, canRedo, onUndo, onRedo,
  onFindReplace, findReplaceOpen, setFindReplaceOpen,
  onJumpToNextViolation,
  onBulkSpeaker, bulkSpeakerOpen, setBulkSpeakerOpen,
  selectedCount,
}) {
  const [findText, setFindText] = useState("");
  const [replaceText, setReplaceText] = useState("");
  const [bulkSpeakerVal, setBulkSpeakerVal] = useState("A");

  return (
    <div className="bg-zinc-900/50 border-b border-zinc-800">
      {/* Main toolbar row */}
      <div className="flex items-center justify-between px-3 py-1.5 gap-2 flex-wrap">
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex items-center gap-1">
            <Switch checked={autoFollow} onCheckedChange={setAutoFollow} className="data-[state=checked]:bg-blue-600 scale-75" />
            <Label className="text-[10px] text-zinc-400">Follow</Label>
          </div>
          <span className="text-[10px] text-zinc-600">{cueCount} cues</span>
          {hasRawCues && (
            <div className="flex items-center gap-1">
              <Switch checked={showRawCol} onCheckedChange={setShowRawCol} className="data-[state=checked]:bg-amber-600 scale-75" />
              <Label className="text-[10px] text-zinc-400">Raw AAI</Label>
            </div>
          )}
          <div className="w-px h-4 bg-zinc-800 mx-1" />
          {/* Undo/Redo */}
          <Button variant="ghost" size="sm" onClick={onUndo} disabled={!canUndo} className="h-6 w-6 p-0 text-zinc-400 hover:text-white disabled:opacity-30" title="Undo (Ctrl+Z)">
            <Undo2 className="w-3.5 h-3.5" />
          </Button>
          <Button variant="ghost" size="sm" onClick={onRedo} disabled={!canRedo} className="h-6 w-6 p-0 text-zinc-400 hover:text-white disabled:opacity-30" title="Redo (Ctrl+Shift+Z)">
            <Redo2 className="w-3.5 h-3.5" />
          </Button>
          <div className="w-px h-4 bg-zinc-800 mx-1" />
          {/* Find/Replace toggle */}
          <Button variant="ghost" size="sm" onClick={() => setFindReplaceOpen(!findReplaceOpen)} className={`h-6 px-2 text-[10px] gap-1 ${findReplaceOpen ? "bg-zinc-800 text-white" : "text-zinc-400 hover:text-white"}`}>
            <Search className="w-3 h-3" /> Find
          </Button>
          {/* Jump to violation */}
          <Button variant="ghost" size="sm" onClick={onJumpToNextViolation} className="h-6 px-2 text-[10px] gap-1 text-zinc-400 hover:text-amber-400" title="Jump to next QC violation">
            <AlertTriangle className="w-3 h-3" /> Next Issue
          </Button>
          {/* Bulk speaker */}
          <Button variant="ghost" size="sm" onClick={() => setBulkSpeakerOpen(!bulkSpeakerOpen)} className={`h-6 px-2 text-[10px] gap-1 ${bulkSpeakerOpen ? "bg-zinc-800 text-white" : "text-zinc-400 hover:text-white"}`}>
            <Users className="w-3 h-3" /> Bulk SPK
          </Button>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={onInsertSDH} className="bg-transparent border-zinc-800 text-zinc-400 hover:bg-zinc-800 hover:text-white text-[10px] h-6 px-2">
            <Volume2 className="w-3 h-3 mr-1" /> SDH
          </Button>
          <Button onClick={onSave} disabled={saving} size="sm" className="bg-blue-600 hover:bg-blue-700 text-white text-[10px] h-6 px-3">
            {saving ? "Saving…" : "Save"}
          </Button>
        </div>
      </div>

      {/* Find/Replace panel */}
      {findReplaceOpen && (
        <div className="flex items-center gap-2 px-3 py-1.5 border-t border-zinc-800/50 bg-zinc-900/80">
          <Search className="w-3 h-3 text-zinc-500 flex-shrink-0" />
          <Input 
            placeholder="Find…" value={findText} onChange={(e) => setFindText(e.target.value)}
            className="h-6 text-[11px] bg-zinc-800 border-zinc-700 text-white w-40"
            onKeyDown={(e) => { if (e.key === "Enter") onFindReplace(findText, replaceText, false); }}
          />
          <Replace className="w-3 h-3 text-zinc-500 flex-shrink-0" />
          <Input 
            placeholder="Replace…" value={replaceText} onChange={(e) => setReplaceText(e.target.value)}
            className="h-6 text-[11px] bg-zinc-800 border-zinc-700 text-white w-40"
            onKeyDown={(e) => { if (e.key === "Enter") onFindReplace(findText, replaceText, false); }}
          />
          <Button variant="outline" size="sm" onClick={() => onFindReplace(findText, replaceText, false)} className="h-6 px-2 text-[10px] border-zinc-700 text-zinc-300 hover:bg-zinc-800">
            Replace Next
          </Button>
          <Button variant="outline" size="sm" onClick={() => onFindReplace(findText, replaceText, true)} className="h-6 px-2 text-[10px] border-zinc-700 text-zinc-300 hover:bg-zinc-800">
            Replace All
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setFindReplaceOpen(false)} className="h-6 w-6 p-0 text-zinc-500 hover:text-white">
            <X className="w-3 h-3" />
          </Button>
        </div>
      )}

      {/* Bulk speaker panel */}
      {bulkSpeakerOpen && (
        <div className="flex items-center gap-2 px-3 py-1.5 border-t border-zinc-800/50 bg-zinc-900/80">
          <Users className="w-3 h-3 text-zinc-500 flex-shrink-0" />
          <span className="text-[10px] text-zinc-400">Assign speaker to {selectedCount || "selected"} cues:</span>
          <select value={bulkSpeakerVal} onChange={(e) => setBulkSpeakerVal(e.target.value)}
            className="h-6 text-[11px] bg-zinc-800 border border-zinc-700 rounded text-zinc-200 px-2">
            <option value="none">None</option>
            <option value="A">A</option>
            <option value="B">B</option>
            <option value="C">C</option>
            <option value="D">D</option>
            <option value="E">E</option>
          </select>
          <Button variant="outline" size="sm" onClick={() => onBulkSpeaker(bulkSpeakerVal === "none" ? null : bulkSpeakerVal)} className="h-6 px-2 text-[10px] border-zinc-700 text-zinc-300 hover:bg-zinc-800">
            Apply
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setBulkSpeakerOpen(false)} className="h-6 w-6 p-0 text-zinc-500 hover:text-white">
            <X className="w-3 h-3" />
          </Button>
        </div>
      )}
    </div>
  );
}