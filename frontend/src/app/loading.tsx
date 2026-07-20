import { HeartPulse } from "lucide-react";

export default function Loading() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-background gap-4">
      <div className="relative">
        <div className="size-12 rounded-2xl bg-primary/10 flex items-center justify-center">
          <HeartPulse className="size-6 text-primary animate-pulse" />
        </div>
        <div className="absolute -inset-2 rounded-3xl border border-primary/20 animate-pulse" />
      </div>
      <div className="flex flex-col items-center gap-1">
        <p className="text-sm font-medium text-foreground">Falcon AI OS</p>
        <p className="text-xs text-muted-foreground">Yuklanmoqda...</p>
      </div>
    </div>
  );
}
