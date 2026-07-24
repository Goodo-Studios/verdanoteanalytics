// US-003: Builder-only per-account taxonomy config surface — the "Taxonomy" tab
// in Settings. Manages the account's governed Theme/Persona list (add, rename,
// soft archive) and toggles which house-menu creative types are active for the
// account. All reads/writes go through the session-authed account-taxonomy edge
// function (see ./api.ts); rendering is gated builder-only by SettingsPage.

import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Archive,
  ArchiveRestore,
  Check,
  Loader2,
  Pencil,
  Plus,
  Sprout,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { useAccountContext } from "@/contexts/AccountContext";
import { isReviewMiningOrigin, TaxonomyTheme, TaxonomyCreativeType } from "./api";
import { useAccountTaxonomy } from "./useAccountTaxonomy";

export interface TaxonomyAccountOption {
  id: string;
  name: string;
}

interface TaxonomyConfigSectionProps {
  accounts: TaxonomyAccountOption[];
}

function themeDisplayName(t: TaxonomyTheme): string {
  return t.label || t.theme || "Untitled";
}

const TaxonomyConfigSection = ({ accounts }: TaxonomyConfigSectionProps) => {
  const { selectedAccountId: appAccountId } = useAccountContext();
  const [accountId, setAccountId] = useState<string | null>(null);

  // Default to the app-level selected account when it's a real account we can
  // see, else the first account. Re-run as the (async) accounts list arrives.
  useEffect(() => {
    if (accountId && accounts.some((a) => a.id === accountId)) return;
    const appMatch =
      appAccountId && appAccountId !== "all" && accounts.some((a) => a.id === appAccountId)
        ? appAccountId
        : null;
    setAccountId(appMatch ?? accounts[0]?.id ?? null);
  }, [accounts, appAccountId, accountId]);

  const { query, create, rename, setArchived, setTypeActive, seed } =
    useAccountTaxonomy(accountId);

  const [newName, setNewName] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");

  const taxonomy = query.data;

  const { liveThemes, archivedThemes } = useMemo(() => {
    const themes = taxonomy?.themes ?? [];
    return {
      liveThemes: themes.filter((t) => !t.archived),
      archivedThemes: themes.filter((t) => t.archived),
    };
  }, [taxonomy]);

  // Group creative types by lane, preserving payload order (lane then sort).
  const lanes = useMemo(() => {
    const byLane = new Map<string, TaxonomyCreativeType[]>();
    for (const ct of taxonomy?.creative_types ?? []) {
      const list = byLane.get(ct.lane);
      if (list) list.push(ct);
      else byLane.set(ct.lane, [ct]);
    }
    return [...byLane.entries()];
  }, [taxonomy]);

  const handleCreate = () => {
    const name = newName.trim();
    if (!name || create.isPending) return;
    create.mutate(name, {
      onSuccess: () => setNewName(""),
      onError: (err) => toast.error(err instanceof Error ? err.message : "Failed to add Theme/Persona"),
    });
  };

  const startRename = (t: TaxonomyTheme) => {
    setEditingId(t.id);
    setEditingName(themeDisplayName(t));
  };

  const handleRenameSave = () => {
    const name = editingName.trim();
    if (!editingId || !name || rename.isPending) return;
    rename.mutate(
      { angleId: editingId, name },
      {
        onSuccess: () => setEditingId(null),
        onError: (err) => toast.error(err instanceof Error ? err.message : "Failed to rename"),
      },
    );
  };

  const handleArchiveToggle = (t: TaxonomyTheme) => {
    if (setArchived.isPending) return;
    setArchived.mutate(
      { angleId: t.id, archived: !t.archived },
      {
        onError: (err) => toast.error(err instanceof Error ? err.message : "Failed to update"),
      },
    );
  };

  const handleSeed = () => {
    if (seed.isPending) return;
    seed.mutate(undefined, {
      onSuccess: (res) => {
        if (res.seed.empty) {
          toast.info("No review-mining output found — list stays empty");
        } else {
          toast.success(
            `Seeded ${res.seed.review_mining_count} Theme/Persona${res.seed.review_mining_count === 1 ? "" : "s"} from review mining`,
          );
        }
      },
      onError: (err) => toast.error(err instanceof Error ? err.message : "Seed failed"),
    });
  };

  const handleTypeToggle = (ct: TaxonomyCreativeType, active: boolean) => {
    setTypeActive.mutate(
      { creativeTypeId: ct.creative_type_id, active },
      {
        onError: (err) =>
          toast.error(err instanceof Error ? err.message : "Failed to update creative type"),
      },
    );
  };

  if (accounts.length === 0) {
    return (
      <div className="glass-panel p-8 flex flex-col items-center justify-center text-center max-w-2xl">
        <p className="font-body text-[13px] text-slate">
          Add ad accounts in the Admin tab to configure their taxonomy.
        </p>
      </div>
    );
  }

  return (
    <div className="max-w-2xl space-y-6">
      {/* Account picker */}
      <div className="glass-panel p-6 space-y-3">
        <div>
          <h3 className="font-heading text-[16px] text-forest">Account taxonomy</h3>
          <p className="font-body text-[12px] text-slate mt-1">
            Govern this account's Theme/Persona list and which house creative types are active
            when tagging.
          </p>
        </div>
        <Select value={accountId ?? ""} onValueChange={(v) => setAccountId(v)}>
          <SelectTrigger className="w-72">
            <SelectValue placeholder="Select an account" />
          </SelectTrigger>
          <SelectContent>
            {accounts.map((acc) => (
              <SelectItem key={acc.id} value={acc.id}>
                {acc.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {query.isLoading && (
        <div className="glass-panel p-8 flex items-center justify-center">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      )}

      {query.isError && !query.isLoading && (
        <div className="glass-panel p-8 flex flex-col items-center justify-center text-center gap-3">
          <p className="font-body text-[13px] text-slate">
            {query.error instanceof Error ? query.error.message : "Failed to load taxonomy."}
          </p>
          <Button size="sm" variant="outline" onClick={() => query.refetch()}>
            Retry
          </Button>
        </div>
      )}

      {taxonomy && !query.isError && (
        <>
          {/* Panel 1: Theme / Persona list */}
          <div className="glass-panel p-6 space-y-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="font-heading text-[16px] text-forest">Theme / Persona list</h3>
                <p className="font-body text-[12px] text-slate mt-1">
                  The governed list strategists pick from when tagging. Archiving hides an entry
                  without breaking existing tags.
                </p>
              </div>
              <Button
                size="sm"
                variant="outline"
                onClick={handleSeed}
                disabled={seed.isPending}
                className="shrink-0"
              >
                {seed.isPending ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
                ) : (
                  <Sprout className="h-3.5 w-3.5 mr-1.5" />
                )}
                Seed from review mining
              </Button>
            </div>

            {/* Add new */}
            <div className="flex items-center gap-2">
              <Input
                className="h-8 text-[13px]"
                placeholder="New Theme/Persona (e.g. Busy parents, Value seekers)"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleCreate();
                }}
              />
              <Button
                size="sm"
                onClick={handleCreate}
                disabled={create.isPending || newName.trim().length === 0}
              >
                {create.isPending ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
                ) : (
                  <Plus className="h-3.5 w-3.5 mr-1.5" />
                )}
                Add
              </Button>
            </div>

            {/* Live rows */}
            {liveThemes.length === 0 && archivedThemes.length === 0 ? (
              <p className="font-body text-[12px] text-muted-foreground py-2">
                No Theme/Personas yet — add one above or seed from review mining.
              </p>
            ) : (
              <div className="space-y-1">
                {liveThemes.map((t) => (
                  <ThemeRow
                    key={t.id}
                    theme={t}
                    editing={editingId === t.id}
                    editingName={editingName}
                    setEditingName={setEditingName}
                    onStartRename={() => startRename(t)}
                    onSaveRename={handleRenameSave}
                    onCancelRename={() => setEditingId(null)}
                    renamePending={rename.isPending && editingId === t.id}
                    onArchiveToggle={() => handleArchiveToggle(t)}
                    archivePending={
                      setArchived.isPending && setArchived.variables?.angleId === t.id
                    }
                  />
                ))}

                {archivedThemes.length > 0 && (
                  <>
                    <div className="flex items-center gap-2 pt-3 pb-1">
                      <span className="font-body text-[10px] uppercase tracking-wider text-muted-foreground font-medium">
                        Archived ({archivedThemes.length})
                      </span>
                      <div className="flex-1 border-t border-border-light" />
                    </div>
                    {archivedThemes.map((t) => (
                      <ThemeRow
                        key={t.id}
                        theme={t}
                        editing={editingId === t.id}
                        editingName={editingName}
                        setEditingName={setEditingName}
                        onStartRename={() => startRename(t)}
                        onSaveRename={handleRenameSave}
                        onCancelRename={() => setEditingId(null)}
                        renamePending={rename.isPending && editingId === t.id}
                        onArchiveToggle={() => handleArchiveToggle(t)}
                        archivePending={
                          setArchived.isPending && setArchived.variables?.angleId === t.id
                        }
                      />
                    ))}
                  </>
                )}
              </div>
            )}
          </div>

          {/* Panel 2: Creative types */}
          <div className="glass-panel p-6 space-y-4">
            <div>
              <h3 className="font-heading text-[16px] text-forest">Creative types</h3>
              <p className="font-body text-[12px] text-slate mt-1">
                Activate the subset of the house menu this account uses. Only active types appear
                when tagging.
              </p>
            </div>

            {lanes.length === 0 ? (
              <p className="font-body text-[12px] text-muted-foreground py-2">
                The house creative-type menu is empty.
              </p>
            ) : (
              <div className="space-y-5">
                {lanes.map(([lane, types]) => (
                  <div key={lane} className="space-y-1">
                    <div className="font-body text-[11px] uppercase tracking-wider text-muted-foreground font-medium pb-1 border-b border-border-light">
                      {lane}
                    </div>
                    {types.map((ct) => {
                      const pending =
                        setTypeActive.isPending &&
                        setTypeActive.variables?.creativeTypeId === ct.creative_type_id;
                      return (
                        <div
                          key={ct.creative_type_id}
                          className="flex items-center justify-between py-1.5"
                        >
                          <span className="font-body text-[13px] text-charcoal">
                            {ct.type_name}
                          </span>
                          <div className="flex items-center gap-2">
                            {pending && (
                              <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
                            )}
                            <Switch
                              checked={ct.active}
                              disabled={pending}
                              onCheckedChange={(checked) => handleTypeToggle(ct, checked)}
                              aria-label={`Toggle ${ct.type_name}`}
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
};

interface ThemeRowProps {
  theme: TaxonomyTheme;
  editing: boolean;
  editingName: string;
  setEditingName: (v: string) => void;
  onStartRename: () => void;
  onSaveRename: () => void;
  onCancelRename: () => void;
  renamePending: boolean;
  onArchiveToggle: () => void;
  archivePending: boolean;
}

function ThemeRow({
  theme,
  editing,
  editingName,
  setEditingName,
  onStartRename,
  onSaveRename,
  onCancelRename,
  renamePending,
  onArchiveToggle,
  archivePending,
}: ThemeRowProps) {
  const reviewMining = isReviewMiningOrigin(theme.origin);
  return (
    <div
      className={`flex items-center gap-2 p-2 rounded-md border border-border bg-card group ${
        theme.archived ? "opacity-50" : ""
      }`}
    >
      {editing ? (
        <>
          <Input
            className="h-7 text-[13px] flex-1"
            value={editingName}
            autoFocus
            onChange={(e) => setEditingName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") onSaveRename();
              if (e.key === "Escape") onCancelRename();
            }}
          />
          <button
            className="text-muted-foreground hover:text-foreground disabled:opacity-40"
            onClick={onSaveRename}
            disabled={renamePending || editingName.trim().length === 0}
            aria-label="Save name"
          >
            {renamePending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Check className="h-3.5 w-3.5" />
            )}
          </button>
          <button
            className="text-muted-foreground hover:text-foreground"
            onClick={onCancelRename}
            aria-label="Cancel rename"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </>
      ) : (
        <>
          <span className="font-body text-[13px] text-charcoal truncate">
            {themeDisplayName(theme)}
          </span>
          <button
            className="text-muted-foreground hover:text-foreground opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
            onClick={onStartRename}
            aria-label={`Rename ${themeDisplayName(theme)}`}
          >
            <Pencil className="h-3 w-3" />
          </button>
          <div className="flex-1" />
          <Badge variant="secondary" className="text-[10px] shrink-0">
            {reviewMining ? "Review mining" : "Manual"}
          </Badge>
          {theme.test_status && (
            <Badge variant="outline" className="text-[10px] shrink-0">
              {theme.test_status}
            </Badge>
          )}
          <button
            className="text-muted-foreground hover:text-foreground shrink-0 disabled:opacity-40"
            onClick={onArchiveToggle}
            disabled={archivePending}
            aria-label={theme.archived ? "Unarchive" : "Archive"}
            title={theme.archived ? "Unarchive" : "Archive"}
          >
            {archivePending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : theme.archived ? (
              <ArchiveRestore className="h-3.5 w-3.5" />
            ) : (
              <Archive className="h-3.5 w-3.5" />
            )}
          </button>
        </>
      )}
    </div>
  );
}

export default TaxonomyConfigSection;
