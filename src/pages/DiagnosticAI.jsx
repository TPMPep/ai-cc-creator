import React, { useState, useEffect, useRef } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { createPageUrl } from "../utils";
import { base44 } from "@/api/base44Client";
import VideoPlayer from "../components/jobdetail/VideoPlayer";
import { Button } from "@/components/ui/button";
import { Loader2, AlertCircle, ArrowLeft } from "lucide-react";
import { getCuesFromResult, getCuesFromResultAsync } from "../components/shared/CueUtils";

const API_BASE = "https://web-production-eba27.up.railway.app";

function msToTimecode(ms) {
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const ms2 = ms % 1000;
  return `${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}:${String(s).padStart(2,"0")}.${String(ms2).padStart(3,"0")}`;
}

// Align rows: assign each assembly/openai cue to the final cue it overlaps MOST with (no duplicates)
function alignRows(assemblyCues, openaiCues, finalCues, utterances) {
    function assignBestMatch(sourceCues) {
      const assignments = new Array(finalCues.length).fill(null).map(() => []);
      for (const src of sourceCues) {
        let bestIdx = -1;
        let bestOverlap = 0;
        for (let i = 0; i < finalCues.length; i++) {
          const f = finalCues[i];
          const overlap = Math.min(src.end, f.end) - Math.max(src.start, f.start);
          if (overlap > bestOverlap) { bestOverlap = overlap; bestIdx = i; }
        }
        if (bestIdx >= 0) assignments[bestIdx].push(src);
      }
      return assignments;
    }

    const utteranceAssigned = assignBestMatch(utterances || []);
    const assemblyAssigned = assignBestMatch(assemblyCues);
    const openaiAssigned = assignBestMatch(openaiCues);

    return finalCues.map((final, i) => ({
      final,
      utterances: utteranceAssigned[i],
      assembly: assemblyAssigned[i],
      openai: openaiAssigned[i],
    }));
  }

