const API_BASE = "https://web-production-eba27.up.railway.app";

/**
 * Create a job on Railway.
 * Payload: mediaUrl, speakerLabels, languageDetection, allowHttp, captionRules
 */
export function buildCaptionEnvVars(opts) {
  if (!opts) return {};
  const vars = {};

  // Profile
  const profile = opts.captionProfile || "nbcu";
  vars.CAPTION_PROFILE = profile;

  // Output format
  if (opts.outputFormat) vars.OUTPUT_FORMATS = opts.outputFormat;

  // TTML settings
  const hasTtml = (opts.outputFormat || "").includes("ttml");
  if (hasTtml) {
    vars.TTML_TIMEBASE = opts.ttmlTimebase || "media";
    vars.TTML_FRAME_RATE = String(opts.ttmlFrameRate || 30);
    vars.TTML_FRAME_RATE_MULTIPLIER = opts.ttmlFrameRateMultiplier || "1000 1001";
    vars.TTML_TEXT_ALIGN = opts.ttmlTextAlign || "center";
  }

  // Speaker labels
  if (opts.speakerLabelMode) vars.SPEAKER_LABEL_MODE = opts.speakerLabelMode;
  if (opts.speakerLabelFormat) vars.SPEAKER_LABEL_FORMAT = opts.speakerLabelFormat;
  if (opts.speakerLabelSingle !== undefined) vars.SPEAKER_LABEL_SINGLE = String(opts.speakerLabelSingle);
  if (opts.speakerGenericPrefix) vars.SPEAKER_GENERIC_PREFIX = opts.speakerGenericPrefix;
  if (opts.speakerNameMap && typeof opts.speakerNameMap === "object" && Object.keys(opts.speakerNameMap).length > 0) {
    vars.SPEAKER_NAME_MAP = JSON.stringify(opts.speakerNameMap);
  }

  // Sound labels
  if (opts.soundLabelStyle) vars.SOUND_LABEL_STYLE = opts.soundLabelStyle;

  // Italics
  if (opts.italicizeTitles !== undefined) vars.ITALICIZE_TITLES = String(opts.italicizeTitles);
  if (opts.italicizeTitlesMinWords !== undefined) vars.ITALICIZE_TITLES_MIN_WORDS = String(opts.italicizeTitlesMinWords);
  if (opts.italicizePhrases) vars.ITALICIZE_PHRASES = opts.italicizePhrases;

  // Alignment
  if (opts.alignmentDefault && opts.alignmentDefault !== "none") vars.ALIGNMENT_DEFAULT = opts.alignmentDefault;
  if (opts.alignmentWindows && opts.alignmentWindows.length > 0) {
    const valid = opts.alignmentWindows.filter(w => w.start && w.end && w.align);
    if (valid.length > 0) vars.ALIGNMENT_WINDOWS = JSON.stringify(valid);
  }

  // Timecode
  if (opts.timecodeOffsetMs) vars.TIMECODE_OFFSET_MS = String(opts.timecodeOffsetMs);

  // Custom overrides (only when profile=custom)
  if (profile === "custom") {
    if (opts.customMaxLines !== undefined)          vars.CUSTOM_MAX_LINES = String(opts.customMaxLines);
    if (opts.customMaxChars !== undefined)           vars.CUSTOM_MAX_CHARS = String(opts.customMaxChars);
    if (opts.customTargetCps !== undefined)          vars.CUSTOM_TARGET_CPS = String(opts.customTargetCps);
    if (opts.customMaxCps !== undefined)             vars.CUSTOM_MAX_CPS = String(opts.customMaxCps);
    if (opts.customMinDisplayMs !== undefined)       vars.CUSTOM_MIN_DISPLAY_MS = String(opts.customMinDisplayMs);
    if (opts.customMinSoundDisplayMs !== undefined)  vars.CUSTOM_MIN_SOUND_DISPLAY_MS = String(opts.customMinSoundDisplayMs);
    if (opts.customMinSoundMs !== undefined)         vars.CUSTOM_MIN_SOUND_MS = String(opts.customMinSoundMs);
    if (opts.customSoundClusterGapMs !== undefined)  vars.CUSTOM_SOUND_CLUSTER_GAP_MS = String(opts.customSoundClusterGapMs);
    if (opts.customMergeGapMs !== undefined)         vars.CUSTOM_MERGE_GAP_MS = String(opts.customMergeGapMs);
  }

  return vars;
}

export async function createJob(payload) {
  const captionEnv = buildCaptionEnvVars(payload.captionOptions);
  const response = await fetch(`${API_BASE}/v1/jobs`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      mediaUrl: payload.mediaUrl,
      speakerLabels: payload.speaker_labels,
      languageDetection: payload.language_detection,
      allowHttp: payload.allowHttp,
      protectedPhrases: payload.protected_phrases || [],
      captionOptions: captionEnv,
    }),
  });

  const responseText = await response.text();
  console.log("POST /v1/jobs response:", { status: response.status, body: responseText });

  if (!response.ok) {
    throw new Error(`Job creation failed (${response.status}): ${responseText}`);
  }

  return JSON.parse(responseText);
}

/**
 * Poll a Railway job by ID.
 * When completed, result contains: result.srt, result.vtt, result.scc, result.qc
 */
export async function pollJob(jobId) {
  const response = await fetch(`${API_BASE}/v1/jobs/${jobId}`);
  if (!response.ok) {
    throw new Error(`Poll failed (${response.status})`);
  }
  const data = await response.json();
  console.log("GET /v1/jobs/:id FULL response:", JSON.stringify(data, null, 2).substring(0, 2000));
  console.log("GET /v1/jobs/:id keys:", {
    status: data.status,
    topKeys: Object.keys(data),
    resultKeys: data.result ? Object.keys(data.result) : "no result key",
  });
  return data;
}