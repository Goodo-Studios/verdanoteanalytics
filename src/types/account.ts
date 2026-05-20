import type { Database } from "@/integrations/supabase/types";

export type Account = Database["public"]["Tables"]["ad_accounts"]["Row"];
