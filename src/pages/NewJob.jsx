import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { createPageUrl } from "../utils";
import { base44 } from "@/api/base44Client";
import { createJob } from "../components/shared/RailwayApi";
import { ensureSettingsExist, getSettings, matchesDomainAllowlist, checkRateLimit } from "../components/shared/ValidationUtils";
import FileUpload from "../components/newjob/FileUpload";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Loader2, Sparkles, Info, AlertCircle } from "lucide-react";
import { toast } from "sonner";

export default function NewJob() {
  const navigate = useNavigate();
  const [mediaUrl, setMediaUrl] = useState("");
  const [allowHttp, setAllowHttp] = useState(false);
  const [speakerLabels, setSpeakerLabels] = useState(true);
  const [languageDetection, setLanguageDetection] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [urlError, setUrlError] = useState(null);
  const [user, setUser] = useState(null);
  const [settings, setSettings] = useState(null);
  const [s3Key, setS3Key] = useState(null);

  useEffect(() => {
    const init = async () => {
      const u = await base44.auth.me();
      setUser(u);
      await ensureSettingsExist(base44);
      const s = await getSettings(base44);
      setSettings(s);
      setAllowHttp(s.defaultAllowHttp || false);

      const params = new URLSearchParams(window.location.search);
      const prefillUrl = params.get("mediaUrl");
      if (prefillUrl) setMediaUrl(prefillUrl);
    };
    init();
  }, []);

  const validateUrl = (url) => {
    try {
      const u = new URL(url);
      if (!["http:", "https:"].includes(u.protocol)) return "URL must use http or https protocol";
      if (u.protocol === "http:" && !allowHttp) {
        return "HTTP is disabled by default. Enable 'Allow HTTP' if your source doesn't support HTTPS.";
      }
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

    if (settings?.allowlistEnabled) {
      const allowed = matchesDomainAllowlist(mediaUrl, settings.allowedDomains);
      if (!allowed) {
        try {
          const hostname = new URL(mediaUrl).hostname;
          setUrlError(`Domain not approved: ${hostname}. Contact an admin.`);
        } catch {
          setUrlError("This URL domain is not approved. Contact an admin.");
        }
        return;
      }
    }

    const rateCheck = checkRateLimit(settings?.jobsPerMinute || 3);
    if (!rateCheck.allowed) {
      toast.error(rateCheck.message);
      return;
    }

    const processingJobs = await base44.entities.Job.filter({
      userId: user?.email,
      status: { $in: ["queued", "processing"] }
    });
    const maxConcurrent = settings?.maxConcurrentProcessingJobsPerUser || 3;
    if (processingJobs.length >= maxConcurrent) {
      toast.error(`You already have ${processingJobs.length} job${processingJobs.length !== 1 ? 's' : ''} in progress. Please wait for one to finish.`);
      return;
    }

    setSubmitting(true);

    try {
      // Submit with no caption options — just transcription settings
      const payload = {
        mediaUrl,
        speaker_labels: speakerLabels,
        language_detection: languageDetection,
        allowHttp,
        protected_phrases: [],
        captionOptions: {}, // No profile rules — raw transcription only
      };
      const data = await createJob(payload);

      let errorMsg = data.error || null;
      if (errorMsg && typeof errorMsg === "object") {
        errorMsg = errorMsg.message || JSON.stringify(errorMsg);
      }
      const mappedStatus = (data.status === "failed") ? "error" : (data.status || "processing");

      await base44.entities.Job.create({
        railwayJobId: data.id,
        userId: user?.email || "",
        mediaUrl,
        s3Key: s3Key || undefined,
        title: deriveTitleFromUrl(mediaUrl),
        status: mappedStatus,
        error: errorMsg,
        allowHttp,
        speakerLabels,
        languageDetection,
        result: data.assemblyai_transcript_id ? { assemblyai_transcript_id: data.assemblyai_transcript_id } : undefined,
        rawTranscript: data.assemblyai_transcript_id ? { transcriptId: data.assemblyai_transcript_id } : undefined,
        deliveries: [],
      });

      navigate(createPageUrl("JobDetail") + `?jobId=${data.id}`);
    } catch (err) {
      setError(err.message || "Failed to create job");
      setSubmitting(false);
    }
  };

  return (
    <div className="px-4 sm:px-6 lg:px-8 py-10">
      <div className="max-w-4xl mx-auto">
        <div className="mb-10">
          <h1 className="text-2xl font-bold text-white tracking-tight">New Caption Job</h1>
          <p className="text-sm text-zinc-400 mt-1.5">Submit a media file to transcribe and generate captions.</p>
        </div>

        <div className="grid lg:grid-cols-5 gap-8">
          <div className="lg:col-span-3 space-y-6">
            {/* Media URL */}
            <div className="rounded-xl border border-zinc-700/50 bg-zinc-900/60 p-6 space-y-5">
              <div className="space-y-3">
                <Label className="text-sm text-zinc-200 font-semibold">Media URL <span className="text-blue-400">*</span></Label>
                <Input
                  value={mediaUrl}
                  onChange={(e) => { setMediaUrl(e.target.value); setUrlError(null); }}
                  placeholder="https://…/video.mp4"
                  className="bg-zinc-800/80 border-zinc-500/60 text-white placeholder:text-zinc-500 focus:border-blue-400 focus:ring-2 focus:ring-blue-500/30 h-12 text-sm"
                />
                {urlError && (
                  <p className="text-xs text-red-400 flex items-center gap-1.5 bg-red-500/10 rounded-md px-3 py-1.5"><AlertCircle className="w-3.5 h-3.5 flex-shrink-0" /> {urlError}</p>
                )}

                <div className="relative flex items-center gap-3 my-2">
                  <div className="flex-1 border-t border-zinc-700/50" />
                  <span className="text-xs text-zinc-500 font-medium">or upload a file</span>
                  <div className="flex-1 border-t border-zinc-700/50" />
                </div>

                <FileUpload onUploadComplete={(url, key) => { if (url) { setMediaUrl(url); setS3Key(key || null); } else { setS3Key(null); } }} />

                <div className="flex items-start gap-2 mt-1">
                  <Info className="w-3.5 h-3.5 text-zinc-500 mt-0.5 flex-shrink-0" />
                  <p className="text-xs text-zinc-500 leading-relaxed">
                    Paste a URL or upload a file directly. Uploaded files go to your S3 bucket.
                    {settings?.allowlistEnabled && <span className="text-amber-400 font-medium"> Only approved domains are allowed.</span>}
                  </p>
                </div>
              </div>

              <div className="flex flex-wrap gap-x-8 gap-y-3 pt-2 border-t border-zinc-700/30">
                <div className="flex items-center gap-2.5">
                  <Switch checked={speakerLabels} onCheckedChange={setSpeakerLabels} className="data-[state=checked]:bg-blue-600" />
                  <Label className="text-sm text-zinc-300 cursor-pointer">Speaker labels</Label>
                </div>
                <div className="flex items-center gap-2.5">
                  <Switch checked={languageDetection} onCheckedChange={setLanguageDetection} className="data-[state=checked]:bg-blue-600" />
                  <Label className="text-sm text-zinc-300 cursor-pointer">Language detection</Label>
                </div>
                <div className="flex items-center gap-2.5">
                  <Switch checked={allowHttp} onCheckedChange={setAllowHttp} className="data-[state=checked]:bg-blue-600" />
                  <Label className="text-sm text-zinc-300 cursor-pointer">Allow HTTP</Label>
                </div>
              </div>
            </div>

            {/* Submit */}
            <div>
              {error && (
                <div className="mb-4 p-4 rounded-lg border border-red-500/30 bg-red-500/10 text-sm text-red-300 flex items-start gap-2.5">
                  <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0 text-red-400" /> {error}
                </div>
              )}
              <Button
                onClick={handleSubmit}
                disabled={submitting || !mediaUrl.trim()}
                className="bg-blue-600 hover:bg-blue-500 text-white h-12 px-10 text-sm font-semibold w-full sm:w-auto transition-colors duration-200 shadow-lg shadow-blue-600/20"
              >
                {submitting ? (
                  <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Transcribing…</>
                ) : (
                  <><Sparkles className="w-4 h-4 mr-2" /> Transcribe Media</>
                )}
              </Button>
            </div>
          </div>

          {/* Right column - How it works */}
          <div className="lg:col-span-2">
            <div className="rounded-xl border border-zinc-700/50 bg-zinc-900/60 p-6 sticky top-20">
              <div className="flex items-center gap-2.5 mb-5">
                <div className="w-7 h-7 rounded-lg bg-blue-600/15 flex items-center justify-center">
                  <Info className="w-4 h-4 text-blue-400" />
                </div>
                <h3 className="text-sm font-semibold text-zinc-100">How it works</h3>
              </div>
              <ol className="space-y-4 text-sm text-zinc-300">
                <li className="flex gap-3">
                  <span className="w-6 h-6 rounded-full bg-zinc-800 border border-zinc-700 text-zinc-400 text-xs font-medium flex items-center justify-center flex-shrink-0 mt-0.5">1</span>
                  <span>Paste a publicly accessible video or audio URL, or upload a file.</span>
                </li>
                <li className="flex gap-3">
                  <span className="w-6 h-6 rounded-full bg-zinc-800 border border-zinc-700 text-zinc-400 text-xs font-medium flex items-center justify-center flex-shrink-0 mt-0.5">2</span>
                  <span>We transcribe the audio with speaker identification and sound detection.</span>
                </li>
                <li className="flex gap-3">
                  <span className="w-6 h-6 rounded-full bg-zinc-800 border border-zinc-700 text-zinc-400 text-xs font-medium flex items-center justify-center flex-shrink-0 mt-0.5">3</span>
                  <span>Review your captions, then <strong className="text-white">apply a delivery profile</strong> (NBCU, Netflix, custom) to format for your spec.</span>
                </li>
                <li className="flex gap-3">
                  <span className="w-6 h-6 rounded-full bg-zinc-800 border border-zinc-700 text-zinc-400 text-xs font-medium flex items-center justify-center flex-shrink-0 mt-0.5">4</span>
                  <span>Export in any format — SRT, VTT, TTML, SCC — all from the same transcript.</span>
                </li>
              </ol>
              <div className="mt-6 p-3.5 rounded-lg bg-blue-600/10 border border-blue-500/20">
                <p className="text-xs text-blue-300 leading-relaxed">
                  Transcription runs once. You can re-apply different profiles anytime without re-transcribing.
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}