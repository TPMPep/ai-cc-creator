import React, { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Settings2 } from "lucide-react";

const SETTINGS_KEY = "aicc_caption_settings";

export default function CaptionSettings({ settings, onSettingsChange }) {
  const [localSettings, setLocalSettings] = useState(settings);

  useEffect(() => {
    const saved = localStorage.getItem(SETTINGS_KEY);
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        setLocalSettings(parsed);
        onSettingsChange(parsed);
      } catch {}
    }
  }, []);

  const updateSettings = (updates) => {
    const newSettings = { ...localSettings, ...updates };
    setLocalSettings(newSettings);
    onSettingsChange(newSettings);
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(newSettings));
  };

  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button variant="outline" size="sm" className="border-zinc-800 text-zinc-400 hover:text-white gap-2">
          <Settings2 className="w-3.5 h-3.5" /> Caption Settings
        </Button>
      </SheetTrigger>
      <SheetContent className="bg-zinc-900 border-zinc-800 text-white">
        <SheetHeader>
          <SheetTitle className="text-white">Caption Display Settings</SheetTitle>
          <SheetDescription className="text-zinc-500">Customize how captions appear on the video.</SheetDescription>
        </SheetHeader>
        <div className="space-y-6 mt-6">
          <div className="space-y-3">
            <Label className="text-sm text-zinc-300">Font Size</Label>
            <Slider
              value={[localSettings.fontSize || 16]}
              onValueChange={([v]) => updateSettings({ fontSize: v })}
              min={12}
              max={28}
              step={1}
              className="w-full"
            />
            <p className="text-xs text-zinc-600">{localSettings.fontSize || 16}px</p>
          </div>

          <div className="space-y-3">
            <Label className="text-sm text-zinc-300">Background Opacity</Label>
            <Slider
              value={[(localSettings.opacity ?? 0.8) * 100]}
              onValueChange={([v]) => updateSettings({ opacity: v / 100 })}
              min={0}
              max={100}
              step={5}
              className="w-full"
            />
            <p className="text-xs text-zinc-600">{Math.round((localSettings.opacity ?? 0.8) * 100)}%</p>
          </div>

          <div className="space-y-3">
            <Label className="text-sm text-zinc-300">Position</Label>
            <Select value={localSettings.position || "bottom"} onValueChange={(v) => updateSettings({ position: v })}>
              <SelectTrigger className="bg-zinc-900 border-zinc-800 text-white">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-zinc-900 border-zinc-800">
                <SelectItem value="bottom" className="text-zinc-300">Bottom</SelectItem>
                <SelectItem value="top" className="text-zinc-300">Top</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}