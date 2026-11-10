// Ad Name Generator: the old goodo-ad-name-generator screen, inside the staff area for
// builders and employees. Ported as-is. The ad code comes from Verdanote's own counter
// (public.ad_name_counter through peek_ad_code and claim_ad_code, migration
// 20261101000005); both functions refuse anyone who is not builder or employee.
//
// The code is only spent when the name is copied. There is no random fallback when the
// counter cannot be reached: a duplicate ad name is worse than no name.
import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader, PageShell, SelectField, TextField } from "@/components/page-kit";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  AD_TYPES,
  CREATIVE_TYPES,
  PEOPLE_ON_CAMERA,
  buildAdName,
  buildClientList,
  emptyFields,
  formatCode,
  isComplete,
  toCode,
  validate,
  type AdNameFields,
  type ClientAccount,
  type FieldErrors,
  type Option,
} from "./adName";

/** The next code, without spending it. Safe to call on every page load. */
async function peekCode(): Promise<string> {
  const { data, error } = await supabase.rpc("peek_ad_code");
  if (error) throw new Error(error.message);
  return toCode(data);
}

/** Spend the next code. Called once, at the moment the name is copied. */
async function claimCode(): Promise<string> {
  const { data, error } = await supabase.rpc("claim_ad_code");
  if (error) throw new Error(error.message);
  return toCode(data);
}

/** Active ad accounts and their Theme / Persona lists (angle_clusters), read with the staff session. */
async function loadClients(): Promise<ClientAccount[]> {
  const [accounts, clusters] = await Promise.all([
    supabase.from("ad_accounts").select("id, name").eq("is_active", true).order("name"),
    supabase.from("angle_clusters").select("id, account_id, label").is("archived_at", null).not("label", "is", null),
  ]);
  if (accounts.error) throw new Error(accounts.error.message);
  if (clusters.error) throw new Error(clusters.error.message);
  return buildClientList(accounts.data ?? [], clusters.data ?? []);
}

function message(prefix: string, e: unknown): string {
  return e instanceof Error ? `${prefix}: ${e.message}` : `${prefix}.`;
}

type Status = { kind: "idle" } | { kind: "copied"; name: string; manual: boolean } | { kind: "error"; message: string };

type FieldProps = { id: string; label: string; value: string; error?: string; hint?: string; onChange: (v: string) => void };

/** Label with a required mark, hint and error around one control (select or text input). */
function Field({ id, label, value, error, hint, onChange, options, placeholder }: FieldProps & { options?: Option[]; placeholder?: string }) {
  return options ? (
    <SelectField
      id={id}
      label={`${label} *`}
      value={value}
      error={error}
      hint={hint}
      placeholder={placeholder ?? ""}
      options={options}
      onChange={(e) => onChange(e.target.value)}
    />
  ) : (
    <TextField id={id} label={`${label} *`} value={value} error={error} hint={hint} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
  );
}

