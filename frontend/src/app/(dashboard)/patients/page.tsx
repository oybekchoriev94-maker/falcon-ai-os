"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api-client";
import { useAuth } from "@/lib/auth-store";
import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { toast } from "sonner";
import {
  Search,
  Plus,
  Edit3,
  Trash2,
  Phone,
  Calendar,
  CalendarDays,
  UserRound,
  FileText,
  AlertTriangle,
  MapPin,
  Heart,
  Building2,
  Hash,
  FolderOpen,
  User,
  Map,
  Home,
  ClipboardList,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
  AlertDialogMedia,
} from "@/components/ui/alert-dialog";

interface Patient {
  id: number;
  first_name: string;
  last_name: string;
  middle_name?: string;
  phone: string;
  birth_date: string;
  region?: string;
  district?: string;
  address?: string;
  passport_number?: string;
  gender?: string;
  benefit_category?: string;
  department?: string;
  order_number?: string;
  medical_record_number?: string;
  notes?: string;
  created_at: string;
}

interface PatientFormData {
  first_name: string;
  last_name: string;
  middle_name: string;
  phone: string;
  birth_date: string;
  region: string;
  district: string;
  address: string;
  passport_number: string;
  gender: string;
  benefit_category: string;
  department: string;
  order_number: string;
  medical_record_number: string;
  notes: string;
}

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

const emptyForm: PatientFormData = {
  first_name: "",
  last_name: "",
  middle_name: "",
  phone: "",
  birth_date: "",
  region: "",
  district: "",
  address: "",
  passport_number: "",
  gender: "",
  benefit_category: "",
  department: "",
  order_number: "",
  medical_record_number: "",
  notes: "",
};

function getInitials(first: string, last: string): string {
  return `${(first || "")[0] || ""}${(last || "")[0] || ""}`.toUpperCase() || "?";
}

