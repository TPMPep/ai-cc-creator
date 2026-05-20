import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { CAPTION_OPTIONS_DEFAULTS } from "../shared/RulesDefaults";
import { createReformatJob, buildCaptionEnvVars } from "../shared/RailwayApi";
import { parseVTT, parseTTML, cuesToSrt, cuesToVtt } from "../shared/SubtitleParsers";
import CaptionOptionsPanel from "../newjob/CaptionOptionsPanel";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { ChevronDown, RotateCcw, Loader2, SlidersHorizontal } from "lucide-react";
import { toast } from "sonner";

export default function ProfileApplyPanel({ job, onReformatComplete }) {
  const [expanded, setExpanded] = useState(false);
  const [captionOptions, setCaptionOptions] = useState(() => {
    // Initialize from job's saved rules, or defaults
    return job?.rules && Object.keys(job.rules).length > 0
      ? { ...CAPTION_OPTIONS_DEFAULTS, ...job.rules }
      : { ...CAPTION_OPTIONS_DEFAULTS };
  });
  const [protectedPhrases, setProtectedPhrases] = useState("");
  const [reformatting, setReformatting] = useState(false);

  const transcriptId = job?.result?.assemblyai_transcript_id;

  const handleApplyProfile = async () => {
    if (!transcriptId) {
      toast.error("No AssemblyAI transcript ID found on this job.");
      return;
    }
    setReformatting(true);
    try {
      const parsedPhrases = protectedPhrases
        .split(/[\n,]+/)
        .map(s => s.trim())
        .filter(Boolean);

      // Build the caption options with protected phrases
      const optionsWithPhrases = {
        ...captionOptions,
        ...(parsedPhrases.length > 0 ? { italicizePhrases: parsedPhrases.join(",") } : {}),
      };

      const data = await createReformatJob(transcriptId, optionsWithPhrases);
      const newRailwayJobId = data.job_id || data.id;
      if (!newRailwayJobId) throw new Error("No job_id returned from Railway");

      // Check if result came back inline (synchronous reformat)
      const resultData = data.result || data;
      const srt = resultData.srt || null;
      const vtt = resultData.vtt || null;
      const scc = resultData.scc || null;
      const ttml = resultData.ttml || null;
      const qc = resultData.qc || null;
      const alreadyDone = !!(srt || vtt || ttml);

      let jobStatus = alreadyDone ? "done" : "processing";
      let jobResult = undefined;

      if (alreadyDone) {
        let parsedCues = [];
        if (vtt) parsedCues = parseVTT(vtt);
        else if (srt) parsedCues = parseVTT("WEBVTT\n\n" + srt.replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, '$1.$2'));
        else if (ttml) parsedCues = parseTTML(ttml);

        const effectiveSrt = srt || (parsedCues.length > 0 ? cuesToSrt(parsedCues) : null);
        const effectiveVtt = vtt || (parsedCues.length > 0 ? cuesToVtt(parsedCues) : null);

        const uploadText = async (text, filename) => {
          const file = new File([text], filename, { type: "text/plain" });
          const { file_url } = await base44.integrations.Core.UploadFile({ file });
          return file_url;
        };
        const uploadPromises = [];
        if (effectiveSrt) uploadPromises.push(uploadText(effectiveSrt, `${newRailwayJobId}-reformat.srt`).then(url => ({ key: "srt_url", url })));
        if (effectiveVtt) uploadPromises.push(uploadText(effectiveVtt, `${newRailwayJobId}-reformat.vtt`).then(url => ({ key: "vtt_url", url })));
        if (scc) uploadPromises.push(uploadText(scc, `${newRailwayJobId}-reformat.scc`).then(url => ({ key: "scc_url", url })));
        if (ttml) uploadPromises.push(uploadText(ttml, `${newRailwayJobId}-reformat.ttml`).then(url => ({ key: "ttml_url", url })));
        const uploaded = await Promise.all(uploadPromises);
        const urlMap = {};
        for (const { key, url } of uploaded) urlMap[key] = url;

        jobResult = {
          ...urlMap,
          qc,
          cues: parsedCues,
          assemblyai_transcript_id: data.assemblyai_transcript_id || data.transcript_id || transcriptId,
        };
      }

      // Create a new Job record for the reformat
      const newJob = await base44.entities.Job.create({
        railwayJobId: newRailwayJobId,
        userId: job.userId,
        mediaUrl: job.mediaUrl,
        title: `${job.title || "Untitled"} (reformat)`,
        status: jobStatus,
        pipeline: "railway",
        speakerLabels: job.speakerLabels,
        languageDetection: job.languageDetection,
        rules: captionOptions,
        ...(jobResult ? {
          result: jobResult,
          durationMs: jobResult.cues?.length > 0 ? jobResult.cues[jobResult.cues.length - 1].end : null,
          issuesCount: qc?.issuesCount || 0,
        } : {}),
      });

      toast.success("Reformat started! Redirecting…");
      onReformatComplete(newRailwayJobId, newJob.id);
    } catch (err) {
      console.error("Reformat error:", err);
      toast.error(`Reformat failed: ${err.message}`);
    } finally {
      setReformatting(false);
    }
  };

  if (!transcriptId) return null;

  return (
    <div className="rounded-xl border border-zinc-800/60 bg-zinc-900/30 overflow-hidden mb-4">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between p-4 hover:bg-zinc-800/20 transition-colors"
      >
        <div className="flex items-center gap-2.5">
          <SlidersHorizontal className="w-4 h-4 text-blue-400" />
          <h3 className="text-sm font-semibold text-zinc-200">Apply Caption Profile</h3>
          {job?.rules?.captionProfile && (
            <span className="text-xs px-2 py-0.5 rounded-full bg-zinc-800 text-zinc-400 border border-zinc-700">
              Current: {job.rules.captionProfile === "nbcu" ? "NBCU CM-051" : job.rules.captionProfile || "default"}
            </span>
          )}
        </div>
        <ChevronDown className={`w-4 h-4 text-zinc-500 transition-transform ${expanded ? "rotate-180" : ""}`} />
      </button>

      {expanded && (
        <div className="border-t border-zinc-800/60 p-4 space-y-4">
          <p className="text-xs text-zinc-400 leading-relaxed">
            Select a delivery profile or customize settings, then apply to reformat your captions. The original transcript is preserved — you can apply different profiles as many times as needed.
          </p>

          {/* Protected Phrases */}
          <div className="space-y-2">
            <Label className="text-xs text-zinc-300 font-medium">Protected Phrases <span className="text-zinc-500">(optional)</span></Label>
            <Textarea
              value={protectedPhrases}
              onChange={(e) => setProtectedPhrases(e.target.value)}
              placeholder={"Watch What Happens Live\nBelow Deck Med"}
              rows={2}
              className="bg-zinc-800/80 border-zinc-500/60 text-white placeholder:text-zinc-500 focus:border-blue-400 focus:ring-2 focus:ring-blue-500/30 text-xs resize-y"
            />
          </div>

          {/* Caption Options (full panel) */}
          <CaptionOptionsPanel
            options={captionOptions}
            onOptionsChange={setCaptionOptions}
            jobSettings={{
              protectedPhrases,
              speakerLabels: job?.speakerLabels ?? true,
              languageDetection: job?.languageDetection ?? true,
              allowHttp: job?.allowHttp ?? false,
            }}
            onJobSettingsChange={(updates) => {
              if (updates.protectedPhrases !== undefined) setProtectedPhrases(updates.protectedPhrases);
            }}
          />

          {/* Apply Button */}
          <Button
            onClick={handleApplyProfile}
            disabled={reformatting}
            className="w-full bg-blue-600 hover:bg-blue-500 text-white h-10 text-sm font-semibold"
          >
            {reformatting ? (
              <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Reformatting…</>
            ) : (
              <><RotateCcw className="w-4 h-4 mr-2" /> Apply Profile & Reformat</>
            )}
          </Button>
        </div>
      )}
    </div>
  );
}