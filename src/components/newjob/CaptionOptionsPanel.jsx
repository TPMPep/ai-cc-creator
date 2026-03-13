import React from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Shield, HelpCircle, FileOutput, Film, Users, Volume2, Italic, AlignCenter, Clock, Plus, Trash2, SlidersHorizontal } from "lucide-react";
import { CAPTION_OPTIONS_DEFAULTS, NBCU_LOCKED_VALUES, CUSTOM_OVERRIDES_CONFIG } from "../shared/RulesDefaults";

const SEC = "space-y-3 border-b border-zinc-800/40 pb-4 last:border-0 last:pb-0";
const LBL = "text-xs text-zinc-400";

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

// ─── Output / Delivery Format ──────────────────
const FR_PRESETS = [
  { label: "29.97 fps (NTSC)", rate: 30, mul: "1000 1001" },
  { label: "23.98 fps (Film)", rate: 24, mul: "1000 1001" },
  { label: "25 fps (PAL)",     rate: 25, mul: "1 1" },
  { label: "24 fps (True)",    rate: 24, mul: "1 1" },
  { label: "30 fps (True)",    rate: 30, mul: "1 1" },
];

function OutputSection({ opts, up, locked }) {
  const hasTtml = (opts.outputFormat || "").includes("ttml");
  const frPreset = FR_PRESETS.find(p => p.rate === opts.ttmlFrameRate && p.mul === opts.ttmlFrameRateMultiplier);
  const frKey = frPreset ? `${frPreset.rate}|${frPreset.mul}` : "custom";

  return (
    <div className={SEC}>
      <div className="flex items-center gap-2 mb-1">
        <FileOutput className="w-3.5 h-3.5 text-orange-400" />
        <span className="text-xs font-semibold text-zinc-300">Delivery Format</span>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label className={LBL}>Output Format <Hint text="NBCU requires TTML (IMSC-1.1 Text Profile). SRT is internal-only." /></Label>
          <Select value={opts.outputFormat || "ttml"} onValueChange={v => up("outputFormat", v)} disabled={locked}>
            <SelectTrigger className="h-8 bg-zinc-900 border-zinc-800 text-zinc-300 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent className="bg-zinc-900 border-zinc-800">
              <SelectItem value="ttml" className="text-zinc-300">TTML (broadcast)</SelectItem>
              <SelectItem value="srt" className="text-zinc-300">SRT (internal/QA)</SelectItem>
              <SelectItem value="scc" className="text-zinc-300">SCC (legacy)</SelectItem>
              <SelectItem value="srt,ttml" className="text-zinc-300">SRT + TTML</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className={LBL}>Timebase <Hint text="NBCU requires ttp:timeBase=media." /></Label>
          <Select value={opts.ttmlTimebase || "media"} onValueChange={v => up("ttmlTimebase", v)} disabled={locked || !hasTtml}>
            <SelectTrigger className="h-8 bg-zinc-900 border-zinc-800 text-zinc-300 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent className="bg-zinc-900 border-zinc-800">
              <SelectItem value="media" className="text-zinc-300">media</SelectItem>
              <SelectItem value="smpte" className="text-zinc-300">smpte</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      {hasTtml && (
        <div className="space-y-3 mt-2">
          <div className="flex items-center gap-2">
            <Film className="w-3 h-3 text-zinc-500" />
            <span className="text-[10px] font-medium text-zinc-500 uppercase tracking-wider">
              Frame Rate <Hint text="Must match source. 23.98→24+1000 1001. 29.97→30+1000 1001. 25→25+1 1." />
            </span>
          </div>
          <Select value={frKey} onValueChange={v => { const p = FR_PRESETS.find(x => `${x.rate}|${x.mul}` === v); if (p) { up("ttmlFrameRate", p.rate); up("ttmlFrameRateMultiplier", p.mul); } }} disabled={locked}>
            <SelectTrigger className="h-8 bg-zinc-900 border-zinc-800 text-zinc-300 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent className="bg-zinc-900 border-zinc-800">
              {FR_PRESETS.map(p => <SelectItem key={`${p.rate}|${p.mul}`} value={`${p.rate}|${p.mul}`} className="text-zinc-300">{p.label}</SelectItem>)}
            </SelectContent>
          </Select>
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1">
              <Label className={LBL}>ttp:frameRate</Label>
              <Input type="number" min={1} value={opts.ttmlFrameRate} onChange={e => up("ttmlFrameRate", parseInt(e.target.value) || 30)} className="h-8 bg-zinc-900 border-zinc-800 text-zinc-300 text-xs font-mono" disabled={locked} />
            </div>
            <div className="space-y-1">
              <Label className={LBL}>Multiplier <Hint text="1000 1001 for 23.98/29.97, 1 1 for 25." /></Label>
              <Input value={opts.ttmlFrameRateMultiplier} onChange={e => up("ttmlFrameRateMultiplier", e.target.value)} className="h-8 bg-zinc-900 border-zinc-800 text-zinc-300 text-xs font-mono" disabled={locked} />
            </div>
            <div className="space-y-1">
              <Label className={LBL}>Text Align</Label>
              <Select value={opts.ttmlTextAlign || "center"} onValueChange={v => up("ttmlTextAlign", v)} disabled={locked}>
                <SelectTrigger className="h-8 bg-zinc-900 border-zinc-800 text-zinc-300 text-xs"><SelectValue /></SelectTrigger>
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

// ─── Speaker ───────────────────────────────────
function SpeakerSection({ opts, up, locked }) {
  const nameMapStr = React.useMemo(() => {
    if (!opts.speakerNameMap || typeof opts.speakerNameMap !== "object") return "";
    return JSON.stringify(opts.speakerNameMap);
  }, [opts.speakerNameMap]);

  return (
    <div className={SEC}>
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
              <Label className={LBL}>Mode <Hint text="NBCU forbids speaker names. Use Dash for NBCU." /></Label>
              <Select value={opts.speakerLabelMode} onValueChange={v => up("speakerLabelMode", v)}>
                <SelectTrigger className="h-8 bg-zinc-900 border-zinc-800 text-zinc-300 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent className="bg-zinc-900 border-zinc-800">
                  <SelectItem value="dash" className="text-zinc-300">Dash (—)</SelectItem>
                  <SelectItem value="alpha" className="text-zinc-300">Alpha (A, B, C)</SelectItem>
                  <SelectItem value="generic" className="text-zinc-300">Generic (SPEAKER 1)</SelectItem>
                  <SelectItem value="named" className="text-zinc-300">Named (custom)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className={LBL}>Format</Label>
              <Select value={opts.speakerLabelFormat} onValueChange={v => up("speakerLabelFormat", v)}>
                <SelectTrigger className="h-8 bg-zinc-900 border-zinc-800 text-zinc-300 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent className="bg-zinc-900 border-zinc-800">
                  <SelectItem value="prefix" className="text-zinc-300">Prefix (- Andy:)</SelectItem>
                  <SelectItem value="bracket" className="text-zinc-300">Bracket (-[Andy])</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="flex items-center justify-between py-1">
            <Label className={LBL}>Label single-speaker cues <Hint text="Should remain OFF for NBCU." /></Label>
            <Switch checked={!!opts.speakerLabelSingle} onCheckedChange={v => up("speakerLabelSingle", v ? 1 : 0)} className="data-[state=checked]:bg-blue-600" />
          </div>
          {opts.speakerLabelMode === "generic" && (
            <div className="space-y-1">
              <Label className={LBL}>Generic prefix</Label>
              <Input value={opts.speakerGenericPrefix} onChange={e => up("speakerGenericPrefix", e.target.value)} className="h-8 bg-zinc-900 border-zinc-800 text-zinc-300 text-xs" placeholder="SPEAKER" />
            </div>
          )}
          {opts.speakerLabelMode === "named" && (
            <div className="space-y-1">
              <Label className={LBL}>Name map (JSON)</Label>
              <Input value={nameMapStr} onChange={e => { try { up("speakerNameMap", JSON.parse(e.target.value)); } catch {} }} className="h-8 bg-zinc-900 border-zinc-800 text-zinc-300 text-xs font-mono" placeholder='{"A":"Andy","B":"Aesha"}' />
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ─── Sound ─────────────────────────────────────
function SoundSection({ opts, up, locked }) {
  return (
    <div className={SEC}>
      <div className="flex items-center gap-2 mb-1">
        <Volume2 className="w-3.5 h-3.5 text-emerald-400" />
        <span className="text-xs font-semibold text-zinc-300">Sound Cues</span>
        {locked && <span className="text-[10px] text-amber-400 ml-auto">NBCU: simple</span>}
      </div>
      <div className="space-y-1">
        <Label className={LBL}>Style <Hint text="NBCU expects simple bracket cues: [LAUGHTER], [APPLAUSE], [MUSIC]." /></Label>
        <Select value={opts.soundLabelStyle} onValueChange={v => up("soundLabelStyle", v)} disabled={locked}>
          <SelectTrigger className="h-8 bg-zinc-900 border-zinc-800 text-zinc-300 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent className="bg-zinc-900 border-zinc-800">
            <SelectItem value="simple" className="text-zinc-300">Simple — [APPLAUSE]</SelectItem>
            <SelectItem value="descriptive" className="text-zinc-300">Descriptive — [audience applauds]</SelectItem>
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}

// ─── Italics ───────────────────────────────────
function ItalicsSection({ opts, up }) {
  return (
    <div className={SEC}>
      <div className="flex items-center gap-2 mb-1">
        <Italic className="w-3.5 h-3.5 text-purple-400" />
        <span className="text-xs font-semibold text-zinc-300">Italics (Titles)</span>
      </div>
      <div className="flex items-center justify-between py-1">
        <Label className={LBL}>Auto-italicize titles <Hint text="Automatically italicizes detected show titles (universal, no hard-coding)." /></Label>
        <Switch checked={!!opts.italicizeTitles} onCheckedChange={v => up("italicizeTitles", v ? 1 : 0)} className="data-[state=checked]:bg-purple-600" />
      </div>
      {!!opts.italicizeTitles && (
        <div className="space-y-1">
          <Label className={LBL}>Min words <Hint text="Minimum word count for auto-detected title phrases." /></Label>
          <Input type="number" min={1} max={10} value={opts.italicizeTitlesMinWords} onChange={e => up("italicizeTitlesMinWords", parseInt(e.target.value) || 3)} className="h-8 bg-zinc-900 border-zinc-800 text-zinc-300 text-xs w-24" />
        </div>
      )}
      <div className="space-y-1">
        <Label className={LBL}>Manual title list <Hint text="Optional comma-separated override list." /></Label>
        <Input value={opts.italicizePhrases} onChange={e => up("italicizePhrases", e.target.value)} className="h-8 bg-zinc-900 border-zinc-800 text-zinc-300 text-xs" placeholder="Watch What Happens Live,Below Deck Med" />
      </div>
    </div>
  );
}

// ─── Alignment ─────────────────────────────────
function AlignmentSection({ opts, up, locked }) {
  const windows = opts.alignmentWindows || [];
  const addWin = () => up("alignmentWindows", [...windows, { start: "", end: "", align: "an8" }]);
  const removeWin = i => up("alignmentWindows", windows.filter((_, idx) => idx !== i));
  const updateWin = (i, f, v) => up("alignmentWindows", windows.map((w, idx) => idx === i ? { ...w, [f]: v } : w));

  return (
    <div className={SEC}>
      <div className="flex items-center gap-2 mb-1">
        <AlignCenter className="w-3.5 h-3.5 text-amber-400" />
        <span className="text-xs font-semibold text-zinc-300">Alignment</span>
      </div>
      <div className="space-y-1">
        <Label className={LBL}>Default <Hint text="TTML doesn't require SRT alignment tags. Use 'none' for NBCU." /></Label>
        <Select value={opts.alignmentDefault} onValueChange={v => up("alignmentDefault", v)} disabled={locked}>
          <SelectTrigger className="h-8 bg-zinc-900 border-zinc-800 text-zinc-300 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent className="bg-zinc-900 border-zinc-800">
            <SelectItem value="none" className="text-zinc-300">None</SelectItem>
            <SelectItem value="an2" className="text-zinc-300">{"\\an2"} (bottom center)</SelectItem>
            <SelectItem value="an8" className="text-zinc-300">{"\\an8"} (top center)</SelectItem>
          </SelectContent>
        </Select>
      </div>
      {!locked && (
        <div className="space-y-2 mt-1">
          <div className="flex items-center justify-between">
            <Label className={LBL}>Windows <Hint text="Override alignment for specific timecode ranges." /></Label>
            <Button size="sm" variant="ghost" className="h-6 px-2 text-xs text-zinc-500 hover:text-zinc-300" onClick={addWin}><Plus className="w-3 h-3 mr-1" /> Add</Button>
          </div>
          {windows.map((w, i) => (
            <div key={i} className="flex items-center gap-2">
              <Input value={w.start} onChange={e => updateWin(i, "start", e.target.value)} className="h-7 bg-zinc-900 border-zinc-800 text-zinc-300 text-[10px] font-mono flex-1" placeholder="01:00:26,000" />
              <span className="text-zinc-600 text-[10px]">→</span>
              <Input value={w.end} onChange={e => updateWin(i, "end", e.target.value)} className="h-7 bg-zinc-900 border-zinc-800 text-zinc-300 text-[10px] font-mono flex-1" placeholder="01:00:33,000" />
              <Select value={w.align} onValueChange={v => updateWin(i, "align", v)}>
                <SelectTrigger className="h-7 w-20 bg-zinc-900 border-zinc-800 text-zinc-300 text-[10px]"><SelectValue /></SelectTrigger>
                <SelectContent className="bg-zinc-900 border-zinc-800">
                  <SelectItem value="an2" className="text-zinc-300">an2</SelectItem>
                  <SelectItem value="an8" className="text-zinc-300">an8</SelectItem>
                </SelectContent>
              </Select>
              <button onClick={() => removeWin(i)} className="text-zinc-600 hover:text-red-400"><Trash2 className="w-3 h-3" /></button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Timecode ──────────────────────────────────
function TimecodeSection({ opts, up }) {
  return (
    <div className={SEC}>
      <div className="flex items-center gap-2 mb-1">
        <Clock className="w-3.5 h-3.5 text-cyan-400" />
        <span className="text-xs font-semibold text-zinc-300">Timecode Offset</span>
      </div>
      <div className="space-y-1">
        <Label className={LBL}>Offset (ms)</Label>
        <Input type="number" min={0} step={1000} value={opts.timecodeOffsetMs} onChange={e => up("timecodeOffsetMs", parseInt(e.target.value) || 0)} className="h-8 bg-zinc-900 border-zinc-800 text-zinc-300 text-xs w-40" />
        <span className="text-[10px] text-zinc-600">e.g. 3600000 = 01:00:00</span>
      </div>
    </div>
  );
}

// ─── Custom Overrides (only shown for custom profile) ───
function CustomOverridesSection({ opts, up }) {
  return (
    <div className={SEC}>
      <div className="flex items-center gap-2 mb-1">
        <SlidersHorizontal className="w-3.5 h-3.5 text-rose-400" />
        <span className="text-xs font-semibold text-zinc-300">Caption Rules (Custom Overrides)</span>
      </div>
      <p className="text-[10px] text-zinc-600 mb-2">These override NBCU-safe defaults. If blank, NBCU defaults remain.</p>
      <div className="grid grid-cols-2 gap-x-4 gap-y-3">
        {Object.entries(CUSTOM_OVERRIDES_CONFIG).map(([key, cfg]) => (
          <div key={key} className="space-y-1">
            <Label className={LBL}>{cfg.label}</Label>
            <Input
              type="number"
              min={cfg.min}
              max={cfg.max}
              value={opts[key] ?? cfg.default}
              onChange={e => {
                const val = parseInt(e.target.value);
                if (!isNaN(val)) up(key, Math.min(cfg.max, Math.max(cfg.min, val)));
              }}
              className="h-8 bg-zinc-900 border-zinc-800 text-zinc-300 text-xs"
            />
            <span className="text-[10px] text-zinc-600">{cfg.min}–{cfg.max}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── NBCU Locked Summary ──────────────────────
function NbcuLockedSummary() {
  const items = [
    ["Output", "TTML"],
    ["Speakers", "Dash (no names)"],
    ["Max Lines", "2"],
    ["Max Chars", "32"],
    ["Sound", "Simple"],
    ["Alignment", "None"],
  ];
  return (
    <div className="rounded-lg bg-amber-500/5 border border-amber-500/20 px-3 py-2.5">
      <p className="text-[11px] text-amber-400/90 leading-relaxed mb-2">
        <Shield className="w-3 h-3 inline mr-1 -mt-0.5" />
        NBCU CM-051 compliance active — core rules are locked to spec.
      </p>
      <div className="grid grid-cols-3 gap-x-4 gap-y-1">
        {items.map(([k, v]) => (
          <div key={k} className="flex justify-between text-[10px]">
            <span className="text-zinc-500">{k}</span>
            <span className="text-zinc-400 font-mono">{v}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Main ──────────────────────────────────────
export default function CaptionOptionsPanel({ options, onOptionsChange }) {
  const isNbcu = (options.captionProfile || "nbcu") === "nbcu";

  const up = (key, val) => {
    onOptionsChange({ ...options, [key]: val });
  };

  const switchProfile = (p) => {
    if (p === "nbcu") {
      // Apply NBCU locks, preserve user-editable fields
      onOptionsChange({
        ...options,
        captionProfile: "nbcu",
        ...NBCU_LOCKED_VALUES,
      });
    } else {
      onOptionsChange({ ...options, captionProfile: "custom" });
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-zinc-200">Caption Options</h3>
        <Select value={isNbcu ? "nbcu" : "custom"} onValueChange={switchProfile}>
          <SelectTrigger className="h-7 w-44 bg-zinc-900 border-zinc-800 text-zinc-300 text-xs">
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

      {isNbcu && <NbcuLockedSummary />}

      <OutputSection opts={options} up={up} locked={isNbcu} />
      <SpeakerSection opts={options} up={up} locked={isNbcu} />
      <SoundSection opts={options} up={up} locked={isNbcu} />
      <ItalicsSection opts={options} up={up} />
      <AlignmentSection opts={options} up={up} locked={isNbcu} />
      <TimecodeSection opts={options} up={up} />

      {!isNbcu && <CustomOverridesSection opts={options} up={up} />}
    </div>
  );
}