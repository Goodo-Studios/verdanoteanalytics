import { cn } from "@/lib/utils";

/** Inspiration framework row shape — broader than `InspirationFramework` in
 * `types/vault.ts` to surface the full set of columns we display. */
export interface FrameworkRow {
  id: string;
  item_id: string;
  hook_type?: string | null;
  hook_verbal?: string | null;
  hook_text?: string | null;
  hook_formula?: string | null;
  value_structure?: string | null;
  cta_type?: string | null;
  cta_formula?: string | null;
  fill_in_blank_script?: string | null;
  copywriting_framework?: string | null;
}

interface Props {
  framework: FrameworkRow;
}

const HOOK_TYPE_LABELS: Record<string, string> = {
  bold_claim: "Bold Claim",
  pattern_interrupt: "Pattern Interrupt",
  honest_admission: "Honest Admission",
  question: "Question",
  other: "Other",
};

const HOOK_TYPE_COLORS: Record<string, string> = {
  bold_claim: "bg-orange-100 text-orange-800",
  pattern_interrupt: "bg-purple-100 text-purple-800",
  honest_admission: "bg-blue-100 text-blue-800",
  question: "bg-green-100 text-green-800",
  other: "bg-gray-100 text-gray-700",
};

const FRAMEWORK_DESCRIPTIONS: Record<string, string> = {
  AIDA: "Attention → Interest → Desire → Action",
  PAS: "Problem → Agitate → Solution",
  BAB: "Before → After → Bridge",
  FAB: "Features → Advantages → Benefits",
  HSO: "Hook → Story → Offer",
  PASTOR: "Problem → Amplify → Story → Testimony → Offer → Response",
  "4Ps": "Picture → Promise → Prove → Push",
  SLAP: "Stop → Look → Act → Purchase",
};

function Section({
  label,
  badge,
  badgeColor,
  content,
  mono,
}: {
  label: string;
  badge?: string;
  badgeColor?: string;
  content?: string | null;
  mono?: boolean;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {label}
        </span>
        {badge && (
          <span
            className={cn(
              "text-xs font-medium px-2 py-0.5 rounded-full",
              badgeColor,
            )}
          >
            {badge}
          </span>
        )}
      </div>
      <p
        className={cn(
          "text-sm leading-relaxed bg-muted rounded-lg p-3",
          mono && "font-mono text-xs whitespace-pre-wrap",
          !content && "text-muted-foreground italic",
        )}
      >
        {content || "—"}
      </p>
    </div>
  );
}

/** Read-only framework display for an inspiration item.
 *
 * Mirrors the Creative Vault component's structure but drops inline editing —
 * Verdanote's US-007 only requires reading the framework; edits land via
 * Re-analyze, which regenerates the row from the source. */
export function FrameworkPanel({ framework }: Props) {
  const hookLabel = framework.hook_type
    ? HOOK_TYPE_LABELS[framework.hook_type] ?? framework.hook_type
    : undefined;
  const hookColor = framework.hook_type
    ? HOOK_TYPE_COLORS[framework.hook_type] ?? HOOK_TYPE_COLORS.other
    : undefined;
  const frameworkDescription = framework.copywriting_framework
    ? FRAMEWORK_DESCRIPTIONS[framework.copywriting_framework] ?? null
    : null;

  return (
    <div className="space-y-6">
      <div>
        <h3 className="font-semibold mb-1">Content Framework</h3>
        <p className="text-sm text-muted-foreground">
          Extracted structure — adapt the formulas for any brand.
        </p>
      </div>

      <div className="rounded-lg border border-border bg-muted/50 px-4 py-3 space-y-1">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Copywriting Framework
        </p>
        <div className="flex items-baseline gap-2 flex-wrap">
          {framework.copywriting_framework ? (
            <>
              <span className="text-base font-semibold text-foreground">
                {framework.copywriting_framework}
              </span>
              {frameworkDescription && (
                <span className="text-sm text-muted-foreground">
                  {frameworkDescription}
                </span>
              )}
            </>
          ) : (
            <span className="text-sm text-muted-foreground italic">—</span>
          )}
        </div>
      </div>

      <div className="space-y-5">
        <Section
          label="Hook (0–3s)"
          badge={hookLabel}
          badgeColor={hookColor}
          content={framework.hook_formula}
        />
        <Section
          label="Value Delivery (3–50s)"
          content={framework.value_structure}
        />
        <Section
          label={`CTA (50–60s)${framework.cta_type ? ` · ${framework.cta_type}` : ""}`}
          content={framework.cta_formula}
        />
        <Section
          label="Fill-in-the-blank Script"
          content={framework.fill_in_blank_script}
          mono
        />
      </div>
    </div>
  );
}
