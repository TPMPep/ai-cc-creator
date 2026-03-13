import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { Download, Copy, Check, Loader2, DownloadCloud } from "lucide-react";
import { getCuesFromResult } from "../shared/CueUtils";
import { base44 } from "@/api/base44Client";

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

async function downloadFromUrl(url, filename) {
  const res = await fetch(url);
  const blob = await res.blob();
  const blobUrl = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = blobUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  URL.revokeObjectURL(blobUrl);
  a.remove();
}

async function fetchTextFromUrl(url) {
  const res = await fetch(url);
  return res.text();
}

function joinChunks(chunks) {
  if (!Array.isArray(chunks)) return "";
  return chunks.join("");
}

export default function ExportPanel({ result, title, jobId, assemblyaiTranscriptId }) {
  const [copiedSrt, setCopiedSrt] = useState(false);
  const [copiedVtt, setCopiedVtt] = useState(false);
  const [downloading, setDownloading] = useState(null);

  if (!result) return null;

  const safeName = sanitizeFilename(title || "export");

  // Support URL-based, inline data, and chunked data
  const hasScc = result.scc_url || result.scc || result.scc_text || result.scc_chunks;
  const hasSrt = result.srt_url || result.srt || result.srt_text || result.srt_chunks;
  const hasVtt = result.vtt_url || result.vtt || result.vtt_text || result.vtt_chunks;
  const hasTtml = result.ttml_url || result.ttml || result.ttml_text || result.ttml_chunks;
  const hasCueUrl = !!result.cue_url;

  const handleDownload = async (urlOrContent, isUrl, filename) => {
    setDownloading(filename);
    if (isUrl) {
      await downloadFromUrl(urlOrContent, filename);
    } else {
      downloadBlob(urlOrContent, filename, "text/plain");
    }
    setDownloading(null);
  };

  const handleCopy = async (urlOrContent, isUrl, setter) => {
    const text = isUrl ? await fetchTextFromUrl(urlOrContent) : urlOrContent;
    await navigator.clipboard.writeText(text);
    setter(true);
    setTimeout(() => setter(false), 2000);
  };

  const DownloadBtn = ({ onClick, children, className, highlight }) => (
    <Button
      variant="outline"
      size="sm"
      onClick={onClick}
      disabled={!!downloading}
      className={highlight
        ? "w-full bg-blue-600/10 border-blue-500/40 text-blue-300 hover:bg-blue-600/20 hover:text-blue-200 text-xs h-9 justify-start font-semibold"
        : "bg-transparent border-zinc-800 text-zinc-300 hover:bg-zinc-800 hover:text-white text-xs h-8 justify-start"
      }
    >
      {downloading ? <Loader2 className="w-3 h-3 mr-1.5 animate-spin" /> : <Download className="w-3 h-3 mr-1.5" />}
      {children}
    </Button>
  );

  return (
    <div className="space-y-3">
      <h3 className="text-xs font-semibold text-zinc-400 uppercase tracking-wide">Exports</h3>
      {hasTtml && (
        <DownloadBtn
          highlight
          onClick={() => {
            const content = result.ttml_url || result.ttml_text || result.ttml || (result.ttml_chunks ? joinChunks(result.ttml_chunks) : null);
            const isUrl = !!result.ttml_url;
            handleDownload(content, isUrl, `${safeName}_${jobId}.ttml`);
          }}
        >
          TTML (Broadcast / IMSC-1.1)
        </DownloadBtn>
      )}
      {hasScc && (
        <DownloadBtn
          highlight
          onClick={() => {
            const content = result.scc_url || result.scc_text || result.scc || (result.scc_chunks ? joinChunks(result.scc_chunks) : null);
            const isUrl = !!result.scc_url;
            handleDownload(content, isUrl, `${safeName}_${jobId}.scc`);
          }}
        >
          SCC (Broadcast / CEA-608)
        </DownloadBtn>
      )}
      <div className="grid grid-cols-2 gap-2">
        {hasSrt && (
          <DownloadBtn onClick={() => {
            const content = result.srt_url || result.srt_text || result.srt || (result.srt_chunks ? joinChunks(result.srt_chunks) : null);
            const isUrl = !!result.srt_url;
            handleDownload(content, isUrl, `${safeName}_${jobId}.srt`);
          }}>
            SRT
          </DownloadBtn>
        )}
        {hasVtt && (
          <DownloadBtn onClick={() => {
            const content = result.vtt_url || result.vtt_text || result.vtt || (result.vtt_chunks ? joinChunks(result.vtt_chunks) : null);
            const isUrl = !!result.vtt_url;
            handleDownload(content, isUrl, `${safeName}_${jobId}.vtt`);
          }}>
            VTT
          </DownloadBtn>
        )}
        <DownloadBtn onClick={async () => {
          if (result.cue_url) {
            await handleDownload(result.cue_url, true, `${safeName}_${jobId}.json`);
          } else {
            const cues = getCuesFromResult(result);
            downloadBlob(JSON.stringify(cues, null, 2), `${safeName}_${jobId}.json`, "application/json");
          }
        }}>
          JSON (Cues)
        </DownloadBtn>
      </div>
      {/* AssemblyAI Raw Exports */}
      {assemblyaiTranscriptId && (
        <>
          <h3 className="text-xs font-semibold text-zinc-400 uppercase tracking-wide mt-4">Raw (AssemblyAI)</h3>
          <div className="grid grid-cols-2 gap-2">
            <DownloadBtn onClick={async () => {
              setDownloading("aai-srt");
              const res = await base44.functions.invoke("fetchAssemblyAIRaw", { transcriptId: assemblyaiTranscriptId, format: "srt" });
              downloadBlob(res.data.srt, `${safeName}_raw_${jobId}.srt`, "text/plain");
              setDownloading(null);
            }}>
              Raw SRT
            </DownloadBtn>
            <DownloadBtn onClick={async () => {
              setDownloading("aai-json");
              const res = await base44.functions.invoke("fetchAssemblyAIRaw", { transcriptId: assemblyaiTranscriptId, format: "json" });
              downloadBlob(JSON.stringify(res.data.json, null, 2), `${safeName}_raw_${jobId}.json`, "application/json");
              setDownloading(null);
            }}>
              Raw JSON
            </DownloadBtn>
          </div>
        </>
      )}

      {/* Download All */}
      <Button
        variant="outline"
        size="sm"
        disabled={!!downloading}
        onClick={async () => {
          setDownloading("all");
          const delay = (ms) => new Promise(r => setTimeout(r, ms));

          // TTML
          if (hasTtml) {
            const content = result.ttml_url || result.ttml_text || result.ttml || (result.ttml_chunks ? joinChunks(result.ttml_chunks) : null);
            if (result.ttml_url) await downloadFromUrl(content, `${safeName}_${jobId}.ttml`);
            else downloadBlob(content, `${safeName}_${jobId}.ttml`, "text/plain");
            await delay(400);
          }

          // SRT
          if (hasSrt) {
            const content = result.srt_url || result.srt_text || result.srt || (result.srt_chunks ? joinChunks(result.srt_chunks) : null);
            if (result.srt_url) await downloadFromUrl(content, `${safeName}_${jobId}.srt`);
            else downloadBlob(content, `${safeName}_${jobId}.srt`, "text/plain");
            await delay(400);
          }

          // JSON Cues
          if (result.cue_url) {
            await downloadFromUrl(result.cue_url, `${safeName}_${jobId}.json`);
          } else {
            const cues = getCuesFromResult(result);
            downloadBlob(JSON.stringify(cues, null, 2), `${safeName}_${jobId}.json`, "application/json");
          }
          await delay(400);

          // Raw SRT + Raw JSON from AssemblyAI
          if (assemblyaiTranscriptId) {
            const srtRes = await base44.functions.invoke("fetchAssemblyAIRaw", { transcriptId: assemblyaiTranscriptId, format: "srt" });
            downloadBlob(srtRes.data.srt, `${safeName}_raw_${jobId}.srt`, "text/plain");
            await delay(400);

            const jsonRes = await base44.functions.invoke("fetchAssemblyAIRaw", { transcriptId: assemblyaiTranscriptId, format: "json" });
            downloadBlob(JSON.stringify(jsonRes.data.json, null, 2), `${safeName}_raw_${jobId}.json`, "application/json");
          }

          setDownloading(null);
        }}
        className="w-full bg-emerald-600/10 border-emerald-500/40 text-emerald-300 hover:bg-emerald-600/20 hover:text-emerald-200 text-xs h-9 justify-center font-semibold mt-1"
      >
        {downloading === "all" ? <Loader2 className="w-3 h-3 mr-1.5 animate-spin" /> : <DownloadCloud className="w-3 h-3 mr-1.5" />}
        Download All
      </Button>

      <div className="flex gap-2">
        {hasSrt && (
          <Button variant="ghost" size="sm" onClick={async () => {
            const content = result.srt_url || result.srt_text || result.srt || (result.srt_chunks ? joinChunks(result.srt_chunks) : null);
            const isUrl = !!result.srt_url;
            await handleCopy(content, isUrl, setCopiedSrt);
          }} className="text-zinc-500 hover:text-white text-[11px] h-7">
            {copiedSrt ? <Check className="w-3 h-3 mr-1 text-emerald-400" /> : <Copy className="w-3 h-3 mr-1" />}
            {copiedSrt ? "Copied" : "Copy SRT"}
          </Button>
        )}
        {hasVtt && (
          <Button variant="ghost" size="sm" onClick={async () => {
            const content = result.vtt_url || result.vtt_text || result.vtt || (result.vtt_chunks ? joinChunks(result.vtt_chunks) : null);
            const isUrl = !!result.vtt_url;
            await handleCopy(content, isUrl, setCopiedVtt);
          }} className="text-zinc-500 hover:text-white text-[11px] h-7">
            {copiedVtt ? <Check className="w-3 h-3 mr-1 text-emerald-400" /> : <Copy className="w-3 h-3 mr-1" />}
            {copiedVtt ? "Copied" : "Copy VTT"}
          </Button>
        )}
      </div>
    </div>
  );
}