import React from "react";
import { Plus, Loader2, CheckCircle2, AlertCircle, X } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function DeliveryTabs({ deliveries, activeDeliveryId, onSelect, onAdd, onRemove }) {
  if (!deliveries || deliveries.length === 0) {
    return (
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-zinc-800/60">
        <span className="text-xs text-zinc-500">No deliveries yet</span>
        <Button
          variant="ghost"
          size="sm"
          onClick={onAdd}
          className="text-blue-400 hover:text-blue-300 hover:bg-blue-600/10 text-xs h-7 px-2"
        >
          <Plus className="w-3 h-3 mr-1" /> Add Delivery
        </Button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1 px-3 py-2 border-b border-zinc-800/60 overflow-x-auto">
      {deliveries.map((d) => {
        const isActive = d.id === activeDeliveryId;
        const isProcessing = d.status === "processing";
        const isError = d.status === "error";

        return (
          <button
            key={d.id}
            onClick={() => onSelect(d.id)}
            className={`group relative flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors whitespace-nowrap ${
              isActive
                ? "bg-zinc-800 text-white border border-zinc-700"
                : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/50"
            }`}
          >
            {isProcessing && <Loader2 className="w-3 h-3 animate-spin text-blue-400" />}
            {d.status === "done" && <CheckCircle2 className="w-3 h-3 text-emerald-400" />}
            {isError && <AlertCircle className="w-3 h-3 text-red-400" />}
            <span>{d.profileName || "Untitled"}</span>
            {onRemove && (
              <button
                onClick={(e) => { e.stopPropagation(); onRemove(d.id); }}
                className="ml-1 text-zinc-600 hover:text-red-400 transition-colors opacity-0 group-hover:opacity-100"
              >
                <X className="w-3 h-3" />
              </button>
            )}
          </button>
        );
      })}
      <Button
        variant="ghost"
        size="sm"
        onClick={onAdd}
        className="text-blue-400 hover:text-blue-300 hover:bg-blue-600/10 text-xs h-7 px-2 ml-1"
      >
        <Plus className="w-3 h-3 mr-1" /> Add
      </Button>
    </div>
  );
}