export default function DiagnosticAI() {
  const [searchParams] = useSearchParams();
  const jobId = searchParams.get("jobId");
  const videoRef = useRef(null);
  const [job, setJob] = useState(null);
  const [loading, setLoading] = useState(true);
  const [currentTimeMs, setCurrentTimeMs] = useState(0);
  const [diagnosticData, setDiagnosticData] = useState(null);
  const [diagLoading, setDiagLoading] = useState(false);

  useEffect(() => {
    if (!jobId) { setLoading(false); return; }
    // Try by DB id first, then by railwayJobId
    base44.entities.Job.filter({ id: jobId }, "-created_date", 1).then(async (jobs) => {
      if (jobs.length > 0) {
        setJob(jobs[0]);
      } else {
        // Fallback: jobId might be a railwayJobId
        const byRailway = await base44.entities.Job.filter({ railwayJobId: jobId }, "-created_date", 1);
        if (byRailway.length > 0) setJob(byRailway[0]);
      }
      setLoading(false);
    });
  }, [jobId]);

  useEffect(() => {
    if (!job?.result) return;
    if (job.result.assemblyRawCues) {
      setDiagnosticData({
        assemblyCues: job.result.assemblyRawCues,
        assemblyUtterances: job.result.assemblyUtterances || [],
        openaiCues: job.result.openaiReformattedCues || [],
        rawAudioEvents: job.result.rawAudioEvents || [],
      });
    } else if (job.result.diagnostic_url) {
      setDiagLoading(true);
      fetch(job.result.diagnostic_url).then(r => r.json()).then(data => {
        setDiagnosticData({
          assemblyCues: data.assemblyRawCues || [],
          assemblyUtterances: data.assemblyUtterances || [],
          openaiCues: data.openaiReformattedCues || [],
          rawAudioEvents: data.rawAudioEvents || [],
        });
        setDiagLoading(false);
      }).catch(() => setDiagLoading(false));
    }
  }, [job?.result]);

  const [finalCues, setFinalCues] = useState([]);

  useEffect(() => {
    if (!job?.result) { setFinalCues([]); return; }
    getCuesFromResultAsync(job.result).then(setFinalCues);
  }, [job?.result]);

  const assemblyCues = diagnosticData?.assemblyCues || [];
  const assemblyUtterances = diagnosticData?.assemblyUtterances || [];
  const openaiCues = diagnosticData?.openaiCues || [];
  const rows = alignRows(assemblyCues, openaiCues, finalCues, assemblyUtterances);
  const activeFinalIndex = finalCues.findIndex(c => c.start <= currentTimeMs && currentTimeMs <= c.end);

  if (loading) return (
    <div className="flex items-center justify-center min-h-[60vh]">
      <Loader2 className="w-6 h-6 text-blue-500 animate-spin" />
    </div>
  );

  if (!job) return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4">
      <AlertCircle className="w-8 h-8 text-red-400" />
      <p className="text-zinc-400 text-sm">Job not found.</p>
      <Link to={createPageUrl("Jobs")}><Button variant="outline" className="border-zinc-800 text-zinc-300">Go to Jobs</Button></Link>
    </div>
  );

  const handleSeek = (ms) => {
    if (videoRef.current) videoRef.current.currentTime = ms / 1000;
  };

  return (
    <div className="px-4 sm:px-6 lg:px-8 py-6 max-w-screen-2xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <Link to={createPageUrl("JobDetailAI") + `?jobId=${job.railwayJobId}`}>
          <Button variant="ghost" size="sm" className="text-zinc-400 hover:text-white">
            <ArrowLeft className="w-4 h-4 mr-1.5" /> Back
          </Button>
        </Link>
        <div>
          <h1 className="text-lg font-bold text-white">Diagnostic View</h1>
          <p className="text-xs text-zinc-500">{job.title || "Untitled"} — side-by-side comparison</p>
        </div>
      </div>

      {/* Video */}
      <div className="mb-6 max-w-3xl">
        <VideoPlayer
          mediaUrl={job.mediaUrl}
          cues={finalCues}
          videoRef={videoRef}
          onTimeUpdate={setCurrentTimeMs}
          captionSettings={{ fontSize: 15, opacity: 0.85, position: "bottom" }}
        />
      </div>

      {/* Legend */}
      <div className="flex items-center gap-6 mb-4 text-xs flex-wrap">
        <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-amber-900/40 inline-block border border-amber-700/40" /> AssemblyAI Utterances</span>
          <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-zinc-700 inline-block" /> AssemblyAI SRT (GPT input)</span>
          <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-indigo-900/60 inline-block border border-indigo-700/40" /> OpenAI Reformatted</span>
          <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-emerald-900/40 inline-block border border-emerald-700/40" /> Final Output</span>
        {assemblyCues.length === 0 && (
          <span className="text-amber-400/80">⚠ No diagnostic data — reprocess the job to capture intermediate data.</span>
        )}
      </div>

      {/* Table */}
      <div className="rounded-xl border border-zinc-800/60 bg-zinc-900/20 overflow-hidden">
        <div className="overflow-auto max-h-[70vh]">
          <table className="w-full text-xs border-collapse">
            <thead className="sticky top-0 z-10 bg-zinc-900">
              <tr className="border-b border-zinc-800">
                <th className="px-3 py-2.5 text-left text-zinc-500 font-medium w-10">#</th>
                <th className="px-3 py-2.5 text-left text-zinc-500 font-medium w-28">TC In → Out</th>
                <th className="px-3 py-2.5 text-left text-zinc-500 font-medium">Utterances</th>
                <th className="px-3 py-2.5 text-left text-zinc-500 font-medium">Audio Events</th>
                <th className="px-3 py-2.5 text-left text-zinc-500 font-medium">SRT (GPT input)</th>
                <th className="px-3 py-2.5 text-left text-zinc-500 font-medium">OpenAI Reformatted</th>
                <th className="px-3 py-2.5 text-left text-zinc-500 font-medium">Final Output</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => {
                const isActive = i === activeFinalIndex;
                return (
                  <tr
                    key={i}
                    onClick={() => handleSeek(row.final.start)}
                    className={`border-b border-zinc-800/30 cursor-pointer transition-colors hover:bg-zinc-800/30 ${isActive ? "bg-blue-600/10" : ""}`}
                  >
                    <td className="px-3 py-2.5 text-zinc-500 font-mono align-top">{i + 1}</td>
                    <td className="px-3 py-2.5 font-mono align-top">
                      <span className={`block ${isActive ? "text-blue-400" : "text-zinc-500"}`}>{msToTimecode(row.final.start)}</span>
                      <span className="text-zinc-700 text-[10px]">↓</span>
                      <span className={`block ${isActive ? "text-blue-400" : "text-zinc-500"}`}>{msToTimecode(row.final.end)}</span>
                    </td>
                    {/* Utterances (word-level from AssemblyAI) */}
                    <td className="px-3 py-2.5 align-top">
                      <div className="bg-amber-950/20 border border-amber-800/20 rounded p-2 min-h-[36px]">
                        {row.utterances.length === 0 ? (
                          <span className="text-zinc-700 italic">—</span>
                        ) : (
                          row.utterances.map((c, j) => (
                            <p key={j} className="text-amber-200 leading-relaxed mb-1 last:mb-0">
                              {c.speaker && <span className="text-amber-600 mr-1">[{c.speaker}]</span>}
                              {c.text}
                            </p>
                          ))
                        )}
                      </div>
                    </td>
                    {/* Raw Audio Events */}
                    <td className="px-3 py-2.5 align-top">
                      <div className="bg-pink-950/20 border border-pink-800/20 rounded p-2 min-h-[36px]">
                        {row.audioEvents.length === 0 ? (
                          <span className="text-zinc-700 italic">—</span>
                        ) : (
                          row.audioEvents.map((ev, j) => (
                            <p key={j} className="text-pink-200 leading-relaxed mb-1 last:mb-0 text-[11px]">
                              <span className="text-pink-400 font-medium">{ev.label}</span>
                              <span className="text-pink-600 ml-1.5">{msToTimecode(ev.start)} → {msToTimecode(ev.end)}</span>
                              {ev.confidence && <span className="text-pink-700 ml-1">({Math.round(ev.confidence * 100)}%)</span>}
                            </p>
                          ))
                        )}
                      </div>
                    </td>
                    {/* AssemblyAI SRT */}
                    <td className="px-3 py-2.5 align-top">
                      <div className="bg-zinc-800/40 rounded p-2 min-h-[36px]">
                        {row.assembly.length === 0 ? (
                          <span className="text-zinc-700 italic">—</span>
                        ) : (
                          row.assembly.map((c, j) => (
                            <p key={j} className="text-zinc-300 leading-relaxed mb-1 last:mb-0">
                              {c.speaker && <span className="text-zinc-600 mr-1">[{c.speaker}]</span>}
                              {c.text}
                            </p>
                          ))
                        )}
                      </div>
                    </td>
                    {/* OpenAI */}
                    <td className="px-3 py-2.5 align-top">
                      <div className="bg-indigo-950/30 border border-indigo-800/20 rounded p-2 min-h-[36px]">
                        {row.openai.length === 0 ? (
                          <span className="text-zinc-700 italic">—</span>
                        ) : (
                          row.openai.map((c, j) => (
                            <p key={j} className="text-indigo-200 leading-relaxed mb-1 last:mb-0 whitespace-pre-wrap">
                              {c.speaker && <span className="text-indigo-500 mr-1">[{c.speaker}]</span>}
                              {c.text}
                            </p>
                          ))
                        )}
                      </div>
                    </td>
                    {/* Final */}
                    <td className="px-3 py-2.5 align-top">
                      <div className="bg-emerald-950/20 border border-emerald-800/20 rounded p-2 min-h-[36px]">
                        <p className="text-emerald-200 leading-relaxed whitespace-pre-wrap">
                          {row.final.speaker && <span className="text-emerald-600 mr-1">[{row.final.speaker}]</span>}
                          {row.final.text}
                        </p>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}