"use client";

// Qurilma tokeni holatini boshqaradi: token yo'q/yaroqsiz bo'lsa "unpaired",
// tekshirilayotganda "checking", ishlaydigan bo'lsa "paired" + klinika config'i.
import { useCallback, useEffect, useState } from "react";
import {
  kioskApi,
  getKioskToken,
  setKioskToken,
  clearKioskToken,
  KioskAuthError,
  type KioskConfig,
} from "@/lib/kiosk-client";

type Status = "checking" | "unpaired" | "paired";

export function useKioskPairing() {
  const [status, setStatus] = useState<Status>("checking");
  const [config, setConfig] = useState<KioskConfig | null>(null);
  const [pairing, setPairing] = useState(false);
  const [error, setError] = useState("");

  const check = useCallback(async () => {
    if (!getKioskToken()) {
      setStatus("unpaired");
      return;
    }
    setStatus("checking");
    try {
      const res = await kioskApi.get<KioskConfig>("/api/kiosk/config");
      setConfig(res);
      setStatus("paired");
    } catch {
      setStatus("unpaired");
    }
  }, []);

  useEffect(() => {
    check();
  }, [check]);

  const pair = useCallback(async (token: string) => {
    setError("");
    setPairing(true);
    setKioskToken(token.trim());
    try {
      const res = await kioskApi.get<KioskConfig>("/api/kiosk/config");
      setConfig(res);
      setStatus("paired");
      return true;
    } catch (e) {
      clearKioskToken();
      setError(e instanceof KioskAuthError ? "Token yaroqsiz yoki bloklangan" : "Serverga ulanmadi. Internetni tekshiring");
      return false;
    } finally {
      setPairing(false);
    }
  }, []);

  const reset = useCallback(() => {
    clearKioskToken();
    setConfig(null);
    setStatus("unpaired");
  }, []);

  return { status, config, pairing, error, pair, reset };
}
