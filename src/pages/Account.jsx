import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { User, LogOut, Mail } from "lucide-react";

export default function Account() {
  const [user, setUser] = useState(null);

  useEffect(() => {
    base44.auth.me().then(setUser);
  }, []);

  if (!user) return null;

  return (
    <div className="px-4 sm:px-6 lg:px-8 py-8">
      <div className="max-w-2xl mx-auto">
        <h1 className="text-2xl font-bold text-white mb-6">Account</h1>

        <div className="rounded-xl border border-zinc-800/60 bg-zinc-900/30 p-6 space-y-6">
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 rounded-full bg-zinc-800 border border-zinc-700 flex items-center justify-center">
              <User className="w-7 h-7 text-zinc-500" />
            </div>
            <div>
              <p className="text-lg font-semibold text-white">{user.full_name || "User"}</p>
              <div className="flex items-center gap-1.5 text-sm text-zinc-500">
                <Mail className="w-3.5 h-3.5" />
                {user.email}
              </div>
            </div>
          </div>

          <div className="border-t border-zinc-800/60 pt-4">
            <p className="text-xs text-zinc-600 mb-1">Role</p>
            <p className="text-sm text-zinc-300 capitalize">{user.role || "user"}</p>
          </div>

          <div className="border-t border-zinc-800/60 pt-4">
            <Button variant="outline" onClick={() => base44.auth.logout()} className="border-zinc-800 text-red-400 hover:bg-red-500/10 hover:text-red-300 hover:border-red-500/30">
              <LogOut className="w-4 h-4 mr-2" /> Sign Out
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}