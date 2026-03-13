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

// Custom override fields and their defaults/validation
export const CUSTOM_OVERRIDES_CONFIG = {
  customMaxLines:          { default: 2,    min: 1,   max: 4,     label: "Max Lines" },
  customMaxChars:          { default: 32,   min: 20,  max: 42,    label: "Max Chars" },
  customTargetCps:         { default: 15,   min: 8,   max: 25,    label: "Target CPS" },
  customMaxCps:            { default: 17,   min: 10,  max: 30,    label: "Max CPS" },
  customMinDisplayMs:      { default: 1000, min: 200, max: 3000,  label: "Min Display (ms)" },
  customMinSoundDisplayMs: { default: 1500, min: 500, max: 5000,  label: "Min Sound Display (ms)" },
  customMinSoundMs:        { default: 250,  min: 100, max: 2000,  label: "Min Sound (ms)" },
  customSoundClusterGapMs: { default: 1500, min: 500, max: 5000,  label: "Sound Cluster Gap (ms)" },
  customMergeGapMs:        { default: 80,   min: 0,   max: 500,   label: "Merge Gap (ms)" },
};

// Build default custom overrides from config
const customOverrideDefaults = Object.fromEntries(
  Object.entries(CUSTOM_OVERRIDES_CONFIG).map(([k, v]) => [k, v.default])
);

export const CAPTION_OPTIONS_DEFAULTS = {
  captionProfile: "nbcu",
  // Delivery
  outputFormat: "ttml",
  ttmlTimebase: "media",
  ttmlFrameRate: 30,
  ttmlFrameRateMultiplier: "1000 1001",
  ttmlTextAlign: "center",
  // Speaker
  speakerLabelMode: "dash",
  speakerLabelFormat: "prefix",
  speakerLabelSingle: 0,
  speakerGenericPrefix: "SPEAKER",
  speakerNameMap: {},
  // Sound
  soundLabelStyle: "simple",
  // Italics
  italicizeTitles: 1,
  italicizeTitlesMinWords: 3,
  italicizePhrases: "",
  // Alignment
  alignmentDefault: "none",
  alignmentWindows: [],
  // Timecode
  timecodeOffsetMs: 0,
  // Custom overrides (used when captionProfile=custom)
  ...customOverrideDefaults,
};

export const NBCU_LOCKED_VALUES = {
  outputFormat: "ttml",
  ttmlTimebase: "media",
  ttmlFrameRate: 30,
  ttmlFrameRateMultiplier: "1000 1001",
  ttmlTextAlign: "center",
  speakerLabelMode: "dash",
  speakerLabelSingle: 0,
  soundLabelStyle: "simple",
  alignmentDefault: "none",
};