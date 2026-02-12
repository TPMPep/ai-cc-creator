import React from "react";
import { Link } from "react-router-dom";
import { createPageUrl } from "../utils";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { Check, ArrowRight, Star } from "lucide-react";

const tiers = [
  {
    name: "Starter",
    tagline: "For individuals testing workflows",
    features: [
      "Basic caption generation",
      "SRT / VTT / SCC exports",
      "Standard processing speed",
      "5 jobs per month",
    ],
    cta: "Start Free",
    ctaAction: "signup",
    highlight: false,
  },
  {
    name: "Pro",
    tagline: "For production teams",
    badge: "Most Popular",
    features: [
      "Unlimited caption generation",
      "Full export formats + JSON",
      "Job history & playback review",
      "QC panel with issue detection",
      "Priority processing",
      "Speaker labels & language detection",
    ],
    cta: "Start Free",
    ctaAction: "signup",
    highlight: true,
  },
  {
    name: "Enterprise",
    tagline: "For studios & service providers",
    features: [
      "Everything in Pro",
      "SSO integration (coming soon)",
      "Custom rulesets & presets",
      "SLA & dedicated support",
      "Volume discounts",
      "On-prem deployment options",
    ],
    cta: "Request Demo",
    ctaAction: "contact",
    highlight: false,
  },
];

export default function Pricing() {
  return (
    <div className="py-20 sm:py-28">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-16">
          <p className="text-blue-400 font-medium text-sm tracking-wide uppercase mb-3">Pricing</p>
          <h1 className="text-4xl sm:text-5xl font-bold text-white mb-4">Simple, transparent pricing</h1>
          <p className="text-lg text-zinc-400 max-w-2xl mx-auto">Choose the plan that fits your workflow. Upgrade or downgrade anytime.</p>
        </div>

        <div className="grid md:grid-cols-3 gap-6 max-w-5xl mx-auto">
          {tiers.map((tier) => (
            <div
              key={tier.name}
              className={`relative rounded-xl border p-6 flex flex-col ${
                tier.highlight
                  ? "border-blue-500/40 bg-blue-600/5 shadow-lg shadow-blue-500/5"
                  : "border-zinc-800/60 bg-zinc-900/30"
              }`}
            >
              {tier.badge && (
                <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                  <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full bg-blue-600 text-white text-xs font-semibold">
                    <Star className="w-3 h-3" /> {tier.badge}
                  </span>
                </div>
              )}
              <div className="mb-6 pt-2">
                <h3 className="text-xl font-bold text-white">{tier.name}</h3>
                <p className="text-sm text-zinc-500 mt-1">{tier.tagline}</p>
              </div>
              <ul className="space-y-3 flex-1 mb-8">
                {tier.features.map((f) => (
                  <li key={f} className="flex items-start gap-2.5">
                    <Check className="w-4 h-4 text-emerald-500 mt-0.5 flex-shrink-0" />
                    <span className="text-sm text-zinc-300">{f}</span>
                  </li>
                ))}
              </ul>
              {tier.ctaAction === "signup" ? (
                <button onClick={() => base44.auth.redirectToLogin(createPageUrl("NewJob"))} className="w-full">
                  <Button className={`w-full ${tier.highlight ? "bg-blue-600 hover:bg-blue-700 text-white" : "bg-zinc-800 hover:bg-zinc-700 text-zinc-200 border border-zinc-700"}`}>
                    {tier.cta} <ArrowRight className="w-4 h-4 ml-2" />
                  </Button>
                </button>
              ) : (
                <Link to={createPageUrl("Contact")} className="w-full">
                  <Button variant="outline" className="w-full border-zinc-700 text-zinc-300 hover:bg-zinc-800 hover:text-white">
                    {tier.cta} <ArrowRight className="w-4 h-4 ml-2" />
                  </Button>
                </Link>
              )}
            </div>
          ))}
        </div>

        <p className="text-center text-xs text-zinc-600 mt-10">
          Pricing shown for planning purposes. Contact us for enterprise options.
        </p>
      </div>
    </div>
  );
}