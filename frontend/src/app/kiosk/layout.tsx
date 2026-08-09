import type { Metadata, Viewport } from "next";

export const metadata: Metadata = {
  title: "Kiosk — Falcon AI OS",
  description: "Bemor o'z-o'ziga xizmat terminali",
};

/**
 * Kiosk planshet uchun viewport: zoom o'chirilgan (bemor tasodifan
 * ekranni kattalashtirib yubormasin), status bar rangi to'q.
 */
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  themeColor: "#020617",
};

/**
 * Kiosk layout — dashboard sidebar/header YO'Q.
 * Fon bermaymiz: page.tsx o'zining to'q gradientini chizadi.
 * select-none — bemor matnni tasodifan belgilab olmasin.
 */
export default function KioskLayout({ children }: { children: React.ReactNode }) {
  return <div className="select-none">{children}</div>;
}
