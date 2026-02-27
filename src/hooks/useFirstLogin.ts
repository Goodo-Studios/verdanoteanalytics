import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

export function useFirstLogin() {
  const { user } = useAuth();
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!user?.id) return;
    (async () => {
      const { data } = await supabase
        .from("user_preferences" as any)
        .select("first_login")
        .eq("user_id", user.id)
        .maybeSingle();

      // No row yet or first_login is true → show onboarding
      if (!data || (data as any).first_login === true) {
        setShowOnboarding(true);
      }
      setLoaded(true);
    })();
  }, [user?.id]);

  const openTour = () => setShowOnboarding(true);
  const closeTour = () => setShowOnboarding(false);

  return { showOnboarding, openTour, closeTour, loaded };
}
