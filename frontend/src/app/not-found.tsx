import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { Home, Search } from "lucide-react";
import { cn } from "@/lib/utils";

export default function NotFound() {
  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-background">
      <div className="max-w-md w-full text-center">
        <div className="mb-6">
          <div className="text-[8rem] font-bold leading-none bg-gradient-to-b from-primary/30 to-primary/5 bg-clip-text text-transparent select-none">
            404
          </div>
        </div>
        <h1 className="text-2xl font-bold tracking-tight mb-2">Sahifa topilmadi</h1>
        <p className="text-muted-foreground mb-8">
          Qidirgan sahifangiz mavjud emas yoki ko&apos;chirilgan bo&apos;lishi mumkin.
        </p>
        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          <Link href="/" className={cn(buttonVariants(), "")}>
            <Home className="size-4 mr-2" />
            Bosh sahifa
          </Link>
          <Link href="/patients" className={cn(buttonVariants({ variant: "outline" }), "")}>
            <Search className="size-4 mr-2" />
            Bemorlarni qidirish
          </Link>
        </div>
      </div>
    </div>
  );
}
