"use client";

import { useEffect } from "react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { AlertTriangle, RefreshCw, Home } from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/utils";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-background">
      <Card className="max-w-md w-full border-border/50 shadow-xl">
        <CardHeader className="text-center pb-2 pt-8">
          <div className="mx-auto mb-4 flex size-14 items-center justify-center rounded-2xl bg-destructive/10 text-destructive">
            <AlertTriangle className="size-7" />
          </div>
          <CardTitle className="text-xl">Xatolik yuz berdi</CardTitle>
          <CardDescription>
            Tizimda kutilmagan xatolik yuz berdi. Iltimos, qaytadan urinib ko&apos;ring.
          </CardDescription>
        </CardHeader>
        <CardContent className="pb-8">
          <div className="flex flex-col gap-3">
            <Button onClick={reset} className="w-full">
              <RefreshCw className="size-4 mr-2" />
              Qaytadan urinish
            </Button>
            <Link
              href="/"
              className={cn(buttonVariants({ variant: "outline" }), "w-full")}
            >
              <Home className="size-4 mr-2" />
              Bosh sahifaga qaytish
            </Link>
          </div>
          {error.digest && (
            <p className="mt-4 text-center text-xs text-muted-foreground/50">
              Error ID: {error.digest}
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
