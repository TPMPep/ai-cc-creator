import React from "react";
import { Shield, Server, Lock, Users, Eye, FileCheck } from "lucide-react";

const sections = [
  {
    icon: Server,
    title: "Data Handling",
    items: [
      "AI CC Creator processes media via customer-provided public URLs.",
      "Results are stored per user account for job history.",
      "No media files are permanently stored — only transcription results and metadata.",
    ],
  },
  {
    icon: Lock,
    title: "Secrets & Credentials",
    items: [
      "No API keys are exposed in the browser.",
      "Third-party transcription is orchestrated server-side.",
      "All communication happens over HTTPS.",
    ],
  },
  {
    icon: Users,
    title: "Access Control",
    items: [
      "User accounts required for job history and results.",
      "Users can only access their own jobs.",
      "Session-based authentication with secure token handling.",
    ],
  },
  {
    icon: Eye,
    title: "Client Guidance",
    items: [
      "Do not submit confidential media unless you control access to the URL.",
      "Use signed or expiring URLs for sensitive content when possible.",
      "Review your organization's media handling policies before use.",
    ],
  },
  {
    icon: FileCheck,
    title: "Compliance Posture",
    items: [
      "Designed with least-privilege principles and audit-friendly workflows.",
      "Job history provides a clear audit trail of all processing activity.",
      "Architecture supports future compliance certifications as needed.",
    ],
  },
];

export default function Security() {
  return (
    <div className="py-20 sm:py-28">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-16">
          <div className="w-12 h-12 rounded-xl bg-blue-600/10 border border-blue-500/20 flex items-center justify-center mx-auto mb-4">
            <Shield className="w-6 h-6 text-blue-400" />
          </div>
          <h1 className="text-4xl sm:text-5xl font-bold text-white mb-4">Security & Compliance</h1>
          <p className="text-lg text-zinc-400 max-w-2xl mx-auto">
            How AI CC Creator handles your data, credentials, and access.
          </p>
        </div>

        <div className="space-y-8">
          {sections.map((section) => (
            <div key={section.title} className="p-6 rounded-xl border border-zinc-800/60 bg-zinc-900/30">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-9 h-9 rounded-lg bg-zinc-800 flex items-center justify-center">
                  <section.icon className="w-4.5 h-4.5 text-zinc-400" />
                </div>
                <h2 className="text-lg font-semibold text-white">{section.title}</h2>
              </div>
              <ul className="space-y-2.5 ml-12">
                {section.items.map((item) => (
                  <li key={item} className="text-sm text-zinc-400 leading-relaxed flex items-start gap-2">
                    <span className="w-1 h-1 rounded-full bg-zinc-600 mt-2 flex-shrink-0" />
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}