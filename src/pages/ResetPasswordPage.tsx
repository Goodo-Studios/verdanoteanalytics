import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, ArrowLeft, CheckCircle, Mail } from "lucide-react";

const ResetPasswordPage = () => {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/update-password`,
    });
    if (error) {
      setError(error.message);
    } else {
      setSent(true);
    }
    setLoading(false);
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-4 relative overflow-hidden bg-cream">
      <div
        className="absolute pointer-events-none"
        style={{
          width: '140vw', height: '140vh', top: '50%', left: '50%',
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
            <h1 className="font-heading text-[28px] text-forest">Reset Password</h1>
            <p className="font-body text-[14px] text-sage font-light tracking-wide mt-1.5">
              {sent ? "Check your inbox" : "Enter your email to receive a reset link"}
            </p>
          </div>
        </div>

        <div className="rounded-[12px] p-9 space-y-5 bg-card shadow-card border border-border-light">
          {sent ? (
            <div className="space-y-5 text-center">
              <CheckCircle className="h-10 w-10 text-verdant mx-auto" />
              <p className="font-body text-[14px] text-slate">
                We've sent a password reset link to <strong className="text-charcoal">{email}</strong>. Check your inbox and follow the link to set a new password.
              </p>
              <a href="/login">
                <Button variant="outline" className="w-full py-3 h-auto font-body text-[15px] font-semibold rounded-[6px]">
                  <ArrowLeft className="h-4 w-4 mr-1.5" />
                  Back to Sign In
                </Button>
              </a>
            </div>
          ) : (
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

              {error && (
                <div className="rounded-md px-3 py-2 text-xs text-destructive bg-destructive/5 border border-destructive/10">
                  {error}
                </div>
              )}

              <Button type="submit" className="w-full py-3 h-auto bg-verdant text-white hover:bg-verdant-light font-body text-[15px] font-semibold rounded-[6px]" disabled={loading}>
                {loading ? <Loader2 className="h-4 w-4 animate-spin mr-1.5" /> : <Mail className="h-4 w-4 mr-1.5" />}
                Send Reset Link
              </Button>

              <div className="flex items-center justify-center">
                <a href="/login" className="font-body text-[13px] text-verdant font-medium hover:text-verdant-light hover:underline transition-colors">
                  <ArrowLeft className="h-3 w-3 inline mr-1" />
                  Back to Sign In
                </a>
              </div>
            </form>
          )}
        </div>

        <p className="font-body text-[12px] text-sage font-light text-center">
          Accounts are provisioned by your admin.
        </p>
      </div>
    </div>
  );
};

export default ResetPasswordPage;
