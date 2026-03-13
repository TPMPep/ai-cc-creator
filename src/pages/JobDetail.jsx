import React, { useState, useEffect, useRef, useCallback } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { toast as sonnerToast } from "sonner";
import { createPageUrl } from "../utils";
import { base44 } from "@/api/base44Client";
import { pollJob, createReformatJob } from "../components/shared/RailwayApi";
import StatusBadge from "../components/shared/StatusBadge";
import VideoPlayer from "../components/jobdetail/VideoPlayer";
import CueList from "../components/jobdetail/CueList";
import ExportPanel from "../components/jobdetail/ExportPanel";
import QCPanel from "../components/jobdetail/QCPanel";
import CaptionSettings from "../components/jobdetail/CaptionSettings";
import CaptionEditor from "../components/jobdetail/CaptionEditor";
import { getCuesFromResultAsync } from "../components/shared/CueUtils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2, Plus, RefreshCw, AlertCircle, Pencil, Check, X, RotateCcw } from "lucide-react";
import moment from "moment";
import { toast } from "sonner";

export default function JobDetail() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const videoRef = useRef(null);
  const [job, setJob] = useState(null);
  const [loading, setLoading] = useState(true);
  const [currentTimeMs, setCurrentTimeMs] = useState(0);
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  const [captionSettings, setCaptionSettings] = useState({ fontSize: 16, opacity: 0.8, position: "bottom" });
  const [cues, setCues] = useState([]);
  const [rawSrtText, setRawSrtText] = useState(null);
  const [rawUtterances, setRawUtterances] = useState([]);
  const pollingRef = useRef(null);
  const pollStartRef = useRef(null);
  const [reformatting, setReformatting] = useState(false);

  const jobId = searchParams.get("jobId");

  // Load job from DB
  useEffect(() => {
    if (!jobId) return;
    const loadJob = async () => {
      const jobs = await base44.entities.Job.filter({ railwayJobId: jobId }, "-created_date", 1);
      if (jobs.length > 0) {
        setJob(jobs[0]);
        setTitleDraft(jobs[0].title || "");
        // Load cues from all formats (cue_url, cue_chunks, cues)
        const loadedCues = await getCuesFromResultAsync(jobs[0].result);
        setCues(loadedCues);
        // Fetch raw AAI SRT if transcript id exists
        const tid = jobs[0].result?.assemblyai_transcript_id;
        if (tid) {
          base44.functions.invoke("fetchAssemblyAIRaw", { transcriptId: tid, format: "srt" })
            .then(res => setRawSrtText(res.data?.srt || null))
            .catch(() => {});
          base44.functions.invoke("fetchAssemblyAIRaw", { transcriptId: tid, format: "utterances" })
            .then(res => setRawUtterances(res.data?.utterances || []))
            .catch(() => {});
        }
      }
      setLoading(false);
    };
    loadJob();
  }, [jobId]);

  // Parse VTT to cues
  const parseVTT = (vttString) => {
    const lines = vttString.split('\n');
    const cues = [];
    let i = 0;
    
    while (i < lines.length) {
      const line = lines[i].trim();
      
      // Look for timecode line (contains -->)
      if (line.includes('-->')) {
        const [startStr, endStr] = line.split('-->').map(s => s.trim());
        const start = parseTimecode(startStr);
        const end = parseTimecode(endStr);
        
        // Collect text lines until blank line
        const textLines = [];
        i++;
        while (i < lines.length && lines[i].trim() !== '') {
          textLines.push(lines[i]);
          i++;
        }
        
        if (textLines.length > 0) {
          cues.push({
            start,
            end,
            text: textLines.join('\n'),
            speaker: null,
            type: 'caption'
          });
        }
      }
      i++;
    }
    
    return cues;
  };
  
  const parseTimecode = (tc) => {
    const parts = tc.split(':');
    const secParts = parts[parts.length - 1].split('.');
    const hours = parts.length === 3 ? parseInt(parts[0]) : 0;
    const minutes = parts.length === 3 ? parseInt(parts[1]) : parseInt(parts[0]);
    const seconds = parseInt(secParts[0]);
    const ms = parseInt(secParts[1] || 0);
    return hours * 3600000 + minutes * 60000 + seconds * 1000 + ms;
  };

  // Use a ref to always have the latest job for polling without re-creating the callback
  const jobRef = useRef(job);
  useEffect(() => { jobRef.current = job; }, [job]);

  // Polling logic — uses jobRef to avoid stale closures
  const doPoll = useCallback(async () => {
    const currentJob = jobRef.current;
    if (!jobId || !currentJob) return;
    if (currentJob.status === "done" || currentJob.status === "error") return;

    try {
      const data = await pollJob(jobId);
      console.log("[JobDetail] Poll raw status:", data.status);
      
      // Map Railway API status to app status
      // Railway returns "completed" / "failed" / "processing" / "queued"
      const statusMap = { "completed": "done", "complete": "done", "finished": "done", "success": "done", "failed": "error", "failure": "error" };
      const mappedStatus = statusMap[data.status] || data.status;
      console.log("[JobDetail] Mapped status:", mappedStatus);
      
      const updates = { status: mappedStatus, lastPolledAt: new Date().toISOString() };
      if (data.error) updates.error = data.error;
      
      // Save results when completed — Railway returns result.srt/.vtt/.scc/.qc
      if (mappedStatus === "done") {
        // Railway may return result at top level or nested — handle both
        const resultData = data.result || data;
        const srt = resultData.srt || null;
        const vtt = resultData.vtt || null;
        const scc = resultData.scc || null;
        const qc = resultData.qc || null;
        
        console.log("[JobDetail] Result found:", { hasSrt: !!srt, hasVtt: !!vtt, hasScc: !!scc, hasQc: !!qc });
        
        // Parse VTT to get cues for the editor/player
        let parsedCues = [];
        if (vtt) {
          parsedCues = parseVTT(vtt);
          console.log("[JobDetail] Parsed", parsedCues.length, "cues from VTT");
        } else if (srt) {
          // Convert SRT timecodes to VTT format (commas to periods in timestamps only)
          const vttFromSrt = "WEBVTT\n\n" + srt.replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, '$1.$2');
          parsedCues = parseVTT(vttFromSrt);
          console.log("[JobDetail] Parsed", parsedCues.length, "cues from SRT fallback");
        }
        
        // Upload large text content as files to avoid entity field size limits
        const uploadText = async (text, filename) => {
          const file = new File([text], filename, { type: "text/plain" });
          const { file_url } = await base44.integrations.Core.UploadFile({ file });
          return file_url;
        };
        
        const uploadPromises = [];
        if (srt) uploadPromises.push(uploadText(srt, `${jobId}.srt`).then(url => ({ key: "srt_url", url })));
        if (vtt) uploadPromises.push(uploadText(vtt, `${jobId}.vtt`).then(url => ({ key: "vtt_url", url })));
        if (scc) uploadPromises.push(uploadText(scc, `${jobId}.scc`).then(url => ({ key: "scc_url", url })));
        
        const uploaded = await Promise.all(uploadPromises);
        const urlMap = {};
        for (const { key, url } of uploaded) urlMap[key] = url;
        console.log("[JobDetail] Uploaded files:", urlMap);
        
        updates.result = {
          ...urlMap,
          qc,
          cues: parsedCues,
          assemblyai_transcript_id: data.assemblyai_transcript_id || null,
        };
        
        // Compute derived fields
        if (parsedCues.length > 0) {
          const lastCue = parsedCues[parsedCues.length - 1];
          updates.durationMs = lastCue.end;
        }
        if (qc) {
          updates.issuesCount = qc.issuesCount || 0;
        }
      }

      await base44.entities.Job.update(currentJob.id, updates);
      setJob((prev) => ({ ...prev, ...updates }));
      if (updates.result) {
        const freshCues = await getCuesFromResultAsync(updates.result);
        setCues(freshCues);
      }

      // Stop polling on terminal states
      if (mappedStatus === "done" || mappedStatus === "error") {
        if (pollingRef.current) clearTimeout(pollingRef.current);
        pollingRef.current = null;
      }
    } catch (err) {
      console.error("[JobDetail] Poll error:", err);
      toast("Temporary network issue. Retrying…", { duration: 2000 });
    }
  }, [jobId]);

  useEffect(() => {
    if (!job) return;
    if (job.status === "done" || job.status === "error") return;

    pollStartRef.current = Date.now();

    const tick = () => {
      const elapsed = Date.now() - pollStartRef.current;
      const interval = elapsed < 20000 ? 2000 : 5000;
      pollingRef.current = setTimeout(async () => {
        await doPoll();
        // Only continue ticking if job is still processing
        const currentJob = jobRef.current;
        if (currentJob && currentJob.status !== "done" && currentJob.status !== "error") {
          tick();
        }
      }, interval);
    };
    tick();

    return () => { if (pollingRef.current) clearTimeout(pollingRef.current); };
  }, [job?.id, doPoll]);

  const handleSaveTitle = async () => {
    if (!titleDraft.trim()) return;
    await base44.entities.Job.update(job.id, { title: titleDraft.trim() });
    setJob((prev) => ({ ...prev, title: titleDraft.trim() }));
    setEditingTitle(false);
  };

  const handleJumpToCue = (cueIndex) => {
    const cues = job?.result?.cues;
    if (!cues || !cues[cueIndex]) return;
    const cue = cues[cueIndex];
    if (videoRef.current) {
      videoRef.current.currentTime = cue.start / 1000;
    }
  };

  const handleRetry = () => {
    const params = new URLSearchParams({
      mediaUrl: job.mediaUrl,
      rules: JSON.stringify(job.rules || {}),
    });
    navigate(createPageUrl("NewJob") + `?${params.toString()}`);
  };

  const handleReformat = async () => {
    const transcriptId = job.result?.assemblyai_transcript_id;
    if (!transcriptId) {
      toast.error("No AssemblyAI transcript ID found on this job.");
      return;
    }
    setReformatting(true);
    try {
      const captionOptions = job.rules || {};
      const data = await createReformatJob(transcriptId, captionOptions);
      const newRailwayJobId = data.job_id || data.id;
      if (!newRailwayJobId) throw new Error("No job_id returned from Railway");

      // Create a new Job record for the reformat
      const newJob = await base44.entities.Job.create({
        railwayJobId: newRailwayJobId,
        userId: job.userId,
        mediaUrl: job.mediaUrl,
        title: `${job.title || "Untitled"} (reformat)`,
        status: "processing",
        pipeline: "railway",
        speakerLabels: job.speakerLabels,
        languageDetection: job.languageDetection,
        rules: job.rules,
      });

      toast.success("Reformat job submitted! Redirecting…");
      navigate(createPageUrl("JobDetail") + `?jobId=${newRailwayJobId}`);
    } catch (err) {
      console.error("Reformat error:", err);
      toast.error(`Reformat failed: ${err.message}`);
    } finally {
      setReformatting(false);
    }
  };

  if (!jobId) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4">
        <AlertCircle className="w-8 h-8 text-red-400 mb-2" />
        <p className="text-zinc-400 text-sm">Missing jobId in URL</p>
        <Link to={createPageUrl("Jobs")}><Button variant="outline" className="border-zinc-800 text-zinc-300">Go to Jobs</Button></Link>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="w-6 h-6 text-blue-500 animate-spin" />
      </div>
    );
  }

  if (!job) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4">
        <p className="text-zinc-500">Job not found.</p>
        <Link to={createPageUrl("Jobs")}><Button variant="outline" className="border-zinc-800 text-zinc-300">Go to Jobs</Button></Link>
      </div>
    );
  }

  const isDone = job.status === "done";
  const isProcessing = job.status === "processing" || job.status === "queued";
  const isError = job.status === "error";

  return (
    <div className="px-4 sm:px-6 lg:px-8 py-6">
      <div className="max-w-screen-2xl mx-auto">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-6">
          <div className="flex items-center gap-3 flex-wrap">
            {editingTitle ? (
              <div className="flex items-center gap-2">
                <Input
                  value={titleDraft}
                  onChange={(e) => setTitleDraft(e.target.value)}
                  className="h-8 w-64 bg-zinc-900 border-zinc-700 text-white text-sm"
                  onKeyDown={(e) => e.key === "Enter" && handleSaveTitle()}
                  autoFocus
                />
                <Button variant="ghost" size="sm" onClick={handleSaveTitle} className="h-7 w-7 p-0 text-emerald-400"><Check className="w-3.5 h-3.5" /></Button>
                <Button variant="ghost" size="sm" onClick={() => { setEditingTitle(false); setTitleDraft(job.title || ""); }} className="h-7 w-7 p-0 text-zinc-500"><X className="w-3.5 h-3.5" /></Button>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <h1 className="text-xl font-bold text-white">{job.title || "Untitled"}</h1>
                <button onClick={() => setEditingTitle(true)} className="text-zinc-600 hover:text-zinc-400 transition-colors">
                  <Pencil className="w-3.5 h-3.5" />
                </button>
              </div>
            )}
            <StatusBadge status={job.status} />
            <span className="text-xs text-zinc-600">{moment(job.created_date).format("MMM D, YYYY h:mm A")}</span>
          </div>
          <div className="flex items-center gap-2">
            {isDone && job.result?.assemblyai_transcript_id && (
              <Button
                size="sm"
                variant="outline"
                onClick={handleReformat}
                disabled={reformatting}
                className="border-zinc-700 text-zinc-300 hover:text-white hover:bg-zinc-800"
              >
                {reformatting ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <RotateCcw className="w-3.5 h-3.5 mr-1.5" />}
                Reformat Captions
              </Button>
            )}
            <Link to={createPageUrl("NewJob")}>
              <Button size="sm" className="bg-blue-600 hover:bg-blue-700 text-white">
                <Plus className="w-3.5 h-3.5 mr-1.5" /> New Job
              </Button>
            </Link>
          </div>
        </div>

        {/* Processing state */}
        {isProcessing && (
          <div className="rounded-xl border border-zinc-800/60 bg-zinc-900/30 p-8 text-center mb-6">
            <Loader2 className="w-8 h-8 text-blue-500 animate-spin mx-auto mb-4" />
            <h2 className="text-lg font-semibold text-white mb-2">Transcribing and generating captions…</h2>
            <p className="text-sm text-zinc-500 mb-4">Updating automatically</p>
            <Button variant="outline" size="sm" onClick={doPoll} className="border-zinc-800 text-zinc-400 hover:text-white">
              <RefreshCw className="w-3.5 h-3.5 mr-1.5" /> Refresh now
            </Button>
          </div>
        )}

        {/* Error state */}
        {isError && (
          <div className="rounded-xl border border-red-500/20 bg-red-500/5 p-6 mb-6">
            <div className="flex items-start gap-3">
              <AlertCircle className="w-5 h-5 text-red-400 mt-0.5 flex-shrink-0" />
              <div className="flex-1">
                <h2 className="text-base font-semibold text-red-300 mb-1">We couldn't process this media URL.</h2>
                <details className="mt-3">
                  <summary className="text-xs text-red-400/60 cursor-pointer hover:text-red-400/80">Show error details</summary>
                  <div className="mt-2 p-3 rounded-md bg-red-950/30 border border-red-500/10">
                    <p className="text-xs text-red-400/70 font-mono break-all">{job.error || "An unknown error occurred."}</p>
                  </div>
                </details>
                <Button variant="outline" size="sm" onClick={handleRetry} className="border-red-500/30 text-red-300 hover:bg-red-500/10 mt-4">
                  Retry Job
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* Done state - main content */}
        {isDone && (
          <>
            {/* Top Section: 70% Video Left / 30% QC + Exports Right */}
            <div className="grid grid-cols-10 gap-6 mb-6">
              {/* Left: Video (70%) */}
              <div className="col-span-7 space-y-4">
                <div className="flex items-center justify-between mb-2">
                  <CaptionSettings settings={captionSettings} onSettingsChange={setCaptionSettings} />
                  <p className="text-[10px] text-zinc-600">
                    Shortcuts: Space (play/pause) • ←/→ (±5s) • J/K/L (−10s/pause/+10s)
                  </p>
                </div>
                <VideoPlayer
                  mediaUrl={job.mediaUrl}
                  cues={cues}
                  videoRef={videoRef}
                  onTimeUpdate={setCurrentTimeMs}
                  captionSettings={captionSettings}
                />
              </div>

              {/* Right: QC Panel + Exports (30%) */}
              <div className="col-span-3 flex flex-col gap-4" style={{ height: "fit-content", maxHeight: "600px" }}>
                {/* Exports */}
                <div className="rounded-xl border border-zinc-800/60 bg-zinc-900/30 p-4">
                  <ExportPanel result={job.result} title={job.title} jobId={job.railwayJobId || job.jobId} assemblyaiTranscriptId={job.result?.assemblyai_transcript_id} />
                </div>

                {/* QC Panel - scrollable */}
                <div className="rounded-xl border border-zinc-800/60 bg-zinc-900/30 p-4 overflow-auto flex-1">
                  <QCPanel qc={job.result?.qc} onJumpToCue={handleJumpToCue} />
                </div>
              </div>
            </div>

            {/* Full Width Caption Editor Below */}
            <div className="rounded-xl border border-zinc-800/60 bg-zinc-900/30 overflow-hidden">
              <CaptionEditor 
                cues={cues}
                currentTimeMs={currentTimeMs}
                videoRef={videoRef}
                job={job}
                rawSrtText={rawSrtText}
                rawUtterances={rawUtterances}
                onCuesChanged={(updatedCues) => {
                  setCues(updatedCues);
                  setJob(prev => ({ ...prev, result: { ...prev.result, cues: updatedCues } }));
                }}
              />
            </div>
          </>
        )}
      </div>
    </div>
  );
}