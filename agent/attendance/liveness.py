# -*- coding: utf-8 -*-
"""
Jonlilik (liveness) bahosi — Face ID v2 (PR #10).

G'oya: jonli odamning yuzi kadrda DOIMO biroz siljiydi va o'lchami
o'zgaradi (bosh qimirlashi, kameraga yaqinlashish). Fotografiya yoki
ekrandagi rasm esa deyarli HARAKATSIZ qoladi. Tasdiqlash oynasidagi
kadrlar bo'yicha yuz markazining siljishi va o'lcham o'zgarishi
o'lchanadi — qo'shimcha model kerak emas, CPU'da tekin.

Bu himoya "dalil" darajasida: past ball yuz berishi mumkin (odam
qotib turgan bo'lsa), shuning uchun server hodisani o'chirmaydi —
faqat flag bilan belgilaydi.

Barcha funksiyalar SOF — kiritilgan ro'yxatga bog'liq, tashqi holat
yo'q. Shuning uchun oson sinalanadi.
"""

# Tasdiqlash uchun kamida shuncha kadr kerak (multi-frame himoya).
MIN_OBSERVATIONS = 3

# Yuz markazi o'rtacha kenglikka nisbatan shunchalik siljigan bo'lsa —
# jonli. 0.02 = kenglikning 2%: foto uchun bu amalda 0, jonli odam
# uchun odatda ancha yuqori.
MOTION_THRESHOLD = 0.02


def compute_liveness(observations, threshold=MOTION_THRESHOLD):
    """
    Tasdiqlash oynasidagi yuz kuzatuvlari bo'yicha jonlilik bahosi.

    observations: [(cx, cy, w), ...] — yuz markazi (piksel) va kengligi,
                    vaqt bo'yicha tartibda. Bo'sh/to'liq emas bo'lishi
                    mumkin — hech qachon istisno chiqarmaydi.

    Qaytaradi: {"score": float, "ok": bool, "frames": int}
      score — kadr ichidagi o'rtacha siljish + o'lcham o'zgarishi
              (o'rtacha kenglikka nisbatan, 0..1 oralig'iga siqilgan).
    """
    pts = []
    for obs in observations or []:
        try:
            cx, cy, w = float(obs[0]), float(obs[1]), float(obs[2])
        except (TypeError, ValueError, IndexError):
            continue
        if w > 0:
            pts.append((cx, cy, w))

    if len(pts) < MIN_OBSERVATIONS:
        return {"score": 0.0, "ok": False, "frames": len(pts)}

    mean_w = sum(p[2] for p in pts) / len(pts)
    if mean_w <= 0:
        return {"score": 0.0, "ok": False, "frames": len(pts)}

    cx0, cy0 = pts[0][0], pts[0][1]
    # Harakat: birinchi kadrdan maksimal siljish (o'rtacha kenglikka nisbatan).
    # Foto kadrlarida bu deyarli 0; jonli yuzda piksellar darajasida ham bor.
    max_disp = max(((p[0] - cx0) ** 2 + (p[1] - cy0) ** 2) ** 0.5 for p in pts)
    motion = max_disp / mean_w

    # O'lcham o'zgarishi: odam kameraga yaqinlashsa yuz kattalashadi.
    widths = [p[2] for p in pts]
    scale_change = (max(widths) - min(widths)) / mean_w

    score = min(1.0, motion + 0.5 * scale_change)
    return {
        "score": round(score, 4),
        "ok": score >= threshold,
        "frames": len(pts),
    }
