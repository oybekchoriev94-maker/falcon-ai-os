"use client";

// O'zbekistondagi to'lov ilovalari nishonlari.
//
// Rasmiy logotiplar ATAYLAB ishlatilmadi: brend fayllari litsenziyaga
// bog'liq va vaqt o'tishi bilan o'zgaradi. Buning o'rniga har bir
// tizimning nomi o'z brend rangida yozilgan yorliq — bemor qaysi
// ilova ishlashini bir qarashda tushunadi, huquqiy xavf yo'q.

const BRANDS = [
  { name: "Payme", bg: "#00CCCC", fg: "#0a3d3d" },
  { name: "Click", bg: "#00A0E3", fg: "#ffffff" },
  { name: "Paynet", bg: "#1BA55B", fg: "#ffffff" },
] as const;

export function PayBrands({
  size = "md",
  align = "left",
}: {
  size?: "sm" | "md";
  align?: "left" | "center";
}) {
  const sm = size === "sm";
  return (
    <div
      style={{
        display: "flex",
        flexWrap: "wrap",
        gap: sm ? 6 : 8,
        justifyContent: align === "center" ? "center" : "flex-start",
      }}
    >
      {BRANDS.map((b) => (
        <span
          key={b.name}
          style={{
            background: b.bg,
            color: b.fg,
            fontFamily: "var(--font-archivo), system-ui, sans-serif",
            fontWeight: 800,
            fontSize: sm ? 12 : 15,
            letterSpacing: "0.01em",
            padding: sm ? "3px 8px" : "5px 12px",
            lineHeight: 1.25,
          }}
        >
          {b.name}
        </span>
      ))}
    </div>
  );
}
