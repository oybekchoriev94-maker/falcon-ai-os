#!/usr/bin/env python3
"""
Ikkita STT modelini yonma-yon solishtirish.

Nima uchun: hozirgi modelimizning (whisper-large-v3-turbo-uzbek-ct2)
aniqligi HECH QAYERDA e'lon qilinmagan. rubaiSTT esa WER ~17% deb
aytadi, lekin u Toshkent shevasiga sozlangan va faqat o'zbek audiosida
fine-tune qilingan. Termiz shevasida va ruschada qanday ishlashini
faqat o'lchab bilish mumkin.

Ishlatish:
    # Faqat matnlarni solishtirish (etalon kerak emas)
    python compare.py --audio ./audio --lang uz

    # Aniqlikni ham o'lchash — har audio yonida .txt etalon bo'lsin
    #   audio/001.wav + audio/001.txt
    python compare.py --audio ./audio --lang uz --wer

    # GPU'da (klinika kompyuteri)
    python compare.py --audio ./audio --lang uz --device cuda --compute float16

Chiqish: konsolda jadval + natija.md faylida to'liq matnlar.
"""
import argparse
import os
import statistics
import time
import unicodedata
from pathlib import Path

MODEL_A_DEFAULT = "hostmepanda/whisper-large-v3-turbo-uzbek-ct2"  # hozirgi
MODEL_B_DEFAULT = "./models/rubaistt-v2-medium-ct2"                # nomzod

AUDIO_EXT = {".wav", ".mp3", ".m4a", ".ogg", ".flac", ".webm"}


# ── WER/CER — tashqi kutubxonasiz (jiwer talab qilmaymiz) ──────

def _norm(s: str) -> str:
    """Solishtirishdan oldin matnni tenglashtirish: registr, tinish
    belgilari, apostrof variantlari (oʻ / o' / o‘) bir ko'rinishga."""
    s = unicodedata.normalize("NFKC", s).lower()
    for ch in "ʻʼ‘’`´":
        s = s.replace(ch, "'")
    keep = []
    for ch in s:
        if ch.isalnum() or ch.isspace() or ch == "'":
            keep.append(ch)
        else:
            keep.append(" ")
    return " ".join("".join(keep).split())


def _edit_distance(a: list, b: list) -> int:
    """Levenshtein — O(len(a)*len(b)) vaqt, O(len(b)) xotira."""
    if not a:
        return len(b)
    prev = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        cur = [i]
        for j, cb in enumerate(b, 1):
            cur.append(min(
                prev[j] + 1,        # o'chirish
                cur[j - 1] + 1,     # qo'shish
                prev[j - 1] + (ca != cb),  # almashtirish
            ))
        prev = cur
    return prev[-1]


def wer(ref: str, hyp: str) -> float:
    r, h = _norm(ref).split(), _norm(hyp).split()
    return _edit_distance(r, h) / len(r) if r else 0.0


def cer(ref: str, hyp: str) -> float:
    r, h = list(_norm(ref)), list(_norm(hyp))
    return _edit_distance(r, h) / len(r) if r else 0.0


# ── Audio uzunligi (ffprobe bo'lsa) ────────────────────────────

def audio_seconds(path: Path) -> float:
    try:
        import subprocess
        out = subprocess.run(
            ["ffprobe", "-v", "error", "-show_entries", "format=duration",
             "-of", "default=nw=1:nk=1", str(path)],
            capture_output=True, text=True, timeout=30,
        )
        return float(out.stdout.strip())
    except Exception:
        return 0.0


# ── Bitta model bilan yurish ───────────────────────────────────

