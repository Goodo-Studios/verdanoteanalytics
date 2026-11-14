import { ReactNode } from "react";
import { GoodoOsMark } from "@/components/GoodoOsMark";

interface AuthLayoutProps {
  title: string;
  subtitle: string;
  children: ReactNode;
}

export function AuthLayout({ title, subtitle, children }: AuthLayoutProps) {
  return (
    <div className="min-h-screen flex items-center justify-center px-4 relative overflow-hidden">
      <div className="w-full max-w-[420px] space-y-8 relative z-10">
        <div className="flex flex-col items-center gap-4">
          <GoodoOsMark size="lg" />
          <div className="text-center">
            <h1 className="text-[32px] font-semibold tracking-[-0.02em] text-foreground">{title}</h1>
            <p className="font-serif italic text-[18px] text-muted-foreground mt-1">{subtitle}</p>
          </div>
        </div>

        <div className="rounded-card p-9 space-y-5 bg-card shadow-card border border-border">
          {children}
        </div>

        <p className="text-[12px] text-muted-foreground text-center">
          Accounts are provisioned by your admin.
        </p>
      </div>
    </div>
  );
}
