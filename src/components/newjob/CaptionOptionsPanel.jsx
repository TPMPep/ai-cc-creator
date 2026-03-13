import React from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Users, Italic, Volume2, AlignCenter, Clock, FileOutput, Shield, Film } from "lucide-react";
import { NBCU_CAPTION_OPTIONS, CAPTION_OPTIONS_DEFAULTS } from "../shared/RulesDefaults";

const SECTION_CLASS = "space-y-3 border-b border-zinc-800/40 pb-4 last:border-0 last:pb-0";
const LABEL_CLASS = "text-xs text-zinc-400";

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
        <span className="text-xs font-semibold text-zinc-300">Speaker Labels</span>
        {locked && <span className="text-[10px] text-amber-400 ml-auto">NBCU: dash only</span>}
      </div>
      {locked ? (
        <p className="text-xs text-zinc-500">Locked to dash mode (no speaker names) per NBCU CM-051.</p>
      ) : (
        <>
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
        </>
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

const FRAME_RATE_PRESETS = [
  { label: "29.97 fps (NTSC)", rate: 30, multiplier: "1000 1001" },
  { label: "23.98 fps (Film)", rate: 24, multiplier: "1000 1001" },
  { label: "25 fps (PAL)", rate: 25, multiplier: "1 1" },
  { label: "24 fps (True)", rate: 24, multiplier: "1 1" },
  { label: "30 fps (True)", rate: 30, multiplier: "1 1" },
];

function OutputSection({ opts, onChange, locked }) {
  const update = (key, val) => onChange({ ...opts, [key]: val });
  
  const currentFrPreset = FRAME_RATE_PRESETS.find(
    p => p.rate === opts.ttmlFrameRate && p.multiplier === opts.ttmlFrameRateMultiplier
  );
  const frKey = currentFrPreset ? `${currentFrPreset.rate}|${currentFrPreset.multiplier}` : "custom";

  return (
    <div className={SECTION_CLASS}>
      <div className="flex items-center gap-2 mb-1">
        <FileOutput className="w-3.5 h-3.5 text-orange-400" />
        <span className="text-xs font-semibold text-zinc-300">Output Format</span>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label className={LABEL_CLASS}>Format</Label>
          <Select value={opts.outputFormat || "srt"} onValueChange={(v) => update("outputFormat", v)} disabled={locked}>
            <SelectTrigger className="h-8 bg-zinc-900 border-zinc-800 text-zinc-300 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="bg-zinc-900 border-zinc-800">
              <SelectItem value="srt" className="text-zinc-300">SRT (internal/QA)</SelectItem>
              <SelectItem value="ttml" className="text-zinc-300">TTML (broadcast)</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className={LABEL_CLASS}>Timebase</Label>
          <Select value={opts.ttmlTimebase || "media"} onValueChange={(v) => update("ttmlTimebase", v)} disabled={locked || opts.outputFormat !== "ttml"}>
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
      {(opts.outputFormat === "ttml") && (
        <div className="space-y-3 mt-2">
          <div className="flex items-center gap-2">
            <Film className="w-3 h-3 text-zinc-500" />
            <span className="text-[10px] font-medium text-zinc-500 uppercase tracking-wider">Frame Rate</span>
          </div>
          <div className="space-y-1">
            <Label className={LABEL_CLASS}>Preset</Label>
            <Select
              value={frKey}
              onValueChange={(v) => {
                const preset = FRAME_RATE_PRESETS.find(p => `${p.rate}|${p.multiplier}` === v);
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
                {FRAME_RATE_PRESETS.map(p => (
                  <SelectItem key={`${p.rate}|${p.multiplier}`} value={`${p.rate}|${p.multiplier}`} className="text-zinc-300">
                    {p.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
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
              <Label className={LABEL_CLASS}>ttp:frameRateMultiplier</Label>
              <Input
                value={opts.ttmlFrameRateMultiplier}
                onChange={(e) => update("ttmlFrameRateMultiplier", e.target.value)}
                className="h-8 bg-zinc-900 border-zinc-800 text-zinc-300 text-xs font-mono"
                placeholder="1000 1001"
                disabled={locked}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function CaptionOptionsPanel({ options, onOptionsChange }) {
  const isNbcu = options._preset === "nbcu";

  const handlePresetChange = (preset) => {
    if (preset === "nbcu") {
      onOptionsChange({ ...NBCU_CAPTION_OPTIONS, _preset: "nbcu", italicizePhrases: options.italicizePhrases });
    } else {
      onOptionsChange({ ...CAPTION_OPTIONS_DEFAULTS, _preset: "custom", italicizePhrases: options.italicizePhrases });
    }
  };

  const handleChange = (newOpts) => {
    // If user manually changes anything, drop out of NBCU preset
    onOptionsChange({ ...newOpts, _preset: isNbcu ? "nbcu" : "custom" });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-zinc-200">Caption Options</h3>
        <div className="flex items-center gap-2">
          <Select value={isNbcu ? "nbcu" : "custom"} onValueChange={handlePresetChange}>
            <SelectTrigger className="h-7 w-36 bg-zinc-900 border-zinc-800 text-zinc-300 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="bg-zinc-900 border-zinc-800">
              <SelectItem value="nbcu" className="text-zinc-300">
                <span className="flex items-center gap-1.5"><Shield className="w-3 h-3 text-amber-400" /> NBCU CM-051</span>
              </SelectItem>
              <SelectItem value="custom" className="text-zinc-300">Custom</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      {isNbcu && (
        <div className="rounded-lg bg-amber-500/5 border border-amber-500/20 px-3 py-2">
          <p className="text-[11px] text-amber-400/90 leading-relaxed">
            <Shield className="w-3 h-3 inline mr-1 -mt-0.5" />
            NBCU CM-051 compliance active — output locked to TTML, speakers set to dash-only, sound labels set to simple. Italicize phrases can still be edited.
          </p>
        </div>
      )}
      <OutputSection opts={options} onChange={handleChange} locked={isNbcu} />
      <SpeakerSection opts={options} onChange={handleChange} locked={isNbcu} />
      <ItalicsSection opts={options} onChange={handleChange} />
      <SoundLabelSection opts={options} onChange={isNbcu ? () => {} : handleChange} />
      <AlignmentSection opts={options} onChange={isNbcu ? () => {} : handleChange} />
      <TimecodeSection opts={options} onChange={handleChange} />
    </div>
  );
}