import { ReactNode } from "react";

interface AuthLayoutProps {
  title: string;
  subtitle: string;
  children: ReactNode;
}

export function AuthLayout({ title, subtitle, children }: AuthLayoutProps) {
  return (
    <div className="min-h-screen flex items-center justify-center px-4 relative overflow-hidden bg-cream">
      <div
        className="absolute pointer-events-none"
        style={{
          width: '140vw',
          height: '140vh',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          background: 'radial-gradient(ellipse 50% 50% at 50% 50%, hsl(152 35% 72% / 0.5) 0%, hsl(152 25% 78% / 0.3) 30%, hsl(147 20% 85% / 0.15) 55%, transparent 80%)',
          filter: 'blur(60px)',
        }}
      />
      <div className="w-full max-w-[420px] space-y-8 relative z-10">
        <div className="flex flex-col items-center gap-4">
          <div className="h-16 w-16 rounded-lg flex items-center justify-center overflow-hidden bg-card shadow-card border border-border-light">
            <img src="/favicon.png" alt="Verdanote" className="h-14 w-14" />
          </div>
          <div className="text-center">
            <h1 className="font-heading text-[28px] text-forest">{title}</h1>
            <p className="font-body text-[14px] text-sage font-light tracking-wide mt-1.5">{subtitle}</p>
          </div>
        </div>

        <div className="rounded-[12px] p-9 space-y-5 bg-card shadow-card border border-border-light">
          {children}
        </div>

        <p className="font-body text-[12px] text-sage font-light text-center">
          Accounts are provisioned by your admin.
        </p>
      </div>
    </div>
  );
}
