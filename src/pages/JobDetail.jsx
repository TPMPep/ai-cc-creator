import React, { useState, useEffect, useRef, useCallback } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { createPageUrl } from "../utils";
import { base44 } from "@/api/base44Client";
import { pollJob } from "../components/shared/RailwayApi";
import StatusBadge from "../components/shared/StatusBadge";
import VideoPlayer from "../components/jobdetail/VideoPlayer";
import CaptionSettings from "../components/jobdetail/CaptionSettings";
import SourceTranscriptPanel from "../components/jobdetail/SourceTranscriptPanel";
import DeliveryTabs from "../components/jobdetail/DeliveryTabs";
import DeliveryPanel from "../components/jobdetail/DeliveryPanel";
import AddDeliveryModal from "../components/jobdetail/AddDeliveryModal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2, Plus, RefreshCw, AlertCircle, Pencil, Check, X } from "lucide-react";
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
  const [rawUtterances, setRawUtterances] = useState([]);
  const [activeDeliveryId, setActiveDeliveryId] = useState(null);
  const [addDeliveryOpen, setAddDeliveryOpen] = useState(false);
  const pollingRef = useRef(null);
  const pollStartRef = useRef(null);
  const jobId = searchParams.get("jobId");
  const recordId = searchParams.get("recordId");

  // Active delivery's cues for video overlay
  const activeDelivery = job?.deliveries?.find(d => d.id === activeDeliveryId);
  const activeCues = activeDelivery?.cues || [];

  // Load job from DB
  useEffect(() => {
    if (!jobId && !recordId) return;
    const loadJob = async () => {
      let jobs = [];
      if (recordId) {
        const allJobs = await base44.entities.Job.list("-created_date", 50);
        const match = allJobs.find(j => j.id === recordId);
        if (match) jobs = [match];
      }
      if (jobs.length === 0 && jobId) {
        jobs = await base44.entities.Job.filter({ railwayJobId: jobId }, "-created_date", 1);
      }
      if (jobs.length > 0) {
        let loadedJob = jobs[0];
        setTitleDraft(loadedJob.title || "");

        // Backward compat: migrate old jobs with result.cues but no deliveries
        const hasLegacyResult = loadedJob.status === "done" && loadedJob.result &&
          (loadedJob.result.cues?.length > 0 || loadedJob.result.cue_chunks?.length > 0 || loadedJob.result.srt_url) &&
          (!loadedJob.deliveries || loadedJob.deliveries.length === 0);

        if (hasLegacyResult) {
          const legacyDelivery = {
            id: "legacy-" + loadedJob.id,
            profileName: loadedJob.rules?.captionProfile === "nbcu" ? "NBCU CM-051" :
              loadedJob.rules?.captionProfile || "Initial Format",
            profileSettings: loadedJob.rules || {},
            status: "done",
            railwayJobId: loadedJob.railwayJobId,
            cues: loadedJob.result.cues || [],
            cue_chunks: loadedJob.result.cue_chunks || null,
            qc: loadedJob.result.qc || null,
            srt_url: loadedJob.result.srt_url || null,
            vtt_url: loadedJob.result.vtt_url || null,
            scc_url: loadedJob.result.scc_url || null,
            ttml_url: loadedJob.result.ttml_url || null,
            created_date: loadedJob.created_date,
          };
          loadedJob = { ...loadedJob, deliveries: [legacyDelivery] };
          // Also ensure rawTranscript is set
          if (!loadedJob.rawTranscript && loadedJob.result?.assemblyai_transcript_id) {
            loadedJob.rawTranscript = { transcriptId: loadedJob.result.assemblyai_transcript_id };
          }
        }

        setJob(loadedJob);

        // Select first delivery if exists
        if (loadedJob.deliveries?.length > 0) {
          setActiveDeliveryId(loadedJob.deliveries[0].id);
        }

        // Load raw utterances
        const tid = loadedJob.rawTranscript?.transcriptId || loadedJob.result?.assemblyai_transcript_id;
        if (tid) {
          fetchRawData(tid);
          // Backfill rawTranscript if missing
          if (!loadedJob.rawTranscript && tid) {
            base44.entities.Job.update(loadedJob.id, { rawTranscript: { transcriptId: tid } });
          }
        }
      }
      setLoading(false);
    };
    loadJob();
  }, [jobId, recordId]);

  const fetchRawData = async (tid) => {
    try {
      const res = await base44.functions.invoke("fetchAssemblyAIRaw", { transcriptId: tid, format: "utterances" });
      setRawUtterances(res.data?.utterances || []);
    } catch (e) {
      console.warn("Could not fetch raw utterances:", e);
    }
  };

  // Polling for transcription (initial job processing)
  const jobRef = useRef(job);
  useEffect(() => { jobRef.current = job; }, [job]);

  const doPoll = useCallback(async () => {
    const currentJob = jobRef.current;
    if (!jobId || !currentJob) return;
    if (currentJob.status === "done" || currentJob.status === "error") return;

    try {
      const data = await pollJob(jobId);
      const statusMap = { completed: "done", complete: "done", finished: "done", success: "done", failed: "error", failure: "error" };
      const mappedStatus = statusMap[data.status] || data.status;
      const updates = { status: mappedStatus, lastPolledAt: new Date().toISOString() };
      if (data.error) updates.error = typeof data.error === "object" ? data.error.message : data.error;

      if (mappedStatus === "done") {
        // Extract transcript ID for raw data
        const tid = data.assemblyai_transcript_id || data.transcript_id ||
          (data.result && (data.result.assemblyai_transcript_id || data.result.transcript_id));
        
        if (tid) {
          updates.rawTranscript = {
            transcriptId: tid,
          };
          // Fetch raw data
          fetchRawData(tid);
        }

        // Store minimal result with transcript ID
        updates.result = {
          assemblyai_transcript_id: tid || null,
        };

        // Initialize empty deliveries — user will add deliveries manually
        if (!currentJob.deliveries || currentJob.deliveries.length === 0) {
          updates.deliveries = [];
        }
      }

      await base44.entities.Job.update(currentJob.id, updates);
      setJob(prev => ({ ...prev, ...updates }));

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
    setJob(prev => ({ ...prev, title: titleDraft.trim() }));
    setEditingTitle(false);
  };

  const [retrying, setRetrying] = useState(false);
  const handleRetry = async () => {
    // Extract s3Key from the job or parse it from the presigned URL
    let key = job.s3Key;
    if (!key && job.mediaUrl) {
      try {
        const u = new URL(job.mediaUrl);
        // S3 presigned URLs have the key as the pathname (minus leading /)
        if (u.hostname.includes('.s3.') && u.hostname.includes('.amazonaws.com')) {
          key = decodeURIComponent(u.pathname.slice(1));
        }
      } catch {}
    }

    if (key) {
      setRetrying(true);
      try {
        const res = await base44.functions.invoke("refreshS3Url", { s3Key: job.s3Key });
        const freshUrl = res.data?.url;
        if (freshUrl) {
          const params = new URLSearchParams({ mediaUrl: freshUrl });
          navigate(createPageUrl("NewJob") + `?${params.toString()}`);
          return;
        }
      } catch (e) {
        console.warn("Could not refresh S3 URL, using original:", e);
      } finally {
        setRetrying(false);
      }
    }
    const params = new URLSearchParams({ mediaUrl: job.mediaUrl });
    navigate(createPageUrl("NewJob") + `?${params.toString()}`);
  };

  const handleDeliveryCreated = (delivery, updatedDeliveries) => {
    setJob(prev => ({ ...prev, deliveries: updatedDeliveries }));
    setActiveDeliveryId(delivery.id);
  };

  const handleDeliveryUpdated = useCallback(async (updatedDelivery) => {
    setJob(prev => {
      const updatedDeliveries = (prev.deliveries || []).map(d =>
        d.id === updatedDelivery.id ? updatedDelivery : d
      );
      // Persist to DB (fire and forget — state is updated immediately)
      base44.entities.Job.update(prev.id, { deliveries: updatedDeliveries });
      return { ...prev, deliveries: updatedDeliveries };
    });
  }, []);

  const handleRemoveDelivery = async (deliveryId) => {
    const updatedDeliveries = (job.deliveries || []).filter(d => d.id !== deliveryId);
    await base44.entities.Job.update(job.id, { deliveries: updatedDeliveries });
    setJob(prev => ({ ...prev, deliveries: updatedDeliveries }));
    if (activeDeliveryId === deliveryId) {
      setActiveDeliveryId(updatedDeliveries.length > 0 ? updatedDeliveries[0].id : null);
    }
  };

  const handleSeek = (timeSec) => {
    if (videoRef.current) videoRef.current.currentTime = timeSec;
  };

  // --- Render ---

  if (!jobId && !recordId) {
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
            <h2 className="text-lg font-semibold text-white mb-2">Transcribing audio…</h2>
            <p className="text-sm text-zinc-500 mb-1">Your raw transcript will appear once complete.</p>
            <p className="text-xs text-zinc-600 mb-4">Then you can apply delivery profiles to format your captions.</p>
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
                <Button variant="outline" size="sm" onClick={handleRetry} disabled={retrying} className="border-red-500/30 text-red-300 hover:bg-red-500/10 mt-4">
                  {retrying ? <><Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> Refreshing URL…</> : "Retry Job"}
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* Done state — Split Panel Layout */}
        {isDone && (
          <>
            {/* Video Player — full width, compact */}
            <div className="mb-6">
              <div className="flex items-center justify-between mb-2">
                <CaptionSettings settings={captionSettings} onSettingsChange={setCaptionSettings} />
                <p className="text-[10px] text-zinc-600">
                  Space (play/pause) • ←/→ (±5s) • J/K/L (−10s/pause/+10s)
                </p>
              </div>
              <VideoPlayer
                mediaUrl={job.mediaUrl}
                cues={activeCues}
                videoRef={videoRef}
                onTimeUpdate={setCurrentTimeMs}
                captionSettings={captionSettings}
              />
            </div>

            {/* Split Panel: Source (left) | Deliveries (right) */}
            <div className="grid grid-cols-10 gap-4" style={{ minHeight: "65vh" }}>
              {/* Left: Source Transcript (30%) */}
              <div className="col-span-3 rounded-xl border border-zinc-800/60 bg-zinc-900/30 overflow-hidden flex flex-col" style={{ maxHeight: "75vh" }}>
                <SourceTranscriptPanel
                  utterances={rawUtterances}
                  currentTimeMs={currentTimeMs}
                  onSeek={handleSeek}
                />
              </div>

              {/* Right: Deliveries (70%) */}
              <div className="col-span-7 rounded-xl border border-zinc-800/60 bg-zinc-900/30 overflow-hidden flex flex-col" style={{ maxHeight: "75vh" }}>
                <DeliveryTabs
                  deliveries={job.deliveries || []}
                  activeDeliveryId={activeDeliveryId}
                  onSelect={setActiveDeliveryId}
                  onAdd={() => setAddDeliveryOpen(true)}
                  onRemove={handleRemoveDelivery}
                />

                {activeDelivery ? (
                  <div className="flex-1 overflow-auto">
                    <DeliveryPanel
                      key={activeDelivery.id}
                      delivery={activeDelivery}
                      job={job}
                      currentTimeMs={currentTimeMs}
                      videoRef={videoRef}
                      onDeliveryUpdated={handleDeliveryUpdated}
                    />
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center flex-1 py-16 gap-4">
                    <div className="w-16 h-16 rounded-2xl bg-zinc-800/50 flex items-center justify-center mb-2">
                      <Plus className="w-7 h-7 text-zinc-600" />
                    </div>
                    <h3 className="text-sm font-semibold text-zinc-300">No deliveries yet</h3>
                    <p className="text-xs text-zinc-500 text-center max-w-xs">
                      Click "Add Delivery" to apply a caption profile (NBCU, Netflix, custom) and generate formatted captions from your transcript.
                    </p>
                    <Button
                      onClick={() => setAddDeliveryOpen(true)}
                      className="bg-blue-600 hover:bg-blue-500 text-white mt-2"
                    >
                      <Plus className="w-4 h-4 mr-2" /> Add Delivery
                    </Button>
                  </div>
                )}
              </div>
            </div>

            {/* Add Delivery Modal */}
            <AddDeliveryModal
              open={addDeliveryOpen}
              onClose={() => setAddDeliveryOpen(false)}
              job={job}
              onDeliveryCreated={handleDeliveryCreated}
            />
          </>
        )}
      </div>
    </div>
  );
}