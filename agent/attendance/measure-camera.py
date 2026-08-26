# -*- coding: utf-8 -*-
"""
KAMERA O'LCHOVI — yuz necha piksel chiqishini tekshiradi.

Nima uchun: yuz tanish yuz ~80px+ bo'lganda ishonchli. Shift kamerasida
odamlar uzoq bo'lgani uchun yuz 20-30px chiqadi va tizim ishlamaydi.
Kamera sotib olish yoki o'rnatishdan OLDIN shuni bilish kerak.

Ishlatish:
    # USB web-kamera (Rapoo)
    python measure-camera.py --device 0

    # NVR kanali (Hikvision)
    python measure-camera.py --nvr 192.168.100.188 --user admin --channel 12

Odam kamera oldida turgan holda ishga tushiring. 10 soniya o'lchaydi.
"""
import argparse
import getpass
import os
import statistics
import sys
import time

import cv2
import numpy as np

import faces as faces_mod

MIN_RELIABLE = 80          # shu qiymatdan past — ishonchsiz
COMFORTABLE = 110          # bundan yuqori — bemalol


def grab_nvr(ip, user, password, channel, width, height):
    import requests
    from requests.auth import HTTPDigestAuth
    ch = channel * 100 + 2                     # substream
    url = (f"http://{ip}/ISAPI/Streaming/channels/{ch}/picture"
           f"?videoResolutionWidth={width}&videoResolutionHeight={height}")
    r = requests.get(url, auth=HTTPDigestAuth(user, password), timeout=8, verify=False)
    if r.status_code != 200 or not r.content:
        return None
    return cv2.imdecode(np.frombuffer(r.content, np.uint8), cv2.IMREAD_COLOR)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--device", type=int, help="USB kamera indeksi (0, 1, ...)")
    ap.add_argument("--nvr", help="NVR IP manzili")
    ap.add_argument("--user", default="admin")
    ap.add_argument("--channel", type=int, default=1)
    ap.add_argument("--width", type=int, default=1920)
    ap.add_argument("--height", type=int, default=1080)
    ap.add_argument("--seconds", type=int, default=10)
    ap.add_argument("--show", action="store_true", help="oynada ko'rsatish")
    args = ap.parse_args()

    if args.device is None and not args.nvr:
        ap.error("--device yoki --nvr kerak")

    password = None
    cap = None
    if args.nvr:
        import urllib3
        urllib3.disable_warnings()
        password = getpass.getpass(f"{args.user}@{args.nvr} paroli: ")
    else:
        # Ba'zi kameralar (masalan Rapoo) DirectShow ostida qora kadr
        # qaytaradi, lekin Media Foundation (Windows Camera ilovasi
        # ishlatadigan) bilan yaxshi ishlaydi. Shuning uchun bir nechta
        # backend sinaladi — birinchi QORA BO'LMAGAN kadr beruvchisi olinadi.
        if sys.platform.startswith("win"):
            candidates = [("DSHOW", cv2.CAP_DSHOW), ("MSMF", cv2.CAP_MSMF), ("AUTO", cv2.CAP_ANY)]
        else:
            candidates = [("V4L2", cv2.CAP_V4L2), ("AUTO", cv2.CAP_ANY)]

        tried = []
        for name, backend in candidates:
            c = cv2.VideoCapture(args.device, backend)
            if not c.isOpened():
                c.release()
                tried.append(f"{name}(ochilmadi)")
                continue
            c.set(cv2.CAP_PROP_FRAME_WIDTH, args.width)
            c.set(cv2.CAP_PROP_FRAME_HEIGHT, args.height)
            for _ in range(5):
                c.grab()
            ok, probe = c.read()
            if ok and probe is not None and float(probe.mean()) >= 3.0:
                cap = c
                print(f"Kamera {args.device}: {name} backend orqali ochildi")
                break
            tried.append(f"{name}(qora kadr)")
            c.release()

        if cap is None:
            raise SystemExit(
                f"Kamera {args.device} hech qanday backend bilan ishlamadi "
                f"(sinaldi: {', '.join(tried) or '-'})"
            )
        print(f"Kamera: {int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))}x"
              f"{int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))}")

    engine = faces_mod.FaceEngine(score_thresh=0.6)
    print(f"\n{args.seconds} soniya o'lchanmoqda — kamera oldida turing...\n")

    sizes = []
    frames = 0
    with_face = 0
    last_frame = None
    brightness = []
    deadline = time.time() + args.seconds

    while time.time() < deadline:
        if cap is not None:
            for _ in range(2):
                cap.grab()
            ok, frame = cap.retrieve()
            frame = frame if ok else None
        else:
            frame = grab_nvr(args.nvr, args.user, password, args.channel,
                             args.width, args.height)

        if frame is None:
            time.sleep(0.3)
            continue

        frames += 1
        last_frame = frame.copy()
        # O'rtacha yorqinlik — kamera qopqog'i yopiq bo'lsa ~0 chiqadi
        brightness.append(float(frame.mean()))
        detected = engine.detect(frame)
        if len(detected):
            with_face += 1
            biggest = max(detected, key=lambda f: f[2])
            w = float(biggest[2])
            sizes.append(w)
            if args.show:
                x, y = int(biggest[0]), int(biggest[1])
                h_ = int(biggest[3])
                col = (80, 220, 100) if w >= MIN_RELIABLE else (80, 80, 220)
                cv2.rectangle(frame, (x, y), (x + int(w), y + h_), col, 2)
                cv2.putText(frame, f"{int(w)}px", (x, max(18, y - 8)),
                            cv2.FONT_HERSHEY_SIMPLEX, 0.8, col, 2)

        if args.show:
            cv2.imshow("O'lchov (chiqish: q)", frame)
            if cv2.waitKey(1) & 0xFF == ord("q"):
                break
        time.sleep(0.1)

    if cap is not None:
        cap.release()
    if args.show:
        cv2.destroyAllWindows()

    # ── Natija ──
    print("=" * 52)
    print(f"Kadrlar: {frames}   Yuz topilgan: {with_face}")

    # Kamera nima ko'rganini FAYLGA saqlaymiz — muammoni ko'z bilan
    # ko'rish eng ishonchli usul (qopqoq yopiqmi, qorong'imi, boshqa
    # kamerami — hammasi rasmdan bilinadi).
    saved = None
    if last_frame is not None:
        saved = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                             "data", "camera-test.jpg")
        os.makedirs(os.path.dirname(saved), exist_ok=True)
        cv2.imwrite(saved, last_frame)

    if brightness:
        avg_b = sum(brightness) / len(brightness)
        print(f"O'rtacha yorqinlik: {avg_b:.0f} / 255")
        if avg_b < 10:
            print("  -> Rasm deyarli QORA. Kamera qopqog'i yopiq yoki")
            print("     boshqa dastur (Teams, Zoom) kamerani band qilgan.")
        elif avg_b < 40:
            print("  -> Juda qorong'i. Yorug'lik qo'shing.")

    if saved:
        print(f"\nKamera ko'rgan rasm saqlandi:\n  {saved}")
        print("Shu faylni oching — o'zingizni ko'ryapsizmi?")

    if not sizes:
        print("\nYUZ TOPILMADI.")
        print("Rasmni ochib ko'ring:")
        print("  - qora bo'lsa      -> kamera qopqog'i / boshqa dastur band qilgan")
        print("  - o'zingiz yo'q    -> kamera boshqa tomonga qaragan")
        print("  - o'zingiz bor     -> yuz juda kichik yoki qorong'i, yaqinroq keling")
        print("  - boshqa manzara   -> boshqa kamera indeksi: --device 1")
        return

    avg = statistics.mean(sizes)
    med = statistics.median(sizes)
    mn, mx = min(sizes), max(sizes)
    print(f"\nYuz kengligi (piksel):")
    print(f"  o'rtacha {avg:.0f}   mediana {med:.0f}   eng kichik {mn:.0f}   eng katta {mx:.0f}")

    print()
    if med >= COMFORTABLE:
        print(f"XULOSA: YAXSHI ({med:.0f}px). Bu kamera davomat uchun to'liq mos.")
    elif med >= MIN_RELIABLE:
        print(f"XULOSA: YETARLI ({med:.0f}px), lekin zaxira kam.")
        print("Kamerani biroz yaqinroq qo'ysangiz ishonchliroq bo'ladi.")
    else:
        print(f"XULOSA: KAM ({med:.0f}px). Kerak: {MIN_RELIABLE}px+")
        print("Yechimlar:")
        print("  - kamerani odamga yaqinroq (1-2 m) va bo'y balandligiga qo'ying")
        print("  - yuqori ruxsatli kamera (1080p+) ishlating")
        print("  - NVR bo'lsa asosiy oqimga (substream emas) o'ting")

    if with_face < frames * 0.5:
        print("\nESLATMA: yuz kadrlarning yarmidan kamida topildi.")
        print("Yorug'likni tekshiring — qarama-qarshi yorug'lik (deraza, shisha eshik)")
        print("yuzni qorong'i qiladi. Yorug'lik kamera ORQASIDAN tushishi kerak.")


if __name__ == "__main__":
    main()
