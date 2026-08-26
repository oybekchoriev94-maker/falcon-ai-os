import type { Metadata, Viewport } from "next";
import { Archivo } from "next/font/google";
import "./kiosk.css";

// Archivo — maketning sarlavha shrifti. 800 og'irlik "Modernist"
// ko'rinishning asosi.
const archivo = Archivo({
  variable: "--font-archivo",
  subsets: ["latin", "latin-ext"],
  weight: ["400", "500", "600", "800"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Kiosk — Oqtosh Klinikasi",
  description: "Bemor o'z-o'ziga xizmat terminali",
};

/**
 * Kiosk planshet uchun viewport: zoom o'chirilgan (bemor tasodifan
 * ekranni kattalashtirib yubormasin), status bar rangi yorug'.
 */
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  themeColor: "#f4f6f7",
};

/**
 * Kiosk layout — dashboard sidebar/header YO'Q.
 * `light` sinfi ildizdagi `dark` mavzuni bekor qiladi: kiosk doim
 * yorug' bo'lishi kerak (klinika zali yorug', to'q ekran aks etadi).
 * select-none — bemor matnni tasodifan belgilab olmasin.
 */
export default function KioskLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className={`${archivo.variable} kiosk-root light select-none`}>
      {children}
    </div>
  );
}
