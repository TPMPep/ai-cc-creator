import React from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Users, Italic, Volume2, AlignCenter, Clock } from "lucide-react";

const SECTION_CLASS = "space-y-3 border-b border-zinc-800/40 pb-4 last:border-0 last:pb-0";
const LABEL_CLASS = "text-xs text-zinc-400";

function SpeakerSection({ opts, onChange }) {
  const update = (key, val) => onChange({ ...opts, [key]: val });
  
  const nameMapStr = React.useMemo(() => {
    if (!opts.speakerNameMap || typeof opts.speakerNameMap !== "object") return "";
    return JSON.stringify(opts.speakerNameMap);
  }, [opts.speakerNameMap]);

  return (
    <div className={SECTION_CLASS}>
      <div className="flex items-center gap-2 mb-1">
        <Users className="w-3.5 h-3.5 text-blue-400" />
        <span className="text-xs font-semibold text-zinc-300">Speaker Labels</span>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label className={LABEL_CLASS}>Mode</Label>
          <Select value={opts.speakerLabelMode} onValueChange={(v) => update("speakerLabelMode", v)}>
            <SelectTrigger className="h-8 bg-zinc-900 border-zinc-800 text-zinc-300 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="bg-zinc-900 border-zinc-800">
              <SelectItem value="dash" className="text-zinc-300">Dash (no labels)</SelectItem>
              <SelectItem value="alpha" className="text-zinc-300">Alpha (A, B, C)</SelectItem>
              <SelectItem value="generic" className="text-zinc-300">Generic (SPEAKER 1)</SelectItem>
              <SelectItem value="named" className="text-zinc-300">Named (custom)</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className={LABEL_CLASS}>Format</Label>
          <Select value={opts.speakerLabelFormat} onValueChange={(v) => update("speakerLabelFormat", v)}>
            <SelectTrigger className="h-8 bg-zinc-900 border-zinc-800 text-zinc-300 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="bg-zinc-900 border-zinc-800">
              <SelectItem value="prefix" className="text-zinc-300">Prefix (- Andy:)</SelectItem>
              <SelectItem value="bracket" className="text-zinc-300">Bracket (-[Andy])</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="flex items-center justify-between py-1">
        <Label className={LABEL_CLASS}>Label single-speaker cues</Label>
        <Switch
          checked={!!opts.speakerLabelSingle}
          onCheckedChange={(v) => update("speakerLabelSingle", v ? 1 : 0)}
          className="data-[state=checked]:bg-blue-600"
        />
      </div>
      {opts.speakerLabelMode === "generic" && (
        <div className="space-y-1">
          <Label className={LABEL_CLASS}>Generic prefix</Label>
          <Input
            value={opts.speakerGenericPrefix}
            onChange={(e) => update("speakerGenericPrefix", e.target.value)}
            className="h-8 bg-zinc-900 border-zinc-800 text-zinc-300 text-xs"
            placeholder="SPEAKER"
          />
        </div>
      )}
      {opts.speakerLabelMode === "named" && (
        <div className="space-y-1">
          <Label className={LABEL_CLASS}>Name map (JSON)</Label>
          <Input
            value={nameMapStr}
            onChange={(e) => {
              try { update("speakerNameMap", JSON.parse(e.target.value)); } catch {}
            }}
            className="h-8 bg-zinc-900 border-zinc-800 text-zinc-300 text-xs font-mono"
            placeholder='{"A":"Andy","B":"Aesha"}'
          />
          <span className="text-[10px] text-zinc-600">Map AssemblyAI speaker letters to display names</span>
        </div>
      )}
    </div>
  );
}

