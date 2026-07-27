"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/lib/auth-store";
import { api } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Eye, EyeOff, Loader2, HeartPulse, Sparkles, Syringe, Stethoscope, Activity } from "lucide-react";
import { motion } from "framer-motion";

const icons = [HeartPulse, Syringe, Stethoscope, Activity, Sparkles];

function FloatingIcon({ Icon, index }: { Icon: typeof HeartPulse; index: number }) {
  return (
    <motion.div
      className="absolute text-primary/5"
      initial={{
        x: Math.random() * 100,
        y: -50,
        opacity: 0,
        rotate: 0,
      }}
      animate={{
        x: Math.random() * 100 + "%",
        y: "100vh",
        opacity: [0, 0.8, 0],
        rotate: 360,
      }}
      transition={{
        duration: 15 + Math.random() * 20,
        repeat: Infinity,
        delay: index * 3,
        ease: "linear",
      }}
    >
      <Icon className="size-16 md:size-24" />
    </motion.div>
  );
}

export default function LoginPage() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [mounted, setMounted] = useState(false);
  const { login } = useAuth();
  const router = useRouter();

  useEffect(() => { setMounted(true); }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim() || !password.trim()) {
      return;
    }
    setLoading(true);
    try {
      const res = await api.post<{ token: string; user: { id: number; username: string; role: string; specialization?: string; full_name?: string } }>(
        "/api/auth/login",
        { username, password }
      );
      if (res.success && res.token && res.user) {
        login(res.token, res.user);
        router.push("/");
      }
    } catch {
      // handled by api-client
    } finally {
      setLoading(false);
    }
  };

  if (!mounted) return null;

  return (
    <div className="relative min-h-screen flex items-center justify-center p-4 overflow-hidden bg-background">
      <div className="absolute inset-0 bg-grid opacity-[0.03] dark:opacity-[0.06]" />

      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        {icons.map((Icon, i) => (
          <FloatingIcon key={i} Icon={Icon} index={i} />
        ))}
      </div>

      <div className="absolute inset-0 bg-gradient-to-b from-primary/8 via-transparent to-primary/5" />

      <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-transparent via-primary to-transparent" />

      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.6, ease: "easeOut" }}
        className="relative w-full max-w-sm"
      >
        <Card className="border-border/40 shadow-2xl shadow-primary/5 backdrop-blur-sm bg-card/95">
          <CardHeader className="text-center pb-6 pt-8">
            <motion.div
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={{ delay: 0.2, type: "spring", stiffness: 200 }}
              className="mx-auto mb-5 flex size-16 items-center justify-center rounded-2xl bg-gradient-to-br from-primary to-primary/70 text-primary-foreground shadow-lg shadow-primary/20"
            >
              <HeartPulse className="size-8" />
            </motion.div>
            <CardTitle className="text-2xl font-bold tracking-tight">
              Falcon AI OS
            </CardTitle>
            <p className="text-sm text-muted-foreground mt-1.5">
              Klinika boshqaruv tizimiga kirish
            </p>
          </CardHeader>
          <CardContent className="pb-8">
            <form onSubmit={handleSubmit} className="space-y-5">
              <div className="space-y-2">
                <Label htmlFor="username" className="text-sm font-medium">
                  Foydalanuvchi nomi
                </Label>
                <Input
                  id="username"
                  placeholder="ceo, admin, doctor..."
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  autoComplete="username"
                  autoFocus
                  className="h-10"
                />
              </div>
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label htmlFor="password" className="text-sm font-medium">
                    Parol
                  </Label>
                </div>
                <div className="relative">
                  <Input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    placeholder="••••••••"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    autoComplete="current-password"
                    className="pr-10 h-10"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    className="absolute right-1.5 top-1/2 -translate-y-1/2 text-muted-foreground"
                    onClick={() => setShowPassword(!showPassword)}
                    tabIndex={-1}
                  >
                    {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                  </Button>
                </div>
              </div>
              <Button type="submit" className="w-full h-10 text-base" disabled={loading}>
                {loading && <Loader2 className="size-4 mr-2 animate-spin" />}
                {loading ? "Kirish..." : "Kirish"}
              </Button>
            </form>

            <div className="relative my-6">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-border/40" />
              </div>
              <div className="relative flex justify-center text-xs">
                <span className="bg-card px-3 text-muted-foreground/60">
                  <Sparkles className="size-3 inline mr-1" />
                  AI yordamida klinika boshqaruvi
                </span>
              </div>
            </div>

            <p className="text-center text-sm text-muted-foreground">
              Klinikangiz hali ulanmaganmi?{" "}
              <Link href="/signup" className="font-medium text-primary hover:underline">
                Bepul boshlash
              </Link>
            </p>

            <p className="mt-4 text-center text-xs text-muted-foreground/50">
              Falcon AI OS v2.0
            </p>
          </CardContent>
        </Card>
      </motion.div>
    </div>
  );
}
