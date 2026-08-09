"use client";

import { useState } from "react";
import { KeyRound, Loader2, MonitorCog } from "lucide-react";

export function PairingScreen({
  onSubmit,
  error,
  loading,
}: {
  onSubmit: (token: string) => void;
  error: string;
  loading: boolean;
}) {
  const [token, setToken] = useState("");

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-gradient-to-b from-slate-950 via-indigo-950/60 to-slate-950 p-6 text-white">
      <div className="w-full max-w-md rounded-3xl bg-white/5 p-8 shadow-2xl ring-1 ring-white/10 backdrop-blur">
        <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-2xl bg-indigo-500/20 ring-1 ring-indigo-400/30">
          <MonitorCog className="h-8 w-8 text-indigo-300" />
        </div>
        <h1 className="text-center text-2xl font-bold">Qurilmani sozlash</h1>
        <p className="mt-2 text-center text-sm text-slate-400">
          Administrator panelidan olingan qurilma tokenini kiriting
        </p>

        <form
          className="mt-6 space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (token.trim().length >= 8) onSubmit(token.trim());
          }}
        >
          <div className="relative">
            <KeyRound className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-500" />
            <input
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="kd_..."
              autoFocus
              spellCheck={false}
              className="w-full rounded-2xl bg-white/10 py-4 pl-12 pr-4 font-mono text-lg text-white placeholder-slate-600 ring-1 ring-white/20 outline-none focus:ring-2 focus:ring-indigo-400"
            />
          </div>

          {error && (
            <div className="rounded-xl bg-rose-500/10 px-4 py-3 text-sm text-rose-200 ring-1 ring-rose-400/30">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading || token.trim().length < 8}
            className="flex w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-indigo-500 to-violet-600 py-4 text-lg font-bold shadow-lg shadow-indigo-500/25 transition hover:brightness-110 disabled:opacity-40"
          >
            {loading && <Loader2 className="h-5 w-5 animate-spin" />}
            Ulash
          </button>
        </form>

        <p className="mt-6 text-center text-xs text-slate-500">
          Boshqarish paneli → Kiosk qurilmalari → Yangi qurilma
        </p>
      </div>
    </div>
  );
}
