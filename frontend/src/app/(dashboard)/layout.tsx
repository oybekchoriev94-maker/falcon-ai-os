"use client";

import { useAuth } from "@/lib/auth-store";
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
  { href: "/patients", label: "Bemorlar", icon: Users, roles: ["superadmin", "ceo", "admin", "doctor", "receptionist"] },
  { href: "/reception", label: "Navbat", icon: ClipboardList, roles: ["superadmin", "ceo", "admin", "receptionist"] },
  { href: "/reception-voice", label: "Ovozli qabul", icon: Mic, roles: ["superadmin", "ceo", "admin", "receptionist"] },
  { href: "/wards", label: "Palatalar", icon: Building2, roles: ["superadmin", "ceo", "admin", "doctor"] },
  { href: "/inventory", label: "Ombor", icon: Package, roles: ["superadmin", "ceo", "admin"] },
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
            <div className="flex size-8 items-center justify-center rounded-lg bg-gradient-to-br from-primary to-primary/70 text-primary-foreground shadow-sm">
              <HeartPulse className="size-4" />
            </div>
            {!collapsed && (
              <span className="font-semibold text-sm tracking-tight">Falcon AI OS</span>
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
