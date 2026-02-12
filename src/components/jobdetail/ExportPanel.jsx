import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { Download, Copy, Check } from "lucide-react";

function downloadBlob(content, filename, mime) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  URL.revokeObjectURL(url);
  a.remove();
}

function sanitizeFilename(str) {
  return (str || "export").replace(/[^a-zA-Z0-9_-]/g, "_").substring(0, 50);
}

export default function ExportPanel({ result, title, jobId }) {
  const [copiedSrt, setCopiedSrt] = useState(false);
  const [copiedVtt, setCopiedVtt] = useState(false);

  if (!result) return null;

  const safeName = sanitizeFilename(title);

  const handleCopy = async (text, setter) => {
    await navigator.clipboard.writeText(text);
    setter(true);
    setTimeout(() => setter(false), 2000);
  };

  return (
    <div className="space-y-3">
      <h3 className="text-xs font-semibold text-zinc-400 uppercase tracking-wide">Exports</h3>
      <div className="grid grid-cols-2 gap-2">
        {result.srt && (
          <Button variant="outline" size="sm" onClick={() => downloadBlob(result.srt, `${safeName}_${jobId}.srt`, "text/plain")} className="border-zinc-800 text-zinc-300 hover:bg-zinc-800 hover:text-white text-xs h-8 justify-start">
            <Download className="w-3 h-3 mr-1.5" /> SRT
          </Button>
        )}
        {result.vtt && (
          <Button variant="outline" size="sm" onClick={() => downloadBlob(result.vtt, `${safeName}_${jobId}.vtt`, "text/plain")} className="border-zinc-800 text-zinc-300 hover:bg-zinc-800 hover:text-white text-xs h-8 justify-start">
            <Download className="w-3 h-3 mr-1.5" /> VTT
          </Button>
        )}
        {result.scc && (
          <Button variant="outline" size="sm" onClick={() => downloadBlob(result.scc, `${safeName}_${jobId}.scc`, "text/plain")} className="border-zinc-800 text-zinc-300 hover:bg-zinc-800 hover:text-white text-xs h-8 justify-start">
            <Download className="w-3 h-3 mr-1.5" /> SCC
          </Button>
        )}
        <Button variant="outline" size="sm" onClick={() => downloadBlob(JSON.stringify(result, null, 2), `${safeName}_${jobId}.json`, "application/json")} className="border-zinc-800 text-zinc-300 hover:bg-zinc-800 hover:text-white text-xs h-8 justify-start">
          <Download className="w-3 h-3 mr-1.5" /> JSON
        </Button>
      </div>
      <div className="flex gap-2">
        {result.srt && (
          <Button variant="ghost" size="sm" onClick={() => handleCopy(result.srt, setCopiedSrt)} className="text-zinc-500 hover:text-white text-[11px] h-7">
            {copiedSrt ? <Check className="w-3 h-3 mr-1 text-emerald-400" /> : <Copy className="w-3 h-3 mr-1" />}
            {copiedSrt ? "Copied" : "Copy SRT"}
          </Button>
        )}
        {result.vtt && (
          <Button variant="ghost" size="sm" onClick={() => handleCopy(result.vtt, setCopiedVtt)} className="text-zinc-500 hover:text-white text-[11px] h-7">
            {copiedVtt ? <Check className="w-3 h-3 mr-1 text-emerald-400" /> : <Copy className="w-3 h-3 mr-1" />}
            {copiedVtt ? "Copied" : "Copy VTT"}
          </Button>
        )}
      </div>
    </div>
  );
}