export const NBCU_DEFAULTS = {
  maxCharsPerLine: 32,
  maxLines: 2,
  maxCPS: 17,
  minDurationMs: 1000,
  maxDurationMs: 7000,
  minGapMs: 80,
  preferPunctuationBreaks: true,
  sccFrameRate: 29.97,
  startAtHour00: true,
};

export const RULES_VALIDATION = {
  maxCharsPerLine: { min: 20, max: 42, type: "integer", label: "Max Chars/Line" },
  maxLines: { min: 1, max: 3, type: "integer", label: "Max Lines" },
  maxCPS: { min: 10, max: 25, type: "integer", label: "Max CPS" },
  minDurationMs: { min: 200, max: 2000, type: "integer", label: "Min Duration (ms)" },
  maxDurationMs: { min: 2000, max: 10000, type: "integer", label: "Max Duration (ms)" },
  minGapMs: { min: 0, max: 500, type: "integer", label: "Min Gap (ms)" },
  preferPunctuationBreaks: { type: "boolean", label: "Prefer Punctuation Breaks" },
  sccFrameRate: { type: "select", options: [23.976, 24, 25, 29.97, 30], label: "SCC Frame Rate" },
  startAtHour00: { type: "boolean", label: "Start at Hour 00" },
};

export const SCC_FRAME_RATES = [23.976, 24, 25, 29.97, 30];