import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { Code2, Copy, Check, X } from "lucide-react";
import { toast } from "sonner";
import { buildCaptionEnvVars } from "../shared/RailwayApi";

export default function PayloadInspector({ mediaUrl, speakerLabels, languageDetection, allowHttp, protectedPhrases, captionOptions }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  const parsedPhrases = (protectedPhrases || "")
    .split(/[\n,]+/)
    .map(s => s.trim())
    .filter(Boolean);

  const payload = {
    mediaUrl: mediaUrl || "(empty)",
    speakerLabels,
    languageDetection,
    allowHttp,
    protectedPhrases: parsedPhrases,
    captionOptions: buildCaptionEnvVars(captionOptions),
  };

  const json = JSON.stringify(payload, null, 2);

  const handleCopy = () => {
    navigator.clipboard.writeText(json);
    setCopied(true);
    toast.success("Payload copied");
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        title="View Railway API payload"
        className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-xs text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/60 transition-colors border border-transparent hover:border-zinc-700/50"
      >
        <Code2 className="w-3.5 h-3.5" />
        <span>API Payload</span>
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => setOpen(false)}>
          <div
            className="bg-zinc-900 border border-zinc-700/60 rounded-xl shadow-2xl w-full max-w-2xl mx-4 max-h-[80vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-800">
              <div>
                <h3 className="text-sm font-semibold text-zinc-200">Railway API Payload</h3>
                <p className="text-xs text-zinc-500 mt-0.5">POST to /v1/jobs — this is exactly what gets sent</p>
              </div>
              <div className="flex items-center gap-2">
                <Button size="sm" variant="ghost" onClick={handleCopy} className="text-zinc-400 hover:text-white h-8 px-2">
                  {copied ? <Check className="w-3.5 h-3.5 text-green-400" /> : <Copy className="w-3.5 h-3.5" />}
                  <span className="ml-1 text-xs">{copied ? "Copied" : "Copy"}</span>
                </Button>
                <button onClick={() => setOpen(false)} className="text-zinc-500 hover:text-zinc-300">
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>
            <div className="overflow-auto flex-1 p-5">
              <pre className="text-xs text-zinc-300 font-mono leading-relaxed whitespace-pre-wrap break-words">
                {json}
              </pre>
            </div>
            <div className="px-5 py-3 border-t border-zinc-800 text-xs text-zinc-600">
              Endpoint: POST https://web-production-eba27.up.railway.app/v1/jobs
            </div>
          </div>
        </div>
      )}
    </>
  );
}