function ItalicsSection({ opts, onChange }) {
  const update = (key, val) => onChange({ ...opts, [key]: val });
  return (
    <div className={SECTION_CLASS}>
      <div className="flex items-center gap-2 mb-1">
        <Italic className="w-3.5 h-3.5 text-purple-400" />
        <span className="text-xs font-semibold text-zinc-300">Italics / Titles</span>
      </div>
      <div className="flex items-center justify-between py-1">
        <Label className={LABEL_CLASS}>Auto-italicize detected titles</Label>
        <Switch
          checked={!!opts.italicizeTitles}
          onCheckedChange={(v) => update("italicizeTitles", v ? 1 : 0)}
          className="data-[state=checked]:bg-purple-600"
        />
      </div>
      {!!opts.italicizeTitles && (
        <div className="space-y-1">
          <Label className={LABEL_CLASS}>Min words for title detection</Label>
          <Input
            type="number" min={1} max={10}
            value={opts.italicizeTitlesMinWords}
            onChange={(e) => update("italicizeTitlesMinWords", parseInt(e.target.value) || 3)}
            className="h-8 bg-zinc-900 border-zinc-800 text-zinc-300 text-xs w-24"
          />
        </div>
      )}
      <div className="space-y-1">
        <Label className={LABEL_CLASS}>Manual italicize phrases <span className="text-zinc-600">(comma-separated)</span></Label>
        <Input
          value={opts.italicizePhrases}
          onChange={(e) => update("italicizePhrases", e.target.value)}
          className="h-8 bg-zinc-900 border-zinc-800 text-zinc-300 text-xs"
          placeholder="Watch What Happens Live,Below Deck Med"
        />
      </div>
    </div>
  );
}

function SoundLabelSection({ opts, onChange }) {
  return (
    <div className={SECTION_CLASS}>
      <div className="flex items-center gap-2 mb-1">
        <Volume2 className="w-3.5 h-3.5 text-emerald-400" />
        <span className="text-xs font-semibold text-zinc-300">Sound Labels</span>
      </div>
      <div className="space-y-1">
        <Label className={LABEL_CLASS}>Style</Label>
        <Select value={opts.soundLabelStyle} onValueChange={(v) => onChange({ ...opts, soundLabelStyle: v })}>
          <SelectTrigger className="h-8 bg-zinc-900 border-zinc-800 text-zinc-300 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="bg-zinc-900 border-zinc-800">
            <SelectItem value="simple" className="text-zinc-300">Simple — [APPLAUSE]</SelectItem>
            <SelectItem value="descriptive" className="text-zinc-300">Descriptive — [audience applauds]</SelectItem>
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}

function AlignmentSection({ opts, onChange }) {
  const update = (key, val) => onChange({ ...opts, [key]: val });
  return (
    <div className={SECTION_CLASS}>
      <div className="flex items-center gap-2 mb-1">
        <AlignCenter className="w-3.5 h-3.5 text-amber-400" />
        <span className="text-xs font-semibold text-zinc-300">Alignment Tags</span>
      </div>
      <div className="space-y-1">
        <Label className={LABEL_CLASS}>Default alignment</Label>
        <Select value={opts.alignmentDefault} onValueChange={(v) => update("alignmentDefault", v)}>
          <SelectTrigger className="h-8 bg-zinc-900 border-zinc-800 text-zinc-300 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="bg-zinc-900 border-zinc-800">
            <SelectItem value="none" className="text-zinc-300">None (no tags)</SelectItem>
            <SelectItem value="an2" className="text-zinc-300">{"\\an2"} (bottom center)</SelectItem>
            <SelectItem value="an8" className="text-zinc-300">{"\\an8"} (top center)</SelectItem>
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}

function TimecodeSection({ opts, onChange }) {
  return (
    <div className={SECTION_CLASS}>
      <div className="flex items-center gap-2 mb-1">
        <Clock className="w-3.5 h-3.5 text-cyan-400" />
        <span className="text-xs font-semibold text-zinc-300">Timecode Offset</span>
      </div>
      <div className="space-y-1">
        <Label className={LABEL_CLASS}>Offset (ms)</Label>
        <Input
          type="number" min={0} step={1000}
          value={opts.timecodeOffsetMs}
          onChange={(e) => onChange({ ...opts, timecodeOffsetMs: parseInt(e.target.value) || 0 })}
          className="h-8 bg-zinc-900 border-zinc-800 text-zinc-300 text-xs w-40"
          placeholder="0"
        />
        <span className="text-[10px] text-zinc-600">e.g. 3600000 = 01:00:00 hour offset</span>
      </div>
    </div>
  );
}

export default function CaptionOptionsPanel({ options, onOptionsChange }) {
  return (
    <div className="space-y-4">
      <h3 className="text-sm font-semibold text-zinc-200">Caption Options</h3>
      <SpeakerSection opts={options} onChange={onOptionsChange} />
      <ItalicsSection opts={options} onChange={onOptionsChange} />
      <SoundLabelSection opts={options} onChange={onOptionsChange} />
      <AlignmentSection opts={options} onChange={onOptionsChange} />
      <TimecodeSection opts={options} onChange={onOptionsChange} />
    </div>
  );
}