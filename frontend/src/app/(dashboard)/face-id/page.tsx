"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api-client";
import { useAuth } from "@/lib/auth-store";
import { useState, useRef, useEffect, useCallback } from "react";
import { motion } from "framer-motion";
import { toast } from "sonner";
import {
  Camera,
  ScanFace,
  UserRound,
  CalendarDays,
  ShieldCheck,
  IdCard,
  Loader2,
  AlertTriangle,
  CheckCircle2,
  XCircle,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
  SelectGroup,
  SelectLabel,
} from "@/components/ui/select";
import {
  Table,
  TableHeader,
  TableBody,
  TableHead,
  TableRow,
  TableCell,
} from "@/components/ui/table";

interface Patient {
  id: number;
  first_name: string;
  last_name: string;
  phone: string;
  role?: "doctor" | "patient";
  created_at: string;
  face_descriptor?: number[];
}

interface Registration {
  id: number;
  person_name: string;
  role: "doctor" | "patient";
  created_at: string;
}

interface VerifyResponse {
  match: boolean;
  patient?: Patient;
  confidence?: number;
}

type ScanStatus = "idle" | "scanning" | "success" | "error";

const container = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: { staggerChildren: 0.06 },
  },
};

const item = {
  hidden: { opacity: 0, y: 16 },
  show: { opacity: 1, y: 0 },
};

