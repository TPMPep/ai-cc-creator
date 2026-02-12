import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { createPageUrl } from "../utils";
import { base44 } from "@/api/base44Client";
import { createJob } from "../components/shared/RailwayApi";
import { NBCU_DEFAULTS } from "../components/shared/RulesDefaults";
import RulesPanel from "../components/newjob/RulesPanel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Loader2, Sparkles, Info, AlertCircle } from "lucide-react";

export default function NewJob() {
  const navigate = useNavigate();
  const [mediaUrl, setMediaUrl] = useState("");
  const [speakerLabels, setSpeakerLabels] = useState(true);
  const [languageDetection, setLanguageDetection] = useState(true);
  const [rules, setRules] = useState({ ...NBCU_DEFAULTS });
  const [preset, setPreset] = useState("nbcu");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [urlError, setUrlError] = useState(null);
  const [user, setUser] = useState(null);

  useEffect(() => {
    // Check for prefilled data from query params
    const params = new URLSearchParams(window.location.search);
    const prefillUrl = params.get("mediaUrl");
    const prefillRules = params.get("rules");
    if (prefillUrl) setMediaUrl(prefillUrl);
    if (prefillRules) {
      try { setRules(JSON.parse(prefillRules)); setPreset("custom"); } catch {}
    }
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
      const payload = {
        mediaUrl,
        speaker_labels: speakerLabels,
        language_detection: languageDetection,
        rules,
      };
      const data = await createJob(payload);

      // Save to DB
      await base44.entities.Job.create({
        jobId: data.id,
        userId: user?.email || "",
        mediaUrl,
        title: deriveTitleFromUrl(mediaUrl),
        status: data.status || "processing",
        rules,
        speakerLabels,
        languageDetection,
      });

      navigate(createPageUrl("JobDetail") + `?jobId=${data.id}`);
    } catch (err) {
      setError(err.message || "Failed to create job");
      setSubmitting(false);
    }
  };

  return (
    <div className="px-4 sm:px-6 lg:px-8 py-8">
      <div className="max-w-6xl mx-auto">
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-white">New Caption Job</h1>
          <p className="text-sm text-zinc-500 mt-1">Submit a public media URL to generate broadcast-ready captions.</p>
        </div>

        <div className="grid lg:grid-cols-5 gap-8">
          {/* Left column - Input + Rules */}
          <div className="lg:col-span-3 space-y-6">
            {/* Media URL */}
            <div className="rounded-xl border border-zinc-800/60 bg-zinc-900/30 p-6 space-y-5">
              <div className="space-y-2">
                <Label className="text-sm text-zinc-300 font-medium">Media URL *</Label>
                <Input
                  value={mediaUrl}
                  onChange={(e) => { setMediaUrl(e.target.value); setUrlError(null); }}
                  placeholder="https://…/video.mp4"
                  className="bg-zinc-900 border-zinc-800 text-white placeholder:text-zinc-600 focus:border-blue-500 h-11"
                />
                {urlError && (
                  <p className="text-xs text-red-400 flex items-center gap-1"><AlertCircle className="w-3 h-3" /> {urlError}</p>
                )}
                <p className="text-xs text-zinc-600">Publicly accessible URL required. Do not submit confidential media unless you control access.</p>
              </div>

              <div className="flex flex-wrap gap-6">
                <div className="flex items-center gap-2.5">
                  <Switch checked={speakerLabels} onCheckedChange={setSpeakerLabels} className="data-[state=checked]:bg-blue-600" />
                  <Label className="text-xs text-zinc-400">Speaker labels</Label>
                </div>
                <div className="flex items-center gap-2.5">
                  <Switch checked={languageDetection} onCheckedChange={setLanguageDetection} className="data-[state=checked]:bg-blue-600" />
                  <Label className="text-xs text-zinc-400">Language detection</Label>
                </div>
              </div>
            </div>

            {/* Rules */}
            <div className="rounded-xl border border-zinc-800/60 bg-zinc-900/30 p-6">
              <RulesPanel rules={rules} onRulesChange={setRules} preset={preset} onPresetChange={setPreset} />
            </div>

            {/* Submit */}
            <div>
              {error && (
                <div className="mb-4 p-3 rounded-lg border border-red-500/30 bg-red-500/5 text-sm text-red-400 flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" /> {error}
                </div>
              )}
              <Button
                onClick={handleSubmit}
                disabled={submitting || !mediaUrl.trim()}
                className="bg-blue-600 hover:bg-blue-700 text-white h-11 px-8 text-sm font-semibold w-full sm:w-auto"
              >
                {submitting ? (
                  <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Creating…</>
                ) : (
                  <><Sparkles className="w-4 h-4 mr-2" /> Create Captions</>
                )}
              </Button>
            </div>
          </div>

          {/* Right column - Instructions */}
          <div className="lg:col-span-2">
            <div className="rounded-xl border border-zinc-800/60 bg-zinc-900/30 p-6 sticky top-20">
              <div className="flex items-center gap-2 mb-4">
                <Info className="w-4 h-4 text-blue-400" />
                <h3 className="text-sm font-semibold text-zinc-200">How it works</h3>
              </div>
              <ol className="space-y-4 text-sm text-zinc-400">
                <li className="flex gap-3">
                  <span className="w-5 h-5 rounded-full bg-zinc-800 text-zinc-500 text-xs flex items-center justify-center flex-shrink-0 mt-0.5">1</span>
                  <span>Paste a publicly accessible video or audio URL above.</span>
                </li>
                <li className="flex gap-3">
                  <span className="w-5 h-5 rounded-full bg-zinc-800 text-zinc-500 text-xs flex items-center justify-center flex-shrink-0 mt-0.5">2</span>
                  <span>Configure caption rules (or use the NBCU default preset).</span>
                </li>
                <li className="flex gap-3">
                  <span className="w-5 h-5 rounded-full bg-zinc-800 text-zinc-500 text-xs flex items-center justify-center flex-shrink-0 mt-0.5">3</span>
                  <span>Click "Create Captions" — the job will process in the background.</span>
                </li>
                <li className="flex gap-3">
                  <span className="w-5 h-5 rounded-full bg-zinc-800 text-zinc-500 text-xs flex items-center justify-center flex-shrink-0 mt-0.5">4</span>
                  <span>Review captions with synced playback, QC checks, and download SRT/VTT/SCC exports.</span>
                </li>
              </ol>
              <div className="mt-6 p-3 rounded-lg bg-blue-600/5 border border-blue-500/10">
                <p className="text-xs text-blue-400/80 leading-relaxed">
                  The media URL must be reachable by our backend. Private/authenticated URLs will fail.
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}