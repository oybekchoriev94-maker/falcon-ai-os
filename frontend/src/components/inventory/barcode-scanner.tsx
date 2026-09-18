"use client";

// ============================================================
// Shtrix-kod skaneri — telefon/planshet kamerasi orqali.
//
// Brauzerning O'Z ichki BarcodeDetector API'si ishlatiladi —
// qo'shimcha kutubxona yuklanmaydi (loyihaning "og'ir bog'liqliklardan
// qochish" tamoyiliga mos). Android Chrome'da ishlaydi; qo'llab-
// quvvatlamaydigan brauzerda (iOS Safari, Firefox) aniq xabar
// ko'rsatiladi — bunday holda USB skaner yoki qo'lda kiritish qoladi.
//
// MUHIM: kamera oqimi yopilganda albatta to'xtatiladi (track.stop()),
// aks holda kamera chirog'i yonib qolaveradi.
// ============================================================

import { useEffect, useRef, useState } from "react";
import { Camera, CameraOff, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";

// BarcodeDetector hali TypeScript'ning standart tiplarida yo'q
interface DetectedBarcode { rawValue: string }
interface BarcodeDetectorLike {
  detect(source: CanvasImageSource): Promise<DetectedBarcode[]>;
}
type BarcodeDetectorCtor = new (opts?: { formats?: string[] }) => BarcodeDetectorLike;

const FORMATS = ["ean_13", "ean_8", "code_128", "code_39", "upc_a", "upc_e", "qr_code", "data_matrix"];

export function BarcodeScannerDialog({
  open, onOpenChange, onDetected,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onDetected: (code: string) => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);

  useEffect(() => {
    if (!open) return;

    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | null = null;

    async function start() {
      setError(null);
      setStarting(true);

      const Ctor = (window as unknown as { BarcodeDetector?: BarcodeDetectorCtor }).BarcodeDetector;
      if (!Ctor) {
        setStarting(false);
        setError(
          "Bu brauzer kamera orqali skanerlashni qo'llab-quvvatlamaydi. " +
          "Android'da Chrome brauzeridan foydalaning, yoki USB skaner bilan " +
          "to'g'ridan-to'g'ri maydonga skanerlang."
        );
        return;
      }

      let detector: BarcodeDetectorLike;
      try {
        detector = new Ctor({ formats: FORMATS });
      } catch {
        detector = new Ctor();
      }

      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "environment" },
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }
        setStarting(false);

        timer = setInterval(async () => {
          const video = videoRef.current;
          if (!video || video.readyState < 2) return;
          try {
            const found = await detector.detect(video);
            const code = found?.[0]?.rawValue?.trim();
            if (code) {
              onDetected(code);
              onOpenChange(false);
            }
          } catch {
            // Bitta kadr o'qilmasa — keyingisida qayta urinadi
          }
        }, 300);
      } catch {
        setStarting(false);
        setError(
          "Kameraga ruxsat berilmadi yoki kamera topilmadi. " +
          "Brauzer so'roviga 'Ruxsat berish'ni bosing."
        );
      }
    }

    start();

    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    };
  }, [open, onDetected, onOpenChange]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Camera className="size-4" /> Shtrix-kodni skanerlash
          </DialogTitle>
          <DialogDescription>
            Dori qutisidagi kodni kamera ro&apos;parasiga tuting
          </DialogDescription>
        </DialogHeader>

        {error ? (
          <div className="flex flex-col items-center gap-3 py-8 text-center">
            <CameraOff className="size-10 text-muted-foreground/40" />
            <p className="text-sm text-muted-foreground">{error}</p>
          </div>
        ) : (
          <div className="relative overflow-hidden rounded-lg bg-black">
            <video ref={videoRef} className="w-full" muted playsInline />
            {starting && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/60">
                <Loader2 className="size-6 animate-spin text-white" />
              </div>
            )}
            {/* Nishon ramkasi — foydalanuvchi kodni qayerga tutishini bilsin */}
            <div className="pointer-events-none absolute inset-x-8 top-1/2 h-24 -translate-y-1/2 rounded-lg border-2 border-emerald-400/80" />
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** Kamera skanerlashni ochadigan tugma — qo'llab-quvvatlanmasa ham ko'rinadi,
 *  bosilganda aniq sabab ko'rsatiladi (jim yo'qolib qolmaydi). */
export function ScanButton({ onDetected, label = "Skanerlash" }: {
  onDetected: (code: string) => void;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button type="button" variant="outline" onClick={() => setOpen(true)}>
        <Camera className="size-4" /> {label}
      </Button>
      <BarcodeScannerDialog open={open} onOpenChange={setOpen} onDetected={onDetected} />
    </>
  );
}
