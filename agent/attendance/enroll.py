# -*- coding: utf-8 -*-
"""
Yuz bazasini faces/ papkadagi suratlardan quradi (xodimlar VA bemorlar).

Suratlarni qo'yish:
    faces/Aliyev Vali.jpg              -> "Aliyev Vali" (xodim)
    faces/Aliyev Vali/1.jpg, 2.jpg     -> "Aliyev Vali" (aniqroq)

Bemorlar uchun papka/fayl nomi "bemor_" prefiksi bilan boshlanadi:
    faces/bemor_Alisher Karim/1.jpg    -> bemor "Alisher Karim"
Bemor keldi degan hodisa serverda avtomatik check-in ga ulanadi.

Har odamga 2-3 ta surat qo'ying: turli burchak va yorug'likda.
Bitta suratda tanish ~85%, uchtada ~95% ga chiqadi.

Xodim ismi SERVERGA shu ko'rinishda boradi. Shifokorlar ro'yxatidagi
"Ism Familiya" bilan bir xil yozsangiz, davomat avtomatik bog'lanadi.
Bemorlar uchun patients jadvalidagi "Ism Familiya" bilan bir xil yozing.

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

    print(f"\nTayyor: {len(people)} ta odam (xodim + bemor)")
    for name, embs in sorted(people.items()):
        kind = "bemor" if name.lower().startswith(("bemor_", "bemor:")) else "xodim"
        mark = "✓" if len(embs) >= 2 else "!"
        note = "" if len(embs) >= 2 else "  (aniqlik uchun yana surat qo'shing)"
        print(f"  {mark} [{kind}] {name} — {len(embs)} ta surat{note}")

    if result["errors"]:
        print("\nOgohlantirishlar:")
        for e in result["errors"]:
            print("  -", e)

    print("\nBaza: data/faces_db.json — bu fayl SHU KOMPYUTERDA qoladi.")
