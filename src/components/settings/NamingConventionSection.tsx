import { useState, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { GripVertical, Plus, X, ArrowRight, Info } from "lucide-react";
import { useAccountContext } from "@/contexts/AccountContext";
import { toast } from "sonner";

const AVAILABLE_TOKENS = [
  { id: "account", label: "Account", example: "NDC" },
  { id: "format", label: "Format", example: "UGC" },
  { id: "hook", label: "Hook", example: "Problem" },
  { id: "hooktype", label: "HookType", example: "Callout" },
  { id: "angle", label: "Angle", example: "Discount" },
  { id: "creator", label: "Creator", example: "Sarah" },
  { id: "version", label: "Version", example: "v1" },
  { id: "date", label: "Date (MMDD)", example: "0215" },
  { id: "campaign", label: "Campaign", example: "Spring" },
  { id: "custom", label: "Custom Text", example: "text" },
] as const;

const SEPARATORS = [
  { value: "_", label: "Underscore ( _ )" },
  { value: "-", label: "Hyphen ( - )" },
  { value: "|", label: "Pipe ( | )" },
  { value: " ", label: "Space" },
];

export interface NamingConventionConfig {
  tokens: string[];
  separator: string;
  required: string[];
  customTexts: Record<string, string>; // token index → custom text value
}

const DEFAULT_CONFIG: NamingConventionConfig = {
  tokens: ["account", "format", "hook", "angle", "version", "date"],
  separator: "_",
  required: ["account", "format", "hook"],
  customTexts: {},
};

function getStorageKey(accountId: string) {
  return `naming_convention_${accountId}`;
}

export function loadNamingConfig(accountId: string): NamingConventionConfig {
  try {
    const stored = localStorage.getItem(getStorageKey(accountId));
    if (stored) return JSON.parse(stored);
  } catch {}
  return DEFAULT_CONFIG;
}

function saveNamingConfig(accountId: string, config: NamingConventionConfig) {
  localStorage.setItem(getStorageKey(accountId), JSON.stringify(config));
}

export function validateAdName(name: string, config: NamingConventionConfig): { valid: boolean; issues: string[] } {
  const issues: string[] = [];
  const sep = config.separator;
  const parts = name.split(sep).map((p) => p.trim()).filter(Boolean);

  if (parts.length < config.required.length) {
    issues.push(`Expected at least ${config.tokens.length} parts separated by "${sep}", found ${parts.length}`);
  }

  // Check if number of parts matches token count (allowing some tolerance)
  if (parts.length < config.tokens.length) {
    issues.push(`Name has ${parts.length} segments but convention expects ${config.tokens.length}`);
  }

  // Check for empty required segments
  config.required.forEach((req, _) => {
    const tokenIndex = config.tokens.indexOf(req);
    if (tokenIndex >= 0 && tokenIndex < parts.length) {
      if (!parts[tokenIndex] || parts[tokenIndex].trim() === "") {
        const label = AVAILABLE_TOKENS.find((t) => t.id === req)?.label || req;
        issues.push(`Required field "${label}" is empty`);
      }
    } else if (tokenIndex === -1) {
      const label = AVAILABLE_TOKENS.find((t) => t.id === req)?.label || req;
      issues.push(`Required token "${label}" is not in the template`);
    }
  });

  // Version format check
  const versionIdx = config.tokens.indexOf("version");
  if (versionIdx >= 0 && versionIdx < parts.length) {
    if (!/^v?\d+$/i.test(parts[versionIdx])) {
      issues.push(`Version segment "${parts[versionIdx]}" doesn't match expected format (e.g., v1, v2)`);
    }
  }

  // Date format check
  const dateIdx = config.tokens.indexOf("date");
  if (dateIdx >= 0 && dateIdx < parts.length) {
    if (!/^\d{4}$/.test(parts[dateIdx])) {
      issues.push(`Date segment "${parts[dateIdx]}" doesn't match MMDD format (e.g., 0215)`);
    }
  }

  return { valid: issues.length === 0, issues };
}

export function NamingConventionSection() {
  const { selectedAccountId, selectedAccount } = useAccountContext();
  const [config, setConfig] = useState<NamingConventionConfig>(() =>
    selectedAccountId && selectedAccountId !== "all" ? loadNamingConfig(selectedAccountId) : DEFAULT_CONFIG
  );

  const accountAbbr = selectedAccount?.name?.substring(0, 3).toUpperCase() || "ACC";

  // Generate example
  const exampleParts = useMemo(() => {
    return config.tokens.map((tokenId) => {
      if (tokenId === "custom") return config.customTexts[tokenId] || "text";
      if (tokenId === "account") return accountAbbr;
      const token = AVAILABLE_TOKENS.find((t) => t.id === tokenId);
      return token?.example || tokenId;
    });
  }, [config.tokens, config.customTexts, accountAbbr]);

  const exampleName = exampleParts.join(config.separator);

  const handleAddToken = (tokenId: string) => {
    setConfig((prev) => ({ ...prev, tokens: [...prev.tokens, tokenId] }));
  };

  const handleRemoveToken = (index: number) => {
    setConfig((prev) => {
      const newTokens = prev.tokens.filter((_, i) => i !== index);
      const removedToken = prev.tokens[index];
      const newRequired = prev.required.filter((r) => r !== removedToken || newTokens.includes(removedToken));
      return { ...prev, tokens: newTokens, required: newRequired };
    });
  };

  const handleMoveToken = (fromIndex: number, direction: "up" | "down") => {
    const toIndex = direction === "up" ? fromIndex - 1 : fromIndex + 1;
    if (toIndex < 0 || toIndex >= config.tokens.length) return;
    setConfig((prev) => {
      const newTokens = [...prev.tokens];
      [newTokens[fromIndex], newTokens[toIndex]] = [newTokens[toIndex], newTokens[fromIndex]];
      return { ...prev, tokens: newTokens };
    });
  };

  const handleToggleRequired = (tokenId: string) => {
    setConfig((prev) => ({
      ...prev,
      required: prev.required.includes(tokenId)
        ? prev.required.filter((r) => r !== tokenId)
        : [...prev.required, tokenId],
    }));
  };

  const handleSave = () => {
    if (!selectedAccountId || selectedAccountId === "all") {
      toast.error("Select a specific account to save naming convention");
      return;
    }
    saveNamingConfig(selectedAccountId, config);
    toast.success("Naming convention saved");
  };

  const availableToAdd = AVAILABLE_TOKENS.filter(
    (t) => t.id === "custom" || !config.tokens.includes(t.id)
  );

  if (!selectedAccountId || selectedAccountId === "all") {
    return (
      <div className="glass-panel p-6 text-center">
        <p className="text-sm text-muted-foreground">Select a specific account to configure naming conventions.</p>
      </div>
    );
  }

  return (
    <div className="max-w-2xl space-y-6">
      <div className="glass-panel p-6 space-y-5">
        <div>
          <h3 className="card-title mb-1">Naming Convention Template</h3>
          <p className="text-xs text-muted-foreground">
            Define how ad names should be structured for consistent auto-tagging and reporting.
          </p>
        </div>

        {/* Separator */}
        <div className="space-y-1.5">
          <Label className="text-xs font-medium">Separator</Label>
          <Select value={config.separator} onValueChange={(v) => setConfig((prev) => ({ ...prev, separator: v }))}>
            <SelectTrigger className="w-48 h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SEPARATORS.map((s) => (
                <SelectItem key={s.value} value={s.value} className="text-xs">
                  {s.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Token list */}
        <div className="space-y-1.5">
          <Label className="text-xs font-medium">Template Tokens (drag to reorder)</Label>
          <div className="space-y-1">
            {config.tokens.map((tokenId, idx) => {
              const token = AVAILABLE_TOKENS.find((t) => t.id === tokenId);
              const isRequired = config.required.includes(tokenId);
              return (
                <div
                  key={`${tokenId}-${idx}`}
                  className="flex items-center gap-2 p-2 rounded-md border border-border bg-card group"
                >
                  <div className="flex flex-col gap-0.5">
                    <button
                      className="text-muted-foreground hover:text-foreground disabled:opacity-30"
                      disabled={idx === 0}
                      onClick={() => handleMoveToken(idx, "up")}
                    >
                      <GripVertical className="h-3 w-3 rotate-180" />
                    </button>
                    <button
                      className="text-muted-foreground hover:text-foreground disabled:opacity-30"
                      disabled={idx === config.tokens.length - 1}
                      onClick={() => handleMoveToken(idx, "down")}
                    >
                      <GripVertical className="h-3 w-3" />
                    </button>
                  </div>
                  <Badge variant="secondary" className="text-xs shrink-0">
                    {`{${token?.label || tokenId}}`}
                  </Badge>
                  {tokenId === "custom" && (
                    <Input
                      className="h-6 text-xs w-24"
                      placeholder="text"
                      value={config.customTexts[tokenId] || ""}
                      onChange={(e) =>
                        setConfig((prev) => ({
                          ...prev,
                          customTexts: { ...prev.customTexts, [tokenId]: e.target.value },
                        }))
                      }
                    />
                  )}
                  <div className="flex-1" />
                  <div className="flex items-center gap-1.5">
                    <Checkbox
                      id={`req-${tokenId}-${idx}`}
                      checked={isRequired}
                      onCheckedChange={() => handleToggleRequired(tokenId)}
                      className="h-3.5 w-3.5"
                    />
                    <label htmlFor={`req-${tokenId}-${idx}`} className="text-[10px] text-muted-foreground cursor-pointer">
                      Required
                    </label>
                  </div>
                  <button
                    className="text-muted-foreground hover:text-destructive opacity-0 group-hover:opacity-100 transition-opacity"
                    onClick={() => handleRemoveToken(idx)}
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              );
            })}
          </div>

          {/* Add token */}
          {availableToAdd.length > 0 && (
            <div className="flex items-center gap-2 mt-2 flex-wrap">
              <span className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium">Add:</span>
              {availableToAdd.map((t) => (
                <button
                  key={t.id}
                  className="inline-flex items-center gap-1 px-2 py-1 rounded border border-dashed border-border text-xs text-muted-foreground hover:text-foreground hover:border-primary transition-colors"
                  onClick={() => handleAddToken(t.id)}
                >
                  <Plus className="h-3 w-3" />
                  {t.label}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Example preview */}
        <div className="space-y-1.5">
          <Label className="text-xs font-medium">Example Preview</Label>
          <div className="flex items-center gap-2 p-3 rounded-md bg-muted/50 border border-border">
            <ArrowRight className="h-3.5 w-3.5 text-primary shrink-0" />
            <code className="text-sm font-mono font-medium text-foreground break-all">{exampleName}</code>
          </div>
          <div className="flex items-center gap-1.5 mt-1">
            <Info className="h-3 w-3 text-muted-foreground" />
            <span className="text-[10px] text-muted-foreground">
              Required tokens: {config.required.map((r) => AVAILABLE_TOKENS.find((t) => t.id === r)?.label || r).join(", ") || "None"}
            </span>
          </div>
        </div>

        <Button size="sm" onClick={handleSave}>Save Convention</Button>
      </div>
    </div>
  );
}
