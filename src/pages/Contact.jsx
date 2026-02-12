import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Send, CheckCircle2, Mail } from "lucide-react";

export default function Contact() {
  const [form, setForm] = useState({ name: "", email: "", company: "", role: "", message: "", wantsDemo: false });
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    await base44.entities.Lead.create(form);
    setSubmitted(true);
    setSubmitting(false);
  };

  if (submitted) {
    return (
      <div className="py-20 sm:py-28">
        <div className="max-w-lg mx-auto px-4 text-center">
          <div className="w-16 h-16 rounded-full bg-emerald-600/10 border border-emerald-500/20 flex items-center justify-center mx-auto mb-6">
            <CheckCircle2 className="w-8 h-8 text-emerald-400" />
          </div>
          <h1 className="text-3xl font-bold text-white mb-3">Thanks — we'll follow up shortly.</h1>
          <p className="text-zinc-400">We typically respond within one business day.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="py-20 sm:py-28">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="grid lg:grid-cols-2 gap-12">
          <div>
            <p className="text-blue-400 font-medium text-sm tracking-wide uppercase mb-3">Contact</p>
            <h1 className="text-4xl font-bold text-white mb-4">Get in touch</h1>
            <p className="text-zinc-400 leading-relaxed mb-8">
              Have questions about AI CC Creator, need enterprise pricing, or want a walkthrough? Fill out the form and we'll get back to you.
            </p>
            <div className="p-4 rounded-lg border border-zinc-800/60 bg-zinc-900/30 inline-flex items-center gap-3">
              <Mail className="w-5 h-5 text-zinc-500" />
              <div>
                <p className="text-xs text-zinc-500">Prefer email?</p>
                <p className="text-sm text-zinc-300">sales@aicccreator.com</p>
              </div>
            </div>
          </div>

          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="grid sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label className="text-zinc-300 text-sm">Name *</Label>
                <Input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Your name" className="bg-zinc-900 border-zinc-800 text-white placeholder:text-zinc-600 focus:border-blue-500" />
              </div>
              <div className="space-y-2">
                <Label className="text-zinc-300 text-sm">Email *</Label>
                <Input required type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="you@company.com" className="bg-zinc-900 border-zinc-800 text-white placeholder:text-zinc-600 focus:border-blue-500" />
              </div>
            </div>
            <div className="grid sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label className="text-zinc-300 text-sm">Company</Label>
                <Input value={form.company} onChange={(e) => setForm({ ...form, company: e.target.value })} placeholder="Company name" className="bg-zinc-900 border-zinc-800 text-white placeholder:text-zinc-600 focus:border-blue-500" />
              </div>
              <div className="space-y-2">
                <Label className="text-zinc-300 text-sm">Role</Label>
                <Input value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })} placeholder="Your role" className="bg-zinc-900 border-zinc-800 text-white placeholder:text-zinc-600 focus:border-blue-500" />
              </div>
            </div>
            <div className="space-y-2">
              <Label className="text-zinc-300 text-sm">Message *</Label>
              <Textarea required value={form.message} onChange={(e) => setForm({ ...form, message: e.target.value })} placeholder="Tell us about your needs…" className="bg-zinc-900 border-zinc-800 text-white placeholder:text-zinc-600 focus:border-blue-500 min-h-[120px]" />
            </div>
            <div className="flex items-center gap-2.5">
              <Checkbox id="demo" checked={form.wantsDemo} onCheckedChange={(v) => setForm({ ...form, wantsDemo: !!v })} className="border-zinc-700 data-[state=checked]:bg-blue-600" />
              <Label htmlFor="demo" className="text-sm text-zinc-400 cursor-pointer">I want a demo</Label>
            </div>
            <Button type="submit" disabled={submitting} className="bg-blue-600 hover:bg-blue-700 text-white w-full sm:w-auto">
              {submitting ? "Sending…" : "Send Message"} <Send className="w-4 h-4 ml-2" />
            </Button>
          </form>
        </div>
      </div>
    </div>
  );
}