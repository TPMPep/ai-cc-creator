import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import AdminGuard from "../components/shared/AdminGuard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Shield, Settings, Save, RotateCcw, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import moment from "moment";

const DEFAULT_SETTINGS = {
  settingsId: "global",
  allowlistEnabled: false,
  allowedDomains: [],
  defaultAllowHttp: false,
  jobsPerMinute: 3,
  maxConcurrentProcessingJobsPerUser: 3,
};

export default function Admin() {
  const [settings, setSettings] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [domainsText, setDomainsText] = useState("");

  useEffect(() => {
    const load = async () => {
      const existing = await base44.entities.Settings.filter({ settingsId: "global" });
      if (existing.length > 0) {
        setSettings(existing[0]);
        setDomainsText((existing[0].allowedDomains || []).join("\n"));
      } else {
        setSettings(DEFAULT_SETTINGS);
      }
      setLoading(false);
    };
    load();
  }, []);

  const handleSave = async () => {
    setSaving(true);
    try {
      const domains = domainsText.split("\n").map(d => d.trim()).filter(Boolean);
      const updated = { ...settings, allowedDomains: domains };
      
      if (settings.id) {
        await base44.entities.Settings.update(settings.id, updated);
      } else {
        const created = await base44.entities.Settings.create(updated);
        setSettings(created);
      }
      
      setSettings(updated);
      toast.success("Settings saved successfully");
    } catch (err) {
      toast.error("Failed to save settings");
    }
    setSaving(false);
  };

  const handleRestoreDefaults = () => {
    if (!confirm("Reset all settings to defaults?")) return;
    setSettings({ ...DEFAULT_SETTINGS });
    setDomainsText("");
    toast.success("Settings reset to defaults");
  };

  if (loading) {
    return (
      <AdminGuard>
        <div className="flex items-center justify-center min-h-[60vh]">
          <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
        </div>
      </AdminGuard>
    );
  }

  return (
    <AdminGuard>
      <div className="px-4 sm:px-6 lg:px-8 py-8">
        <div className="max-w-4xl mx-auto">
          <div className="mb-8">
            <h1 className="text-2xl font-bold text-white flex items-center gap-2">
              <Shield className="w-6 h-6 text-blue-400" /> Admin Console
            </h1>
            <p className="text-sm text-zinc-500 mt-1">Configure security controls and rate limits.</p>
          </div>

          <div className="space-y-6">
            {/* Security Controls */}
            <Card className="border-zinc-800/60 bg-zinc-900/30">
              <CardHeader>
                <CardTitle className="text-white flex items-center gap-2">
                  <Shield className="w-5 h-5 text-blue-400" /> Security Controls
                </CardTitle>
                <CardDescription className="text-zinc-500">
                  Domain allowlist and protocol restrictions
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-5">
                <div className="flex items-center justify-between py-2">
                  <div>
                    <Label className="text-sm text-zinc-300 font-medium">Allowlist Enabled</Label>
                    <p className="text-xs text-zinc-600 mt-0.5">Restrict URLs to approved domains only</p>
                  </div>
                  <Switch
                    checked={settings?.allowlistEnabled || false}
                    onCheckedChange={(v) => setSettings({ ...settings, allowlistEnabled: v })}
                    className="data-[state=checked]:bg-blue-600"
                  />
                </div>

                <div className="space-y-2">
                  <Label className="text-sm text-zinc-300 font-medium">Allowed Domains (one per line)</Label>
                  <Textarea
                    value={domainsText}
                    onChange={(e) => setDomainsText(e.target.value)}
                    placeholder="*.cloudfront.net&#10;*.amazonaws.com&#10;media.client.com"
                    className="bg-zinc-900 border-zinc-800 text-white placeholder:text-zinc-600 focus:border-blue-500 font-mono text-xs min-h-[120px]"
                    disabled={!settings?.allowlistEnabled}
                  />
                  <p className="text-xs text-zinc-600">
                    Use * for wildcard subdomains. Example: *.cloudfront.net matches abc.cloudfront.net
                  </p>
                </div>

                <div className="flex items-center justify-between py-2">
                  <div>
                    <Label className="text-sm text-zinc-300 font-medium">Default Allow HTTP</Label>
                    <p className="text-xs text-zinc-600 mt-0.5">Default toggle state in New Job form</p>
                  </div>
                  <Switch
                    checked={settings?.defaultAllowHttp || false}
                    onCheckedChange={(v) => setSettings({ ...settings, defaultAllowHttp: v })}
                    className="data-[state=checked]:bg-blue-600"
                  />
                </div>
              </CardContent>
            </Card>

            {/* Limits */}
            <Card className="border-zinc-800/60 bg-zinc-900/30">
              <CardHeader>
                <CardTitle className="text-white flex items-center gap-2">
                  <Settings className="w-5 h-5 text-blue-400" /> Rate Limits
                </CardTitle>
                <CardDescription className="text-zinc-500">
                  Prevent abuse and control resource usage
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-5">
                <div className="grid sm:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label className="text-sm text-zinc-300 font-medium">Jobs Per Minute</Label>
                    <Input
                      type="number"
                      min={1}
                      max={20}
                      value={settings?.jobsPerMinute ?? 3}
                      onChange={(e) => setSettings({ ...settings, jobsPerMinute: parseInt(e.target.value) || 3 })}
                      className="bg-zinc-900 border-zinc-800 text-white focus:border-blue-500"
                    />
                    <p className="text-xs text-zinc-600">Max jobs a user can create per minute</p>
                  </div>

                  <div className="space-y-2">
                    <Label className="text-sm text-zinc-300 font-medium">Max Concurrent Processing Jobs</Label>
                    <Input
                      type="number"
                      min={1}
                      max={10}
                      value={settings?.maxConcurrentProcessingJobsPerUser ?? 3}
                      onChange={(e) => setSettings({ ...settings, maxConcurrentProcessingJobsPerUser: parseInt(e.target.value) || 3 })}
                      className="bg-zinc-900 border-zinc-800 text-white focus:border-blue-500"
                    />
                    <p className="text-xs text-zinc-600">Max active jobs per user at once</p>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Actions */}
            <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
              <div className="text-xs text-zinc-600">
                {settings?.updated_date && (
                  <span>Last updated: {moment(settings.updated_date).fromNow()}</span>
                )}
              </div>
              <div className="flex gap-2">
                <Button variant="outline" onClick={handleRestoreDefaults} className="border-zinc-800 text-zinc-400 hover:text-white gap-2">
                  <RotateCcw className="w-3.5 h-3.5" /> Restore Defaults
                </Button>
                <Button onClick={handleSave} disabled={saving} className="bg-blue-600 hover:bg-blue-700 text-white gap-2">
                  {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                  Save Settings
                </Button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </AdminGuard>
  );
}