import { useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { Navigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, Leaf } from "lucide-react";

const LoginPage = () => {
  const { signIn, user, isLoading: authLoading } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (user) return <Navigate to="/" replace />;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const { error } = await signIn(email, password);
    if (error) setError(error);
    setLoading(false);
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-4 relative overflow-hidden bg-cream">
      {/* Soft gradient glow behind modal */}
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
        {/* Logo & branding */}
        <div className="flex flex-col items-center gap-4">
          <div className="h-16 w-16 rounded-lg flex items-center justify-center overflow-hidden bg-card shadow-card border border-border-light">
            <img src="/favicon.png" alt="Verdanote" className="h-14 w-14" />
          </div>
          <div className="text-center">
            <h1 className="font-heading text-[28px] text-forest">Verdanote</h1>
            <p className="font-body text-[14px] text-sage font-light tracking-wide mt-1.5">Creative analytics, simplified</p>
          </div>
        </div>

        {/* Login card */}
        <div className="rounded-[12px] p-9 space-y-5 bg-card shadow-card border border-border-light">
          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="space-y-2">
              <Label htmlFor="email" className="font-label text-[10px] font-semibold uppercase tracking-[0.08em] text-slate">
                Email
              </Label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                className="font-body text-[14px] text-charcoal placeholder:text-sage border-border-light rounded-[4px] focus:border-verdant focus:shadow-[0_0_0_3px_rgba(27,122,78,0.2)]"
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password" className="font-label text-[10px] font-semibold uppercase tracking-[0.08em] text-slate">
                Password
              </Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="font-body text-[14px] text-charcoal placeholder:text-sage border-border-light rounded-[4px] focus:border-verdant focus:shadow-[0_0_0_3px_rgba(27,122,78,0.2)]"
                required
              />
            </div>

            <div className="flex items-center justify-end">
              <a
                href="/reset-password"
                className="font-body text-[13px] text-verdant font-medium hover:text-verdant-light hover:underline transition-colors"
              >
                Forgot password?
              </a>
            </div>

            {error && (
              <div className="rounded-md px-3 py-2 text-xs text-destructive bg-destructive/5 border border-destructive/10">
                {error}
              </div>
            )}

            <Button type="submit" className="w-full py-3 h-auto bg-verdant text-white hover:bg-verdant-light font-body text-[15px] font-semibold rounded-[6px]" disabled={loading}>
              {loading ? <Loader2 className="h-4 w-4 animate-spin mr-1.5" /> : <Leaf className="h-4 w-4 mr-1.5" />}
              Sign In
            </Button>
          </form>
        </div>

        {/* Footer */}
        <p className="font-body text-[12px] text-sage font-light text-center">
          Accounts are provisioned by your admin.
        </p>
      </div>
    </div>
  );
};

export default LoginPage;
