import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { CAPTION_OPTIONS_DEFAULTS } from "../shared/RulesDefaults";
import { createReformatJob } from "../shared/RailwayApi";
import CaptionOptionsPanel from "../newjob/CaptionOptionsPanel";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Loader2, RotateCcw, X } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export default function AddDeliveryModal({ open, onClose, job, onDeliveryCreated }) {
  const [captionOptions, setCaptionOptions] = useState({ ...CAPTION_OPTIONS_DEFAULTS });
  const [protectedPhrases, setProtectedPhrases] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const transcriptId = job?.rawTranscript?.transcriptId || job?.result?.assemblyai_transcript_id;

  const profileDisplayName = (opts) => {
    const p = opts?.captionProfile || "nbcu";
    if (p === "nbcu") return "NBCU CM-051";
    if (p === "custom") return "Custom";
    return p.charAt(0).toUpperCase() + p.slice(1);
  };

  const handleSubmit = async () => {
    if (!transcriptId) {
      toast.error("No transcript ID available. Job may still be processing.");
      return;
    }
    setSubmitting(true);

    try {
      const parsedPhrases = protectedPhrases
        .split(/[\n,]+/)
        .map((s) => s.trim())
        .filter(Boolean);

      const optionsWithPhrases = {
        ...captionOptions,
        ...(parsedPhrases.length > 0 ? { italicizePhrases: parsedPhrases.join(",") } : {}),
      };

      // Generate a unique delivery ID
      const deliveryId = crypto.randomUUID();

      // Call Railway reformat endpoint
      const data = await createReformatJob(transcriptId, optionsWithPhrases, parsedPhrases);
      const railwayJobId = data.job_id || data.id;
      if (!railwayJobId) throw new Error("No job_id returned from Railway");

      // Create the delivery entry
      const delivery = {
        id: deliveryId,
        profileName: profileDisplayName(captionOptions),
        profileSettings: captionOptions,
        status: "processing",
        railwayJobId,
        cues: [],
        qc: null,
        srt_url: null,
        vtt_url: null,
        scc_url: null,
        ttml_url: null,
        created_date: new Date().toISOString(),
      };

      // Save to job
      const existingDeliveries = job.deliveries || [];
      const updatedDeliveries = [...existingDeliveries, delivery];
      await base44.entities.Job.update(job.id, { deliveries: updatedDeliveries });

      toast.success(`Delivery "${delivery.profileName}" started`);
      onDeliveryCreated(delivery, updatedDeliveries);
      onClose();
    } catch (err) {
      console.error("Add delivery error:", err);
      toast.error(`Failed to create delivery: ${err.message}`);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="bg-zinc-900 border-zinc-800 max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-white text-lg">Add Delivery</DialogTitle>
        </DialogHeader>

        <p className="text-xs text-zinc-400 leading-relaxed">
          Select a delivery profile and formatting rules. The raw transcript will be reformatted without re-transcribing.
        </p>

        {/* Protected Phrases */}
        <div className="space-y-2 mt-2">
          <Label className="text-xs text-zinc-300 font-medium">
            Protected Phrases <span className="text-zinc-500">(optional)</span>
          </Label>
          <Textarea
            value={protectedPhrases}
            onChange={(e) => setProtectedPhrases(e.target.value)}
            placeholder={"Watch What Happens Live\nBelow Deck Med"}
            rows={2}
            className="bg-zinc-800/80 border-zinc-500/60 text-white placeholder:text-zinc-500 text-xs resize-y"
          />
        </div>

        {/* Caption Options */}
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

        {/* Submit */}
        <div className="flex justify-end gap-3 mt-4 pt-4 border-t border-zinc-800">
          <Button variant="outline" onClick={onClose} className="border-zinc-700 text-zinc-400">
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={submitting || !transcriptId}
            className="bg-blue-600 hover:bg-blue-500 text-white"
          >
            {submitting ? (
              <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Creating…</>
            ) : (
              <><RotateCcw className="w-4 h-4 mr-2" /> Generate Delivery</>
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}