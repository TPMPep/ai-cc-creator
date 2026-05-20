import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Shield, Pencil, Trash2, SlidersHorizontal } from "lucide-react";
import { toast } from "sonner";
import SaveProfileModal from "./SaveProfileModal";

export default function ProfileSelector({ currentOptions, onProfileSelect }) {
  const [profiles, setProfiles] = useState([]);
  const [selectedId, setSelectedId] = useState("custom");
  const [showSaveModal, setShowSaveModal] = useState(false);
  const [editingProfile, setEditingProfile] = useState(null);

  const loadProfiles = async () => {
    const list = await base44.entities.CaptionProfile.list("-created_date", 50);
    setProfiles(list);

    // Auto-select NBCU system profile on first load if current profile is nbcu
    if (currentOptions.captionProfile === "nbcu" && list.length > 0) {
      const nbcu = list.find(p => p.isSystem && p.name.toLowerCase().includes("nbcu"));
      if (nbcu) setSelectedId(nbcu.id);
    }
  };

  useEffect(() => { loadProfiles(); }, []);

  const handleSelect = (id) => {
    setSelectedId(id);
    if (id === "custom") {
      onProfileSelect(null); // null = custom/manual mode
    } else {
      const profile = profiles.find(p => p.id === id);
      if (profile) onProfileSelect(profile);
    }
  };

  const handleDelete = async (profile) => {
    if (profile.isSystem) return;
    if (!confirm(`Delete profile "${profile.name}"?`)) return;
    await base44.entities.CaptionProfile.delete(profile.id);
    toast.success(`Deleted "${profile.name}"`);
    if (selectedId === profile.id) {
      setSelectedId("custom");
      onProfileSelect(null);
    }
    loadProfiles();
  };

  const handleEdit = (profile) => {
    if (profile.isSystem) return;
    setEditingProfile(profile);
    setShowSaveModal(true);
  };

  const handleSaved = (savedProfile) => {
    setShowSaveModal(false);
    setEditingProfile(null);
    loadProfiles();
    setSelectedId(savedProfile.id);
    onProfileSelect(savedProfile);
  };

  const systemProfiles = profiles.filter(p => p.isSystem);
  const userProfiles = profiles.filter(p => !p.isSystem);

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Select value={selectedId} onValueChange={handleSelect}>
          <SelectTrigger className="h-9 flex-1 bg-zinc-800 border-zinc-600 text-zinc-200 text-xs font-medium">
            <SelectValue placeholder="Select profile…" />
          </SelectTrigger>
          <SelectContent className="bg-zinc-800 border-zinc-600 max-h-64">
            {/* System profiles */}
            {systemProfiles.map(p => (
              <SelectItem key={p.id} value={p.id} className="text-zinc-200">
                <span className="flex items-center gap-1.5">
                  <Shield className="w-3.5 h-3.5 text-amber-400" />
                  {p.name}
                </span>
              </SelectItem>
            ))}

            {/* User profiles */}
            {userProfiles.length > 0 && (
              <>
                <div className="px-2 py-1.5 text-[10px] text-zinc-500 uppercase tracking-wider border-t border-zinc-700 mt-1 pt-2">
                  Saved Profiles
                </div>
                {userProfiles.map(p => (
                  <SelectItem key={p.id} value={p.id} className="text-zinc-200">
                    {p.name}
                  </SelectItem>
                ))}
              </>
            )}

            {/* Custom option */}
            <div className="border-t border-zinc-700 mt-1 pt-1">
              <SelectItem value="custom" className="text-zinc-200">
                <span className="flex items-center gap-1.5">
                  <SlidersHorizontal className="w-3.5 h-3.5 text-zinc-400" />
                  Custom (manual)
                </span>
              </SelectItem>
            </div>
          </SelectContent>
        </Select>

        {/* Edit/Delete for selected user profile */}
        {selectedId !== "custom" && (() => {
          const sel = profiles.find(p => p.id === selectedId);
          if (!sel || sel.isSystem) return null;
          return (
            <div className="flex gap-1">
              <Button size="icon" variant="ghost" className="h-8 w-8 text-zinc-400 hover:text-zinc-200" onClick={() => handleEdit(sel)}>
                <Pencil className="w-3.5 h-3.5" />
              </Button>
              <Button size="icon" variant="ghost" className="h-8 w-8 text-zinc-400 hover:text-red-400" onClick={() => handleDelete(sel)}>
                <Trash2 className="w-3.5 h-3.5" />
              </Button>
            </div>
          );
        })()}
      </div>

      {/* Save as Profile button — always visible when in custom or editing */}
      {selectedId === "custom" && (
        <Button
          size="sm"
          variant="outline"
          className="w-full h-8 text-xs border-zinc-600 text-zinc-300 hover:text-white hover:border-zinc-500 bg-zinc-800/50"
          onClick={() => { setEditingProfile(null); setShowSaveModal(true); }}
        >
          Save current settings as profile
        </Button>
      )}

      <SaveProfileModal
        open={showSaveModal}
        onOpenChange={setShowSaveModal}
        currentOptions={currentOptions}
        existingProfile={editingProfile}
        onSaved={handleSaved}
      />
    </div>
  );
}