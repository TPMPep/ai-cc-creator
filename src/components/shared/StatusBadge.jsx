import React from "react";
import { Badge } from "@/components/ui/badge";
import { Loader2, CheckCircle2, AlertCircle, Clock } from "lucide-react";

const statusConfig = {
  queued: { label: "Queued", className: "bg-zinc-700 text-zinc-200 border-zinc-600", icon: Clock },
  processing: { label: "Processing", className: "bg-blue-900/50 text-blue-300 border-blue-700", icon: Loader2 },
  done: { label: "Done", className: "bg-emerald-900/50 text-emerald-300 border-emerald-700", icon: CheckCircle2 },
  error: { label: "Error", className: "bg-red-900/50 text-red-300 border-red-700", icon: AlertCircle },
};

export default function StatusBadge({ status }) {
  const config = statusConfig[status] || statusConfig.queued;
  const Icon = config.icon;
  return (
    <Badge variant="outline" className={`${config.className} gap-1.5 px-2.5 py-1 font-medium`}>
      <Icon className={`w-3 h-3 ${status === "processing" ? "animate-spin" : ""}`} />
      {config.label}
    </Badge>
  );
}