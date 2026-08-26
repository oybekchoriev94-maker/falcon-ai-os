# -*- coding: utf-8 -*-
"""
TANISHNI SINASH — kamerasiz, faqat suratlar bilan.

Nima uchun: kamera hali ulanmagan bo'lsa ham, eng muhim savolga javob
olish mumkin — "chegara to'g'ri qo'yilganmi va odamlar tanilyaptimi?"

Ishlatish:
    # faces/ dagi odamlarni test suratlar bilan tekshirish
    python test-recognition.py --folder test-photos

    # bitta surat
    python test-recognition.py --image test.jpg

TEST SURATLAR bazadagilardan BOSHQA bo'lishi kerak. Bazaga qo'shilgan
suratning o'zini sinasangiz, natija har doim ~1.00 chiqadi va hech
narsani isbotlamaydi.
"""
import argparse
import os
import sys

import cv2
import numpy as np

import faces as faces_mod

IMG_EXT = {".jpg", ".jpeg", ".png", ".bmp", ".webp"}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--folder", help="test suratlar papkasi")
    ap.add_argument("--image", help="bitta surat")
    ap.add_argument("--threshold", type=float, default=None,
                    help="chegarani vaqtincha o'zgartirib sinash")
    args = ap.parse_args()

    if not args.folder and not args.image:
        ap.error("--folder yoki --image kerak")

    db_mat, db_names, _ = faces_mod.load_db()
    if db_mat is None:
        raise SystemExit("Baza bo'sh. Avval: python enroll.py")

    people = sorted(set(db_names))
    print(f"Bazada {len(people)} ta odam: {', '.join(people)}")

    thresh = args.threshold if args.threshold is not None else faces_mod.COSINE_THRESHOLD
    engine = faces_mod.FaceEngine(cosine_thresh=thresh)
    print(f"Chegara: {thresh}\n")

    paths = []
    if args.image:
        paths.append(args.image)
    if args.folder:
        for root, _, files in os.walk(args.folder):
            for f in sorted(files):
                if os.path.splitext(f)[1].lower() in IMG_EXT:
                    paths.append(os.path.join(root, f))

    if not paths:
        raise SystemExit("Surat topilmadi")

    # Apostrofli matnlar f-string IFODASI ichida bo'lmasin — Python
    # buni qabul qilmaydi. Shuning uchun oldindan o'zgaruvchiga olamiz.
    h_file, h_res, h_score, h_face = "Fayl", "Natija", "O'xshashlik", "Yuz"
    print(f"{h_file:<28} {h_res:<20} {h_score:>11}  {h_face:>7}")
    print("-" * 72)

    scores_ok, scores_no = [], []
    no_face = 0

    for p in paths:
        img = cv2.imread(p)
        name_short = os.path.basename(p)[:27]
        if img is None:
            bad = "o'qib bo'lmadi"
            print(f"{name_short:<28} {bad:<20}")
            continue

        detected = engine.detect(img)
        if len(detected) == 0:
            no_face += 1
            print(f"{name_short:<28} {'YUZ TOPILMADI':<20} {'':>11}  {'':>7}")
            continue

        # Eng katta yuz
        face = max(detected, key=lambda f: f[2] * f[3])
        fw = int(face[2])
        feat = engine.embed(img, face)
        name, score = engine.match(feat, db_mat, db_names)

        if name:
            scores_ok.append(score)
            print(f"{name_short:<28} {name:<20} {score:>11.3f}  {fw:>5}px")
        else:
            scores_no.append(score)
            print(f"{name_short:<28} {'tanilmadi':<20} {score:>11.3f}  {fw:>5}px")

    # ── Xulosa ──
    print("-" * 72)
    total = len(scores_ok) + len(scores_no) + no_face
    print(f"Jami {total} ta surat: tanildi {len(scores_ok)}, "
          f"tanilmadi {len(scores_no)}, yuz yo'q {no_face}")

    # O'xshashlik ~1.000 bo'lsa — bu bazadagi suratning O'ZI.
    # Bunday test hech narsani isbotlamaydi, ogohlantiramiz.
    identical = [s for s in scores_ok if s > 0.985]
    if identical:
        print(f"\n!!! DIQQAT: {len(identical)} ta suratda o'xshashlik ~1.000.")
        print("    Bu bazadagi suratning AYNAN O'ZI degani — model o'zi")
        print("    ko'rgan rasmni tanidi, bu natija hech narsani isbotlamaydi.")
        print("    Boshqa sharoitda olingan (boshqa kun, yorug'lik, burchak)")
        print("    suratlar bilan qayta sinang.")

    if scores_ok:
        print(f"\nTanilganlar o'xshashligi: "
              f"eng past {min(scores_ok):.3f}, o'rtacha {sum(scores_ok)/len(scores_ok):.3f}")
        margin = min(scores_ok) - thresh
        if margin < 0.05:
            print(f"  ! Chegaraga juda yaqin ({margin:+.3f}). Yana surat qo'shing —")
            print("    yorug'lik o'zgarsa tanilmay qolishi mumkin.")
        else:
            print(f"  Zaxira: {margin:+.3f} — yaxshi.")

    if scores_no:
        print(f"\nTanilmaganlar: eng yuqori {max(scores_no):.3f}")
        if max(scores_no) > thresh - 0.06:
            print("  ! Chegaraga yaqin. Bu odam bazada bo'lsa — yana surat qo'shing.")
            print("    Bazada BO'LMASA — hammasi to'g'ri, begona odam tanilmasligi kerak.")

    # Chegarani pasaytirish tavsiyasini FAQAT xavfsiz bo'lsa beramiz
    if scores_ok and scores_no:
        gap = min(scores_ok) - max(scores_no)
        print(f"\nAjratish oralig'i: {gap:+.3f}")
        if gap <= 0:
            print("  ! XAVFLI: tanilgan va tanilmagan qiymatlar ARALASHIB ketgan.")
            print("    Bu chegara bilan noto'g'ri odam 'keldi' deb yozilishi mumkin.")
            print("    Suratlar sifatini oshiring (aniq, to'g'ri qaragan yuz).")
        elif gap < 0.08:
            print("  Oraliq tor — suratlar sifatini oshirish tavsiya etiladi.")
        else:
            print("  Oraliq yaxshi — chegara ishonchli.")


if __name__ == "__main__":
    main()
