import React, { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { createPageUrl } from "./utils";
import { base44 } from "@/api/base44Client";
import { Menu, X, ChevronRight, LogOut, User, Subtitles } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const PUBLIC_PAGES = ["Landing", "Pricing", "Security", "Contact"];
const APP_PAGES = ["NewJob", "Jobs", "JobDetail", "Account"];

export default function Layout({ children, currentPageName }) {
  const [user, setUser] = useState(null);
  const [checking, setChecking] = useState(true);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  useEffect(() => {
    base44.auth.isAuthenticated().then(async (isAuth) => {
      if (isAuth) {
        const u = await base44.auth.me();
        setUser(u);
      }
      setChecking(false);
    });
  }, []);

  const isPublicPage = PUBLIC_PAGES.includes(currentPageName);
  const isAppPage = APP_PAGES.includes(currentPageName);

  if (checking) {
    return (
      <div className="min-h-screen bg-zinc-950 flex items-center justify-center">
        <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  // Public marketing layout
  if (isPublicPage) {
    return (
      <div className="min-h-screen bg-zinc-950 text-zinc-100">
        <style>{`
          :root {
            --brand: #3b82f6;
            --brand-hover: #2563eb;
          }
          body { background: #09090b; }
        `}</style>
        <header className="sticky top-0 z-50 border-b border-zinc-800/60 bg-zinc-950/80 backdrop-blur-xl">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex items-center justify-between h-16">
              <Link to={createPageUrl("Landing")} className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center">
                  <Subtitles className="w-4.5 h-4.5 text-white" />
                </div>
                <span className="font-semibold text-lg tracking-tight text-white">AI CC Creator</span>
              </Link>

              <nav className="hidden md:flex items-center gap-1">
                <Link to={createPageUrl("Landing")} className="px-3 py-2 text-sm text-zinc-400 hover:text-white transition-colors rounded-md hover:bg-zinc-800/50">Product</Link>
                <Link to={createPageUrl("Pricing")} className="px-3 py-2 text-sm text-zinc-400 hover:text-white transition-colors rounded-md hover:bg-zinc-800/50">Pricing</Link>
                <Link to={createPageUrl("Security")} className="px-3 py-2 text-sm text-zinc-400 hover:text-white transition-colors rounded-md hover:bg-zinc-800/50">Security</Link>
                <Link to={createPageUrl("Contact")} className="px-3 py-2 text-sm text-zinc-400 hover:text-white transition-colors rounded-md hover:bg-zinc-800/50">Contact</Link>
                <div className="w-px h-6 bg-zinc-800 mx-2" />
                {user ? (
                  <>
                    <Link to={createPageUrl("NewJob")}>
                      <Button size="sm" className="bg-blue-600 hover:bg-blue-700 text-white">Go to App</Button>
                    </Link>
                  </>
                ) : (
                  <>
                    <button onClick={() => base44.auth.redirectToLogin(createPageUrl("NewJob"))} className="px-3 py-2 text-sm text-zinc-400 hover:text-white transition-colors">Login</button>
                    <button onClick={() => base44.auth.redirectToLogin(createPageUrl("NewJob"))}>
                      <Button size="sm" className="bg-blue-600 hover:bg-blue-700 text-white">Start Free</Button>
                    </button>
                  </>
                )}
              </nav>

              <button className="md:hidden text-zinc-400" onClick={() => setMobileMenuOpen(!mobileMenuOpen)}>
                {mobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
              </button>
            </div>
          </div>
          {mobileMenuOpen && (
            <div className="md:hidden border-t border-zinc-800 bg-zinc-950 px-4 py-4 space-y-2">
              <Link to={createPageUrl("Landing")} className="block px-3 py-2 text-sm text-zinc-300 hover:text-white" onClick={() => setMobileMenuOpen(false)}>Product</Link>
              <Link to={createPageUrl("Pricing")} className="block px-3 py-2 text-sm text-zinc-300 hover:text-white" onClick={() => setMobileMenuOpen(false)}>Pricing</Link>
              <Link to={createPageUrl("Security")} className="block px-3 py-2 text-sm text-zinc-300 hover:text-white" onClick={() => setMobileMenuOpen(false)}>Security</Link>
              <Link to={createPageUrl("Contact")} className="block px-3 py-2 text-sm text-zinc-300 hover:text-white" onClick={() => setMobileMenuOpen(false)}>Contact</Link>
              <div className="border-t border-zinc-800 pt-2 mt-2">
                {user ? (
                  <Link to={createPageUrl("NewJob")} onClick={() => setMobileMenuOpen(false)}>
                    <Button size="sm" className="w-full bg-blue-600 hover:bg-blue-700 text-white">Go to App</Button>
                  </Link>
                ) : (
                  <button onClick={() => base44.auth.redirectToLogin(createPageUrl("NewJob"))} className="w-full">
                    <Button size="sm" className="w-full bg-blue-600 hover:bg-blue-700 text-white">Start Free</Button>
                  </button>
                )}
              </div>
            </div>
          )}
        </header>

        <main>{children}</main>

        <footer className="border-t border-zinc-800/60 bg-zinc-950">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
            <div className="flex flex-col md:flex-row items-center justify-between gap-6">
              <div className="flex items-center gap-2.5">
                <div className="w-7 h-7 rounded-md bg-blue-600 flex items-center justify-center">
                  <Subtitles className="w-3.5 h-3.5 text-white" />
                </div>
                <span className="font-semibold text-sm text-zinc-400">AI CC Creator</span>
              </div>
              <div className="flex flex-wrap items-center gap-6 text-xs text-zinc-500">
                <Link to={createPageUrl("Pricing")} className="hover:text-zinc-300 transition-colors">Pricing</Link>
                <Link to={createPageUrl("Security")} className="hover:text-zinc-300 transition-colors">Security</Link>
                <Link to={createPageUrl("Contact")} className="hover:text-zinc-300 transition-colors">Contact</Link>
                <span>Terms</span>
                <span>Privacy</span>
              </div>
              <p className="text-xs text-zinc-600">&copy; {new Date().getFullYear()} AI CC Creator</p>
            </div>
          </div>
        </footer>
      </div>
    );
  }

  // App layout (authenticated)
  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      <style>{`
        :root { --brand: #3b82f6; --brand-hover: #2563eb; }
        body { background: #09090b; }
      `}</style>
      <header className="sticky top-0 z-50 border-b border-zinc-800/60 bg-zinc-950/80 backdrop-blur-xl">
        <div className="max-w-screen-2xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-14">
            <div className="flex items-center gap-6">
              <Link to={createPageUrl("NewJob")} className="flex items-center gap-2.5">
                <div className="w-7 h-7 rounded-md bg-blue-600 flex items-center justify-center">
                  <Subtitles className="w-3.5 h-3.5 text-white" />
                </div>
                <span className="font-semibold text-sm tracking-tight text-white hidden sm:inline">AI CC Creator</span>
              </Link>
              <nav className="flex items-center gap-1">
                <Link to={createPageUrl("NewJob")} className={`px-3 py-1.5 text-sm rounded-md transition-colors ${currentPageName === "NewJob" ? "bg-zinc-800 text-white" : "text-zinc-400 hover:text-white hover:bg-zinc-800/50"}`}>
                  New Job
                </Link>
                <Link to={createPageUrl("Jobs")} className={`px-3 py-1.5 text-sm rounded-md transition-colors ${currentPageName === "Jobs" || currentPageName === "JobDetail" ? "bg-zinc-800 text-white" : "text-zinc-400 hover:text-white hover:bg-zinc-800/50"}`}>
                  Jobs
                </Link>
                <Link to={createPageUrl("NewJobAI")} className={`px-3 py-1.5 text-sm rounded-md transition-colors ${currentPageName === "NewJobAI" || currentPageName === "JobDetailAI" ? "bg-blue-600/20 text-blue-400 border border-blue-500/30" : "text-zinc-400 hover:text-white hover:bg-zinc-800/50"}`}>
                  ✦ AI Pipeline
                </Link>
                {user?.role === "admin" && (
                  <Link to={createPageUrl("Admin")} className={`px-3 py-1.5 text-sm rounded-md transition-colors ${currentPageName === "Admin" ? "bg-zinc-800 text-white" : "text-zinc-400 hover:text-white hover:bg-zinc-800/50"}`}>
                    Admin
                  </Link>
                )}
              </nav>
            </div>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-zinc-800/50 transition-colors">
                  <div className="w-7 h-7 rounded-full bg-zinc-800 border border-zinc-700 flex items-center justify-center">
                    <User className="w-3.5 h-3.5 text-zinc-400" />
                  </div>
                  <span className="text-sm text-zinc-400 hidden sm:inline">{user?.email}</span>
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56 bg-zinc-900 border-zinc-800">
                <div className="px-3 py-2">
                  <p className="text-sm font-medium text-zinc-200">{user?.full_name || "User"}</p>
                  <p className="text-xs text-zinc-500">{user?.email}</p>
                </div>
                <DropdownMenuSeparator className="bg-zinc-800" />
                <DropdownMenuItem asChild className="text-zinc-300 focus:bg-zinc-800 focus:text-white cursor-pointer">
                  <Link to={createPageUrl("Account")}>
                    <User className="w-4 h-4 mr-2" /> Account
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuSeparator className="bg-zinc-800" />
                <DropdownMenuItem onClick={() => base44.auth.logout()} className="text-red-400 focus:bg-zinc-800 focus:text-red-300 cursor-pointer">
                  <LogOut className="w-4 h-4 mr-2" /> Sign Out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </header>
      <main className="max-w-screen-2xl mx-auto">{children}</main>
    </div>
  );
}