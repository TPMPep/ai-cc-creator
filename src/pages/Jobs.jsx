import React, { useState, useEffect, useRef } from "react";
import { Link } from "react-router-dom";
import { createPageUrl } from "../utils";
import { base44 } from "@/api/base44Client";
import StatusBadge from "../components/shared/StatusBadge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Plus, Search, Trash2, Eye, Copy, Check } from "lucide-react";
import moment from "moment";
import { toast } from "sonner";

export default function Jobs() {
  const [jobs, setJobs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [user, setUser] = useState(null);
  const [copiedUrl, setCopiedUrl] = useState(null);
  const [userNames, setUserNames] = useState({});
  const pollTimerRef = useRef(null);
  const jobsRef = useRef([]);

  useEffect(() => { jobsRef.current = jobs; }, [jobs]);

  useEffect(() => {
    const load = async () => {
      const u = await base44.auth.me();
      setUser(u);
      const allJobs = await base44.entities.Job.list("-created_date", 200);
      // Fetch all users to map emails to names
      const allUsers = await base44.entities.User.list();
      const userMap = {};
      allUsers.forEach(u2 => { userMap[u2.email] = u2.full_name || u2.email; });
      setUserNames(userMap);
      setJobs(allJobs);
      setLoading(false);
    };
    load();
  }, []);

  // Poll processing AI jobs so the list stays accurate when user navigates back
  useEffect(() => {
    const pollProcessing = async () => {
      const processingAIJobs = jobsRef.current.filter(
        j => (j.status === "processing" || j.status === "queued") && j.pipeline === "ai"
      );
      if (processingAIJobs.length === 0) return;

      for (const job of processingAIJobs) {
        try {
          const res = await base44.functions.invoke("pollAICaption", { transcript_id: job.railwayJobId });
          const data = res.data;

          if (data.status === "completed") {
            const cueStr = JSON.stringify(data.cues || []);
            const cueChunks = [];
            for (let i = 0; i < cueStr.length; i += 75000) {
              cueChunks.push(cueStr.slice(i, i + 75000));
            }
            const updates = {
              status: "done",
              result: {
                cue_chunks: cueChunks,
                srt: data.exports?.srt,
                vtt: data.exports?.vtt,
                scc: data.exports?.scc,
                qc: data.qc,
                language: data.language,
                diagnostic: data.diagnostic || null,
              },
              durationMs: data.cues?.length > 0 ? data.cues[data.cues.length - 1].end : 0,
              issuesCount: data.qc?.issuesCount || 0,
              lastPolledAt: new Date().toISOString(),
            };
            await base44.entities.Job.update(job.id, updates);
            setJobs(prev => prev.map(j => j.id === job.id ? { ...j, ...updates } : j));
            toast.success(`"${job.title || "Job"}" is ready!`);
          } else if (data.status === "error") {
            const updates = { status: "error", error: data.error || "Transcription failed" };
            await base44.entities.Job.update(job.id, updates);
            setJobs(prev => prev.map(j => j.id === job.id ? { ...j, ...updates } : j));
          }
        } catch (err) {
          console.error("Background poll error for job", job.id, err);
        }
      }
    };

    // Poll every 20s — GPT-4o takes time, no need to hammer it
    pollTimerRef.current = setInterval(pollProcessing, 20000);
    return () => clearInterval(pollTimerRef.current);
  }, []);

  const handleDelete = async (job) => {
    if (!confirm("Delete this job from your history?")) return;
    await base44.entities.Job.delete(job.id);
    setJobs(jobs.filter((j) => j.id !== job.id));
  };

  const copyUrl = (url, jobId) => {
    navigator.clipboard.writeText(url);
    setCopiedUrl(jobId);
    toast.success("URL copied to clipboard");
    setTimeout(() => setCopiedUrl(null), 2000);
  };

  const filtered = jobs.filter((j) => {
    const matchStatus = statusFilter === "all" || j.status === statusFilter;
    const matchSearch = !search || 
      (j.title || "").toLowerCase().includes(search.toLowerCase()) ||
      (j.mediaUrl || "").toLowerCase().includes(search.toLowerCase());
    return matchStatus && matchSearch;
  });

  return (
    <div className="px-4 sm:px-6 lg:px-8 py-8">
      <div className="max-w-6xl mx-auto">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
          <div>
            <h1 className="text-2xl font-bold text-white">Jobs</h1>
            <p className="text-sm text-zinc-500 mt-1">All caption generation jobs.</p>
          </div>
          <Link to={createPageUrl("NewJob")}>
            <Button className="bg-blue-600 hover:bg-blue-700 text-white">
              <Plus className="w-4 h-4 mr-2" /> New Job
            </Button>
          </Link>
        </div>

        {/* Filters */}
        <div className="flex flex-col sm:flex-row gap-3 mb-6">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-600" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by title or URL…"
              className="pl-9 bg-zinc-900 border-zinc-800 text-white placeholder:text-zinc-600 focus:border-blue-500 h-9"
            />
          </div>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-40 h-9 bg-zinc-900 border-zinc-800 text-zinc-300 text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="bg-zinc-900 border-zinc-800">
              <SelectItem value="all" className="text-zinc-300">All Status</SelectItem>
              <SelectItem value="processing" className="text-zinc-300">Processing</SelectItem>
              <SelectItem value="done" className="text-zinc-300">Done</SelectItem>
              <SelectItem value="error" className="text-zinc-300">Error</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Table */}
        <div className="rounded-xl border border-zinc-800/60 bg-zinc-900/30 overflow-hidden">
          {loading ? (
            <div className="p-6 space-y-3">
              {[...Array(5)].map((_, i) => <Skeleton key={i} className="h-12 bg-zinc-800/50" />)}
            </div>
          ) : filtered.length === 0 ? (
            <div className="py-16 text-center">
              <p className="text-zinc-500 mb-4">{jobs.length === 0 ? "No jobs yet" : "No matching jobs"}</p>
              {jobs.length === 0 && (
                <Link to={createPageUrl("NewJob")}>
                  <Button className="bg-blue-600 hover:bg-blue-700 text-white">
                    <Plus className="w-4 h-4 mr-2" /> Create new job
                  </Button>
                </Link>
              )}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="border-zinc-800/60 hover:bg-transparent">
                  <TableHead className="text-zinc-500 text-xs font-medium">Title</TableHead>
                  <TableHead className="text-zinc-500 text-xs font-medium">Created By</TableHead>
                  <TableHead className="text-zinc-500 text-xs font-medium">Job ID</TableHead>
                  <TableHead className="text-zinc-500 text-xs font-medium">Created</TableHead>
                  <TableHead className="text-zinc-500 text-xs font-medium">Status</TableHead>
                  <TableHead className="text-zinc-500 text-xs font-medium hidden md:table-cell">Media URL</TableHead>
                  <TableHead className="text-zinc-500 text-xs font-medium text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((job) => (
                  <TableRow key={job.id} className="border-zinc-800/40 hover:bg-zinc-800/20">
                    <TableCell>
                      <Link
                        to={createPageUrl(job.pipeline === "ai" ? "JobDetailAI" : "JobDetail") + `?jobId=${job.pipeline === "ai" ? job.railwayJobId : (job.railwayJobId || job.jobId)}`}
                        className="text-sm font-medium text-zinc-200 hover:text-blue-400 transition-colors"
                      >
                        {job.title || "Untitled"}
                      </Link>
                    </TableCell>
                    <TableCell>
                      <span className="text-xs text-zinc-400">{userNames[job.userId] || job.userId || "—"}</span>
                    </TableCell>
                    <TableCell>
                      <span className="text-xs text-zinc-500 font-mono">{job.railwayJobId || job.jobId}</span>
                    </TableCell>
                    <TableCell className="text-xs text-zinc-500">
                      {moment(job.created_date).format("MMM D, YYYY h:mm A")}
                    </TableCell>
                    <TableCell><StatusBadge status={job.status} /></TableCell>
                    <TableCell className="hidden md:table-cell">
                      <button
                        onClick={() => copyUrl(job.mediaUrl, job.id)}
                        className="flex items-center gap-1.5 text-xs text-zinc-500 hover:text-zinc-300 transition-colors group"
                      >
                        <span className="max-w-[180px] truncate">{job.mediaUrl}</span>
                        {copiedUrl === job.id ? (
                          <Check className="w-3 h-3 text-green-500 flex-shrink-0" />
                        ) : (
                          <Copy className="w-3 h-3 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" />
                        )}
                      </button>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        <Link to={createPageUrl(job.pipeline === "ai" ? "JobDetailAI" : "JobDetail") + `?jobId=${job.pipeline === "ai" ? job.railwayJobId : (job.railwayJobId || job.jobId)}`}>
                          <Button variant="ghost" size="sm" className="text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800 h-7 w-7 p-0">
                            <Eye className="w-3.5 h-3.5" />
                          </Button>
                        </Link>
                        <Button variant="ghost" size="sm" onClick={() => handleDelete(job)} className="text-zinc-600 hover:text-red-400 h-7 w-7 p-0">
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>
      </div>
    </div>
  );
}