"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api-client";
import { useState } from "react";
import { toast } from "sonner";
import { FlaskConical, User, Phone, FolderOpen, Save, Loader2, CheckCircle2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import Link from "next/link";

interface LabOrder {
  id: string;
  test_type: string;
  reason: string | null;
  status: string;
  ordered_at: string;
  paid_at: string | null;
  patient_id: string | null;
  patient_name: string | null;
  medical_record_number: string | null;
  phone: string | null;
  doctor_name: string | null;
  birth_date: string | null;
  gender: string | null;
}

const LAB_LABELS: Record<string, string> = {
  blood_general: "Umumiy qon",
  urine_general: "Peshob tahlili",
  biochemistry:  "Bioximik tahlil",
  coagulogram:   "Koagulogramma",
  ekg:           "EKG",
  xray:          "Rentgen",
  ultrasound:    "UZI",
  egds:          "EFGDS",
  ct_mri:        "MSKT/MRT",
  consult:       "Konsultatsiya",
};

function fmtDate(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("uz-UZ", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

export default function LabQueuePage() {
  const [openOrder, setOpenOrder] = useState<LabOrder | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["lab-queue"],
    queryFn: async () => {
      const res = await api.get<{ orders: LabOrder[] }>("/api/labs/queue");
      if (!res.success) throw new Error(res.error);
      return res;
    },
    refetchInterval: 15_000,
  });
  const orders = data?.orders ?? [];
  const paidOrders = orders.filter((o) => o.paid_at);
  const pendingPayment = orders.filter((o) => !o.paid_at);

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <div className="size-10 rounded-xl bg-gradient-to-br from-primary to-primary/70 flex items-center justify-center">
          <FlaskConical className="size-5 text-primary-foreground" />
        </div>
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Laborator ish stoli</h1>
          <p className="text-xs text-muted-foreground">Bemorlar to&apos;lagach — tekshiruvni bajaring va natijani kiriting</p>
        </div>
      </div>

      {/* To'langan — asosiy ish uchun */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <CheckCircle2 className="size-4 text-emerald-500" />
              To&apos;langan buyurtmalar (bajarishga tayyor)
            </CardTitle>
            <Badge variant="default" className="text-xs">{paidOrders.length}</Badge>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-2">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-16 w-full rounded-lg" />)}</div>
          ) : paidOrders.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">Bajarishga tayyor buyurtma yo&apos;q</p>
          ) : (
            <div className="space-y-2">
              {paidOrders.map((o) => <OrderRow key={o.id} order={o} onOpen={() => setOpenOrder(o)} />)}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Kutayotgan to'lov — laborantga faqat ma'lumot uchun */}
      {pendingPayment.length > 0 && (
        <Card className="border-amber-500/25 bg-amber-500/5">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium">Kassaga to&apos;lov kutmoqda</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {pendingPayment.map((o) => <OrderRow key={o.id} order={o} onOpen={() => {}} disabled />)}
            </div>
          </CardContent>
        </Card>
      )}

      <ResultDialog order={openOrder} onClose={() => setOpenOrder(null)} />
    </div>
  );
}

function OrderRow({ order, onOpen, disabled }: { order: LabOrder; onOpen: () => void; disabled?: boolean }) {
  return (
    <button
      onClick={onOpen} disabled={disabled}
      className={`w-full text-left rounded-lg border p-3 transition-colors ${
        disabled ? "border-border/30 bg-muted/20 opacity-70 cursor-not-allowed" : "border-border/60 hover:border-primary/50 hover:bg-primary/5"
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-sm font-semibold">{LAB_LABELS[order.test_type] || order.test_type}</span>
            {order.medical_record_number && <span className="text-xs font-mono text-muted-foreground">{order.medical_record_number}</span>}
          </div>
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <span className="flex items-center gap-1"><User className="size-3" />{order.patient_name || "—"}</span>
            {order.phone && <span className="flex items-center gap-1"><Phone className="size-3" />{order.phone}</span>}
          </div>
          <div className="flex items-center gap-3 text-[11px] text-muted-foreground/70 mt-1">
            <span>Buyurgan: {order.doctor_name || "—"}</span>
            {order.paid_at && <span>To&apos;lovi: {fmtDate(order.paid_at)}</span>}
            {!order.paid_at && <span className="text-amber-600">To&apos;lov kutilmoqda</span>}
          </div>
          {order.reason && (
            <p className="text-xs text-muted-foreground italic mt-1">Sabab: {order.reason}</p>
          )}
        </div>
        {order.patient_id && (
          <Link href={`/patients/${order.patient_id}`} target="_blank"
            onClick={(e) => e.stopPropagation()}
            className="text-xs text-primary hover:underline shrink-0 inline-flex items-center gap-1">
            <FolderOpen className="size-3" />karta
          </Link>
        )}
      </div>
    </button>
  );
}

function ResultDialog({ order, onClose }: { order: LabOrder | null; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [values, setValues] = useState("");
  const [conclusion, setConclusion] = useState("");

  const submit = useMutation({
    mutationFn: async () => {
      if (!order) throw new Error("Buyurtma yo'q");
      if (!values.trim() && !conclusion.trim()) throw new Error("Natija yoki xulosa kiriting");
      const res = await api.post(`/api/labs/orders/${order.id}/result`, {
        values_json: values.trim() ? { text: values.trim() } : undefined,
        conclusion: conclusion.trim() || undefined,
      });
      if (!res.success) throw new Error(res.error);
      return res;
    },
    onSuccess: () => {
      toast.success("Natija saqlandi. Doktor kartada ko'radi");
      setValues(""); setConclusion("");
      queryClient.invalidateQueries({ queryKey: ["lab-queue"] });
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const open = !!order;
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent showCloseButton>
        <DialogHeader>
          <DialogTitle>{order ? LAB_LABELS[order.test_type] || order.test_type : ""}</DialogTitle>
          <DialogDescription>
            {order?.patient_name} · {order?.medical_record_number || "MRN yo'q"}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>Ko&apos;rsatkichlar (matn / raqamlar)</Label>
            <Textarea value={values} onChange={(e) => setValues(e.target.value)} rows={5}
                      placeholder="Hb: 12.5 g/dl&#10;WBC: 7.2 × 10^9/l&#10;RBC: 4.5 × 10^12/l&#10;HCT: 40 %" />
          </div>
          <div className="space-y-1.5">
            <Label>Xulosa</Label>
            <Textarea value={conclusion} onChange={(e) => setConclusion(e.target.value)} rows={3}
                      placeholder="Umumiy holat normada. Yashirin qon aniqlanmadi." />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Bekor qilish</Button>
          <Button onClick={() => submit.mutate()} disabled={submit.isPending}>
            {submit.isPending ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
            Natijani saqlash
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
