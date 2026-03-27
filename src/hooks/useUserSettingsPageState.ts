import { useState, useEffect, useCallback, useRef } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useSettings, useTestMeta } from "@/hooks/useSettingsApi";
import { useAccounts, useAddAccount, useDeleteAccount, useRenameAccount } from "@/hooks/useAccountsApi";
import { useSync, useRefreshMedia } from "@/hooks/useSyncApi";
import { useUsers, useCreateUser, useDeleteUser, useUpdateUser } from "@/hooks/useUsersApi";

export function useUserSettingsPageState() {
  const { user, role, isBuilder } = useAuth();

  // Profile state
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [savingProfile, setSavingProfile] = useState(false);
  const [savingPassword, setSavingPassword] = useState(false);
  const [loadingProfile, setLoadingProfile] = useState(true);

  // Admin state
  const [metaStatus, setMetaStatus] = useState<"unknown" | "connected" | "disconnected" | "testing">("unknown");
  const [metaUser, setMetaUser] = useState<string | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState<string | null>(null);
  const [renamingAccount, setRenamingAccount] = useState<{ id: string; name: string } | null>(null);
  const [availableAccounts, setAvailableAccounts] = useState<any[]>([]);
  const [loadingAccounts, setLoadingAccounts] = useState(false);
  const metaCacheRef = useRef<{ accounts: any[]; timestamp: number } | null>(null);
  const META_CACHE_TTL = 60_000; // 60 seconds
  const [showCreateUser, setShowCreateUser] = useState(false);
  const [newUserEmail, setNewUserEmail] = useState("");
  const [newUserPassword, setNewUserPassword] = useState("");
  const [newUserName, setNewUserName] = useState("");
  const [newUserRole, setNewUserRole] = useState<string>("client");
  const [newUserAccountIds, setNewUserAccountIds] = useState<string[]>([]);
  const [showDeleteUserConfirm, setShowDeleteUserConfirm] = useState<string | null>(null);

  // API hooks
  const { data: settings } = useSettings();
  const testMeta = useTestMeta();
  const { data: rawAccounts } = useAccounts();
  const accounts = [...(rawAccounts || [])].sort((a: any, b: any) => a.name.localeCompare(b.name));
  const addAccount = useAddAccount();
  const deleteAccount = useDeleteAccount();
  const renameAccount = useRenameAccount();
  const sync = useSync();
  const refreshMedia = useRefreshMedia();
  const { data: users } = useUsers();
  const createUser = useCreateUser();
  const deleteUser = useDeleteUser();

  const existingIds = new Set((accounts || []).map((a: any) => a.id));

  useEffect(() => {
    if (settings) {
      setMetaStatus(settings.meta_access_token_set === "true" ? "connected" : "disconnected");
    }
  }, [settings]);

  useEffect(() => {
    if (user) {
      setEmail(user.email || "");
      loadProfile();
    }
  }, [user]);

  const loadProfile = useCallback(async () => {
    if (!user) return;
    setLoadingProfile(true);
    const { data } = await supabase.from("profiles").select("display_name").eq("user_id", user.id).single();
    if (data) setDisplayName(data.display_name || "");
    setLoadingProfile(false);
  }, [user]);

  const handleSaveProfile = useCallback(async () => {
    if (!user) return;
    setSavingProfile(true);
    try {
      const { error } = await supabase.from("profiles").update({ display_name: displayName }).eq("user_id", user.id);
      if (error) throw error;
      toast.success("Your display name has been saved.");
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSavingProfile(false);
    }
  }, [user, displayName]);

  const handleChangePassword = useCallback(async () => {
    if (newPassword !== confirmPassword) { toast.error("Passwords don't match"); return; }
    if (newPassword.length < 6) { toast.error("Password too short — at least 6 characters."); return; }
    setSavingPassword(true);
    try {
      const { error } = await supabase.auth.updateUser({ password: newPassword });
      if (error) throw error;
      toast.success("Password updated");
      setNewPassword("");
      setConfirmPassword("");
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSavingPassword(false);
    }
  }, [newPassword, confirmPassword]);

  const handleTestConnection = useCallback(async () => {
    setMetaStatus("testing");
    try {
      const result = await testMeta.mutateAsync(undefined);
      if (result.connected) {
        setMetaStatus("connected");
        setMetaUser(result.user?.name || null);
        toast.success(`Connected to Meta as ${result.user?.name}. ${result.accounts?.length || 0} ad accounts found.`);
        if (result.tokenWarning) toast.warning(result.tokenWarning);
      } else {
        setMetaStatus("disconnected");
        toast.error(`Connection failed: ${result.error}`);
      }
    } catch (e: any) {
      setMetaStatus("disconnected");
      toast.error(e.message);
    }
  }, [testMeta]);

  const handleOpenAddModal = useCallback(async () => {
    setShowAddModal(true);

    // Use cached results if fresh enough
    if (metaCacheRef.current && Date.now() - metaCacheRef.current.timestamp < META_CACHE_TTL) {
      setAvailableAccounts(metaCacheRef.current.accounts);
      return;
    }

    setLoadingAccounts(true);
    try {
      const result = await testMeta.mutateAsync(undefined);
      if (result.connected) {
        setAvailableAccounts(result.accounts || []);
        metaCacheRef.current = { accounts: result.accounts || [], timestamp: Date.now() };
      } else {
        toast.error(result.error || "Meta token not configured.");
        setShowAddModal(false);
      }
    } catch {
      toast.error("Failed to fetch accounts.");
      setShowAddModal(false);
    } finally {
      setLoadingAccounts(false);
    }
  }, [testMeta]);

  const handleAddAccount = useCallback(async (account: { id: string; name: string }) => {
    await addAccount.mutateAsync(account);
    sync.mutate({ account_id: account.id, sync_type: "initial" });
    setShowAddModal(false);
  }, [addAccount, sync]);

  const handleCreateUser = useCallback(async () => {
    if (!newUserEmail || !newUserPassword) return;
    await createUser.mutateAsync({
      email: newUserEmail,
      password: newUserPassword,
      role: newUserRole,
      display_name: newUserName || undefined,
      account_ids: newUserRole === "client" ? newUserAccountIds : undefined,
    });
    setShowCreateUser(false);
    setNewUserEmail("");
    setNewUserPassword("");
    setNewUserName("");
    setNewUserRole("client");
    setNewUserAccountIds([]);
  }, [newUserEmail, newUserPassword, newUserRole, newUserName, newUserAccountIds, createUser]);

  return {
    // Auth
    user, role, isBuilder,
    // Profile
    displayName, setDisplayName, email, loadingProfile,
    newPassword, setNewPassword, confirmPassword, setConfirmPassword,
    savingProfile, savingPassword,
    handleSaveProfile, handleChangePassword,
    // Meta connection
    metaStatus, metaUser, handleTestConnection,
    // Accounts
    accounts, existingIds,
    showAddModal, setShowAddModal, availableAccounts, loadingAccounts,
    handleOpenAddModal, handleAddAccount, addAccount,
    renamingAccount, setRenamingAccount, renameAccount,
    showDeleteConfirm, setShowDeleteConfirm, deleteAccount,
    sync, refreshMedia,
    // Users
    users,
    showCreateUser, setShowCreateUser,
    newUserEmail, setNewUserEmail, newUserPassword, setNewUserPassword,
    newUserName, setNewUserName, newUserRole, setNewUserRole,
    newUserAccountIds, setNewUserAccountIds,
    handleCreateUser, createUser,
    showDeleteUserConfirm, setShowDeleteUserConfirm, deleteUser,
  };
}
