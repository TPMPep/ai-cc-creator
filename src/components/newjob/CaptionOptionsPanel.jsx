import React from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Shield, HelpCircle, FileOutput, Film, Users, Volume2, Italic, AlignCenter, Clock, Plus, Trash2, SlidersHorizontal, CheckCircle, Activity } from "lucide-react";
import { CAPTION_OPTIONS_DEFAULTS, NBCU_LOCKED_VALUES, CUSTOM_OVERRIDES_CONFIG } from "../shared/RulesDefaults";

const SEC = "space-y-3 border-b border-zinc-700/30 pb-5 last:border-0 last:pb-0";
const LBL = "text-xs text-zinc-300 font-medium";
const INPUT_CLS = "h-9 bg-zinc-800/80 border-zinc-500/60 text-zinc-100 text-xs focus:border-blue-400 focus:ring-2 focus:ring-blue-500/30";
const SELECT_TRIGGER_CLS = "h-9 bg-zinc-800/80 border-zinc-500/60 text-zinc-200 text-xs";
const SELECT_CONTENT_CLS = "bg-zinc-800 border-zinc-500/60";
const SELECT_ITEM_CLS = "text-zinc-200";

function Hint({ text }) {
  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <HelpCircle className="w-3 h-3 text-zinc-600 hover:text-zinc-400 cursor-help inline ml-1 -mt-0.5" />
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-xs bg-zinc-700 border-zinc-600 text-zinc-100 text-xs shadow-lg">
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
      <div className="flex items-center gap-2 mb-2">
        <FileOutput className="w-4 h-4 text-orange-400" />
        <span className="text-sm font-semibold text-zinc-100">Delivery Format</span>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label className={LBL}>Output Format <Hint text="NBCU requires TTML (IMSC-1.1 Text Profile). SRT is internal-only." /></Label>
          <Select value={opts.outputFormat || "ttml"} onValueChange={v => up("outputFormat", v)} disabled={locked}>
            <SelectTrigger className={SELECT_TRIGGER_CLS}><SelectValue /></SelectTrigger>
            <SelectContent className={SELECT_CONTENT_CLS}>
              <SelectItem value="ttml" className={SELECT_ITEM_CLS}>TTML (broadcast)</SelectItem>
              <SelectItem value="srt" className={SELECT_ITEM_CLS}>SRT (internal/QA)</SelectItem>
              <SelectItem value="scc" className={SELECT_ITEM_CLS}>SCC (legacy)</SelectItem>
              <SelectItem value="srt,ttml" className={SELECT_ITEM_CLS}>SRT + TTML</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label className={LBL}>Timebase <Hint text="NBCU requires ttp:timeBase=media." /></Label>
          <Select value={opts.ttmlTimebase || "media"} onValueChange={v => up("ttmlTimebase", v)} disabled={locked || !hasTtml}>
            <SelectTrigger className={SELECT_TRIGGER_CLS}><SelectValue /></SelectTrigger>
            <SelectContent className={SELECT_CONTENT_CLS}>
              <SelectItem value="media" className={SELECT_ITEM_CLS}>media</SelectItem>
              <SelectItem value="smpte" className={SELECT_ITEM_CLS}>smpte</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      {hasTtml && (
        <div className="space-y-3 mt-3">
          <div className="flex items-center gap-2">
            <Film className="w-3.5 h-3.5 text-zinc-400" />
            <span className="text-xs font-medium text-zinc-400 uppercase tracking-wider">
              Frame Rate <Hint text="Must match source. 23.98→24+1000 1001. 29.97→30+1000 1001. 25→25+1 1." />
            </span>
          </div>
          <Select value={frKey} onValueChange={v => { const p = FR_PRESETS.find(x => `${x.rate}|${x.mul}` === v); if (p) { up("ttmlFrameRate", p.rate); up("ttmlFrameRateMultiplier", p.mul); } }} disabled={locked}>
            <SelectTrigger className={SELECT_TRIGGER_CLS}><SelectValue /></SelectTrigger>
            <SelectContent className={SELECT_CONTENT_CLS}>
              {FR_PRESETS.map(p => <SelectItem key={`${p.rate}|${p.mul}`} value={`${p.rate}|${p.mul}`} className={SELECT_ITEM_CLS}>{p.label}</SelectItem>)}
            </SelectContent>
          </Select>
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1.5">
              <Label className={LBL}>ttp:frameRate</Label>
              <Input type="number" min={1} value={opts.ttmlFrameRate} onChange={e => up("ttmlFrameRate", parseInt(e.target.value) || 30)} className={INPUT_CLS + " font-mono"} disabled={locked} />
            </div>
            <div className="space-y-1.5">
              <Label className={LBL}>Multiplier <Hint text="1000 1001 for 23.98/29.97, 1 1 for 25." /></Label>
              <Input value={opts.ttmlFrameRateMultiplier} onChange={e => up("ttmlFrameRateMultiplier", e.target.value)} className={INPUT_CLS + " font-mono"} disabled={locked} />
            </div>
            <div className="space-y-1.5">
              <Label className={LBL}>Text Align</Label>
              <Select value={opts.ttmlTextAlign || "center"} onValueChange={v => up("ttmlTextAlign", v)} disabled={locked}>
                <SelectTrigger className={SELECT_TRIGGER_CLS}><SelectValue /></SelectTrigger>
                <SelectContent className={SELECT_CONTENT_CLS}>
                  <SelectItem value="center" className={SELECT_ITEM_CLS}>center</SelectItem>
                  <SelectItem value="left" className={SELECT_ITEM_CLS}>left</SelectItem>
                  <SelectItem value="right" className={SELECT_ITEM_CLS}>right</SelectItem>
                  <SelectItem value="start" className={SELECT_ITEM_CLS}>start</SelectItem>
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
      <div className="flex items-center gap-2 mb-2">
        <Users className="w-4 h-4 text-blue-400" />
        <span className="text-sm font-semibold text-zinc-100">Speaker Formatting</span>
        {locked && <span className="text-[10px] text-amber-400/90 ml-auto bg-amber-500/10 px-2 py-0.5 rounded-full">NBCU: dash only</span>}
      </div>
      {locked ? (
        <p className="text-xs text-zinc-400">Locked to dash mode (no speaker names) per NBCU CM-051.</p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label className={LBL}>Mode <Hint text="NBCU forbids speaker names. Use Dash for NBCU." /></Label>
              <Select value={opts.speakerLabelMode} onValueChange={v => up("speakerLabelMode", v)}>
                <SelectTrigger className={SELECT_TRIGGER_CLS}><SelectValue /></SelectTrigger>
                <SelectContent className={SELECT_CONTENT_CLS}>
                  <SelectItem value="dash" className={SELECT_ITEM_CLS}>Dash (—)</SelectItem>
                  <SelectItem value="alpha" className={SELECT_ITEM_CLS}>Alpha (A, B, C)</SelectItem>
                  <SelectItem value="generic" className={SELECT_ITEM_CLS}>Generic (SPEAKER 1)</SelectItem>
                  <SelectItem value="named" className={SELECT_ITEM_CLS}>Named (custom)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className={LBL}>Format</Label>
              <Select value={opts.speakerLabelFormat} onValueChange={v => up("speakerLabelFormat", v)}>
                <SelectTrigger className={SELECT_TRIGGER_CLS}><SelectValue /></SelectTrigger>
                <SelectContent className={SELECT_CONTENT_CLS}>
                  <SelectItem value="prefix" className={SELECT_ITEM_CLS}>Prefix (- Andy:)</SelectItem>
                  <SelectItem value="bracket" className={SELECT_ITEM_CLS}>Bracket (-[Andy])</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="flex items-center justify-between py-2">
            <Label className={LBL}>Label single-speaker cues <Hint text="Should remain OFF for NBCU." /></Label>
            <Switch checked={!!opts.speakerLabelSingle} onCheckedChange={v => up("speakerLabelSingle", v ? 1 : 0)} className="data-[state=checked]:bg-blue-600" />
          </div>
          {opts.speakerLabelMode === "generic" && (
            <div className="space-y-1.5">
              <Label className={LBL}>Generic prefix</Label>
              <Input value={opts.speakerGenericPrefix} onChange={e => up("speakerGenericPrefix", e.target.value)} className={INPUT_CLS} placeholder="SPEAKER" />
            </div>
          )}
          {opts.speakerLabelMode === "named" && (
            <div className="space-y-1.5">
              <Label className={LBL}>Name map (JSON)</Label>
              <Input value={nameMapStr} onChange={e => { try { up("speakerNameMap", JSON.parse(e.target.value)); } catch {} }} className={INPUT_CLS + " font-mono"} placeholder='{"A":"Andy","B":"Aesha"}' />
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ─── TTML Validation ──────────────────────────
function ValidationSection({ opts, up, locked }) {
  return (
    <div className={SEC}>
      <div className="flex items-center gap-2 mb-2">
        <CheckCircle className="w-4 h-4 text-teal-400" />
        <span className="text-sm font-semibold text-zinc-100">TTML Validation</span>
        {locked && <span className="text-[10px] text-amber-400/90 ml-auto bg-amber-500/10 px-2 py-0.5 rounded-full">NBCU: required</span>}
      </div>
      <div className="space-y-2">
        <div className="flex items-center justify-between py-2">
          <Label className={LBL}>Validate TTML output <Hint text="Runs IMSC-1.1 conformance checks on the generated TTML." /></Label>
          <Switch checked={!!opts.validateTtml} onCheckedChange={v => up("validateTtml", v ? 1 : 0)} disabled={locked} className="data-[state=checked]:bg-teal-600" />
        </div>
        <div className="flex items-center justify-between py-2">
          <Label className={LBL}>Fail on validation error <Hint text="If ON, the job fails when TTML validation finds issues. NBCU requires this." /></Label>
          <Switch checked={!!opts.failOnTtmlValidation} onCheckedChange={v => up("failOnTtmlValidation", v ? 1 : 0)} disabled={locked} className="data-[state=checked]:bg-teal-600" />
        </div>
      </div>
    </div>
  );
}

// ─── Sound Density ────────────────────────────
function SoundDensitySection({ opts, up, locked }) {
  return (
    <div className={SEC}>
      <div className="flex items-center gap-2 mb-2">
        <Activity className="w-4 h-4 text-sky-400" />
        <span className="text-sm font-semibold text-zinc-100">Sound Cue Density</span>
        {locked && <span className="text-[10px] text-amber-400/90 ml-auto bg-amber-500/10 px-2 py-0.5 rounded-full">NBCU: conservative</span>}
      </div>
      <div className="space-y-1.5">
        <Label className={LBL}>Density <Hint text="Controls how many sound cues are inserted. Conservative = strict NBCU style. Balanced = more cues. Aggressive = most cues with trimming." /></Label>
        <Select value={opts.soundDensity || "conservative"} onValueChange={v => up("soundDensity", v)} disabled={locked}>
          <SelectTrigger className={SELECT_TRIGGER_CLS}><SelectValue /></SelectTrigger>
          <SelectContent className={SELECT_CONTENT_CLS}>
            <SelectItem value="conservative" className={SELECT_ITEM_CLS}>Conservative (NBCU safe)</SelectItem>
            <SelectItem value="balanced" className={SELECT_ITEM_CLS}>Balanced</SelectItem>
            <SelectItem value="aggressive" className={SELECT_ITEM_CLS}>Aggressive</SelectItem>
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}

// ─── Sound ─────────────────────────────────────
function SoundSection({ opts, up, locked }) {
  return (
    <div className={SEC}>
      <div className="flex items-center gap-2 mb-2">
        <Volume2 className="w-4 h-4 text-emerald-400" />
        <span className="text-sm font-semibold text-zinc-100">Sound Cues</span>
        {locked && <span className="text-[10px] text-amber-400/90 ml-auto bg-amber-500/10 px-2 py-0.5 rounded-full">NBCU: simple</span>}
      </div>
      <div className="space-y-1.5">
        <Label className={LBL}>Style <Hint text="NBCU expects simple bracket cues: [LAUGHTER], [APPLAUSE], [MUSIC]." /></Label>
        <Select value={opts.soundLabelStyle} onValueChange={v => up("soundLabelStyle", v)} disabled={locked}>
          <SelectTrigger className={SELECT_TRIGGER_CLS}><SelectValue /></SelectTrigger>
          <SelectContent className={SELECT_CONTENT_CLS}>
            <SelectItem value="simple" className={SELECT_ITEM_CLS}>Simple — [APPLAUSE]</SelectItem>
            <SelectItem value="descriptive" className={SELECT_ITEM_CLS}>Descriptive — [audience applauds]</SelectItem>
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
      <div className="flex items-center gap-2 mb-2">
        <Italic className="w-4 h-4 text-purple-400" />
        <span className="text-sm font-semibold text-zinc-100">Italics (Titles)</span>
      </div>
      <div className="flex items-center justify-between py-2">
        <Label className={LBL}>Auto-italicize titles <Hint text="Automatically italicizes detected show titles (universal, no hard-coding)." /></Label>
        <Switch checked={!!opts.italicizeTitles} onCheckedChange={v => up("italicizeTitles", v ? 1 : 0)} className="data-[state=checked]:bg-purple-600" />
      </div>
      {!!opts.italicizeTitles && (
        <div className="space-y-1.5">
          <Label className={LBL}>Min words <Hint text="Minimum word count for auto-detected title phrases." /></Label>
          <Input type="number" min={1} max={10} value={opts.italicizeTitlesMinWords} onChange={e => up("italicizeTitlesMinWords", parseInt(e.target.value) || 3)} className={INPUT_CLS + " w-24"} />
        </div>
      )}
      <div className="space-y-1.5">
        <Label className={LBL}>Manual title list <Hint text="Optional comma-separated override list." /></Label>
        <Input value={opts.italicizePhrases} onChange={e => up("italicizePhrases", e.target.value)} className={INPUT_CLS} placeholder="Watch What Happens Live,Below Deck Med" />
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
      <div className="flex items-center gap-2 mb-2">
        <AlignCenter className="w-4 h-4 text-amber-400" />
        <span className="text-sm font-semibold text-zinc-100">Alignment</span>
      </div>
      <div className="space-y-1.5">
        <Label className={LBL}>Default <Hint text="TTML doesn't require SRT alignment tags. Use 'none' for NBCU." /></Label>
        <Select value={opts.alignmentDefault} onValueChange={v => up("alignmentDefault", v)} disabled={locked}>
          <SelectTrigger className={SELECT_TRIGGER_CLS}><SelectValue /></SelectTrigger>
          <SelectContent className={SELECT_CONTENT_CLS}>
            <SelectItem value="none" className={SELECT_ITEM_CLS}>None</SelectItem>
            <SelectItem value="an2" className={SELECT_ITEM_CLS}>{"\\an2"} (bottom center)</SelectItem>
            <SelectItem value="an8" className={SELECT_ITEM_CLS}>{"\\an8"} (top center)</SelectItem>
          </SelectContent>
        </Select>
      </div>
      {!locked && (
        <div className="space-y-2 mt-2">
          <div className="flex items-center justify-between">
            <Label className={LBL}>Windows <Hint text="Override alignment for specific timecode ranges." /></Label>
            <Button size="sm" variant="ghost" className="h-7 px-2 text-xs text-zinc-400 hover:text-zinc-200" onClick={addWin}><Plus className="w-3 h-3 mr-1" /> Add</Button>
          </div>
          {windows.map((w, i) => (
            <div key={i} className="flex items-center gap-2">
              <Input value={w.start} onChange={e => updateWin(i, "start", e.target.value)} className="h-8 bg-zinc-800 border-zinc-600 text-zinc-200 text-xs font-mono flex-1" placeholder="01:00:26,000" />
              <span className="text-zinc-500 text-xs">→</span>
              <Input value={w.end} onChange={e => updateWin(i, "end", e.target.value)} className="h-8 bg-zinc-800 border-zinc-600 text-zinc-200 text-xs font-mono flex-1" placeholder="01:00:33,000" />
              <Select value={w.align} onValueChange={v => updateWin(i, "align", v)}>
                <SelectTrigger className="h-8 w-20 bg-zinc-800 border-zinc-600 text-zinc-200 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent className={SELECT_CONTENT_CLS}>
                  <SelectItem value="an2" className={SELECT_ITEM_CLS}>an2</SelectItem>
                  <SelectItem value="an8" className={SELECT_ITEM_CLS}>an8</SelectItem>
                </SelectContent>
              </Select>
              <button onClick={() => removeWin(i)} className="text-zinc-500 hover:text-red-400 transition-colors"><Trash2 className="w-3.5 h-3.5" /></button>
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
      <div className="flex items-center gap-2 mb-2">
        <Clock className="w-4 h-4 text-cyan-400" />
        <span className="text-sm font-semibold text-zinc-100">Timecode Offset</span>
      </div>
      <div className="space-y-1.5">
        <Label className={LBL}>Offset (ms)</Label>
        <Input type="number" min={0} step={1000} value={opts.timecodeOffsetMs} onChange={e => up("timecodeOffsetMs", parseInt(e.target.value) || 0)} className={INPUT_CLS + " w-40"} />
        <span className="text-xs text-zinc-500">e.g. 3600000 = 01:00:00</span>
      </div>
    </div>
  );
}

// ─── Custom Overrides (only shown for custom profile) ───
function CustomOverridesSection({ opts, up }) {
  return (
    <div className={SEC}>
      <div className="flex items-center gap-2 mb-2">
        <SlidersHorizontal className="w-4 h-4 text-rose-400" />
        <span className="text-sm font-semibold text-zinc-100">Caption Rules (Custom Overrides)</span>
      </div>
      <p className="text-xs text-zinc-400 mb-3">These override NBCU-safe defaults. If blank, NBCU defaults remain.</p>
      <div className="grid grid-cols-2 gap-x-4 gap-y-4">
        {Object.entries(CUSTOM_OVERRIDES_CONFIG).map(([key, cfg]) => (
          <div key={key} className="space-y-1.5">
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
              className={INPUT_CLS}
            />
            <span className="text-xs text-zinc-500">{cfg.min}–{cfg.max}</span>
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
    ["Sound Density", "Conservative"],
    ["Alignment", "None"],
    ["TTML Validate", "Yes + Fail"],
  ];
  return (
    <div className="rounded-lg bg-amber-500/10 border border-amber-500/25 px-4 py-3">
      <p className="text-xs text-amber-300 leading-relaxed mb-2.5 font-medium">
        <Shield className="w-3.5 h-3.5 inline mr-1.5 -mt-0.5" />
        NBCU CM-051 compliance active — core rules are locked to spec.
      </p>
      <div className="grid grid-cols-3 gap-x-4 gap-y-1.5">
        {items.map(([k, v]) => (
          <div key={k} className="flex justify-between text-xs">
            <span className="text-zinc-400">{k}</span>
            <span className="text-zinc-200 font-mono">{v}</span>
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
      onOptionsChange({
        ...options,
        captionProfile: "nbcu",
        ...NBCU_LOCKED_VALUES,
      });
    } else {
      onOptionsChange({
        ...options,
        captionProfile: "custom",
        validateTtml: 0,
        failOnTtmlValidation: 0,
        soundDensity: "balanced",
      });
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-base font-bold text-white">Caption Options</h3>
        <Select value={isNbcu ? "nbcu" : "custom"} onValueChange={switchProfile}>
          <SelectTrigger className="h-9 w-48 bg-zinc-800 border-zinc-600 text-zinc-200 text-xs font-medium">
            <SelectValue />
          </SelectTrigger>
          <SelectContent className={SELECT_CONTENT_CLS}>
            <SelectItem value="nbcu" className={SELECT_ITEM_CLS}>
              <span className="flex items-center gap-1.5"><Shield className="w-3.5 h-3.5 text-amber-400" /> NBCU CM-051</span>
            </SelectItem>
            <SelectItem value="custom" className={SELECT_ITEM_CLS}>Custom</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {isNbcu && <NbcuLockedSummary />}

      <OutputSection opts={options} up={up} locked={isNbcu} />
      <ValidationSection opts={options} up={up} locked={isNbcu} />
      <SpeakerSection opts={options} up={up} locked={isNbcu} />
      <SoundSection opts={options} up={up} locked={isNbcu} />
      <SoundDensitySection opts={options} up={up} locked={isNbcu} />
      <ItalicsSection opts={options} up={up} />
      <AlignmentSection opts={options} up={up} locked={isNbcu} />
      <TimecodeSection opts={options} up={up} />

      {!isNbcu && <CustomOverridesSection opts={options} up={up} />}
    </div>
  );
}