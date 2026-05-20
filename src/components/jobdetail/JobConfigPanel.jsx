import React, { useState } from "react";
import { ChevronDown, Shield, SlidersHorizontal } from "lucide-react";

const LABEL_MAP = {
  captionProfile: "Profile",
  outputFormat: "Output Format",
  ttmlTimebase: "TTML Timebase",
  ttmlFrameRate: "Frame Rate",
  ttmlFrameRateMultiplier: "Frame Rate Multiplier",
  ttmlTextAlign: "Text Align",
  speakerLabelMode: "Speaker Mode",
  speakerLabelFormat: "Speaker Format",
  speakerLabelSingle: "Label Single Speaker",
  speakerGenericPrefix: "Generic Prefix",
  soundLabelStyle: "Sound Style",
  soundDensity: "Sound Density",
  italicizeTitles: "Auto-Italicize Titles",
  italicizePhrases: "Italic Phrases",
  alignmentDefault: "Default Alignment",
  timecodeOffsetMs: "Timecode Offset",
  validateTtml: "Validate TTML",
  failOnTtmlValidation: "Fail on Validation",
  customMaxLines: "Max Lines",
  customMaxChars: "Max Chars/Line",
  customTargetCps: "Target CPS",
  customMaxCps: "Max CPS",
  customMinDisplayMs: "Min Display (ms)",
  customMinSoundDisplayMs: "Min Sound Display (ms)",
  customMinSoundMs: "Min Sound (ms)",
  customSoundClusterGapMs: "Sound Cluster Gap (ms)",
  customMergeGapMs: "Merge Gap (ms)",
};

const formatValue = (key, val) => {
  if (val === 1 || val === "1") return "Yes";
  if (val === 0 || val === "0") return "No";
  if (typeof val === "object") return JSON.stringify(val);
  return String(val);
};

export default function JobConfigPanel({ job }) {
  const [expanded, setExpanded] = useState(false);
  const rules = job?.rules;

  if (!rules || Object.keys(rules).length === 0) {
    return (
      <div className="rounded-xl border border-zinc-800/60 bg-zinc-900/30 px-4 py-3 mb-4">
        <div className="flex items-center gap-2">
          <SlidersHorizontal className="w-3.5 h-3.5 text-zinc-500" />
          <span className="text-xs text-zinc-400">No profile applied yet — use the panel below to apply caption formatting rules.</span>
        </div>
      </div>
    );
  }

  const profileName = rules.captionProfile === "nbcu"
    ? "NBCU CM-051"
    : rules.captionProfile === "custom"
      ? "Custom"
      : rules.captionProfile || "Default";

  const isNBCU = rules.captionProfile === "nbcu";

  // Filter out empty/default values for display
  const displayEntries = Object.entries(rules)
    .filter(([key, val]) => {
      if (key === "captionProfile") return false;
      if (key === "speakerNameMap" && (!val || Object.keys(val).length === 0)) return false;
      if (key === "alignmentWindows" && (!val || val.length === 0)) return false;
      if (val === "" || val === null || val === undefined) return false;
      return true;
    })
    .map(([key, val]) => ({ key, label: LABEL_MAP[key] || key, value: formatValue(key, val) }));

  return (
    <div className="rounded-xl border border-zinc-800/60 bg-zinc-900/30 overflow-hidden mb-4">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between p-4 hover:bg-zinc-800/20 transition-colors"
      >
        <div className="flex items-center gap-2.5">
          {isNBCU ? (
            <Shield className="w-4 h-4 text-amber-400" />
          ) : (
            <SlidersHorizontal className="w-4 h-4 text-blue-400" />
          )}
          <span className="text-sm font-semibold text-zinc-200">Applied Profile:</span>
          <span className={`text-sm font-bold ${isNBCU ? "text-amber-300" : "text-blue-300"}`}>{profileName}</span>
          <span className="text-xs text-zinc-500">({displayEntries.length} settings)</span>
        </div>
        <ChevronDown className={`w-4 h-4 text-zinc-500 transition-transform ${expanded ? "rotate-180" : ""}`} />
      </button>

      {expanded && (
        <div className="border-t border-zinc-800/60 px-4 py-3 max-h-72 overflow-y-auto">
          <div className="grid grid-cols-2 md:grid-cols-3 gap-x-6 gap-y-2">
            {displayEntries.map(({ key, label, value }) => (
              <div key={key} className="flex justify-between gap-2 text-xs py-1">
                <span className="text-zinc-500 whitespace-nowrap">{label}</span>
                <span className="text-zinc-300 font-mono text-right truncate max-w-32">{value}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}