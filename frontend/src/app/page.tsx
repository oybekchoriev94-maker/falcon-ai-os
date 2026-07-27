"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-store";
import { api } from "@/lib/api-client";

const SETUP_ROLES = ["ceo", "admin", "superadmin"];

export default function Home() {
  const { isAuthenticated, user } = useAuth();
  const router = useRouter();

  useEffect(() => {
    let cancelled = false;

    if (!isAuthenticated) {
      router.replace("/login");
      return;
    }
    if (user?.role === "doctor") {
      router.replace("/doctor");
      return;
    }

    // Klinika rahbari/admini: sozlash tugamagan bo'lsa avval sehrgarga yuboramiz.
    // Aks holda yangi klinika bo'sh dashboard'ga tushib, shifokor qo'shish
    // yo'lini topolmaydi.
    if (user && SETUP_ROLES.includes(user.role)) {
      api
        .get<{ onboarding?: { ready?: boolean } }>("/api/v1/tenants/me")
        .then((res) => {
          if (cancelled) return;
          const ready = res?.success === false || res?.onboarding?.ready !== false;
          router.replace(ready ? "/dashboard" : "/onboarding");
        })
        .catch(() => {
          if (!cancelled) router.replace("/dashboard");
        });
      return () => { cancelled = true; };
    }

    router.replace("/dashboard");
  }, [isAuthenticated, user, router]);

  return (
    <div className="flex min-h-screen items-center justify-center">
      <div className="size-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
    </div>
  );
}
