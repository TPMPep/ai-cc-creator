import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, Save } from "lucide-react";
import { toast } from "sonner";

export default function SaveProfileModal({ open, onOpenChange, currentOptions, existingProfile, onSaved }) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      if (existingProfile) {
        setName(existingProfile.name);
        setDescription(existingProfile.description || "");
      } else {
        setName("");
        setDescription("");
      }
    }
  }, [open, existingProfile]);

  const handleSave = async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      toast.error("Please enter a profile name");
      return;
    }

    setSaving(true);

    // Build settings from currentOptions — strip the captionProfile key itself
    const { captionProfile, ...settings } = currentOptions;

    const profileData = {
      name: trimmed,
      description: description.trim(),
      isSystem: false,
      settings,
      lockedFields: [],
    };

    if (existingProfile) {
      await base44.entities.CaptionProfile.update(existingProfile.id, profileData);
      toast.success(`Updated "${trimmed}"`);
      onSaved({ ...existingProfile, ...profileData });
    } else {
      const created = await base44.entities.CaptionProfile.create(profileData);
      toast.success(`Saved "${trimmed}"`);
      onSaved(created);
    }

    setSaving(false);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-zinc-900 border-zinc-700 text-zinc-100 max-w-md">
        <DialogHeader>
          <DialogTitle className="text-lg font-semibold text-white">
            {existingProfile ? "Edit Profile" : "Save as Profile"}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label className="text-xs text-zinc-300 font-medium">Profile Name</Label>
            <Input
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="e.g. Netflix, HBO Max, Disney+"
              className="bg-zinc-800 border-zinc-600 text-white placeholder:text-zinc-500 h-10"
              autoFocus
            />
          </div>
          <div className="space-y-2">
            <Label className="text-xs text-zinc-300 font-medium">Description <span className="text-zinc-500">(optional)</span></Label>
            <Textarea
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder="Notes about this profile's requirements…"
              rows={2}
              className="bg-zinc-800 border-zinc-600 text-white placeholder:text-zinc-500 text-sm resize-none"
            />
          </div>
          <div className="rounded-lg bg-zinc-800/60 border border-zinc-700/50 p-3">
            <p className="text-xs text-zinc-400">
              This will save all your current caption settings (output format, speaker mode, sound density, custom overrides, etc.) to this profile.
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" className="text-zinc-400 hover:text-zinc-200" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={saving} className="bg-blue-600 hover:bg-blue-500 text-white">
            {saving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Save className="w-4 h-4 mr-2" />}
            {existingProfile ? "Update" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}