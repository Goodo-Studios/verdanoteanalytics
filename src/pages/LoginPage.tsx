import { useEffect, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Navigate, useLocation } from "react-router-dom";
import { AuthLayout } from "@/components/AuthLayout";
import { APP_NAME } from "@/lib/brand";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, Leaf, Mail } from "lucide-react";
// Single hardened implementation — a surface that bounced an unauthenticated
// visitor here (CaptureShareTarget) parks its own path in router state so the
// interrupted action resumes instead of dumping the user on the dashboard.
// That path is derived from attacker-influenced share text, so the sanitising
// lives in one place next to the code that produces it.
import { resolvePostLoginPath } from "@/pwa/shareTarget";
// /capture/quick-add is the one route with its own (manifest-free) HTML
// document, so returning to it after login has to be a real document load.
import { requiresDocumentNavigation } from "@/pwa/quickAdd";

export const NEUTRAL_LINK_NOTICE = "If that email has an account, a sign-in link is on its way.";
export const RATE_LIMIT_NOTICE = "Too many requests, try again in a minute.";

function isRateLimited(err: { status?: number; code?: string; message?: string } | null): boolean {
  if (!err) return false;
  if (err.status === 429) return true;
  if (err.code && /rate_limit/i.test(err.code)) return true;
  return /rate limit|too many requests/i.test(err.message ?? "");
}

const LoginPage = () => {
  const { signIn, user, isLoading: authLoading } = useAuth();
  const location = useLocation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [linkSending, setLinkSending] = useState(false);
  const [linkNotice, setLinkNotice] = useState<string | null>(null);

  const postLoginPath = user ? resolvePostLoginPath(location.state) : null;
  // A client-side <Navigate> would render the quick-add route inside the
  // index.html document, which links the manifest — and iOS would then offer
  // "Add to Home Screen" for the manifest's start_url ("/") rather than for the
  // quick-add page the user is actually looking at. A full load fetches
  // /capture/quick-add.html instead, which links no manifest.
  const needsDocumentLoad = postLoginPath !== null && requiresDocumentNavigation(postLoginPath);

  useEffect(() => {
    if (needsDocumentLoad && postLoginPath) window.location.assign(postLoginPath);
  }, [needsDocumentLoad, postLoginPath]);

  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // The effect above owns the navigation; hold a spinner rather than flashing
  // the form (or the SPA-rendered quick-add page) while the document loads.
  if (needsDocumentLoad) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (postLoginPath) return <Navigate to={postLoginPath} replace />;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const { error } = await signIn(email, password);
    if (error) setError(error);
    setLoading(false);
  };

  // Invited clients have no password. A one-time sign-in link gets them back in.
  // shouldCreateUser: false means this never creates an account, and the same
  // neutral notice shows whether or not the address exists, so the form cannot
  // be used to discover accounts. Only rate limiting gets its own message.
  const handleEmailLink = async () => {
    setError(null);
    setLinkNotice(null);
    const address = email.trim();
    if (!address) {
      setError("Enter your email first.");
      return;
    }
    setLinkSending(true);
    try {
      const { error: otpError } = await supabase.auth.signInWithOtp({
        email: address,
        options: { shouldCreateUser: false, emailRedirectTo: window.location.origin + "/" },
      });
      setLinkNotice(isRateLimited(otpError) ? RATE_LIMIT_NOTICE : NEUTRAL_LINK_NOTICE);
    } catch {
      setLinkNotice(NEUTRAL_LINK_NOTICE);
    } finally {
      setLinkSending(false);
    }
  };

  return (
    <AuthLayout title={APP_NAME} subtitle="Goodo Studios, in one place">
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

        <Button
          type="button"
          variant="ghost"
          onClick={handleEmailLink}
          disabled={linkSending}
          className="w-full h-auto py-2 font-body text-[14px] text-muted-foreground hover:text-foreground"
        >
          {linkSending ? <Loader2 className="h-4 w-4 animate-spin mr-1.5" /> : <Mail className="h-4 w-4 mr-1.5" />}
          Email me a sign-in link
        </Button>

        {linkNotice && (
          <p role="status" className="font-body text-[13px] text-muted-foreground text-center">
            {linkNotice}
          </p>
        )}
      </form>
    </AuthLayout>
  );
};

export default LoginPage;
