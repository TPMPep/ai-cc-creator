import React, { useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
  Users, Italic, Volume2, AlignCenter, Clock, FileOutput, Shield, Film,
  HelpCircle, Plus, Trash2, Briefcase,
} from "lucide-react";
import { NBCU_CAPTION_OPTIONS, CAPTION_OPTIONS_DEFAULTS, INTERNAL_CAPTION_OPTIONS } from "../shared/RulesDefaults";

const SECTION_CLASS = "space-y-3 border-b border-zinc-800/40 pb-4 last:border-0 last:pb-0";
const LABEL_CLASS = "text-xs text-zinc-400";

function Hint({ text }) {
  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <HelpCircle className="w-3 h-3 text-zinc-600 hover:text-zinc-400 cursor-help inline ml-1 -mt-0.5" />
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-xs bg-zinc-800 border-zinc-700 text-zinc-200 text-xs">
          {text}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

// ─── Speaker Labels ──────────────────────────────────────
function SpeakerSection({ opts, onChange, locked }) {
  const update = (key, val) => onChange({ ...opts, [key]: val });

  const nameMapStr = React.useMemo(() => {
    if (!opts.speakerNameMap || typeof opts.speakerNameMap !== "object") return "";
    return JSON.stringify(opts.speakerNameMap);
  }, [opts.speakerNameMap]);

  return (
    <div className={SECTION_CLASS}>
      <div className="flex items-center gap-2 mb-1">
        <Users className="w-3.5 h-3.5 text-blue-400" />
        <span className="text-xs font-semibold text-zinc-300">Speaker Formatting</span>
        {locked && <span className="text-[10px] text-amber-400 ml-auto">NBCU: dash only</span>}
      </div>
      {locked ? (
        <p className="text-xs text-zinc-500">Locked to dash mode (no speaker names) per NBCU CM-051.</p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className={LABEL_CLASS}>
                Mode
                <Hint text="NBCU forbids speaker names. Use Dash for NBCU deliveries." />
              </Label>
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
            <Label className={LABEL_CLASS}>
              Label single-speaker cues
              <Hint text="Should remain OFF for NBCU." />
            </Label>
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
        </>
      )}
    </div>
  );
}

// ─── Sound Cues ──────────────────────────────────────────
function SoundLabelSection({ opts, onChange, locked }) {
  return (
    <div className={SECTION_CLASS}>
      <div className="flex items-center gap-2 mb-1">
        <Volume2 className="w-3.5 h-3.5 text-emerald-400" />
        <span className="text-xs font-semibold text-zinc-300">Sound Cues</span>
        {locked && <span className="text-[10px] text-amber-400 ml-auto">NBCU: simple</span>}
      </div>
      <div className="space-y-1">
        <Label className={LABEL_CLASS}>
          Style
          <Hint text="NBCU expects simple bracket cues: [LAUGHTER], [APPLAUSE], [MUSIC]." />
        </Label>
        <Select value={opts.soundLabelStyle} onValueChange={(v) => onChange({ ...opts, soundLabelStyle: v })} disabled={locked}>
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

// ─── Italics ──────────────────────────────────────────────
function ItalicsSection({ opts, onChange }) {
  const update = (key, val) => onChange({ ...opts, [key]: val });
  return (
    <div className={SECTION_CLASS}>
      <div className="flex items-center gap-2 mb-1">
        <Italic className="w-3.5 h-3.5 text-purple-400" />
        <span className="text-xs font-semibold text-zinc-300">Italics (Titles)</span>
      </div>
      <div className="flex items-center justify-between py-1">
        <Label className={LABEL_CLASS}>
          Auto-italicize titles
          <Hint text="Automatically italicizes detected show titles (universal, no hard-coding)." />
        </Label>
        <Switch
          checked={!!opts.italicizeTitles}
          onCheckedChange={(v) => update("italicizeTitles", v ? 1 : 0)}
          className="data-[state=checked]:bg-purple-600"
        />
      </div>
      {!!opts.italicizeTitles && (
        <div className="space-y-1">
          <Label className={LABEL_CLASS}>
            Min words for title detection
            <Hint text="Minimum word count for auto-detected title phrases." />
          </Label>
          <Input
            type="number" min={1} max={10}
            value={opts.italicizeTitlesMinWords}
            onChange={(e) => update("italicizeTitlesMinWords", parseInt(e.target.value) || 3)}
            className="h-8 bg-zinc-900 border-zinc-800 text-zinc-300 text-xs w-24"
          />
        </div>
      )}
      <div className="space-y-1">
        <Label className={LABEL_CLASS}>
          Manual title list <span className="text-zinc-600">(comma-separated)</span>
          <Hint text="Optional override list if known titles are provided." />
        </Label>
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

// ─── Alignment ────────────────────────────────────────────
function AlignmentSection({ opts, onChange, locked }) {
  const update = (key, val) => onChange({ ...opts, [key]: val });
  const windows = opts.alignmentWindows || [];

  const addWindow = () => {
    update("alignmentWindows", [...windows, { start: "", end: "", align: "an8" }]);
  };
  const removeWindow = (i) => {
    update("alignmentWindows", windows.filter((_, idx) => idx !== i));
  };
  const updateWindow = (i, field, val) => {
    const next = windows.map((w, idx) => idx === i ? { ...w, [field]: val } : w);
    update("alignmentWindows", next);
  };

  return (
    <div className={SECTION_CLASS}>
      <div className="flex items-center gap-2 mb-1">
        <AlignCenter className="w-3.5 h-3.5 text-amber-400" />
        <span className="text-xs font-semibold text-zinc-300">Alignment</span>
      </div>
      <div className="space-y-1">
        <Label className={LABEL_CLASS}>
          Default alignment
          <Hint text="TTML does not require SRT alignment tags. Use 'none' for NBCU." />
        </Label>
        <Select value={opts.alignmentDefault} onValueChange={(v) => update("alignmentDefault", v)} disabled={locked}>
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
      {!locked && (
        <div className="space-y-2 mt-1">
          <div className="flex items-center justify-between">
            <Label className={LABEL_CLASS}>
              Alignment windows
              <Hint text="Override alignment for specific timecode ranges." />
            </Label>
            <Button size="sm" variant="ghost" className="h-6 px-2 text-xs text-zinc-500 hover:text-zinc-300" onClick={addWindow}>
              <Plus className="w-3 h-3 mr-1" /> Add
            </Button>
          </div>
          {windows.map((w, i) => (
            <div key={i} className="flex items-center gap-2">
              <Input
                value={w.start}
                onChange={(e) => updateWindow(i, "start", e.target.value)}
                className="h-7 bg-zinc-900 border-zinc-800 text-zinc-300 text-[10px] font-mono flex-1"
                placeholder="01:00:26,000"
              />
              <span className="text-zinc-600 text-[10px]">→</span>
              <Input
                value={w.end}
                onChange={(e) => updateWindow(i, "end", e.target.value)}
                className="h-7 bg-zinc-900 border-zinc-800 text-zinc-300 text-[10px] font-mono flex-1"
                placeholder="01:00:33,000"
              />
              <Select value={w.align} onValueChange={(v) => updateWindow(i, "align", v)}>
                <SelectTrigger className="h-7 w-20 bg-zinc-900 border-zinc-800 text-zinc-300 text-[10px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-zinc-900 border-zinc-800">
                  <SelectItem value="an2" className="text-zinc-300">an2</SelectItem>
                  <SelectItem value="an8" className="text-zinc-300">an8</SelectItem>
                </SelectContent>
              </Select>
              <button onClick={() => removeWindow(i)} className="text-zinc-600 hover:text-red-400">
                <Trash2 className="w-3 h-3" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Timecode Offset ──────────────────────────────────────
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

// ─── Output / Delivery Format ────────────────────────────
const FRAME_RATE_PRESETS = [
  { label: "29.97 fps (NTSC)", rate: 30, multiplier: "1000 1001" },
  { label: "23.98 fps (Film)", rate: 24, multiplier: "1000 1001" },
  { label: "25 fps (PAL)", rate: 25, multiplier: "1 1" },
  { label: "24 fps (True)", rate: 24, multiplier: "1 1" },
  { label: "30 fps (True)", rate: 30, multiplier: "1 1" },
];

function OutputSection({ opts, onChange, locked }) {
  const update = (key, val) => onChange({ ...opts, [key]: val });
  const showTtml = (opts.outputFormat || "").includes("ttml");

  const currentFrPreset = FRAME_RATE_PRESETS.find(
    (p) => p.rate === opts.ttmlFrameRate && p.multiplier === opts.ttmlFrameRateMultiplier
  );
  const frKey = currentFrPreset ? `${currentFrPreset.rate}|${currentFrPreset.multiplier}` : "custom";

  return (
    <div className={SECTION_CLASS}>
      <div className="flex items-center gap-2 mb-1">
        <FileOutput className="w-3.5 h-3.5 text-orange-400" />
        <span className="text-xs font-semibold text-zinc-300">Delivery Format</span>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label className={LABEL_CLASS}>
            Output Format
            <Hint text='NBCU delivery requires TTML (IMSC-1.1 Text Profile). SRT is internal-only.' />
          </Label>
          <Select value={opts.outputFormat || "srt"} onValueChange={(v) => update("outputFormat", v)} disabled={locked}>
            <SelectTrigger className="h-8 bg-zinc-900 border-zinc-800 text-zinc-300 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="bg-zinc-900 border-zinc-800">
              <SelectItem value="ttml" className="text-zinc-300">TTML (broadcast)</SelectItem>
              <SelectItem value="srt" className="text-zinc-300">SRT (internal/QA)</SelectItem>
              <SelectItem value="scc" className="text-zinc-300">SCC (legacy)</SelectItem>
              <SelectItem value="srt,ttml" className="text-zinc-300">SRT + TTML</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className={LABEL_CLASS}>
            Timebase
            <Hint text="NBCU requires ttp:timeBase=media." />
          </Label>
          <Select value={opts.ttmlTimebase || "media"} onValueChange={(v) => update("ttmlTimebase", v)} disabled={locked || !showTtml}>
            <SelectTrigger className="h-8 bg-zinc-900 border-zinc-800 text-zinc-300 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="bg-zinc-900 border-zinc-800">
              <SelectItem value="media" className="text-zinc-300">media</SelectItem>
              <SelectItem value="smpte" className="text-zinc-300">smpte</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {showTtml && (
        <div className="space-y-3 mt-2">
          <div className="flex items-center gap-2">
            <Film className="w-3 h-3 text-zinc-500" />
            <span className="text-[10px] font-medium text-zinc-500 uppercase tracking-wider">
              Frame Rate
              <Hint text="Must match source timecode. 23.98 → 24 + 1000 1001. 29.97 → 30 + 1000 1001. 25 → 25 + 1 1." />
            </span>
          </div>
          <div className="space-y-1">
            <Label className={LABEL_CLASS}>Preset</Label>
            <Select
              value={frKey}
              onValueChange={(v) => {
                const preset = FRAME_RATE_PRESETS.find((p) => `${p.rate}|${p.multiplier}` === v);
                if (preset) {
                  onChange({ ...opts, ttmlFrameRate: preset.rate, ttmlFrameRateMultiplier: preset.multiplier });
                }
              }}
              disabled={locked}
            >
              <SelectTrigger className="h-8 bg-zinc-900 border-zinc-800 text-zinc-300 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-zinc-900 border-zinc-800">
                {FRAME_RATE_PRESETS.map((p) => (
                  <SelectItem key={`${p.rate}|${p.multiplier}`} value={`${p.rate}|${p.multiplier}`} className="text-zinc-300">
                    {p.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1">
              <Label className={LABEL_CLASS}>ttp:frameRate</Label>
              <Input
                type="number" min={1}
                value={opts.ttmlFrameRate}
                onChange={(e) => update("ttmlFrameRate", parseInt(e.target.value) || 30)}
                className="h-8 bg-zinc-900 border-zinc-800 text-zinc-300 text-xs font-mono"
                disabled={locked}
              />
            </div>
            <div className="space-y-1">
              <Label className={LABEL_CLASS}>
                Multiplier
                <Hint text="Use 1000 1001 for 23.98/29.97, 1 1 for 25." />
              </Label>
              <Input
                value={opts.ttmlFrameRateMultiplier}
                onChange={(e) => update("ttmlFrameRateMultiplier", e.target.value)}
                className="h-8 bg-zinc-900 border-zinc-800 text-zinc-300 text-xs font-mono"
                placeholder="1000 1001"
                disabled={locked}
              />
            </div>
            <div className="space-y-1">
              <Label className={LABEL_CLASS}>Text Align</Label>
              <Select value={opts.ttmlTextAlign || "center"} onValueChange={(v) => update("ttmlTextAlign", v)} disabled={locked}>
                <SelectTrigger className="h-8 bg-zinc-900 border-zinc-800 text-zinc-300 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-zinc-900 border-zinc-800">
                  <SelectItem value="center" className="text-zinc-300">center</SelectItem>
                  <SelectItem value="left" className="text-zinc-300">left</SelectItem>
                  <SelectItem value="right" className="text-zinc-300">right</SelectItem>
                  <SelectItem value="start" className="text-zinc-300">start</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Main Panel ───────────────────────────────────────────
export default function CaptionOptionsPanel({ options, onOptionsChange }) {
  const preset = options._preset || "custom";
  const isNbcu = preset === "nbcu";

  const handlePresetChange = (p) => {
    if (p === "nbcu") {
      onOptionsChange({ ...NBCU_CAPTION_OPTIONS, _preset: "nbcu", italicizePhrases: options.italicizePhrases });
    } else if (p === "internal") {
      onOptionsChange({ ...INTERNAL_CAPTION_OPTIONS, _preset: "internal", italicizePhrases: options.italicizePhrases });
    } else {
      onOptionsChange({ ...CAPTION_OPTIONS_DEFAULTS, _preset: "custom", italicizePhrases: options.italicizePhrases });
    }
  };

  const handleChange = (newOpts) => {
    onOptionsChange({ ...newOpts, _preset: isNbcu ? "nbcu" : (preset || "custom") });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-zinc-200">Caption Options</h3>
        <Select value={preset} onValueChange={handlePresetChange}>
          <SelectTrigger className="h-7 w-44 bg-zinc-900 border-zinc-800 text-zinc-300 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="bg-zinc-900 border-zinc-800">
            <SelectItem value="nbcu" className="text-zinc-300">
              <span className="flex items-center gap-1.5"><Shield className="w-3 h-3 text-amber-400" /> NBCU CM-051</span>
            </SelectItem>
            <SelectItem value="internal" className="text-zinc-300">
              <span className="flex items-center gap-1.5"><Briefcase className="w-3 h-3 text-blue-400" /> Internal / Editorial</span>
            </SelectItem>
            <SelectItem value="custom" className="text-zinc-300">Custom</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {isNbcu && (
        <div className="rounded-lg bg-amber-500/5 border border-amber-500/20 px-3 py-2">
          <p className="text-[11px] text-amber-400/90 leading-relaxed">
            <Shield className="w-3 h-3 inline mr-1 -mt-0.5" />
            NBCU CM-051 compliance — output locked to TTML, speakers dash-only, sound labels simple, alignment none. Italicize phrases still editable.
          </p>
        </div>
      )}

      <OutputSection opts={options} onChange={handleChange} locked={isNbcu} />
      <SpeakerSection opts={options} onChange={handleChange} locked={isNbcu} />
      <SoundLabelSection opts={options} onChange={handleChange} locked={isNbcu} />
      <ItalicsSection opts={options} onChange={handleChange} />
      <AlignmentSection opts={options} onChange={handleChange} locked={isNbcu} />
      <TimecodeSection opts={options} onChange={handleChange} />
    </div>
  );
}