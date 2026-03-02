import React, { useState, useEffect } from "react";
import { useNavigate, Link } from "react-router-dom";
import { createPageUrl } from "../utils";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, Sparkles, Info, AlertCircle, Radio } from "lucide-react";
import { toast } from "sonner";

export default function NewJobAI() {
  const navigate = useNavigate();
  const [mediaUrl, setMediaUrl] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [urlError, setUrlError] = useState(null);
  const [user, setUser] = useState(null);

  useEffect(() => {
    base44.auth.me().then(setUser);
  }, []);

  const validateUrl = (url) => {
    try {
      const u = new URL(url);
      if (!["http:", "https:"].includes(u.protocol)) return "URL must use http or https protocol";
      return null;
    } catch {
      return "Please enter a valid URL";
    }
  };

  const deriveTitleFromUrl = (url) => {
    try {
      const pathname = new URL(url).pathname;
      const filename = pathname.split("/").pop();
      if (filename) return decodeURIComponent(filename.replace(/\.[^.]+$/, ""));
    } catch {}
    return "Untitled Job";
  };

  const handleSubmit = async () => {
    setError(null);
    const vErr = validateUrl(mediaUrl);
    if (vErr) { setUrlError(vErr); return; }
    setUrlError(null);
    setSubmitting(true);

    try {
      // Start AssemblyAI transcription (first call without job_db_id to get transcript_id)
      const res = await base44.functions.invoke("startAICaption", { mediaUrl });
      const { transcript_id } = res.data;
      if (!transcript_id) throw new Error("No transcript ID returned");

      // Save job to DB
      const job = await base44.entities.Job.create({
        railwayJobId: transcript_id,
        userId: user?.email || "",
        mediaUrl,
        title: deriveTitleFromUrl(mediaUrl),
        status: "processing",
        pipeline: "ai",
      });

      // Kick off server-side polling so processing happens even if browser closes
      base44.functions.invoke("waitAndProcess", {
        transcript_id,
        job_db_id: job.id,
      }).catch(err => console.error("waitAndProcess fire-and-forget error:", err));

      navigate(createPageUrl("JobDetailAI") + `?jobId=${transcript_id}`);
    } catch (err) {
      setError(err.message || "Failed to start job");
      setSubmitting(false);
    }
  };

  return (
    <div className="px-4 sm:px-6 lg:px-8 py-8">
      <div className="max-w-3xl mx-auto">
        {/* Pipeline toggle */}
        <div className="mb-8 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-white">New Caption Job</h1>
            <p className="text-sm text-zinc-500 mt-1">AI pipeline · AssemblyAI + GPT-4o · NBCU broadcast spec</p>
          </div>
          <Link to={createPageUrl("NewJob")}>
            <Button variant="outline" size="sm" className="border-zinc-700 text-zinc-400 hover:text-white gap-2">
              <Radio className="w-3.5 h-3.5" /> Switch to Railway
            </Button>
          </Link>
        </div>

        <div className="rounded-xl border border-zinc-800/60 bg-zinc-900/30 p-6 space-y-6">
          {/* Media URL */}
          <div className="space-y-2">
            <Label className="text-sm text-zinc-300 font-medium">Media URL *</Label>
            <Input
              value={mediaUrl}
              onChange={(e) => { setMediaUrl(e.target.value); setUrlError(null); }}
              placeholder="https://…/video.mp4 or audio.mp3"
              className="bg-zinc-900 border-zinc-800 text-white placeholder:text-zinc-600 focus:border-blue-500 h-11"
            />
            {urlError && (
              <p className="text-xs text-red-400 flex items-center gap-1"><AlertCircle className="w-3 h-3" /> {urlError}</p>
            )}
            <p className="text-xs text-zinc-600 flex items-start gap-1.5">
              <Info className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
              Publicly accessible URL (video or audio). The AI will transcribe, detect speakers, flag foreign language segments, add music cues, and format to NBCU broadcast spec.
            </p>
          </div>

          {/* What this does */}
          <div className="rounded-lg bg-blue-600/5 border border-blue-500/15 p-4 space-y-2">
            <p className="text-xs font-semibold text-blue-400 uppercase tracking-wide">What the AI pipeline does</p>
            <ul className="space-y-1.5 text-xs text-zinc-400">
              <li className="flex items-start gap-2"><span className="text-blue-500 mt-0.5">①</span> Transcribes speech with word-level timestamps (AssemblyAI)</li>
              <li className="flex items-start gap-2"><span className="text-blue-500 mt-0.5">②</span> Detects foreign language and inserts <span className="font-mono text-zinc-300">[Speaking Spanish]</span> cues</li>
              <li className="flex items-start gap-2"><span className="text-blue-500 mt-0.5">③</span> Adds music cues where appropriate</li>
              <li className="flex items-start gap-2"><span className="text-blue-500 mt-0.5">④</span> Applies NBCU rules: 32 chars/line max, 2 lines max, reading speed</li>
              <li className="flex items-start gap-2"><span className="text-blue-500 mt-0.5">⑤</span> Exports SCC (broadcast), SRT, VTT · starts at 00:00:00:00</li>
            </ul>
          </div>

          {error && (
            <div className="p-3 rounded-lg border border-red-500/30 bg-red-500/5 text-sm text-red-400 flex items-start gap-2">
              <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" /> {error}
            </div>
          )}

          <Button
            onClick={handleSubmit}
            disabled={submitting || !mediaUrl.trim()}
            className="bg-blue-600 hover:bg-blue-700 text-white h-11 px-8 text-sm font-semibold w-full"
          >
            {submitting ? (
              <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Starting transcription…</>
            ) : (
              <><Sparkles className="w-4 h-4 mr-2" /> Generate Broadcast Captions</>
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}