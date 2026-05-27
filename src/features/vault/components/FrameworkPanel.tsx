import { useEffect, useState } from "react";
import { Star } from "lucide-react";
import { cn } from "@/lib/utils";
import { CopyButton } from "./CopyButton";

/** Inspiration framework row shape — broader than `InspirationFramework` in
 * `types/vault.ts` to surface the full set of columns we display. */
export interface FrameworkRow {
  id: string;
  item_id: string;
  hook_type?: string | null;
  hook_verbal?: string | null;
  hook_text?: string | null;
  hook_visual?: string | null;
  hook_formula?: string | null;
  value_structure?: string | null;
  cta_type?: string | null;
  cta_formula?: string | null;
  fill_in_blank_script?: string | null;
  copywriting_framework?: string | null;
}

interface Props {
  framework: FrameworkRow;
  /** Called on blur when a field has changed. Parent is responsible for saving. */
  onSave?: (field: keyof FrameworkRow, value: string) => void;
  /** Whether the verbal hook is currently starred into the Hook Library. */
  hookVerbalSaved?: boolean;
  /** Whether the on-screen text hook is currently starred into the Hook Library. */
  hookTextSaved?: boolean;
  /** Whether the visual hook is currently starred into the Hook Library. */
  hookVisualSaved?: boolean;
  /** Called when the user toggles a hook star. */
  onToggleHookStar?: (
    field: "hook_verbal_saved" | "hook_text_saved" | "hook_visual_saved",
    value: boolean,
  ) => void;
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
  onSave,
  starred,
  onStar,
}: {
  label: string;
  badge?: string;
  badgeColor?: string;
  content?: string | null;
  mono?: boolean;
  onSave?: (value: string) => void;
  /** Current star state — when provided a star button renders in the header. */
  starred?: boolean;
  onStar?: () => void;
}) {
  const [draft, setDraft] = useState(content ?? "");

  // Keep draft in sync when parent data refreshes (e.g. re-analyze)
  useEffect(() => {
    setDraft(content ?? "");
  }, [content]);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
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
        <div className="flex items-center gap-1">
          {onStar !== undefined && (
            <button
              type="button"
              onClick={onStar}
              title={starred ? "Remove from Hook Library" : "Save to Hook Library"}
              className={cn(
                "p-1 rounded hover:bg-muted-foreground/10 transition-colors",
                starred ? "text-amber-500" : "text-muted-foreground",
              )}
            >
              <Star
                className={cn("w-3.5 h-3.5", starred && "fill-amber-500")}
              />
            </button>
          )}
          <CopyButton text={draft} />
        </div>
      </div>

      {onSave ? (
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => {
            if (draft !== (content ?? "")) onSave(draft);
          }}
          placeholder="—"
          className={cn(
            "w-full min-h-[80px] text-sm leading-relaxed bg-muted rounded-lg p-3 border-0 focus:outline-none focus:ring-2 focus:ring-primary/30 resize-y",
            mono && "font-mono text-xs",
          )}
        />
      ) : (
        <p
          className={cn(
            "text-sm leading-relaxed bg-muted rounded-lg p-3",
            mono && "font-mono text-xs whitespace-pre-wrap",
            !content && "text-muted-foreground italic",
          )}
        >
          {content || "—"}
        </p>
      )}
    </div>
  );
}

export function FrameworkPanel({
  framework,
  onSave,
  hookVerbalSaved = false,
  hookTextSaved = false,
  hookVisualSaved = false,
  onToggleHookStar,
}: Props) {
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
        {/* Verbal hook — what the creator says in the first 3s */}
        {(framework.hook_verbal || onToggleHookStar) && (
          <Section
            label="Verbal Hook"
            badge={hookLabel}
            badgeColor={hookColor}
            content={framework.hook_verbal}
            onSave={onSave ? (v) => onSave("hook_verbal", v) : undefined}
            starred={hookVerbalSaved}
            onStar={
              onToggleHookStar
                ? () => onToggleHookStar("hook_verbal_saved", !hookVerbalSaved)
                : undefined
            }
          />
        )}

        {/* On-screen text hook */}
        {(framework.hook_text || onToggleHookStar) && (
          <Section
            label="On-screen Text Hook"
            content={framework.hook_text}
            onSave={onSave ? (v) => onSave("hook_text", v) : undefined}
            starred={hookTextSaved}
            onStar={
              onToggleHookStar
                ? () => onToggleHookStar("hook_text_saved", !hookTextSaved)
                : undefined
            }
          />
        )}

        {/* Visual hook — what the viewer sees in the first 3s */}
        {(framework.hook_visual || onToggleHookStar) && (
          <Section
            label="Visual Hook"
            content={framework.hook_visual}
            onSave={onSave ? (v) => onSave("hook_visual", v) : undefined}
            starred={hookVisualSaved}
            onStar={
              onToggleHookStar
                ? () => onToggleHookStar("hook_visual_saved", !hookVisualSaved)
                : undefined
            }
          />
        )}

        <Section
          label="Hook Formula (0–3s)"
          content={framework.hook_formula}
          onSave={onSave ? (v) => onSave("hook_formula", v) : undefined}
        />
        <Section
          label="Value Delivery (3–50s)"
          content={framework.value_structure}
          onSave={onSave ? (v) => onSave("value_structure", v) : undefined}
        />
        <Section
          label={`CTA (50–60s)${framework.cta_type ? ` · ${framework.cta_type}` : ""}`}
          content={framework.cta_formula}
          onSave={onSave ? (v) => onSave("cta_formula", v) : undefined}
        />
        <Section
          label="Fill-in-the-blank Script"
          content={framework.fill_in_blank_script}
          mono
          onSave={onSave ? (v) => onSave("fill_in_blank_script", v) : undefined}
        />
      </div>
    </div>
  );
}
