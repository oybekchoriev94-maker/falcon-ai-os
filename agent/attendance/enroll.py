# -*- coding: utf-8 -*-
"""
Xodimlar bazasini faces/ papkadagi suratlardan quradi.

Suratlarni qo'yish:
    faces/Aliyev Vali.jpg              -> "Aliyev Vali"
    faces/Aliyev Vali/1.jpg, 2.jpg     -> "Aliyev Vali" (aniqroq)

Har xodimga 2-3 ta surat qo'ying: turli burchak va yorug'likda.
Bitta suratda tanish ~85%, uchtada ~95% ga chiqadi.

Ism SERVERGA shu ko'rinishda boradi. Shifokorlar ro'yxatidagi
"Ism Familiya" bilan bir xil yozsangiz, davomat avtomatik bog'lanadi.

Ishga tushirish:
    python enroll.py
"""
import sys

from faces import FaceEngine, build_db, FACES_DIR


if __name__ == "__main__":
    print(f"Suratlar papkasi: {FACES_DIR}")
    print("Baza qurilmoqda...\n")

    engine = FaceEngine()
    result = build_db(engine)

    people = result["people"]
    if not people:
        print("\nHech kim qo'shilmadi.")
        print("faces/ papkasiga surat soling, masalan: faces/Aliyev Vali.jpg")
        sys.exit(1)

    print(f"\nTayyor: {len(people)} ta xodim")
    for name, embs in sorted(people.items()):
        mark = "✓" if len(embs) >= 2 else "!"
        note = "" if len(embs) >= 2 else "  (aniqlik uchun yana surat qo'shing)"
        print(f"  {mark} {name} — {len(embs)} ta surat{note}")

    if result["errors"]:
        print("\nOgohlantirishlar:")
        for e in result["errors"]:
            print("  -", e)

    print("\nBaza: data/faces_db.json — bu fayl SHU KOMPYUTERDA qoladi.")