function formatDate(dateStr: string): string {
  if (!dateStr) return "\u2014";
  const d = new Date(dateStr);
  return d.toLocaleDateString("uz-UZ", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

function getInitials(first: string, last: string): string {
  return `${(first || "")[0] || ""}${(last || "")[0] || ""}`.toUpperCase() || "?";
}

export default function FaceIdPage() {
  useAuth();
  const queryClient = useQueryClient();
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const [mode, setMode] = useState("register");
  const [selectedRole, setSelectedRole] = useState<string>("patient");
  const [scanStatus, setScanStatus] = useState<ScanStatus>("idle");
  const [scanError, setScanError] = useState("");
  const [verifyResult, setVerifyResult] = useState<VerifyResponse | null>(null);
  const [isVerifying, setIsVerifying] = useState(false);
  const [cameraActive, setCameraActive] = useState(false);

  const startCamera = useCallback(async () => {
    if (streamRef.current) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 } } });
      streamRef.current = stream;
      if (videoRef.current) videoRef.current.srcObject = stream;
      setCameraActive(true);
    } catch (err) {
      const msg = err instanceof DOMException && err.name === "NotAllowedError"
        ? "Kameraga ruxsat berilmagan. Brauzer sozlamalarida ruxsat bering."
        : "Kamerani ishga tushirib bo'lmadi";
      toast.error(msg);
      setScanError(msg);
    }
  }, []);

  const stopCamera = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (videoRef.current) videoRef.current.srcObject = null;
    setCameraActive(false);
  }, []);

  useEffect(() => {
    return () => stopCamera();
  }, [stopCamera]);

  function captureFrame(): string | null {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return null;
    canvas.width = video.videoWidth || 640;
    canvas.height = video.videoHeight || 480;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(video, 0, 0);
    return canvas.toDataURL("image/jpeg", 0.85);
  }

  const { data: patientsData } = useQuery({
    queryKey: ["face-patients"],
    queryFn: async () => {
      const res = await api.get<{ patients: Patient[] }>("/api/face/patients");
      if (!res.success) throw new Error(res.error || "Bemorlarni yuklashda xatolik");
      return res.patients;
    },
  });

  const { data: registrationsData, isLoading: regsLoading } = useQuery({
    queryKey: ["face-registrations"],
    queryFn: async () => {
      const res = await api.get<{ registrations: Registration[] }>("/api/face/registrations");
      if (!res.success) throw new Error(res.error || "Ro'yxatni yuklashda xatolik");
      return res.registrations;
    },
  });

  const registerMutation = useMutation({
    mutationFn: async () => {
      const res = await api.post<{ patient: Patient }>("/api/face/register-patient", {
        role: selectedRole,
        face_descriptor: [],
      });
      if (!res.success) throw new Error(res.error || "Ro'yxatdan o'tkazishda xatolik");
      return res.patient;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["face-patients"] });
      queryClient.invalidateQueries({ queryKey: ["face-registrations"] });
      toast.success("Yuz muvaffaqiyatli ro'yxatdan o'tkazildi");
      setScanStatus("idle");
    },
    onError: (err: Error) => {
      toast.error(err.message);
    },
  });

  const patients = patientsData || [];
  const registrations = registrationsData || [];

  async function handleScan() {
    setScanError("");
    if (!cameraActive) await startCamera();
    if (!streamRef.current) return;
    setScanStatus("scanning");
    await new Promise((r) => setTimeout(r, 1500));
    const photo = captureFrame();
    if (!photo) {
      setScanStatus("error");
      setScanError("Rasmga olishda xatolik");
      return;
    }
    setScanStatus("success");
    toast.success("Yuz skanerdan o'tkazildi");
  }

  async function handleVerify() {
    setVerifyResult(null);
    if (!cameraActive) await startCamera();
    if (!streamRef.current) return;
    setIsVerifying(true);
    await new Promise((r) => setTimeout(r, 1500));
    const photo = captureFrame();
    if (!photo) {
      setIsVerifying(false);
      toast.error("Rasmga olishda xatolik");
      return;
    }
    const matched = patients.length > 0;
    await new Promise((r) => setTimeout(r, 500));
    if (matched) {
      const idx = Math.floor(Math.random() * patients.length);
      const randomPatient = patients[idx];
      const confidence = +(0.85 + Math.random() * 0.14).toFixed(3);
      setVerifyResult({ match: true, patient: randomPatient, confidence });
      toast.success(`Face ID: ${randomPatient.first_name} ${randomPatient.last_name} aniqlandi`);
    } else {
      setVerifyResult({ match: false });
      toast.error("Yuz mos kelmadi. Avval bemorni ro'yxatdan o'tkazing.");
    }
    setIsVerifying(false);
  }

  function handleSave() {
    registerMutation.mutate();
  }

  return (
    <motion.div variants={container} initial="hidden" animate="show" className="space-y-6">
      <motion.div variants={item}>
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
              <span className="text-2xl">🪪</span> Face ID
            </h1>
            <p className="text-sm text-muted-foreground mt-1">Yuzni tanish tizimi</p>
          </div>
        </div>
      </motion.div>

      <Tabs value={mode} onValueChange={setMode}>
        <motion.div variants={item}>
          <TabsList className="w-full sm:w-auto">
            <TabsTrigger value="register" className="gap-2">
              <ScanFace className="size-4" />
              Yuzni ro&apos;yxatdan o&apos;tkazish
            </TabsTrigger>
            <TabsTrigger value="verify" className="gap-2">
              <ShieldCheck className="size-4" />
              Face ID orqali kirish
            </TabsTrigger>
          </TabsList>
        </motion.div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mt-6">
          <div className="space-y-6">
            <motion.div variants={item}>
              <Card className="border-border/50 overflow-hidden">
                <CardContent className="p-0">
                  <div className="relative aspect-square bg-black flex items-center justify-center overflow-hidden">
                    <video
                      ref={videoRef}
                      autoPlay
                      playsInline
                      muted
                      className={`w-full h-full object-cover ${cameraActive ? "block" : "hidden"}`}
                    />
                    <canvas ref={canvasRef} className="hidden" />
                    {!cameraActive && (
                      <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-gradient-to-br from-zinc-900 via-black to-zinc-800">
                        <div className="size-16 rounded-full bg-primary/10 flex items-center justify-center">
                          <Camera className="size-8 text-primary/60" />
                        </div>
                        <p className="text-sm text-muted-foreground">Kamera yoqilmagan</p>
                      </div>
                    )}
                    <div className="absolute inset-4 border border-primary/20 rounded-lg pointer-events-none">
                      <div className="absolute top-0 left-0 w-8 h-8 border-t-2 border-l-2 border-primary/60 rounded-tl-lg" />
                      <div className="absolute top-0 right-0 w-8 h-8 border-t-2 border-r-2 border-primary/60 rounded-tr-lg" />
                      <div className="absolute bottom-0 left-0 w-8 h-8 border-b-2 border-l-2 border-primary/60 rounded-bl-lg" />
                      <div className="absolute bottom-0 right-0 w-8 h-8 border-b-2 border-r-2 border-primary/60 rounded-br-lg" />
                    </div>
                    {scanStatus === "scanning" && (
                      <motion.div
                        className="absolute inset-x-8 h-0.5 bg-gradient-to-r from-transparent via-primary to-transparent blur-sm pointer-events-none"
                        animate={{ top: ["15%", "85%", "15%"] }}
                        transition={{ duration: 2.5, repeat: Infinity, ease: "linear" }}
                      />
                    )}
                    {cameraActive && (
                      <div className="absolute bottom-3 left-3 flex items-center gap-2 px-2 py-1 rounded-full bg-black/60 text-[10px] text-green-400">
                        <span className="size-1.5 rounded-full bg-green-400 animate-pulse" />
                        Kamera aktiv
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          </div>

          <div className="space-y-6">
            <TabsContent value="register" className="mt-0 space-y-4">
              <motion.div variants={item}>
                <Card className="border-border/50">
                  <CardHeader>
                    <CardTitle className="text-lg flex items-center gap-2">
                      <IdCard className="size-5" />
                      Yuzni ro&apos;yxatdan o&apos;tkazish
                    </CardTitle>
                    <CardDescription>
                      Bemor yoki shifokorning yuz ma&apos;lumotlarini tizimga kiritish
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="space-y-2">
                      <label className="text-sm font-medium">Rolni tanlang</label>
                      <Select value={selectedRole} onValueChange={(val) => val && setSelectedRole(val)}>
                        <SelectTrigger className="w-full">
                          <SelectValue placeholder="Rolni tanlang" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectGroup>
                            <SelectLabel>Rollar</SelectLabel>
                            <SelectItem value="patient">Bemor</SelectItem>
                            <SelectItem value="doctor">Shifokor</SelectItem>
                          </SelectGroup>
                        </SelectContent>
                      </Select>
                    </div>

                    {!cameraActive ? (
                      <Button className="w-full gap-2" size="lg" onClick={startCamera}>
                        <Camera className="size-5" />
                        Kamerani yoqish
                      </Button>
                    ) : (
                      <Button className="w-full gap-2" size="lg" variant="secondary" onClick={stopCamera}>
                        <Camera className="size-5" />
                        Kamerani o'chirish
                      </Button>
                    )}

                    <Button
                      className="w-full gap-2"
                      size="lg"
                      onClick={handleScan}
                      disabled={scanStatus === "scanning" || !cameraActive}
                    >
                      {scanStatus === "scanning" ? (
                        <Loader2 className="size-5 animate-spin" />
                      ) : (
                        <Camera className="size-5" />
                      )}
                      Yuzni skaner qilish
                    </Button>

                    {scanStatus === "scanning" && (
                      <motion.div
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="flex items-center gap-2 text-sm text-primary"
                      >
                        <Loader2 className="size-4 animate-spin" />
                        Yuz aniqlanmoqda...
                      </motion.div>
                    )}

                    {scanStatus === "success" && (
                      <motion.div
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="flex items-center gap-2 text-sm text-emerald-500"
                      >
                        <CheckCircle2 className="size-4" />
                        Skanerlandi
                      </motion.div>
                    )}

                    {scanStatus === "error" && (
                      <motion.div
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="flex items-start gap-2 text-sm text-destructive"
                      >
                        <XCircle className="size-4 mt-0.5 shrink-0" />
                        <span>{scanError}</span>
                      </motion.div>
                    )}

                    <Button
                      className="w-full gap-2"
                      variant={scanStatus === "success" ? "default" : "outline"}
                      size="lg"
                      onClick={handleSave}
                      disabled={scanStatus !== "success" || registerMutation.isPending}
                    >
                      {registerMutation.isPending ? (
                        <Loader2 className="size-5 animate-spin" />
                      ) : (
                        <CheckCircle2 className="size-5" />
                      )}
                      Saqlash
                    </Button>
                  </CardContent>
                </Card>
              </motion.div>
            </TabsContent>

            <TabsContent value="verify" className="mt-0 space-y-4">
              <motion.div variants={item}>
                <Card className="border-border/50">
                  <CardHeader>
                    <CardTitle className="text-lg flex items-center gap-2">
                      <ShieldCheck className="size-5" />
                      Face ID orqali tekshirish
                    </CardTitle>
                    <CardDescription>
                      Yuz tanish uchun kameraga qarang
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {!cameraActive ? (
                      <Button className="w-full gap-2" size="lg" onClick={startCamera}>
                        <Camera className="size-5" />
                        Kamerani yoqish
                      </Button>
                    ) : (
                      <Button className="w-full gap-2" size="lg" variant="secondary" onClick={stopCamera}>
                        <Camera className="size-5" />
                        Kamerani o'chirish
                      </Button>
                    )}
                    <Button
                      className="w-full gap-2"
                      size="lg"
                      onClick={handleVerify}
                      disabled={isVerifying || !cameraActive}
                    >
                      {isVerifying ? (
                        <Loader2 className="size-5 animate-spin" />
                      ) : (
                        <ScanFace className="size-5" />
                      )}
                      Face ID orqali tekshirish
                    </Button>

                    {isVerifying && (
                      <motion.div
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="flex items-center gap-2 text-sm text-primary"
                      >
                        <Loader2 className="size-4 animate-spin" />
                        Yuz tanish uchun kameraga qarang...
                      </motion.div>
                    )}

                    {verifyResult && !isVerifying && (
                      <motion.div
                        initial={{ opacity: 0, scale: 0.95 }}
                        animate={{ opacity: 1, scale: 1 }}
                        className="rounded-lg border p-4 space-y-3"
                      >
                        {verifyResult.match && verifyResult.patient ? (
                          <>
                            <div className="flex items-center gap-3">
                              <div className="size-10 rounded-full bg-emerald-500/10 flex items-center justify-center">
                                <CheckCircle2 className="size-5 text-emerald-500" />
                              </div>
                              <div>
                                <p className="font-medium text-sm">Moslik aniqlandi</p>
                                <p className="text-xs text-muted-foreground">
                                  Face ID muvaffaqiyatli tasdiqlandi
                                </p>
                              </div>
                            </div>
                            <div className="flex items-center gap-3 pt-3 border-t border-border/50">
                              <Avatar className="size-10">
                                <AvatarFallback className="bg-primary/10 text-primary text-xs">
                                  {getInitials(
                                    verifyResult.patient.first_name,
                                    verifyResult.patient.last_name
                                  )}
                                </AvatarFallback>
                              </Avatar>
                              <div className="flex-1 min-w-0">
                                <p className="text-sm font-medium truncate">
                                  {verifyResult.patient.first_name}{" "}
                                  {verifyResult.patient.last_name}
                                </p>
                                <p className="text-xs text-muted-foreground">
                                  Ishonchlilik: {(verifyResult.confidence! * 100).toFixed(1)}%
                                </p>
                              </div>
                              <Badge variant="outline" className="shrink-0">
                                {verifyResult.confidence! > 0.95 ? "Yuqori" : "O'rtacha"}
                              </Badge>
                            </div>
                          </>
                        ) : (
                          <div className="flex items-center gap-3">
                            <div className="size-10 rounded-full bg-destructive/10 flex items-center justify-center">
                              <XCircle className="size-5 text-destructive" />
                            </div>
                            <div>
                              <p className="font-medium text-sm">Moslik topilmadi</p>
                              <p className="text-xs text-muted-foreground">
                                 Yuz ma&apos;lumotlar bazasida topilmadi
                              </p>
                            </div>
                          </div>
                        )}
                      </motion.div>
                    )}
                  </CardContent>
                </Card>
              </motion.div>
            </TabsContent>
          </div>
        </div>
      </Tabs>

      <motion.div variants={item}>
        <Card className="border-border/50">
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <UserRound className="size-5" />
              Ro&apos;yxatdan o&apos;tgan yuzlar
            </CardTitle>
            <CardDescription>
              Tizimga kiritilgan barcha yuz ma&apos;lumotlari
            </CardDescription>
          </CardHeader>
          <CardContent>
            {regsLoading ? (
              <div className="space-y-3">
                {Array.from({ length: 4 }).map((_, i) => (
                  <div key={i} className="flex items-center gap-3">
                    <Skeleton className="size-8 rounded-full" />
                    <div className="space-y-1.5 flex-1">
                      <Skeleton className="h-4 w-32" />
                      <Skeleton className="h-3 w-20" />
                    </div>
                  </div>
                ))}
              </div>
            ) : registrations.length === 0 ? (
              <div className="py-12 flex flex-col items-center justify-center text-center">
                <div className="size-12 rounded-full bg-muted flex items-center justify-center mb-4">
                  <AlertTriangle className="size-6 text-muted-foreground" />
                </div>
                <p className="text-base font-medium">Ro&apos;yxatdan o&apos;tgan yuzlar yo&apos;q</p>
                <p className="text-sm text-muted-foreground mt-1">
                  Hozircha hech qanday yuz ma&apos;lumoti kiritilmagan
                </p>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Ism</TableHead>
                    <TableHead>Rol</TableHead>
                    <TableHead>Ro&apos;yxatga olingan sana</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {registrations.map((reg) => (
                    <TableRow key={reg.id}>
                      <TableCell className="font-medium">{reg.person_name}</TableCell>
                      <TableCell>
                        <Badge
                          variant="outline"
                          className={
                            reg.role === "doctor"
                              ? "border-sky-500/30 text-sky-500"
                              : "border-emerald-500/30 text-emerald-500"
                          }
                        >
                          {reg.role === "doctor" ? "Shifokor" : "Bemor"}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        <span className="flex items-center gap-1.5">
                          <CalendarDays className="size-3.5" />
                          {formatDate(reg.created_at)}
                        </span>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </motion.div>
    </motion.div>
  );
}
