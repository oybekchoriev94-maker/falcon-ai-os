"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { motion } from "framer-motion";
import { toast } from "sonner";
import { HeartPulse, Eye, EyeOff, Loader2, Check } from "lucide-react";
import { api } from "@/lib/api-client";
import { useAuth } from "@/lib/auth-store";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface RegisterResponse {
  tenant: { id: string; code: string; name: string };
  user: { id: string; email: string; role: string; name: string };
  token: string;
  trial_days: number;
}

/** Parol talablari — backend bilan bir xil (8+, katta, kichik, raqam) */
function passwordChecks(p: string) {
  return [
    { label: "Kamida 8 belgi", ok: p.length >= 8 },
    { label: "Katta harf", ok: /[A-Z]/.test(p) },
    { label: "Kichik harf", ok: /[a-z]/.test(p) },
    { label: "Raqam", ok: /\d/.test(p) },
  ];
}

export default function SignupPage() {
  const [clinic, setClinic] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [city, setCity] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [mounted, setMounted] = useState(false);

  const { login } = useAuth();
  const router = useRouter();
  useEffect(() => { setMounted(true); }, []);

  const checks = passwordChecks(password);
  const passwordOk = checks.every((c) => c.ok);
  const canSubmit = clinic.trim() && name.trim() && email.trim() && passwordOk && !loading;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setLoading(true);
    try {
      const res = await api.post<RegisterResponse>("/api/v1/tenants/register", {
        clinic_name: clinic.trim(),
        name: name.trim(),
        email: email.trim().toLowerCase(),
        phone: phone.trim() || undefined,
        city: city.trim() || undefined,
        password,
      });
      if (!res.success) throw new Error(res.error || "Ro'yxatdan o'tishda xatolik");

      // Tenant ham saqlanadi — barcha so'rovlar shu klinikaga tegishli bo'ladi
      login(res.token, {
        id: res.user.id as unknown as number,
        username: res.user.email,
        role: res.user.role,
        full_name: res.user.name,
      }, res.tenant.id);

      toast.success(`${res.tenant.name} ro'yxatdan o'tdi`, {
        description: `${res.trial_days} kunlik bepul sinov boshlandi`,
      });
      router.push("/onboarding");
    } catch (err) {
      toast.error("Ro'yxatdan o'tib bo'lmadi", { description: (err as Error).message });
    } finally {
      setLoading(false);
    }
  }

  if (!mounted) return null;

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-background p-4">
      <div className="absolute inset-0 bg-grid opacity-[0.03] dark:opacity-[0.06]" />
      <div className="absolute inset-0 bg-gradient-to-b from-primary/8 via-transparent to-primary/5" />
      <div className="absolute left-0 right-0 top-0 h-1 bg-gradient-to-r from-transparent via-primary to-transparent" />

      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.5, ease: "easeOut" }}
        className="relative w-full max-w-md"
      >
        <Card className="border-border/40 bg-card/95 shadow-2xl shadow-primary/5 backdrop-blur-sm">
          <CardHeader className="pb-5 pt-8 text-center">
            <motion.div
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={{ delay: 0.15, type: "spring", stiffness: 200 }}
              className="mx-auto mb-5 flex size-16 items-center justify-center rounded-2xl bg-gradient-to-br from-primary to-primary/70 text-primary-foreground shadow-lg shadow-primary/20"
            >
              <HeartPulse className="size-8" />
            </motion.div>
            <CardTitle className="text-2xl font-bold tracking-tight">Klinikangizni ulang</CardTitle>
            <p className="mt-1.5 text-sm text-muted-foreground">
              14 kunlik bepul sinov · karta talab qilinmaydi
            </p>
          </CardHeader>

          <CardContent className="pb-8">
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="clinic">Klinika nomi *</Label>
                <Input id="clinic" placeholder="Shifo Med" value={clinic}
                  onChange={(e) => setClinic(e.target.value)} autoFocus className="h-10" />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label htmlFor="name">Rahbar ismi *</Label>
                  <Input id="name" placeholder="Aziz Karimov" value={name}
                    onChange={(e) => setName(e.target.value)} className="h-10" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="city">Shahar</Label>
                  <Input id="city" placeholder="Toshkent" value={city}
                    onChange={(e) => setCity(e.target.value)} className="h-10" />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="email">Email *</Label>
                <Input id="email" type="email" placeholder="rahbar@klinika.uz" value={email}
                  onChange={(e) => setEmail(e.target.value)} autoComplete="email" className="h-10" />
                <p className="text-xs text-muted-foreground">Bu email bilan tizimga kirasiz</p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="phone">Telefon</Label>
                <Input id="phone" placeholder="+998 90 123 45 67" value={phone}
                  onChange={(e) => setPhone(e.target.value)} className="h-10" />
              </div>

              <div className="space-y-2">
                <Label htmlFor="password">Parol *</Label>
                <div className="relative">
                  <Input id="password" type={showPassword ? "text" : "password"} placeholder="••••••••"
                    value={password} onChange={(e) => setPassword(e.target.value)}
                    autoComplete="new-password" className="h-10 pr-10" />
                  <Button type="button" variant="ghost" size="icon-sm" tabIndex={-1}
                    className="absolute right-1.5 top-1/2 -translate-y-1/2 text-muted-foreground"
                    onClick={() => setShowPassword(!showPassword)}>
                    {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                  </Button>
                </div>
                {password.length > 0 && (
                  <div className="grid grid-cols-2 gap-1.5 pt-1">
                    {checks.map((c) => (
                      <span key={c.label}
                        className={`flex items-center gap-1.5 text-xs ${c.ok ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground"}`}>
                        <Check className={`size-3 ${c.ok ? "opacity-100" : "opacity-30"}`} />
                        {c.label}
                      </span>
                    ))}
                  </div>
                )}
              </div>

              <Button type="submit" className="h-10 w-full text-base" disabled={!canSubmit}>
                {loading && <Loader2 className="mr-2 size-4 animate-spin" />}
                {loading ? "Yaratilmoqda..." : "Bepul boshlash"}
              </Button>
            </form>

            <p className="mt-5 text-center text-sm text-muted-foreground">
              Hisobingiz bormi?{" "}
              <Link href="/login" className="font-medium text-primary hover:underline">Kirish</Link>
            </p>
          </CardContent>
        </Card>
      </motion.div>
    </div>
  );
}