export default function AdNameGeneratorPage() {
  const [fields, setFields] = useState<AdNameFields>(emptyFields);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [clients, setClients] = useState<ClientAccount[] | null>(null);
  const [loadingCode, setLoadingCode] = useState(true);
  const [claiming, setClaiming] = useState(false);

  const loadPreviewCode = useCallback(async () => {
    setLoadingCode(true);
    try {
      const code = await peekCode();
      setFields((cur) => ({ ...cur, uniqueCode: code }));
    } catch (e) {
      setStatus({ kind: "error", message: message("Could not reach the code counter", e) });
    } finally {
      setLoadingCode(false);
    }
  }, []);

  useEffect(() => {
    void loadPreviewCode();
    loadClients()
      .then(setClients)
      .catch((e: unknown) => setStatus({ kind: "error", message: message("Could not load the client list", e) }));
  }, [loadPreviewCode]);

  const account = useMemo(() => clients?.find((a) => a.accountId === fields.accountId) ?? null, [clients, fields.accountId]);
  const hasGovernedThemes = Boolean(account && account.themes.length > 0);

  const setField = (key: keyof AdNameFields, value: string) => {
    setFields((cur) => ({ ...cur, [key]: value }));
    setErrors((cur) => (cur[key] ? { ...cur, [key]: undefined } : cur));
    // Editing after a copy means a new ad is being named, so pull the next code now.
    if (status.kind === "copied") {
      setStatus({ kind: "idle" });
      void loadPreviewCode();
    }
  };

  /** Changing client clears the theme, whose options belong to the account. */
  const handleAccountChange = (accountId: string) => {
    setFields((cur) => ({ ...cur, accountId, themeOfAd: "" }));
    setErrors((cur) => ({ ...cur, accountId: undefined }));
    if (status.kind === "copied") {
      setStatus({ kind: "idle" });
      void loadPreviewCode();
    }
  };

  const adName = useMemo(() => buildAdName(fields), [fields]);
  const ready = useMemo(() => isComplete(fields), [fields]);

  const handleCopy = async () => {
    const found = validate(fields);
    if (Object.keys(found).length > 0) {
      setErrors(found);
      setStatus({ kind: "error", message: "Fill in every field before copying." });
      return;
    }
    setClaiming(true);
    try {
      // Spend the code only now. The claimed number can differ from the preview if
      // someone else copied first, so the copied name always uses the claimed value.
      const claimed = await claimCode();
      const claimedFields = { ...fields, uniqueCode: claimed };
      const finalName = buildAdName(claimedFields);
      setFields(claimedFields);
      // The code is spent. If the browser refuses the clipboard, keep the name on screen
      // to copy by hand instead of inviting a retry that would spend a second code.
      let manual = false;
      try {
        await navigator.clipboard.writeText(finalName);
      } catch (clipboardError) {
        console.warn("Clipboard write failed", clipboardError);
        manual = true;
      }
      setStatus({ kind: "copied", name: finalName, manual });
    } catch (e) {
      setStatus({ kind: "error", message: message("Nothing was copied", e) });
    } finally {
      setClaiming(false);
    }
  };

  const handleNextAd = () => {
    // Client and product carry over: naming a run of ads for one brief is the normal case.
    setFields((cur) => ({ ...emptyFields(), accountId: cur.accountId, productName: cur.productName }));
    setErrors({});
    setStatus({ kind: "idle" });
    void loadPreviewCode();
  };

  return (
    <PageShell className="max-w-2xl">
      <PageHeader title="Ad Name Generator" description="Every name is a coordinate on the client's Creative Matrix." />

      <section className="space-y-3 rounded-lg border border-input bg-background p-5">
        <Field
          id="accountId"
          label="Client"
          placeholder={clients ? "Select client" : "Loading clients..."}
          options={(clients ?? []).map((a) => ({ value: a.accountId, label: a.name }))}
          value={fields.accountId}
          error={errors.accountId}
          onChange={handleAccountChange}
        />

        {hasGovernedThemes ? (
          <Field
            id="themeOfAd"
            label="Theme / Persona"
            placeholder="Select theme"
            options={(account?.themes ?? []).map((t) => ({ value: t.label, label: t.label }))}
            value={fields.themeOfAd}
            error={errors.themeOfAd}
            onChange={(v) => setField("themeOfAd", v)}
          />
        ) : (
          <Field
            id="themeOfAd"
            label="Theme / Persona"
            placeholder="e.g. ChronicFatigue"
            hint={
              fields.accountId
                ? "This client has no theme list on its board yet, so this is typed. It won't line up with a board column until the list exists."
                : "Pick a client first to get its board themes."
            }
            value={fields.themeOfAd}
            error={errors.themeOfAd}
            onChange={(v) => setField("themeOfAd", v)}
          />
        )}

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field
            id="adType"
            label="Ad Type"
            placeholder="Select ad type"
            options={AD_TYPES}
            value={fields.adType}
            error={errors.adType}
            onChange={(v) => setField("adType", v)}
          />
          <Field
            id="creativeType"
            label="Creative Type"
            placeholder="Select creative type"
            options={CREATIVE_TYPES}
            value={fields.creativeType}
            error={errors.creativeType}
            onChange={(v) => setField("creativeType", v)}
          />
        </div>

        <Field
          id="hook"
          label="Hook"
          placeholder="e.g. Tired by 3pm? or Problem callout"
          hint="What the hook says, or what kind of hook it is."
          value={fields.hook}
          error={errors.hook}
          onChange={(v) => setField("hook", v)}
        />

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field
            id="personOnCamera"
            label="Person on Camera"
            placeholder="Select person"
            options={PEOPLE_ON_CAMERA}
            value={fields.personOnCamera}
            error={errors.personOnCamera}
            onChange={(v) => setField("personOnCamera", v)}
          />
          <Field
            id="productName"
            label="Product Name"
            placeholder="e.g. Greens"
            value={fields.productName}
            error={errors.productName}
            onChange={(v) => setField("productName", v)}
          />
        </div>
      </section>

      <section className="rounded-lg border border-input bg-background p-5">
        <h2 className="font-label text-[12px] font-medium uppercase tracking-wide text-muted-foreground">Generated Ad Name</h2>
        <p className="mt-2 break-all font-mono text-[20px] text-forest" data-testid="generated-name" aria-live="polite">
          {loadingCode && !adName ? "Loading the next code..." : adName || "-"}
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <Button
            type="button"
            onClick={handleCopy}
            // Disabled once copied so a second click cannot spend another code on the same name.
            disabled={!ready || claiming || loadingCode || status.kind === "copied"}
          >
            {claiming ? "Claiming code..." : status.kind === "copied" ? "Copied" : "Copy Ad Name"}
          </Button>
          <Button type="button" variant="outline" onClick={handleNextAd}>
            Next Ad
          </Button>
        </div>
        {status.kind === "copied" && !status.manual && (
          <p className="mt-3 text-[12px] text-verdant" role="status">
            Copied. {formatCode(fields.uniqueCode)} is yours. Change a field or hit Next Ad to pick up the following code.
          </p>
        )}
        {status.kind === "copied" && status.manual && (
          <p className="mt-3 text-[12px] text-destructive" role="status">
            {formatCode(fields.uniqueCode)} is reserved for this ad, but the browser blocked copying. Select the name above and copy it by hand.
          </p>
        )}
        {status.kind === "error" && (
          <p className="mt-3 text-[12px] text-destructive" role="alert">
            {status.message}
          </p>
        )}
      </section>

      <p className="text-center text-[12px] text-muted-foreground">
        The code is only spent when you copy, so opening this page costs nothing.
      </p>
    </PageShell>
  );
}
