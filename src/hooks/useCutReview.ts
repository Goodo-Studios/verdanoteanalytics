// Cut review (OS-020). Versions of a task and the timestamped comments on each.
//
// Staff read os_task_versions directly (staff-only row rule) and add versions through
// os_add_task_version. A client reads versions only through os_client_task_versions, which returns
// nothing unless the task is their own client's and in a client stage. Comments on a version go
// through post_task_version_comment and list_task_version_comments, which never return internal
// comments to a client.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toCutComments, toVersions, type CommentThread, type CutComment, type TaskVersion } from "@/lib/cutReview";

type Result = PromiseLike<{ data: unknown; error: { message: string; code?: string } | null }>;
type Query = Result & { eq(col: string, v: unknown): Query; order(col: string, o: { ascending: boolean }): Query };
type Untyped = {
  rpc(fn: string, args?: Record<string, unknown>): Result;
  from(table: string): { select(cols: string): Query };
};
const db = () => supabase as unknown as Untyped;

export type Viewer = "client" | "staff";

export const versionsKey = (viewer: Viewer, taskId: string | null) => ["cut-versions", viewer, taskId] as const;
export const cutCommentsKey = (viewer: Viewer, versionId: string | null) => ["cut-comments", viewer, versionId] as const;

export function useTaskVersions(viewer: Viewer, taskId: string | null) {
  return useQuery<TaskVersion[]>({
    queryKey: versionsKey(viewer, taskId),
    enabled: !!taskId,
    staleTime: 30_000,
    queryFn: async () => {
      const res =
        viewer === "client"
          ? await db().rpc("os_client_task_versions", { p_task_id: taskId })
          : await db().from("os_task_versions").select("id, version_no, label, video_url, created_at").eq("task_id", taskId).order("version_no", { ascending: false });
      if (res.error) throw new Error(res.error.message);
      return toVersions(res.data);
    },
  });
}

export function useCutComments(viewer: Viewer, versionId: string | null) {
  return useQuery<CutComment[]>({
    queryKey: cutCommentsKey(viewer, versionId),
    enabled: !!versionId,
    queryFn: async () => {
      const { data, error } = await db().rpc("list_task_version_comments", { p_version_id: versionId });
      if (error) throw new Error(error.message);
      return toCutComments(data, { clientOnly: viewer === "client" });
    },
  });
}

export function usePostCutComment(viewer: Viewer, versionId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { thread: CommentThread; body: string; timecodeMs: number | null }) => {
      if (viewer === "client" && input.thread !== "client") throw new Error("Your comment could not be sent.");
      const { error } = await db().rpc("post_task_version_comment", {
        p_version_id: versionId,
        p_thread: input.thread,
        p_body: input.body,
        p_timecode_ms: input.timecodeMs,
      });
      if (error) throw new Error("Your comment could not be sent. Please try again.");
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: cutCommentsKey(viewer, versionId) }),
  });
}

export function useAddVersion(taskId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { url: string; label: string }) => {
      const { data, error } = await db().rpc("os_add_task_version", {
        p_task_id: taskId,
        p_video_url: input.url.trim(),
        p_label: input.label.trim() || null,
      });
      if (error) throw new Error(error.code === "22023" ? "Use a link that starts with https://." : "The version could not be added.");
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: versionsKey("staff", taskId) }),
  });
}
