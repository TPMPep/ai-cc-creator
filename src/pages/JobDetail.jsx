import React, { useState, useEffect, useRef, useCallback } from "react";
import { Link, useNavigate } from "react-router-dom";
import { createPageUrl } from "../utils";
import { base44 } from "@/api/base44Client";
import { pollJob } from "../components/shared/RailwayApi";
import StatusBadge from "../components/shared/StatusBadge";
import VideoPlayer from "../components/jobdetail/VideoPlayer";
import CueList from "../components/jobdetail/CueList";
import ExportPanel from "../components/jobdetail/ExportPanel";
import QCPanel from "../components/jobdetail/QCPanel";
import CaptionSettings from "../components/jobdetail/CaptionSettings";
import CaptionEditor from "../components/jobdetail/CaptionEditor";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2, Plus, RefreshCw, AlertCircle, Pencil, Check, X } from "lucide-react";
import moment from "moment";
import { toast } from "sonner";

export default function JobDetail() {
  const navigate = useNavigate();
  const videoRef = useRef(null);
  const [job, setJob] = useState(null);
  const [loading, setLoading] = useState(true);
  const [currentTimeMs, setCurrentTimeMs] = useState(0);
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  const [captionSettings, setCaptionSettings] = useState({ fontSize: 16, opacity: 0.8, position: "bottom" });
  const [cues, setCues] = useState([]);
  const pollingRef = useRef(null);
  const pollStartRef = useRef(null);

  const params = new URLSearchParams(window.location.search);
  const jobId = params.get("jobId");

  // Load job from DB
  useEffect(() => {
    if (!jobId) return;
    const loadJob = async () => {
      const jobs = await base44.entities.Job.filter({ railwayJobId: jobId }, "-created_date", 1);
      if (jobs.length > 0) {
        setJob(jobs[0]);
        setTitleDraft(jobs[0].title || "");
        setCues(jobs[0].result?.cues || []);
      }
      setLoading(false);
    };
    loadJob();
  }, [jobId]);

  // Polling logic
  const doPoll = useCallback(async () => {
    if (!jobId || !job) return;
    if (job.status === "done" || job.status === "error") return;

    try {
      const data = await pollJob(jobId);
      const updates = { status: data.status, lastPolledAt: new Date().toISOString() };
      if (data.error) updates.error = data.error;
      if (data.status === "done" && data.result) {
        updates.result = data.result;
        // Compute derived fields
        if (data.result.cues && data.result.cues.length > 0) {
          const lastCue = data.result.cues[data.result.cues.length - 1];
          updates.durationMs = lastCue.end;
        }
        if (data.result.qc) {
          updates.issuesCount = data.result.qc.issuesCount || 0;
        }
      }

      await base44.entities.Job.update(job.id, updates);
      setJob((prev) => ({ ...prev, ...updates }));
      if (updates.result?.cues) setCues(updates.result.cues);

      if (data.status === "done" || data.status === "error") {
        clearInterval(pollingRef.current);
      }
    } catch (err) {
      toast("Temporary network issue. Retrying…", { duration: 2000 });
    }
  }, [jobId, job]);

  useEffect(() => {
    if (!job) return;
    if (job.status === "done" || job.status === "error") return;

    pollStartRef.current = Date.now();

    const tick = () => {
      const elapsed = Date.now() - pollStartRef.current;
      const interval = elapsed < 20000 ? 2000 : 5000;
      pollingRef.current = setTimeout(async () => {
        await doPoll();
        tick();
      }, interval);
    };
    tick();

    return () => { if (pollingRef.current) clearTimeout(pollingRef.current); };
  }, [job?.status, job?.id, doPoll]);

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
          <Link to={createPageUrl("NewJob")}>
            <Button size="sm" className="bg-blue-600 hover:bg-blue-700 text-white">
              <Plus className="w-3.5 h-3.5 mr-1.5" /> New Job
            </Button>
          </Link>
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
                  <ExportPanel result={job.result} title={job.title} jobId={job.railwayJobId || job.jobId} />
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