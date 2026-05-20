import React, { useState } from "react";
import { ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function JobConfigPanel({ job }) {
  const [expanded, setExpanded] = useState(false);
  const rules = job?.rules || {};

  if (!rules || Object.keys(rules).length === 0) {
    return null;
  }

  // Format env var names to readable labels
  const formatLabel = (key) => {
    return key
      .replace(/^(CUSTOM_|TTML_|)/, "")
      .replace(/_/g, " ")
      .replace(/\b\w/g, (c) => c.toUpperCase());
  };

  // Group settings by category
  const categories = {
    "Output & Timing": ["OUTPUT_FORMATS", "TTML_TIMEBASE", "TTML_FRAME_RATE", "TTML_FRAME_RATE_MULTIPLIER", "TTML_TEXT_ALIGN"],
    "Formatting": ["CAPTION_PROFILE", "CUSTOM_MAX_CHARS", "CUSTOM_MAX_LINES", "CUSTOM_TARGET_CPS", "CUSTOM_MAX_CPS"],
    "Display Rules": ["CUSTOM_MIN_DISPLAY_MS", "CUSTOM_MIN_SOUND_DISPLAY_MS", "CUSTOM_MIN_SOUND_MS", "CUSTOM_MERGE_GAP_MS", "CUSTOM_SOUND_CLUSTER_GAP_MS"],
    "Advanced": ["SOUND_DENSITY", "SPEAKER_LABEL_MODE", "TIMECODE_OFFSET_MS", "ITALICIZE_TITLES", "ITALICIZE_PHRASES", "ALIGNMENT_DEFAULT", "ALIGNMENT_WINDOWS", "VALIDATE_TTML", "FAIL_ON_TTML_VALIDATION"],
  };

  const categorizeRules = () => {
    const grouped = {};
    for (const [category, keys] of Object.entries(categories)) {
      grouped[category] = keys.filter((k) => rules[k] !== undefined).map((k) => ({ key: k, value: rules[k] }));
    }
    return Object.fromEntries(Object.entries(grouped).filter(([_, v]) => v.length > 0));
  };

  const grouped = categorizeRules();

  return (
    <div className="rounded-xl border border-zinc-800/60 bg-zinc-900/30 overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between p-4 hover:bg-zinc-800/20 transition-colors"
      >
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold text-zinc-200">Job Configuration</h3>
          <span className="text-xs text-zinc-500">({Object.keys(rules).length} settings)</span>
        </div>
        <ChevronDown className={`w-4 h-4 text-zinc-500 transition-transform ${expanded ? "rotate-180" : ""}`} />
      </button>

      {expanded && (
        <div className="border-t border-zinc-800/60 px-4 py-3 space-y-4 max-h-96 overflow-y-auto">
          {Object.entries(grouped).map(([category, items]) => (
            <div key={category}>
              <h4 className="text-xs font-semibold text-zinc-400 uppercase tracking-wide mb-2">{category}</h4>
              <div className="space-y-1.5">
                {items.map(({ key, value }) => (
                  <div key={key} className="flex justify-between gap-3 text-xs">
                    <span className="text-zinc-500 min-w-fit">{formatLabel(key)}:</span>
                    <code className="text-zinc-300 text-right break-words font-mono">{String(value).substring(0, 60)}</code>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}