def run_model(name: str, files: list, lang: str, device: str, compute: str,
              beam: int, prompt: str | None):
    from faster_whisper import WhisperModel

    print(f"\n>>> {name}")
    t0 = time.perf_counter()
    model = WhisperModel(name, device=device, compute_type=compute)
    load_s = time.perf_counter() - t0
    print(f"    yuklandi: {load_s:.1f}s")

    results = {}
    for f in files:
        t = time.perf_counter()
        segments, _info = model.transcribe(
            str(f),
            language=lang,
            beam_size=beam,
            vad_filter=True,
            initial_prompt=prompt,
        )
        text = " ".join(s.text.strip() for s in segments).strip()
        dt = time.perf_counter() - t
        results[f.name] = {"text": text, "sec": dt}
        print(f"    {f.name}: {dt:.1f}s")

    del model
    return {"load_s": load_s, "files": results}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--audio", required=True, help="audio fayllar papkasi")
    ap.add_argument("--lang", default="uz", choices=["uz", "ru"])
    ap.add_argument("--model-a", default=MODEL_A_DEFAULT, help="hozirgi model")
    ap.add_argument("--model-b", default=MODEL_B_DEFAULT, help="nomzod model")
    ap.add_argument("--device", default="cpu", choices=["cpu", "cuda"])
    ap.add_argument("--compute", default="int8", help="int8 | float16")
    ap.add_argument("--beam", type=int, default=3)
    ap.add_argument("--wer", action="store_true", help="yonidagi .txt etalon bilan o'lchash")
    ap.add_argument("--prompt", default=None,
                    help="initial_prompt sinovi (hozirgi model buni ko'tarmaydi)")
    ap.add_argument("--out", default="natija.md")
    args = ap.parse_args()

    folder = Path(args.audio)
    files = sorted(p for p in folder.iterdir() if p.suffix.lower() in AUDIO_EXT)
    if not files:
        raise SystemExit(f"{folder} ichida audio topilmadi ({', '.join(sorted(AUDIO_EXT))})")
    print(f"{len(files)} ta audio, til={args.lang}, {args.device}/{args.compute}")

    refs = {}
    if args.wer:
        for f in files:
            t = f.with_suffix(".txt")
            if t.exists():
                refs[f.name] = t.read_text(encoding="utf-8").strip()
        print(f"etalon matn: {len(refs)}/{len(files)}")
        if not refs:
            print("  OGOHLANTIRISH: birorta .txt topilmadi, WER hisoblanmaydi")

    a = run_model(args.model_a, files, args.lang, args.device, args.compute, args.beam, args.prompt)
    b = run_model(args.model_b, files, args.lang, args.device, args.compute, args.beam, args.prompt)

    # ── Hisobot ──
    lines = [
        "# STT solishtiruvi", "",
        f"- Til: **{args.lang}** · Qurilma: **{args.device}/{args.compute}** · beam={args.beam}",
        f"- A (hozirgi): `{args.model_a}`",
        f"- B (nomzod):  `{args.model_b}`",
        f"- Yuklash: A {a['load_s']:.1f}s · B {b['load_s']:.1f}s",
        "",
        "## Tezlik", "",
        "| Fayl | Uzunlik | A vaqt | A xRT | B vaqt | B xRT |",
        "|---|---|---|---|---|---|",
    ]
    a_rt, b_rt = [], []
    for f in files:
        dur = audio_seconds(f)
        ta = a["files"][f.name]["sec"]
        tb = b["files"][f.name]["sec"]
        ra = dur / ta if ta else 0
        rb = dur / tb if tb else 0
        if dur:
            a_rt.append(ra); b_rt.append(rb)
        lines.append(
            f"| {f.name} | {dur:.0f}s | {ta:.1f}s | {ra:.1f}x | {tb:.1f}s | {rb:.1f}x |"
        )
    if a_rt:
        lines += ["", f"**O'rtacha tezlik:** A {statistics.mean(a_rt):.1f}x · "
                      f"B {statistics.mean(b_rt):.1f}x real vaqt "
                      f"(1x dan past = audiodan sekin)"]

    if refs:
        lines += ["", "## Aniqlik", "",
                  "| Fayl | A WER | A CER | B WER | B CER | Yaxshisi |",
                  "|---|---|---|---|---|---|"]
        aw, bw = [], []
        for f in files:
            if f.name not in refs:
                continue
            r = refs[f.name]
            wa = wer(r, a["files"][f.name]["text"]); ca = cer(r, a["files"][f.name]["text"])
            wb = wer(r, b["files"][f.name]["text"]); cb = cer(r, b["files"][f.name]["text"])
            aw.append(wa); bw.append(wb)
            better = "A" if wa < wb else ("B" if wb < wa else "=")
            lines.append(f"| {f.name} | {wa:.1%} | {ca:.1%} | {wb:.1%} | {cb:.1%} | **{better}** |")
        if aw:
            ma, mb = statistics.mean(aw), statistics.mean(bw)
            lines += ["", f"**O'rtacha WER:** A {ma:.1%} · B {mb:.1%}", ""]
            if mb < ma - 0.02:
                lines.append(f"> Xulosa: **B aniqroq** ({(ma-mb)*100:.1f} punktga).")
            elif ma < mb - 0.02:
                lines.append(f"> Xulosa: **A aniqroq** ({(mb-ma)*100:.1f} punktga). Almashtirmaymiz.")
            else:
                lines.append("> Xulosa: farq sezilarli emas — tezlik va ruscha qo'llab-quvvatlash hal qiladi.")

    lines += ["", "## Matnlar", ""]
    for f in files:
        lines += [f"### {f.name}", ""]
        if f.name in refs:
            lines += ["**Etalon:**", "", "> " + refs[f.name].replace("\n", " "), ""]
        lines += ["**A (hozirgi):**", "", "> " + (a["files"][f.name]["text"] or "_bo'sh_"), "",
                  "**B (nomzod):**", "", "> " + (b["files"][f.name]["text"] or "_bo'sh_"), ""]

    Path(args.out).write_text("\n".join(lines), encoding="utf-8")
    print(f"\nHisobot: {args.out}")
    if refs:
        print("Aniqlik jadvali hisobot ichida.")


if __name__ == "__main__":
    main()
