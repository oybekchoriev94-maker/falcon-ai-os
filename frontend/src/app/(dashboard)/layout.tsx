"use client";

import { useAuth } from "@/lib/auth-store";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api-client";
import { useRouter, usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useTheme } from "next-themes";
import {
  LayoutDashboard,
  Users,
  ClipboardList,
  Building2,
  Package,
  CreditCard,
  Mic,
  Shield,
  Camera,
  Share2,
  LogOut,
  Menu,
  ChevronLeft,
  Sun,
  Moon,
  HeartPulse,
  Sliders,
  Bell,
  Monitor,
  UserCheck,
  FileText,
  ScanFace,
  ListChecks,
  Boxes,
  Activity,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { motion, AnimatePresence } from "framer-motion";

const navItems = [
  { href: "/doctor", label: "Shifokor paneli", icon: HeartPulse, roles: ["doctor"] },
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard, roles: ["superadmin", "ceo", "admin", "receptionist"] },
  // Klinika sozlamalari — shifokor, ish jadvali, xizmat/narx, xodim va bemor
  // havolasi shu yerda. Doimiy ochiq bo'lishi kerak: ro'yxatdan o'tgandan keyin
  // qayta kirgan rahbar shifokor qo'sha olmay qolmasin.
  { href: "/onboarding", label: "Klinika sozlamalari", icon: Sliders, roles: ["superadmin", "ceo", "admin"] },
  { href: "/klinikalar", label: "Klinikalar", icon: Building2, roles: ["superadmin", "ceo", "admin"] },
  { href: "/patients", label: "Bemorlar", icon: Users, roles: ["superadmin", "ceo", "admin", "doctor", "receptionist"] },
  { href: "/medplum", label: "Medplum sinxronizatsiya", icon: Activity, roles: ["superadmin", "ceo", "admin"] },
  { href: "/reception", label: "Navbat", icon: ClipboardList, roles: ["superadmin", "ceo", "admin", "receptionist"] },
  { href: "/reception-voice", label: "Ovozli qabul", icon: Mic, roles: ["superadmin", "ceo", "admin", "receptionist"] },
  { href: "/wards", label: "Palatalar", icon: Building2, roles: ["superadmin", "ceo", "admin", "doctor"] },
  { href: "/lab", label: "Laboratoriya", icon: Building2, roles: ["superadmin", "ceo", "admin", "doctor", "receptionist"] },
  { href: "/alerts", label: "Xavfsizlik", icon: Bell, roles: ["superadmin", "ceo", "admin", "doctor"] },
  { href: "/attendance", label: "Davomat", icon: UserCheck, roles: ["superadmin", "ceo", "admin"] },
  { href: "/xodim-nazorati", label: "Xodim nazorati", icon: ScanFace, roles: ["superadmin", "ceo", "admin"] },
  { href: "/xodim-reestri", label: "Xodim reestri", icon: Users, roles: ["superadmin", "ceo", "admin"] },
  { href: "/vazifalar", label: "Vazifalar", icon: ListChecks, roles: ["superadmin", "ceo", "admin"] },
  { href: "/hujjatlar", label: "Hujjatlar", icon: FileText, roles: ["superadmin", "ceo", "admin", "doctor", "receptionist"] },
  { href: "/kiosk-devices", label: "Kiosk qurilmalari", icon: Monitor, roles: ["superadmin", "ceo", "admin"] },
  { href: "/insights", label: "Biznes tahlili", icon: LayoutDashboard, roles: ["superadmin", "ceo", "admin"] },
  { href: "/inventory", label: "Ombor", icon: Package, roles: ["superadmin", "ceo", "admin"] },
  { href: "/erp-sinxronizatsiya", label: "ERPNext sinxronizatsiya", icon: Boxes, roles: ["superadmin", "ceo", "admin"] },
  { href: "/billing", label: "To'lovlar", icon: CreditCard, roles: ["superadmin", "ceo", "admin"] },
  { href: "/scribe", label: "AI Scribe", icon: Mic, roles: ["superadmin", "ceo", "admin", "doctor", "receptionist"] },
  { href: "/b2b", label: "B2B Referal", icon: Share2, roles: ["superadmin", "ceo", "admin"] },
  { href: "/admin", label: "Admin", icon: Shield, roles: ["superadmin"] },
];

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, user, logout } = useAuth();
  const { theme, setTheme } = useTheme();
  const router = useRouter();
  const pathname = usePathname();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => { setMounted(true); }, []);

  // Token muddati tugaganda (/auth/refresh ham muvaffaqiyatsiz) — session
  // tugatib login'ga qaytish. api-client bu eventni dispatch qiladi.
  useEffect(() => {
    if (!isAuthenticated) return;
    const onExpired = () => {
      logout();
      router.replace("/login");
    };
    window.addEventListener("auth:expired", onExpired);
    return () => window.removeEventListener("auth:expired", onExpired);
  }, [isAuthenticated, logout, router]);

  // Klinika nomi va logotipi — qaysi klinikada ekanini bir qarashda bilish uchun
  const { data: clinic } = useQuery({
    queryKey: ["tenant-me"],
    enabled: isAuthenticated,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const res = await api.get<{ tenant: { name: string; logo_url?: string | null } }>("/api/v1/tenants/me");
      if (res.success) return res;
      throw new Error(res.error);
    },
  });
  const clinicName = clinic?.tenant?.name || "Falcon AI OS";
  const clinicLogo = clinic?.tenant?.logo_url
    ? `${process.env.NEXT_PUBLIC_API_URL || ""}${clinic.tenant.logo_url}`
    : null;

  // MUHIM: redirect faqat mount'dan keyin (zustand persist localStorage'dan
  // rehydratsiya qilib bo'lgach). Aks holda sahifani yangilaganda yoki bookmark'dan
  // ochganda autentifikatsiyalangan foydalanuvchi ham /login'ga uloqtiriladi
  // (rehydratsiyagacha isAuthenticated=false bo'ladi).
  useEffect(() => {
    if (mounted && !isAuthenticated) {
      router.replace("/login");
    }
  }, [mounted, isAuthenticated, router]);

  if (!mounted || !isAuthenticated || !user) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="size-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  const visibleItems = navItems.filter((item) => item.roles.includes(user.role));

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <AnimatePresence mode="wait">
        {sidebarOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-40 bg-black/50 md:hidden"
            onClick={() => setSidebarOpen(false)}
          />
        )}
      </AnimatePresence>

      <aside
        className={cn(
          "fixed md:static inset-y-0 left-0 z-50 flex flex-col border-r border-border bg-sidebar transition-all duration-300",
          collapsed ? "w-16" : "w-64",
          sidebarOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0"
        )}
      >
        <div className="flex h-14 items-center gap-3 border-b border-border px-4">
          <div className={cn("flex items-center gap-3", collapsed && "justify-center w-full")}>
            <div className="flex size-8 flex-none items-center justify-center overflow-hidden rounded-lg bg-gradient-to-br from-primary to-primary/70 text-primary-foreground shadow-sm">
              {clinicLogo
                ? <img src={clinicLogo} alt="" className="size-full object-contain" />
                : <HeartPulse className="size-4" />}
            </div>
            {!collapsed && (
              <span className="min-w-0">
                <span className="block truncate text-sm font-semibold leading-tight tracking-tight">{clinicName}</span>
                <span className="block text-[10px] leading-tight text-muted-foreground">Falcon AI OS</span>
              </span>
            )}
          </div>
          <Button
            variant="ghost"
            size="icon-xs"
            className="md:flex hidden ml-auto"
            onClick={() => setCollapsed(!collapsed)}
          >
            <ChevronLeft className={cn("size-4 transition-transform", collapsed && "rotate-180")} />
          </Button>
        </div>

        <ScrollArea className="flex-1 py-2">
          <nav className="flex flex-col gap-0.5 px-2">
            {visibleItems.map((item) => {
              const isActive = pathname === item.href || (item.href !== "/" && pathname.startsWith(item.href));
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setSidebarOpen(false)}
                  className={cn(
                    "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-all duration-200",
                    isActive
                      ? "bg-primary/10 text-primary shadow-sm"
                      : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
                    collapsed && "justify-center px-2"
                  )}
                >
                  <item.icon className="size-4 shrink-0" />
                  {!collapsed && <span>{item.label}</span>}
                </Link>
              );
            })}
          </nav>
        </ScrollArea>

        <div className="border-t border-border p-3">
          <div className={cn("flex items-center gap-3", collapsed && "justify-center")}>
            <DropdownMenu>
              <DropdownMenuTrigger className={cn("flex items-center gap-3 h-auto w-full rounded-lg p-2 text-left hover:bg-accent transition-colors cursor-pointer", collapsed && "justify-center p-1")}>
                <Avatar className="size-8 shrink-0">
                  <AvatarFallback className="bg-primary/10 text-primary text-xs">
                    {(user.full_name || user.username).slice(0, 2).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                {!collapsed && (
                  <div className="text-left min-w-0">
                    <p className="text-sm font-medium leading-tight truncate">{user.full_name || user.username}</p>
                    <p className="text-xs text-muted-foreground capitalize truncate">{user.role}</p>
                  </div>
                )}
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel>{user.full_name || user.username}</DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={logout} className="text-destructive">
                  <LogOut className="size-4 mr-2" />
                  Chiqish
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </aside>

      <div className="flex flex-1 flex-col min-w-0">
        <header className="flex h-14 items-center gap-4 border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 px-4 md:px-6">
          <Button variant="ghost" size="icon" className="md:hidden" onClick={() => setSidebarOpen(true)}>
            <Menu className="size-5" />
          </Button>
          <div className="flex-1" />
          <AlertsBell />
          {mounted && (
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
              className="text-muted-foreground hover:text-foreground"
            >
              <Sun className="size-4 rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" />
              <Moon className="absolute size-4 rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" />
            </Button>
          )}
        </header>

        <main className="flex-1 overflow-auto p-4 md:p-6">
          {children}
        </main>
      </div>
    </div>
  );
}

// Xavfsizlik qo'ng'irog'i — yechilmagan kritik/warning alertlar sonini ko'rsatadi.
// Har 20 sekundda yangilanadi. Bosilganda /alerts sahifasiga o'tadi.
function AlertsBell() {
  const { data } = useQuery({
    queryKey: ["alerts-badge"],
    queryFn: async () => {
      const res = await api.get<{ counts: { critical: number; warning: number; total: number } }>("/api/alerts?status=unresolved&limit=1");
      return res.success ? res.counts : { critical: 0, warning: 0, total: 0 };
    },
    refetchInterval: 20_000,
    staleTime: 15_000,
  });
  const counts = data || { critical: 0, warning: 0, total: 0 };
  const hasCritical = counts.critical > 0;
  const total = counts.total || 0;
  return (
    <Link href="/alerts" className="relative inline-flex size-9 items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-accent">
      <Bell className="size-4" />
      {total > 0 && (
        <span className={cn(
          "absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] rounded-full text-[10px] font-bold text-white flex items-center justify-center px-1",
          hasCritical ? "bg-rose-500 animate-pulse" : "bg-amber-500"
        )}>
          {total > 99 ? "99+" : total}
        </span>
      )}
    </Link>
  );
}
