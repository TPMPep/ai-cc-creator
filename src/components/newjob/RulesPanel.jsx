import React from "react";
import { NBCU_DEFAULTS, RULES_VALIDATION, SCC_FRAME_RATES } from "../shared/RulesDefaults";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { RotateCcw } from "lucide-react";

export default function RulesPanel({ rules, onRulesChange, preset, onPresetChange }) {
  const updateRule = (key, value) => {
    onRulesChange({ ...rules, [key]: value });
    if (preset !== "custom") onPresetChange("custom");
  };

  const resetToNBCU = () => {
    onRulesChange({ ...NBCU_DEFAULTS });
    onPresetChange("nbcu");
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-zinc-200">Caption Rules</h3>
        <div className="flex items-center gap-2">
          <Select value={preset} onValueChange={(v) => {
            onPresetChange(v);
            if (v === "nbcu") onRulesChange({ ...NBCU_DEFAULTS });
          }}>
            <SelectTrigger className="w-40 h-8 bg-zinc-900 border-zinc-800 text-zinc-300 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="bg-zinc-900 border-zinc-800">
              <SelectItem value="nbcu" className="text-zinc-300">NBCU (Default)</SelectItem>
              <SelectItem value="custom" className="text-zinc-300">Custom</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="ghost" size="sm" onClick={resetToNBCU} className="text-zinc-500 hover:text-zinc-300 h-8 px-2">
            <RotateCcw className="w-3.5 h-3.5" />
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-x-4 gap-y-4">
        {Object.entries(RULES_VALIDATION).map(([key, config]) => {
          if (config.type === "boolean") {
            return (
              <div key={key} className="col-span-2 sm:col-span-1 flex items-center justify-between py-1">
                <Label className="text-xs text-zinc-400">{config.label}</Label>
                <Switch
                  checked={!!rules[key]}
                  onCheckedChange={(v) => updateRule(key, v)}
                  className="data-[state=checked]:bg-blue-600"
                />
              </div>
            );
          }
          if (config.type === "select") {
            return (
              <div key={key} className="space-y-1.5">
                <Label className="text-xs text-zinc-400">{config.label}</Label>
                <Select value={String(rules[key])} onValueChange={(v) => updateRule(key, parseFloat(v))}>
                  <SelectTrigger className="h-8 bg-zinc-900 border-zinc-800 text-zinc-300 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-zinc-900 border-zinc-800">
                    {SCC_FRAME_RATES.map((r) => (
                      <SelectItem key={r} value={String(r)} className="text-zinc-300">{r}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            );
          }
          return (
            <div key={key} className="space-y-1.5">
              <Label className="text-xs text-zinc-400">{config.label}</Label>
              <Input
                type="number"
                min={config.min}
                max={config.max}
                value={rules[key] ?? ""}
                onChange={(e) => {
                  const val = parseInt(e.target.value);
                  if (!isNaN(val)) updateRule(key, Math.min(config.max, Math.max(config.min, val)));
                }}
                className="h-8 bg-zinc-900 border-zinc-800 text-zinc-300 text-xs"
              />
              <span className="text-[10px] text-zinc-600">{config.min}–{config.max}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}