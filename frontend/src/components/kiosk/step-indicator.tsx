"use client";

// Bron qilish oqimidagi progress ko'rsatkichi (0-based joriy qadam).
export function StepIndicator({ step, total }: { step: number; total: number }) {
  return (
    <div className="mb-6 flex items-center justify-center">
      {Array.from({ length: total }).map((_, i) => (
        <div key={i} className="flex items-center">
          <div
            className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-bold transition ${
              i < step
                ? "bg-emerald-500 text-white"
                : i === step
                ? "bg-emerald-500/20 text-emerald-300 ring-2 ring-emerald-400"
                : "bg-white/10 text-slate-500"
            }`}
          >
            {i < step ? "✓" : i + 1}
          </div>
          {i < total - 1 && (
            <div className={`h-0.5 w-6 sm:w-10 ${i < step ? "bg-emerald-500" : "bg-white/10"}`} />
          )}
        </div>
      ))}
    </div>
  );
}
