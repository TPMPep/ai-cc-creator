import React, { useState, useEffect, useRef, useCallback } from "react";
import { base44 } from "@/api/base44Client";
import { pollJob } from "../shared/RailwayApi";
import { parseVTT, parseTTML, cuesToSrt, cuesToVtt } from "../shared/SubtitleParsers";
import CaptionEditor from "./CaptionEditor";
import ExportPanel from "./ExportPanel";
import QCPanel from "./QCPanel";
import JobConfigPanel from "./JobConfigPanel";
import { Loader2, AlertCircle } from "lucide-react";
import { toast } from "sonner";

export default function DeliveryPanel({ delivery, job, currentTimeMs, videoRef, onDeliveryUpdated }) {
  const [cues, setCues] = useState(delivery?.cues || []);
  const pollingRef = useRef(null);
  const deliveryRef = useRef(delivery);

  useEffect(() => {
    deliveryRef.current = delivery;
  }, [delivery]);

  // Sync cues when delivery changes — handle cues, cue_chunks, and cue_url
  useEffect(() => {
    const loadCues = async () => {
      if (delivery?.cues && delivery.cues.length > 0) {
        setCues(delivery.cues);
        return;
      }
      if (delivery?.cue_chunks && delivery.cue_chunks.length > 0) {
        try {
          const parsed = JSON.parse(delivery.cue_chunks.join(""));
          setCues(parsed);
          return;
        } catch (e) {
          console.error("Failed to parse delivery cue_chunks:", e);
        }
      }
      if (delivery?.cue_url) {
        try {
          const res = await fetch(delivery.cue_url);
          const text = await res.text();
          setCues(JSON.parse(text));
        } catch (e) {
          console.error("Failed to fetch delivery cue_url:", e);
        }
      }
    };
    loadCues();
  }, [delivery?.id, delivery?.cues?.length, delivery?.cue_chunks?.length]);

  // Poll delivery if it's still processing
  const doPoll = useCallback(async () => {
    const d = deliveryRef.current;
    if (!d || d.status !== "processing" || !d.railwayJobId) return;

    try {
      const data = await pollJob(d.railwayJobId);
      const statusMap = { completed: "done", complete: "done", finished: "done", success: "done", failed: "error", failure: "error" };
      const mappedStatus = statusMap[data.status] || data.status;

      if (mappedStatus === "done") {
        const resultData = data.result || data;
        const srt = resultData.srt || null;
        const vtt = resultData.vtt || null;
        const scc = resultData.scc || null;
        const ttml = resultData.ttml || null;
        const qc = resultData.qc || null;

        let parsedCues = [];
        if (vtt) parsedCues = parseVTT(vtt);
        else if (srt) parsedCues = parseVTT("WEBVTT\n\n" + srt.replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, "$1.$2"));
        else if (ttml) parsedCues = parseTTML(ttml);

        const effectiveSrt = srt || (parsedCues.length > 0 ? cuesToSrt(parsedCues) : null);
        const effectiveVtt = vtt || (parsedCues.length > 0 ? cuesToVtt(parsedCues) : null);

        // Upload files
        const uploadText = async (text, filename) => {
          const file = new File([text], filename, { type: "text/plain" });
          const { file_url } = await base44.integrations.Core.UploadFile({ file });
          return file_url;
        };

        const uploadPromises = [];
        if (effectiveSrt) uploadPromises.push(uploadText(effectiveSrt, `${d.railwayJobId}.srt`).then((url) => ({ key: "srt_url", url })));
        if (effectiveVtt) uploadPromises.push(uploadText(effectiveVtt, `${d.railwayJobId}.vtt`).then((url) => ({ key: "vtt_url", url })));
        if (scc) uploadPromises.push(uploadText(scc, `${d.railwayJobId}.scc`).then((url) => ({ key: "scc_url", url })));
        if (ttml) uploadPromises.push(uploadText(ttml, `${d.railwayJobId}.ttml`).then((url) => ({ key: "ttml_url", url })));
        const uploaded = await Promise.all(uploadPromises);
        const urlMap = {};
        for (const { key, url } of uploaded) urlMap[key] = url;

        const updatedDelivery = {
          ...d,
          status: "done",
          cues: parsedCues,
          qc,
          ...urlMap,
        };

        setCues(parsedCues);
        onDeliveryUpdated(updatedDelivery);
        toast.success(`"${d.profileName}" delivery complete`);

        if (pollingRef.current) clearInterval(pollingRef.current);
        pollingRef.current = null;
      } else if (mappedStatus === "error") {
        const updatedDelivery = {
          ...d,
          status: "error",
          error: data.error?.message || data.error || "Unknown error",
        };
        onDeliveryUpdated(updatedDelivery);
        if (pollingRef.current) clearInterval(pollingRef.current);
        pollingRef.current = null;
      }
    } catch (err) {
      console.error("[DeliveryPanel] Poll error:", err);
    }
  }, [onDeliveryUpdated]);

  useEffect(() => {
    if (delivery?.status !== "processing") return;

    // Start polling
    const tick = () => {
      pollingRef.current = setInterval(doPoll, 3000);
    };
    tick();

    return () => {
      if (pollingRef.current) clearInterval(pollingRef.current);
    };
  }, [delivery?.id, delivery?.status, doPoll]);

  // Processing state
  if (delivery?.status === "processing") {
    return (
      <div className="flex flex-col items-center justify-center py-16 gap-4">
        <Loader2 className="w-8 h-8 text-blue-500 animate-spin" />
        <h3 className="text-sm font-semibold text-white">Formatting captions…</h3>
        <p className="text-xs text-zinc-500">Applying {delivery.profileName} profile</p>
      </div>
    );
  }

  // Error state
  if (delivery?.status === "error") {
    return (
      <div className="p-6">
        <div className="flex items-start gap-3 p-4 rounded-lg border border-red-500/20 bg-red-500/5">
          <AlertCircle className="w-5 h-5 text-red-400 mt-0.5 flex-shrink-0" />
          <div>
            <h3 className="text-sm font-semibold text-red-300 mb-1">Delivery failed</h3>
            <p className="text-xs text-red-400/70">{delivery.error || "An unknown error occurred."}</p>
          </div>
        </div>
      </div>
    );
  }

  // Build a result-like object for ExportPanel compatibility
  const deliveryResult = {
    srt_url: delivery?.srt_url,
    vtt_url: delivery?.vtt_url,
    scc_url: delivery?.scc_url,
    ttml_url: delivery?.ttml_url,
    qc: delivery?.qc,
    cues: cues,
    cue_chunks: delivery?.cue_chunks,
    assemblyai_transcript_id: job?.rawTranscript?.transcriptId || job?.result?.assemblyai_transcript_id,
  };

  // Build a job-like object for JobConfigPanel
  const configJob = { rules: delivery?.profileSettings };

  const handleCuesChanged = async (updatedCues) => {
    setCues(updatedCues);
    // Save cues back to delivery
    const cueStr = JSON.stringify(updatedCues);
    const cueChunks = [];
    for (let i = 0; i < cueStr.length; i += 75000) cueChunks.push(cueStr.slice(i, i + 75000));

    const updatedDelivery = { ...delivery, cue_chunks: cueChunks };
    delete updatedDelivery.cues; // Use chunks to avoid field size limits
    onDeliveryUpdated(updatedDelivery);
  };

  const handleJumpToCue = (cueIndex) => {
    if (!cues || !cues[cueIndex]) return;
    const cue = cues[cueIndex];
    if (videoRef.current) {
      videoRef.current.currentTime = cue.start / 1000;
    }
  };

  return (
    <div className="flex flex-col h-full">
      {/* Config summary */}
      <div className="px-4 pt-3">
        <JobConfigPanel job={configJob} />
      </div>

      {/* Export + QC row */}
      <div className="grid grid-cols-2 gap-4 px-4 pb-3">
        <div className="rounded-lg border border-zinc-800/60 bg-zinc-900/30 p-3">
          <ExportPanel
            result={deliveryResult}
            title={job?.title}
            jobId={delivery?.railwayJobId || delivery?.id}
            assemblyaiTranscriptId={deliveryResult.assemblyai_transcript_id}
          />
        </div>
        <div className="rounded-lg border border-zinc-800/60 bg-zinc-900/30 p-3 overflow-auto max-h-64">
          <QCPanel qc={delivery?.qc} onJumpToCue={handleJumpToCue} />
        </div>
      </div>

      {/* Caption Editor */}
      <div className="flex-1 border-t border-zinc-800/60">
        <CaptionEditor
          cues={cues}
          currentTimeMs={currentTimeMs}
          videoRef={videoRef}
          job={{ ...job, rules: delivery?.profileSettings || {} }}
          onCuesChanged={(updatedCues) => setCues(updatedCues)}
          onSaveCues={handleCuesChanged}
          rawSrtText={null}
          rawUtterances={[]}
        />
      </div>
    </div>
  );
}