import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useRoleNavigate } from "@/hooks/useRolePath";
import { AuthLayout } from "@/components/AuthLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, CheckCircle, Lock } from "lucide-react";

const UpdatePasswordPage = () => {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const navigate = useRoleNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (password.length < 6) {
      setError("Password must be at least 6 characters");
      return;
    }
    if (password !== confirm) {
      setError("Passwords do not match");
      return;
    }
    setLoading(true);
    const { error } = await supabase.auth.updateUser({ password });
    if (error) {
      setError(error.message);
    } else {
      setDone(true);
      setTimeout(() => navigate("/"), 2000);
    }
    setLoading(false);
  };

  return (
    <AuthLayout
      title="Set New Password"
      subtitle={done ? "Password updated!" : "Choose a new password for your account"}
    >
      {done ? (
        <div className="space-y-5 text-center">
          <CheckCircle className="h-10 w-10 text-verdant mx-auto" />
          <p className="font-body text-[14px] text-slate">Redirecting you now…</p>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-5">
          <div className="space-y-2">
            <Label htmlFor="password" className="font-label text-[10px] font-semibold uppercase tracking-[0.08em] text-slate">
              New Password
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
          <div className="space-y-2">
            <Label htmlFor="confirm" className="font-label text-[10px] font-semibold uppercase tracking-[0.08em] text-slate">
              Confirm Password
            </Label>
            <Input
              id="confirm"
              type="password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              placeholder="••••••••"
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
            {loading ? <Loader2 className="h-4 w-4 animate-spin mr-1.5" /> : <Lock className="h-4 w-4 mr-1.5" />}
            Update Password
          </Button>
        </form>
      )}
    </AuthLayout>
  );
};

export default UpdatePasswordPage;
