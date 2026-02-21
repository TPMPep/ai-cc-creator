import React, { useState, useEffect, useRef, useCallback } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { createPageUrl } from "../utils";
import { base44 } from "@/api/base44Client";
import StatusBadge from "../components/shared/StatusBadge";
import VideoPlayer from "../components/jobdetail/VideoPlayer";
import CueList from "../components/jobdetail/CueList";
import ExportPanel from "../components/jobdetail/ExportPanel";
import QCPanel from "../components/jobdetail/QCPanel";
import CaptionSettings from "../components/jobdetail/CaptionSettings";
import CaptionEditor from "../components/jobdetail/CaptionEditor";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2, Plus, RefreshCw, AlertCircle, Pencil, Check, X, Sparkles, FlaskConical } from "lucide-react";
import moment from "moment";
import { toast } from "sonner";

export default function JobDetailAI() {
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
  const pollingRef = useRef(null);
  const pollStartRef = useRef(null);

  const jobId = searchParams.get("jobId"); // This is the AssemblyAI transcript_id

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

  // Poll AssemblyAI via our backend function
  const doPoll = useCallback(async () => {
    if (!jobId || !job) return;
    if (job.status === "done" || job.status === "error") return;

    try {
      const res = await base44.functions.invoke("pollAICaption", { transcript_id: jobId });
      const data = res.data;

      if (data.status === "queued" || data.status === "processing") return;

      if (data.status === "error") {
        const updates = { status: "error", error: data.error || "Transcription failed" };
        await base44.entities.Job.update(job.id, updates);
        setJob(prev => ({ ...prev, ...updates }));
        clearInterval(pollingRef.current);
        return;
      }

      if (data.status === "completed") {
        const updates = {
          status: "done",
          result: {
            cues: data.cues,
            srt: data.exports?.srt,
            vtt: data.exports?.vtt,
            scc: data.exports?.scc,
            qc: data.qc,
            language: data.language,
          },
          durationMs: data.cues?.length > 0 ? data.cues[data.cues.length - 1].end : 0,
          issuesCount: data.qc?.issuesCount || 0,
          lastPolledAt: new Date().toISOString(),
        };
        await base44.entities.Job.update(job.id, updates);
        setJob(prev => ({ ...prev, ...updates }));
        setCues(data.cues || []);
        clearInterval(pollingRef.current);
        toast.success("Captions ready!");
      }
    } catch (err) {
      console.error("Poll error:", err);
    }
  }, [jobId, job]);

  useEffect(() => {
    if (!job) return;
    if (job.status === "done" || job.status === "error") return;

    pollStartRef.current = Date.now();
    const tick = () => {
      const elapsed = Date.now() - pollStartRef.current;
      const interval = elapsed < 30000 ? 5000 : 10000;
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
    setJob(prev => ({ ...prev, title: titleDraft.trim() }));
    setEditingTitle(false);
  };

  const handleJumpToCue = (cueIndex) => {
    const allCues = job?.result?.cues;
    if (!allCues || !allCues[cueIndex]) return;
    const cue = allCues[cueIndex];
    if (videoRef.current) videoRef.current.currentTime = cue.start / 1000;
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
            <span className="inline-flex items-center gap-1 text-xs text-blue-400/70 bg-blue-500/10 border border-blue-500/20 rounded px-2 py-0.5">
              <Sparkles className="w-3 h-3" /> AI Pipeline
            </span>
            <span className="text-xs text-zinc-600">{moment(job.created_date).format("MMM D, YYYY h:mm A")}</span>
          </div>
          <Link to={createPageUrl("NewJobAI")}>
            <Button size="sm" className="bg-blue-600 hover:bg-blue-700 text-white">
              <Plus className="w-3.5 h-3.5 mr-1.5" /> New Job
            </Button>
          </Link>
        </div>

        {/* Processing */}
        {isProcessing && (
          <div className="rounded-xl border border-zinc-800/60 bg-zinc-900/30 p-8 text-center mb-6">
            <Loader2 className="w-8 h-8 text-blue-500 animate-spin mx-auto mb-4" />
            <h2 className="text-lg font-semibold text-white mb-1">Transcribing & applying NBCU rules…</h2>
            <p className="text-sm text-zinc-500 mb-1">AssemblyAI is processing your media, then GPT-4o will apply broadcast formatting.</p>
            <p className="text-xs text-zinc-600 mb-4">Typically 1–5 minutes depending on length.</p>
            <Button variant="outline" size="sm" onClick={doPoll} className="border-zinc-800 text-zinc-400 hover:text-white">
              <RefreshCw className="w-3.5 h-3.5 mr-1.5" /> Check now
            </Button>
          </div>
        )}

        {/* Error */}
        {isError && (
          <div className="rounded-xl border border-red-500/20 bg-red-500/5 p-6 mb-6">
            <div className="flex items-start gap-3">
              <AlertCircle className="w-5 h-5 text-red-400 mt-0.5 flex-shrink-0" />
              <div className="flex-1">
                <h2 className="text-base font-semibold text-red-300 mb-1">Processing failed.</h2>
                <p className="text-xs text-red-400/70 font-mono mt-2">{job.error || "Unknown error"}</p>
                <Link to={createPageUrl("NewJobAI")}>
                  <Button variant="outline" size="sm" className="border-red-500/30 text-red-300 hover:bg-red-500/10 mt-4">
                    Try Again
                  </Button>
                </Link>
              </div>
            </div>
          </div>
        )}

        {/* Done */}
        {isDone && (
          <>
            {/* Sticky top section: video + sidebar — never scrolls away */}
            <div className="sticky top-14 z-20 bg-zinc-950 pb-2">
              <div className="grid grid-cols-10 gap-6">
                <div className="col-span-7 space-y-2">
                  <div className="flex items-center justify-between">
                    <CaptionSettings settings={captionSettings} onSettingsChange={setCaptionSettings} />
                    <div className="flex items-center gap-3">
                      {job.result?.language && (
                        <span className="text-xs text-zinc-500">Detected: <span className="text-zinc-300">{job.result.language}</span></span>
                      )}
                      <p className="text-[10px] text-zinc-600">
                        Space (play/pause) · ←/→ (±5s) · J/K/L
                      </p>
                    </div>
                  </div>
                  <VideoPlayer
                    mediaUrl={job.mediaUrl}
                    cues={cues}
                    videoRef={videoRef}
                    onTimeUpdate={setCurrentTimeMs}
                    captionSettings={captionSettings}
                  />
                </div>

                <div className="col-span-3 flex flex-col gap-4" style={{ maxHeight: "calc(9/16 * (100vw * 0.7) + 2rem)", overflowY: "auto" }}>
                  <div className="rounded-xl border border-zinc-800/60 bg-zinc-900/30 p-4">
                    <ExportPanel result={job.result} title={job.title} jobId={job.railwayJobId} />
                  </div>
                  <div className="rounded-xl border border-zinc-800/60 bg-zinc-900/30 p-4 overflow-auto flex-1">
                    <QCPanel qc={job.result?.qc} onJumpToCue={handleJumpToCue} />
                  </div>
                </div>
              </div>
            </div>

            {/* Scrollable caption editor below */}
            <div className="mt-4 rounded-xl border border-zinc-800/60 bg-zinc-900/30 overflow-hidden">
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