// Supabase edge functions (supabase/functions/**) use Deno URL imports. Some
// unit tests import those modules directly, which pulls them into the app
// typecheck where Node/tsc cannot resolve URL specifiers. Map the URL module
// onto the installed npm package so the real types flow through.
declare module "https://esm.sh/@supabase/supabase-js@2" {
  export * from "@supabase/supabase-js";
}
