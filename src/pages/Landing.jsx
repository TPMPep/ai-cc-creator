import React from "react";
import { Link } from "react-router-dom";
import { createPageUrl } from "../utils";
import { base44 } from "@/api/base44Client";
import HeroMockup from "../components/landing/HeroMockup";
import {
  Link2, Sparkles, PlayCircle, Timer, Users, SlidersHorizontal,
  ShieldCheck, MonitorPlay, FileOutput, Film, Globe, Tv, ClipboardCheck,
  ArrowRight, CheckCircle2
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { motion } from "framer-motion";

const features = [
  { icon: Timer, title: "Word-level timing", desc: "Precise start/end timestamps for every cue, powered by AI transcription." },
  { icon: Users, title: "Speaker labels", desc: "Automatic speaker identification and labeling across multi-person content." },
  { icon: SlidersHorizontal, title: "Rules presets (NBCU-style)", desc: "Apply broadcast-standard caption rules with one click, or customize your own." },
  { icon: ShieldCheck, title: "QC issue detection", desc: "Automated quality checks for CPS, line length, duration, and gap violations." },
  { icon: MonitorPlay, title: "Playback with synced captions", desc: "Review captions in-context with video playback and click-to-seek." },
  { icon: FileOutput, title: "Exports: SRT / VTT / SCC / JSON", desc: "Download production-ready formats for any platform or delivery spec." },
];

const steps = [
  { num: "01", icon: Link2, title: "Paste a public media URL", desc: "Drop in any publicly accessible video or audio URL." },
  { num: "02", icon: Sparkles, title: "Generate captions + QC", desc: "AI transcribes, formats, and validates against your rules." },
  { num: "03", icon: PlayCircle, title: "Review with playback + export", desc: "Watch, verify, and download in your required format." },
];

const useCases = [
  { icon: Film, title: "Studio mastering & delivery prep", desc: "Generate and QC captions as part of your delivery workflow." },
  { icon: Globe, title: "Localization pipelines", desc: "Kickstart subtitle creation for multi-language distribution." },
  { icon: Tv, title: "Streaming platform packages", desc: "Produce SRT/VTT/SCC for OTT and platform ingest specs." },
  { icon: ClipboardCheck, title: "Internal review for caption QC", desc: "Catch violations before they reach delivery or compliance review." },
];

const benefits = [
  "Reduce manual caption formatting",
  "Catch CPS/line violations early",
  "Generate consistent exports quickly",
  "Review in-context with media playback",
];

export default function Landing() {
  return (
    <div className="overflow-hidden">
      {/* Hero */}
      <section className="relative py-20 sm:py-28 lg:py-36">
        <div className="absolute inset-0 overflow-hidden">
          <div className="absolute top-1/4 left-1/2 -translate-x-1/2 w-[800px] h-[800px] bg-blue-600/5 rounded-full blur-3xl" />
        </div>
        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid lg:grid-cols-2 gap-12 lg:gap-16 items-center">
            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6 }}>
              <p className="text-blue-400 font-medium text-sm tracking-wide uppercase mb-4">Production Caption Generator</p>
              <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold text-white leading-[1.1] tracking-tight">
                Production-ready captions from a media URL.
              </h1>
              <p className="mt-6 text-lg text-zinc-400 leading-relaxed max-w-xl">
                Paste a public video/audio URL, generate captions, review in sync with playback, export SRT/VTT/SCC. Designed for production teams who need speed and consistency.
              </p>
              <div className="mt-8 flex flex-wrap gap-3">
                <button onClick={() => base44.auth.redirectToLogin(createPageUrl("NewJob"))}>
                  <Button size="lg" className="bg-blue-600 hover:bg-blue-700 text-white h-12 px-7 text-sm font-semibold">
                    Start Free <ArrowRight className="w-4 h-4 ml-2" />
                  </Button>
                </button>
                <Link to={createPageUrl("Contact")}>
                  <Button size="lg" variant="outline" className="border-zinc-700 text-zinc-300 hover:bg-zinc-800 hover:text-white h-12 px-7 text-sm font-semibold">
                    Request Demo
                  </Button>
                </Link>
              </div>
              <p className="mt-5 text-xs text-zinc-600">No installs. Professional exports. Built for production workflows.</p>
            </motion.div>
            <motion.div initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.7, delay: 0.2 }}>
              <HeroMockup />
            </motion.div>
          </div>
        </div>
      </section>

      {/* How it works */}
      <section className="py-20 sm:py-28 border-t border-zinc-800/60">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <p className="text-blue-400 font-medium text-sm tracking-wide uppercase mb-3">How it works</p>
            <h2 className="text-3xl sm:text-4xl font-bold text-white">Three steps to broadcast-ready captions</h2>
          </div>
          <div className="grid md:grid-cols-3 gap-8">
            {steps.map((s) => (
              <div key={s.num} className="relative group">
                <div className="p-6 rounded-xl border border-zinc-800/60 bg-zinc-900/30 hover:border-zinc-700/60 transition-all h-full">
                  <div className="flex items-center gap-3 mb-4">
                    <span className="text-2xl font-bold text-zinc-800 group-hover:text-blue-600/30 transition-colors">{s.num}</span>
                    <div className="w-10 h-10 rounded-lg bg-blue-600/10 border border-blue-500/20 flex items-center justify-center">
                      <s.icon className="w-5 h-5 text-blue-400" />
                    </div>
                  </div>
                  <h3 className="text-lg font-semibold text-white mb-2">{s.title}</h3>
                  <p className="text-sm text-zinc-500 leading-relaxed">{s.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Built for production */}
      <section className="py-20 sm:py-28 border-t border-zinc-800/60 bg-zinc-900/20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <p className="text-blue-400 font-medium text-sm tracking-wide uppercase mb-3">Features</p>
            <h2 className="text-3xl sm:text-4xl font-bold text-white">Built for production</h2>
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {features.map((f) => (
              <div key={f.title} className="p-6 rounded-xl border border-zinc-800/60 bg-zinc-900/40 hover:border-zinc-700/60 transition-all">
                <div className="w-10 h-10 rounded-lg bg-blue-600/10 border border-blue-500/20 flex items-center justify-center mb-4">
                  <f.icon className="w-5 h-5 text-blue-400" />
                </div>
                <h3 className="text-base font-semibold text-white mb-2">{f.title}</h3>
                <p className="text-sm text-zinc-500 leading-relaxed">{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Why teams use it */}
      <section className="py-20 sm:py-28 border-t border-zinc-800/60">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid lg:grid-cols-2 gap-12 items-center">
            <div>
              <p className="text-blue-400 font-medium text-sm tracking-wide uppercase mb-3">Benefits</p>
              <h2 className="text-3xl sm:text-4xl font-bold text-white mb-8">Why teams use it</h2>
              <div className="space-y-4">
                {benefits.map((b) => (
                  <div key={b} className="flex items-start gap-3">
                    <CheckCircle2 className="w-5 h-5 text-emerald-500 mt-0.5 flex-shrink-0" />
                    <span className="text-zinc-300">{b}</span>
                  </div>
                ))}
              </div>
            </div>
            <div>
              <p className="text-blue-400 font-medium text-sm tracking-wide uppercase mb-3">Use cases</p>
              <h2 className="text-3xl sm:text-4xl font-bold text-white mb-8">Who it's for</h2>
              <div className="grid sm:grid-cols-2 gap-4">
                {useCases.map((uc) => (
                  <div key={uc.title} className="p-4 rounded-lg border border-zinc-800/60 bg-zinc-900/30">
                    <uc.icon className="w-5 h-5 text-blue-400 mb-2" />
                    <h4 className="text-sm font-semibold text-white mb-1">{uc.title}</h4>
                    <p className="text-xs text-zinc-500 leading-relaxed">{uc.desc}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Security & Privacy */}
      <section className="py-20 sm:py-28 border-t border-zinc-800/60 bg-zinc-900/20">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-12">
            <p className="text-blue-400 font-medium text-sm tracking-wide uppercase mb-3">Security & Privacy</p>
            <h2 className="text-3xl sm:text-4xl font-bold text-white">Secure by design</h2>
          </div>
          <div className="grid sm:grid-cols-3 gap-6 text-center">
            <div className="p-5 rounded-lg border border-zinc-800/60 bg-zinc-900/30">
              <Shield className="w-6 h-6 text-emerald-400 mx-auto mb-3" />
              <p className="text-sm text-zinc-300 font-medium mb-1">Server-Side Processing</p>
              <p className="text-xs text-zinc-500">Your AssemblyAI credentials are never stored in the browser.</p>
            </div>
            <div className="p-5 rounded-lg border border-zinc-800/60 bg-zinc-900/30">
              <CheckCircle2 className="w-6 h-6 text-emerald-400 mx-auto mb-3" />
              <p className="text-sm text-zinc-300 font-medium mb-1">Signed URLs Supported</p>
              <p className="text-xs text-zinc-500">Processing happens securely server-side.</p>
            </div>
            <div className="p-5 rounded-lg border border-zinc-800/60 bg-zinc-900/30">
              <Shield className="w-6 h-6 text-emerald-400 mx-auto mb-3" />
              <p className="text-sm text-zinc-300 font-medium mb-1">NBCU-Ready Output</p>
              <p className="text-xs text-zinc-500">QC checks included. SRT / VTT / SCC exports.</p>
            </div>
          </div>
        </div>
      </section>

      {/* CTA Banner */}
      <section className="py-20 sm:py-28 border-t border-zinc-800/60">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <h2 className="text-3xl sm:text-4xl font-bold text-white mb-4">Ready to generate captions in minutes?</h2>
          <p className="text-zinc-400 mb-8">Start for free — no credit card required.</p>
          <div className="flex flex-wrap justify-center gap-3">
            <button onClick={() => base44.auth.redirectToLogin(createPageUrl("NewJob"))}>
              <Button size="lg" className="bg-blue-600 hover:bg-blue-700 text-white h-12 px-7 text-sm font-semibold">
                Start Free <ArrowRight className="w-4 h-4 ml-2" />
              </Button>
            </button>
            <Link to={createPageUrl("Contact")}>
              <Button size="lg" variant="outline" className="border-zinc-700 text-zinc-300 hover:bg-zinc-800 hover:text-white h-12 px-7 text-sm font-semibold">
                Request Demo
              </Button>
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}