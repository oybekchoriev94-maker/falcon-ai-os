"use client";

import { motion } from "framer-motion";
import { Mail, Phone, MapPin, CalendarDays, User, AlertTriangle, HeartCrack, UtensilsCrossed, IdCard, Droplets } from "lucide-react";
import type { Patient, ClinicalAlert } from "@/lib/mock-patient-data";
import { fmtDateUz } from "@/lib/mock-patient-data";
import { cn } from "@/lib/utils";

interface Props {
  patient: Patient;
  alerts: ClinicalAlert;
  onSchedule?: () => void;
  onAssignDoctor?: () => void;
}

export function PatientProfileCard({ patient, alerts, onSchedule, onAssignDoctor }: Props) {
  const initials = `${patient.firstName?.[0] || ""}${patient.lastName?.[0] || ""}`.toUpperCase() || "?";
  const hasAllergies = alerts.drugAllergies.length > 0 || alerts.foodAllergies.length > 0;

  return (
    <motion.aside
      initial={{ opacity: 0, x: 12 }}
      animate={{ opacity: 1, x: 0 }}
      className="rounded-2xl border border-slate-200/80 bg-white shadow-sm overflow-hidden"
    >
      {/* Header — avatar + F.I.O */}
      <div className="relative bg-gradient-to-br from-blue-600 to-indigo-600 px-5 pt-6 pb-14 text-white">
        <div className="absolute inset-0 opacity-30 pointer-events-none">
          <div className="absolute -top-8 -left-8 h-32 w-32 rounded-full bg-white/20 blur-2xl" />
          <div className="absolute -bottom-6 -right-6 h-24 w-24 rounded-full bg-cyan-300/30 blur-xl" />
        </div>
        <p className="relative text-[10px] uppercase tracking-wider text-white/70 font-semibold">Bemor kartasi</p>
        <h2 className="relative text-lg font-semibold mt-1 leading-tight">{patient.fullName}</h2>
        {patient.medicalRecordNumber && (
          <p className="relative text-xs text-white/80 mt-1 font-mono">
            <IdCard className="size-3 inline mr-1" />
            {patient.medicalRecordNumber}
          </p>
        )}
      </div>

      {/* Avatar (overlap) */}
      <div className="px-5 -mt-10 relative">
        <div className="flex items-end gap-3">
          <div className="size-20 rounded-2xl bg-white ring-4 ring-white shadow-md flex items-center justify-center shrink-0">
            {patient.avatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={patient.avatarUrl} alt="" className="size-full object-cover rounded-2xl" />
            ) : (
              <span className="text-2xl font-bold text-blue-600">{initials}</span>
            )}
          </div>
          <div className="flex-1 min-w-0 pb-1.5">
            <span className={cn(
              "inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full",
              patient.gender === "ayol" ? "bg-pink-100 text-pink-700" : "bg-blue-100 text-blue-700",
            )}>
              <User className="size-3" />
              {patient.gender === "ayol" ? "Ayol" : "Erkak"}
            </span>
          </div>
        </div>
      </div>

      {/* Ma'lumot qatorlari */}
      <div className="px-5 py-4 space-y-2.5">
        {patient.birthDate && (
          <InfoRow icon={<CalendarDays className="size-3.5" />}
            label="Tug'ilgan sana"
            value={`${fmtDateUz(patient.birthDate)}${patient.ageYears ? ` · ${patient.ageYears} yosh` : ""}`} />
        )}
        {patient.location && (
          <InfoRow icon={<MapPin className="size-3.5" />} label="Manzil" value={patient.location} />
        )}
        {patient.phone && (
          <InfoRow icon={<Phone className="size-3.5" />} label="Telefon" value={patient.phone} />
        )}
        {patient.email && (
          <InfoRow icon={<Mail className="size-3.5" />} label="E-pochta" value={patient.email} />
        )}
        {(patient.bloodGroup || patient.rhFactor) && (
          <InfoRow icon={<Droplets className="size-3.5" />} label="Qon guruhi"
            value={`${patient.bloodGroup || "—"}${patient.rhFactor ? ` ${patient.rhFactor}` : ""}`} />
        )}
      </div>

      {/* Aloqa tugmalari */}
      <div className="px-5 pb-4 grid grid-cols-2 gap-2">
        <a
          href={patient.email ? `mailto:${patient.email}` : "#"}
          className={cn(
            "inline-flex items-center justify-center gap-1.5 rounded-lg border border-slate-200 py-2 text-xs font-medium",
            patient.email ? "text-slate-700 hover:bg-slate-50" : "text-slate-400 cursor-not-allowed",
          )}
          onClick={(e) => { if (!patient.email) e.preventDefault(); }}
        >
          <Mail className="size-3.5" /> E-pochta
        </a>
        <a
          href={patient.phone ? `tel:${patient.phone}` : "#"}
          className={cn(
            "inline-flex items-center justify-center gap-1.5 rounded-lg border border-slate-200 py-2 text-xs font-medium",
            patient.phone ? "text-slate-700 hover:bg-slate-50" : "text-slate-400 cursor-not-allowed",
          )}
          onClick={(e) => { if (!patient.phone) e.preventDefault(); }}
        >
          <Phone className="size-3.5" /> Qo&apos;ng&apos;iroq
        </a>
      </div>

      {/* Clinical Alerts */}
      <div className="mx-5 mb-4 rounded-xl border border-amber-200 bg-amber-50 p-3">
        <div className="flex items-center gap-1.5 mb-2">
          <AlertTriangle className="size-3.5 text-amber-600" />
          <h4 className="text-xs font-semibold text-amber-900 uppercase tracking-wider">
            Klinik ogohlantirishlar
          </h4>
        </div>
        <div className="space-y-1.5 text-xs">
          <AlertItem
            icon={<HeartCrack className="size-3 text-rose-500" />}
            label="Surunkali kasalliklar"
            value={alerts.chronicConditions.length ? alerts.chronicConditions.join(", ") : "Yo'q"}
            highlight={alerts.chronicConditions.length > 0}
          />
          <AlertItem
            icon={<AlertTriangle className="size-3 text-rose-500" />}
            label="Dori allergiyalari"
            value={alerts.drugAllergies.length ? alerts.drugAllergies.join(", ") : "Yo'q"}
            highlight={alerts.drugAllergies.length > 0}
          />
          <AlertItem
            icon={<UtensilsCrossed className="size-3 text-amber-500" />}
            label="Oziq-ovqat allergiyalari"
            value={alerts.foodAllergies.length ? alerts.foodAllergies.join(", ") : "Yo'q"}
            highlight={alerts.foodAllergies.length > 0}
          />
        </div>
        {!hasAllergies && alerts.chronicConditions.length === 0 && (
          <p className="mt-2 text-[10px] text-amber-700/70 italic">
            Bemor kartasini to&apos;ldirsangiz bu joyda ko&apos;rinadi
          </p>
        )}
      </div>

      {/* Asosiy amallar */}
      <div className="px-5 pb-5 space-y-2">
        <button
          onClick={onSchedule}
          className="w-full rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-medium text-sm py-2.5 shadow-sm shadow-blue-500/20 transition-colors">
          Qabul belgilash
        </button>
        <button
          onClick={onAssignDoctor}
          className="w-full rounded-lg border border-slate-200 hover:bg-slate-50 text-slate-700 font-medium text-sm py-2.5 transition-colors">
          Shifokorga biriktirish
        </button>
      </div>
    </motion.aside>
  );
}

function InfoRow({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-start gap-2 text-xs">
      <span className="mt-0.5 text-slate-400">{icon}</span>
      <div className="min-w-0 flex-1">
        <p className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold">{label}</p>
        <p className="text-slate-800 mt-0.5 break-words">{value}</p>
      </div>
    </div>
  );
}

function AlertItem({ icon, label, value, highlight }: {
  icon: React.ReactNode; label: string; value: string; highlight?: boolean;
}) {
  return (
    <div className="flex items-start gap-2">
      <span className="mt-0.5 shrink-0">{icon}</span>
      <div className="min-w-0 flex-1">
        <p className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">{label}</p>
        <p className={cn("text-xs mt-0.5", highlight ? "text-slate-900 font-medium" : "text-slate-600")}>
          {value}
        </p>
      </div>
    </div>
  );
}
