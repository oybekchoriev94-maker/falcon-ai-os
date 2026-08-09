"use client";

// Ekrandagi raqamli klaviatura — teginish kioskida OS klaviaturasi
// chiqmasligi uchun (bank terminallari uslubida).
import { Delete } from "lucide-react";

export function NumPad({
  onDigit,
  onBackspace,
  disabled,
}: {
  onDigit: (d: string) => void;
  onBackspace: () => void;
  disabled?: boolean;
}) {
  const keys = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", "back"];
  return (
    <div className="grid grid-cols-3 gap-2.5">
      {keys.map((k, i) => {
        if (k === "") return <div key={i} />;
        if (k === "back") {
          return (
            <button
              key={i}
              type="button"
              disabled={disabled}
              onClick={onBackspace}
              className="flex items-center justify-center rounded-2xl bg-white/10 py-4 text-xl ring-1 ring-white/10 transition active:scale-95 active:bg-white/20 disabled:opacity-40"
            >
              <Delete className="h-6 w-6" />
            </button>
          );
        }
        return (
          <button
            key={i}
            type="button"
            disabled={disabled}
            onClick={() => onDigit(k)}
            className="rounded-2xl bg-white/10 py-4 text-2xl font-semibold tabular-nums ring-1 ring-white/10 transition active:scale-95 active:bg-white/20 disabled:opacity-40"
          >
            {k}
          </button>
        );
      })}
    </div>
  );
}