function formatDate(dateStr: string): string {
  if (!dateStr) return "\u2014";
  const d = new Date(dateStr);
  return d.toLocaleDateString("uz-UZ", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

function formatPhone(phone: string): string {
  if (!phone) return "\u2014";
  const cleaned = phone.replace(/\D/g, "");
  if (cleaned.length === 12) {
    return `+${cleaned.slice(0, 3)} ${cleaned.slice(3, 5)} ${cleaned.slice(5, 8)} ${cleaned.slice(8, 10)} ${cleaned.slice(10)}`;
  }
  return phone;
}

function genderLabel(g: string): string {
  if (g === "erkak") return "Erkak";
  if (g === "ayol") return "Ayol";
  return g || "\u2014";
}

export default function PatientsPage() {
  useAuth();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [selectedPatient, setSelectedPatient] = useState<Patient | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [editingPatient, setEditingPatient] = useState<Patient | null>(null);
  const [formData, setFormData] = useState<PatientFormData>(emptyForm);
  const [deleteTarget, setDeleteTarget] = useState<Patient | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 400);
    return () => clearTimeout(timer);
  }, [search]);

  const { data, isLoading, error } = useQuery({
    queryKey: ["patients"],
    queryFn: async () => {
      const res = await api.get<{ patients: Patient[] }>("/api/patients");
      if (!res.success) throw new Error(res.error || "Bemorlarni yuklashda xatolik");
      return res.patients;
    },
    refetchInterval: 30_000,
  });

  useEffect(() => {
    if (error) {
      toast.error(error instanceof Error ? error.message : "Bemorlarni yuklashda xatolik yuz berdi");
    }
  }, [error]);

  const patients = data || [];
  const filtered = debouncedSearch
    ? patients.filter(
        (p) =>
          `${p.first_name} ${p.middle_name || ""} ${p.last_name}`
            .toLowerCase()
            .includes(debouncedSearch.toLowerCase()) ||
          (p.phone || "").includes(debouncedSearch) ||
          (p.passport_number || "").toLowerCase().includes(debouncedSearch.toLowerCase())
      )
    : patients;

  const createMutation = useMutation({
    mutationFn: async (data: PatientFormData) => {
      const res = await api.post<{ patient: Patient }>("/api/patients", data);
      if (!res.success) throw new Error(res.error || "Bemor qo'shishda xatolik");
      return res.patient;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["patients"] });
      toast.success("Bemor muvaffaqiyatli qo'shildi");
      handleFormClose();
    },
    onError: (err: Error) => {
      toast.error(err.message);
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: number; data: PatientFormData }) => {
      const res = await api.put<{ patient: Patient }>(`/api/patients/${id}`, data);
      if (!res.success) throw new Error(res.error || "Bemorni yangilashda xatolik");
      return res.patient;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["patients"] });
      toast.success("Bemor ma'lumotlari yangilandi");
      handleFormClose();
    },
    onError: (err: Error) => {
      toast.error(err.message);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await api.delete(`/api/patients/${id}`);
      if (!res.success) throw new Error(res.error || "Bemorni o'chirishda xatolik");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["patients"] });
      toast.success("Bemor o'chirildi");
      setDeleteOpen(false);
      setDeleteTarget(null);
    },
    onError: (err: Error) => {
      toast.error(err.message);
    },
  });

  const isPending = createMutation.isPending || updateMutation.isPending;

  function handleFormClose() {
    setFormOpen(false);
    setEditingPatient(null);
    setFormData(emptyForm);
  }

  function openNewForm() {
    setEditingPatient(null);
    setFormData(emptyForm);
    setFormOpen(true);
  }

  function openEditForm(patient: Patient) {
    setEditingPatient(patient);
    setFormData({
      first_name: patient.first_name,
      last_name: patient.last_name || "",
      middle_name: patient.middle_name || "",
      phone: patient.phone || "",
      birth_date: patient.birth_date ? patient.birth_date.split("T")[0] : "",
      region: patient.region || "",
      district: patient.district || "",
      address: patient.address || "",
      passport_number: patient.passport_number || "",
      gender: patient.gender || "",
      benefit_category: patient.benefit_category || "",
      department: patient.department || "",
      order_number: patient.order_number || "",
      medical_record_number: patient.medical_record_number || "",
      notes: patient.notes || "",
    });
    setFormOpen(true);
  }

  function openDetail(patient: Patient) {
    setSelectedPatient(patient);
    setDetailOpen(true);
  }

  function confirmDelete(patient: Patient) {
    setDeleteTarget(patient);
    setDeleteOpen(true);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!formData.first_name.trim() || !formData.last_name.trim()) {
      toast.error("Ism va familiya majburiy");
      return;
    }
    if (editingPatient) {
      updateMutation.mutate({ id: editingPatient.id, data: formData });
    } else {
      createMutation.mutate(formData);
    }
  }

  function setFormField(field: keyof PatientFormData, value: string) {
    setFormData((prev) => ({ ...prev, [field]: value }));
  }

  return (
    <motion.div variants={container} initial="hidden" animate="show" className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Bemorlar</h1>
          <p className="text-sm text-muted-foreground">Barcha bemorlar ro&apos;yxati va boshqaruvi</p>
        </div>
        <Button onClick={openNewForm}>
          <Plus className="size-4" />
          Yangi bemor
        </Button>
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground pointer-events-none" />
        <Input
          placeholder="Ism, familiya, telefon yoki passport bo'yicha qidirish..."
          className="pl-9 h-9"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {isLoading ? (
        <LoadingSkeleton />
      ) : filtered.length === 0 ? (
        <EmptyState
          hasSearch={!!debouncedSearch}
          onAdd={openNewForm}
          onClearSearch={() => {
            setSearch("");
            setDebouncedSearch("");
          }}
        />
      ) : (
        <motion.div variants={item} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((patient) => (
            <PatientCard
              key={patient.id}
              patient={patient}
              onView={() => openDetail(patient)}
              onEdit={() => openEditForm(patient)}
              onDelete={() => confirmDelete(patient)}
            />
          ))}
        </motion.div>
      )}

      {!isLoading && filtered.length > 0 && (
        <p className="text-xs text-muted-foreground text-center">
          Jami {filtered.length} ta bemor topildi
          {debouncedSearch && patients.length !== filtered.length && ` (${patients.length} ta dan)`}
        </p>
      )}

      <Dialog open={detailOpen} onOpenChange={setDetailOpen}>
        <DialogContent className="sm:max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Bemor haqida ma&apos;lumot</DialogTitle>
            <DialogDescription>Bemorning to&apos;liq ma&apos;lumotlari</DialogDescription>
          </DialogHeader>
          {selectedPatient && (
            <div className="space-y-5">
              <div className="flex items-center gap-3">
                <Avatar className="size-12">
                  <AvatarFallback className="bg-primary/10 text-primary text-sm">
                    {getInitials(selectedPatient.first_name, selectedPatient.last_name)}
                  </AvatarFallback>
                </Avatar>
                <div>
                  <p className="font-semibold text-base">
                    {selectedPatient.last_name} {selectedPatient.first_name} {selectedPatient.middle_name || ""}
                  </p>
                  <Badge variant="secondary" className="mt-0.5">
                    ID: {selectedPatient.id}
                  </Badge>
                </div>
              </div>

              <div className="grid gap-3 text-sm">
                <DetailRow icon={<Phone className="size-4" />} label="Telefon" value={formatPhone(selectedPatient.phone)} />
                <DetailRow icon={<Calendar className="size-4" />} label="Tug'ilgan sana" value={formatDate(selectedPatient.birth_date)} />
                {selectedPatient.gender && <DetailRow icon={<User className="size-4" />} label="Jinsi" value={genderLabel(selectedPatient.gender)} />}
                {selectedPatient.passport_number && <DetailRow icon={<Hash className="size-4" />} label="Passport raqami" value={selectedPatient.passport_number} />}
                {selectedPatient.region && <DetailRow icon={<Map className="size-4" />} label="Viloyat" value={selectedPatient.region} />}
                {selectedPatient.district && <DetailRow icon={<MapPin className="size-4" />} label="Tuman/Shahar" value={selectedPatient.district} />}
                {selectedPatient.address && <DetailRow icon={<Home className="size-4" />} label="Manzil" value={selectedPatient.address} />}
                {selectedPatient.benefit_category && <DetailRow icon={<Heart className="size-4" />} label="Imtiyozi" value={selectedPatient.benefit_category} />}
                {selectedPatient.department && <DetailRow icon={<Building2 className="size-4" />} label="Bo'lim" value={selectedPatient.department} />}
                {selectedPatient.order_number && <DetailRow icon={<ClipboardList className="size-4" />} label="Order raqami" value={selectedPatient.order_number} />}
                {selectedPatient.medical_record_number && <DetailRow icon={<FolderOpen className="size-4" />} label="Tibbiy varaqa" value={selectedPatient.medical_record_number} />}
                {selectedPatient.notes && <DetailRow icon={<FileText className="size-4" />} label="Izoh" value={selectedPatient.notes} />}
                <DetailRow icon={<CalendarDays className="size-4" />} label="Ro'yxatga olingan" value={formatDate(selectedPatient.created_at)} />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDetailOpen(false)}>
              Yopish
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={formOpen}
        onOpenChange={(open) => {
          if (!open) handleFormClose();
        }}
      >
        <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto" showCloseButton>
          <DialogHeader>
            <DialogTitle>{editingPatient ? "Bemorni tahrirlash" : "Yangi bemor qo'shish"}</DialogTitle>
            <DialogDescription>
              {editingPatient
                ? "Bemor ma'lumotlarini yangilang"
                : "Yangi bemorning barcha ma'lumotlarini kiriting"}
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="space-y-3">
              <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">F.I.O</h3>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="last_name">Familiya *</Label>
                  <Input id="last_name" placeholder="Familiya" value={formData.last_name} onChange={(e) => setFormField("last_name", e.target.value)} required />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="first_name">Ism *</Label>
                  <Input id="first_name" placeholder="Ism" value={formData.first_name} onChange={(e) => setFormField("first_name", e.target.value)} required />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="middle_name">Otasining ismi</Label>
                  <Input id="middle_name" placeholder="Otasining ismi" value={formData.middle_name} onChange={(e) => setFormField("middle_name", e.target.value)} />
                </div>
              </div>
            </div>

            <div className="space-y-3">
              <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Aloqa va manzil</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="phone">Telefon raqam</Label>
                  <Input id="phone" type="tel" placeholder="+998 XX XXX XX XX" value={formData.phone} onChange={(e) => setFormField("phone", e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="birth_date">Tug'ilgan sana</Label>
                  <Input id="birth_date" type="date" value={formData.birth_date} onChange={(e) => setFormField("birth_date", e.target.value)} />
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="region">Viloyat</Label>
                  <Input id="region" placeholder="Viloyat" value={formData.region} onChange={(e) => setFormField("region", e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="district">Tuman / Shahar</Label>
                  <Input id="district" placeholder="Tuman yoki shahar" value={formData.district} onChange={(e) => setFormField("district", e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="address">Uy manzili</Label>
                  <Input id="address" placeholder="Ko'cha, uy, xonadon" value={formData.address} onChange={(e) => setFormField("address", e.target.value)} />
                </div>
              </div>
            </div>

            <div className="space-y-3">
              <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Hujjat va ma'lumot</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="passport_number">Passport raqami</Label>
                  <Input id="passport_number" placeholder="AB1234567" value={formData.passport_number} onChange={(e) => setFormField("passport_number", e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="gender">Jinsi</Label>
                  <Select value={formData.gender || undefined} onValueChange={(v) => v && setFormField("gender", v)}>
                    <SelectTrigger id="gender">
                      <SelectValue placeholder="Jinsini tanlang" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="erkak">Erkak</SelectItem>
                      <SelectItem value="ayol">Ayol</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="benefit_category">Imtiyozi</Label>
                  <Select value={formData.benefit_category || undefined} onValueChange={(v) => v && setFormField("benefit_category", v)}>
                    <SelectTrigger id="benefit_category">
                      <SelectValue placeholder="Imtiyoz turini tanlang" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="yoq">Yo'q</SelectItem>
                      <SelectItem value="nogiron_1">1-guruh nogironi</SelectItem>
                      <SelectItem value="nogiron_2">2-guruh nogironi</SelectItem>
                      <SelectItem value="nogiron_3">3-guruh nogironi</SelectItem>
                      <SelectItem value="urush_faxriysi">Urush faxriysi</SelectItem>
                      <SelectItem value="mexnat_faxriysi">Mehnat faxriysi</SelectItem>
                      <SelectItem value="kambagal">Kam ta'minlangan</SelectItem>
                      <SelectItem value="bola">Bolalar</SelectItem>
                      <SelectItem value="boshqa">Boshqa</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="department">Bo'lim</Label>
                  <Select value={formData.department || undefined} onValueChange={(v) => v && setFormField("department", v)}>
                    <SelectTrigger id="department">
                      <SelectValue placeholder="Bo'limni tanlang" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="kardiologiya">Kardiologiya</SelectItem>
                      <SelectItem value="nevrologiya">Nevrologiya</SelectItem>
                      <SelectItem value="pediatriya">Pediatriya</SelectItem>
                      <SelectItem value="xirurgiya">Xirurgiya</SelectItem>
                      <SelectItem value="travmatologiya">Travmatologiya</SelectItem>
                      <SelectItem value="akusherlik">Akusherlik</SelectItem>
                      <SelectItem value="terapiya">Terapiya</SelectItem>
                      <SelectItem value="oftalmologiya">Oftalmologiya</SelectItem>
                      <SelectItem value="lor">LOR</SelectItem>
                      <SelectItem value="stomatologiya">Stomatologiya</SelectItem>
                      <SelectItem value="boshqa">Boshqa</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="order_number">Order raqami</Label>
                  <Input id="order_number" placeholder="Order raqami" value={formData.order_number} onChange={(e) => setFormField("order_number", e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="medical_record_number">Tibbiy varaqa raqami</Label>
                  <Input id="medical_record_number" placeholder="Tibbiy varaqa raqami" value={formData.medical_record_number} onChange={(e) => setFormField("medical_record_number", e.target.value)} />
                </div>
              </div>
            </div>

            <div className="space-y-3">
              <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Qo'shimcha</h3>
              <div className="space-y-1.5">
                <Label htmlFor="notes">Izoh</Label>
                <Textarea id="notes" placeholder="Bemor haqida qo'shimcha ma'lumotlar..." value={formData.notes} onChange={(e) => setFormField("notes", e.target.value)} rows={2} />
              </div>
            </div>

            <DialogFooter className="border-t border-border/50 pt-4">
              <Button type="button" variant="outline" onClick={handleFormClose}>
                Bekor qilish
              </Button>
              <Button type="submit" disabled={isPending}>
                {isPending ? "Saqlanmoqda..." : editingPatient ? "Yangilash" : "Saqlash"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent size="sm">
          <AlertDialogHeader>
            <AlertDialogMedia>
              <AlertTriangle className="size-5 text-destructive" />
            </AlertDialogMedia>
            <AlertDialogTitle>Bemorni o&apos;chirish</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget
                ? `"${deleteTarget.last_name} ${deleteTarget.first_name}" ni o'chirishni tasdiqlaysizmi? Bu amalni qaytarib bo'lmaydi.`
                : "Bemorni o'chirishni tasdiqlaysizmi?"}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel
              onClick={() => {
                setDeleteOpen(false);
                setDeleteTarget(null);
              }}
            >
              Bekor qilish
            </AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={deleteMutation.isPending}
              onClick={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
            >
              {deleteMutation.isPending ? "O'chirilmoqda..." : "O'chirish"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </motion.div>
  );
}

function DetailRow({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-start gap-2 text-muted-foreground">
      <span className="shrink-0 mt-0.5">{icon}</span>
      <div>
        <span className="text-xs text-muted-foreground/60">{label}</span>
        <p className="text-sm">{value}</p>
      </div>
    </div>
  );
}

function PatientCard({
  patient,
  onView,
  onEdit,
  onDelete,
}: {
  patient: Patient;
  onView: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <motion.div variants={item}>
      <Card
        className="cursor-pointer border-border/50 hover:border-primary/30 transition-all duration-200 group"
        onClick={onView}
      >
        <CardContent className="p-4">
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-3 min-w-0">
              <Avatar className="size-10 shrink-0">
                <AvatarFallback className="bg-primary/10 text-primary text-xs">
                  {getInitials(patient.first_name, patient.last_name)}
                </AvatarFallback>
              </Avatar>
              <div className="min-w-0">
                <p className="font-medium text-sm truncate">
                  {patient.last_name} {patient.first_name}
                </p>
                <p className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1">
                  <Phone className="size-3" />
                  {formatPhone(patient.phone)}
                </p>
              </div>
            </div>
            <div
              className="flex items-center gap-1 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
              onClick={(e) => e.stopPropagation()}
            >
              <Button variant="ghost" size="icon-sm" onClick={onEdit}>
                <Edit3 className="size-3.5" />
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={onDelete}
                className="text-destructive hover:text-destructive"
              >
                <Trash2 className="size-3.5" />
              </Button>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-3 pt-3 border-t border-border/50 text-xs text-muted-foreground">
            {patient.department && (
              <span className="flex items-center gap-1">
                <Building2 className="size-3" />
                {patient.department}
              </span>
            )}
            {patient.birth_date && (
              <span className="flex items-center gap-1">
                <Calendar className="size-3" />
                {formatDate(patient.birth_date)}
              </span>
            )}
            {patient.passport_number && (
              <span className="flex items-center gap-1">
                <Hash className="size-3" />
                {patient.passport_number}
              </span>
            )}
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
}

function LoadingSkeleton() {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {Array.from({ length: 6 }).map((_, i) => (
        <Card key={i} className="border-border/50">
          <CardContent className="p-4 space-y-3">
            <div className="flex items-center gap-3">
              <Skeleton className="size-10 rounded-full" />
              <div className="space-y-1.5 flex-1">
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-3 w-24" />
              </div>
            </div>
            <div className="flex gap-4 pt-3 border-t border-border/50">
              <Skeleton className="h-3 w-20" />
              <Skeleton className="h-3 w-20" />
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function EmptyState({
  hasSearch,
  onAdd,
  onClearSearch,
}: {
  hasSearch: boolean;
  onAdd: () => void;
  onClearSearch: () => void;
}) {
  return (
    <motion.div variants={item}>
      <Card className="border-border/50">
        <CardContent className="py-16 flex flex-col items-center justify-center text-center">
          <div className="size-12 rounded-full bg-muted flex items-center justify-center mb-4">
            <UserRound className="size-6 text-muted-foreground" />
          </div>
          {hasSearch ? (
            <>
              <p className="text-base font-medium">Hech narsa topilmadi</p>
              <p className="text-sm text-muted-foreground mt-1">
                Qidiruv so&apos;roviga mos bemor topilmadi
              </p>
              <Button variant="outline" className="mt-4" onClick={onClearSearch}>
                Qidiruvni tozalash
              </Button>
            </>
          ) : (
            <>
              <p className="text-base font-medium">Bemorlar yo&apos;q</p>
              <p className="text-sm text-muted-foreground mt-1">
                Hozircha hech qanday bemor qo&apos;shilmagan
              </p>
              <Button className="mt-4" onClick={onAdd}>
                <Plus className="size-4" />
                Birinchi bemorni qo&apos;shish
              </Button>
            </>
          )}
        </CardContent>
      </Card>
    </motion.div>
  );
}
