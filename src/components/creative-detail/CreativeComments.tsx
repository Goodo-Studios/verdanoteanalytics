import { useState, useMemo, useRef, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import {
  Send, MessageSquare, ChevronDown, ChevronRight, CheckCircle2,
  Circle, Reply, Loader2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { format } from "date-fns";

const REACTIONS = ["👍", "❤️", "🔥", "💡", "⚠️"] as const;

interface Comment {
  id: string;
  ad_id: string;
  account_id: string;
  user_id: string;
  parent_id: string | null;
  body: string;
  mentions: string[];
  reactions: Record<string, string[]>; // emoji -> user_ids
  is_resolved: boolean;
  created_at: string;
  updated_at: string;
  // joined
  user_email?: string;
  user_name?: string;
}

interface CreativeCommentsProps {
  adId: string;
  accountId: string;
}

export function CreativeComments({ adId, accountId }: CreativeCommentsProps) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [newComment, setNewComment] = useState("");
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [replyText, setReplyText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [showResolved, setShowResolved] = useState(false);
  const [mentionSearch, setMentionSearch] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Fetch comments
  const { data: comments = [], isLoading } = useQuery({
    queryKey: ["creative_comments", adId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("creative_comments")
        .select("*")
        .eq("ad_id", adId)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return (data || []) as Comment[];
    },
    enabled: !!adId,
  });

  // Fetch team members for @mentions
  const { data: teamMembers = [] } = useQuery({
    queryKey: ["profiles_for_mentions"],
    queryFn: async () => {
      const { data } = await supabase
        .from("profiles")
        .select("user_id, email, display_name");
      return (data || []).map((p: any) => ({
        id: p.user_id,
        name: p.display_name || p.email?.split("@")[0] || "User",
        email: p.email,
      }));
    },
  });

  // Realtime subscription
  useEffect(() => {
    const channel = supabase
      .channel(`comments:${adId}`)
      .on("postgres_changes", {
        event: "*",
        schema: "public",
        table: "creative_comments",
        filter: `ad_id=eq.${adId}`,
      }, () => {
        queryClient.invalidateQueries({ queryKey: ["creative_comments", adId] });
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [adId, queryClient]);

  // Organize threads
  const { rootComments, repliesByParent, unresolvedCount, resolvedCount } = useMemo(() => {
    const roots: Comment[] = [];
    const replies: Record<string, Comment[]> = {};
    let unresolved = 0;
    let resolved = 0;

    for (const c of comments) {
      if (c.parent_id) {
        if (!replies[c.parent_id]) replies[c.parent_id] = [];
        replies[c.parent_id].push(c);
      } else {
        roots.push(c);
        if (c.is_resolved) resolved++;
        else unresolved++;
      }
    }
    return { rootComments: roots, repliesByParent: replies, unresolvedCount: unresolved, resolvedCount: resolved };
  }, [comments]);

  const getUserName = (userId: string) => {
    const member = teamMembers.find((m: any) => m.id === userId);
    return member?.name || "User";
  };

  const handleSubmit = async (parentId?: string) => {
    const body = parentId ? replyText.trim() : newComment.trim();
    if (!body || !user) return;

    // Extract @mentions
    const mentionRegex = /@(\w+)/g;
    const mentions: string[] = [];
    let match;
    while ((match = mentionRegex.exec(body)) !== null) {
      const found = teamMembers.find((m: any) =>
        m.name.toLowerCase() === match![1].toLowerCase()
      );
      if (found) mentions.push(found.id);
    }

    setSubmitting(true);
    try {
      const { error } = await supabase.from("creative_comments").insert({
        ad_id: adId,
        account_id: accountId,
        user_id: user.id,
        parent_id: parentId || null,
        body,
        mentions,
      } as any);
      if (error) throw error;
      if (parentId) {
        setReplyText("");
        setReplyTo(null);
      } else {
        setNewComment("");
      }
    } catch (err: any) {
      toast.error("Failed to post comment", { description: err.message });
    } finally {
      setSubmitting(false);
    }
  };

  const handleReaction = async (commentId: string, emoji: string) => {
    if (!user) return;
    const comment = comments.find((c) => c.id === commentId);
    if (!comment) return;

    const reactions = { ...(comment.reactions || {}) };
    const users = reactions[emoji] || [];

    if (users.includes(user.id)) {
      reactions[emoji] = users.filter((id: string) => id !== user.id);
      if (reactions[emoji].length === 0) delete reactions[emoji];
    } else {
      reactions[emoji] = [...users, user.id];
    }

    await supabase
      .from("creative_comments")
      .update({ reactions } as any)
      .eq("id", commentId);

    queryClient.invalidateQueries({ queryKey: ["creative_comments", adId] });
  };

  const handleToggleResolve = async (commentId: string, currentState: boolean) => {
    await supabase
      .from("creative_comments")
      .update({ is_resolved: !currentState } as any)
      .eq("id", commentId);
    queryClient.invalidateQueries({ queryKey: ["creative_comments", adId] });
  };

  // @mention autocomplete
  const filteredMentions = mentionSearch != null
    ? teamMembers.filter((m: any) =>
        m.name.toLowerCase().includes(mentionSearch.toLowerCase())
      ).slice(0, 5)
    : [];

  const handleTextChange = (value: string, setter: (v: string) => void) => {
    setter(value);
    const lastAt = value.lastIndexOf("@");
    if (lastAt >= 0) {
      const afterAt = value.slice(lastAt + 1);
      if (afterAt.length > 0 && !afterAt.includes(" ")) {
        setMentionSearch(afterAt);
      } else if (afterAt.length === 0) {
        setMentionSearch("");
      } else {
        setMentionSearch(null);
      }
    } else {
      setMentionSearch(null);
    }
  };

  const insertMention = (name: string, setter: (v: string) => void, currentValue: string) => {
    const lastAt = currentValue.lastIndexOf("@");
    const before = currentValue.slice(0, lastAt);
    setter(`${before}@${name} `);
    setMentionSearch(null);
  };

  const renderBody = (body: string) => {
    return body.replace(/@(\w+)/g, (match) => match).split(/(@\w+)/g).map((part, i) => {
      if (part.startsWith("@")) {
        return <span key={i} className="text-primary font-semibold">{part}</span>;
      }
      return <span key={i}>{part}</span>;
    });
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Summary */}
      <div className="flex items-center gap-3">
        <MessageSquare className="h-4 w-4 text-muted-foreground" />
        <span className="font-body text-[13px] text-foreground font-medium">
          {unresolvedCount} open thread{unresolvedCount !== 1 ? "s" : ""}
        </span>
        {resolvedCount > 0 && (
          <button
            onClick={() => setShowResolved(!showResolved)}
            className="font-body text-[12px] text-muted-foreground hover:text-foreground flex items-center gap-1"
          >
            {showResolved ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
            {resolvedCount} resolved
          </button>
        )}
      </div>

      {/* New comment */}
      <div className="space-y-2 relative">
        <Textarea
          ref={textareaRef}
          value={newComment}
          onChange={(e) => handleTextChange(e.target.value, setNewComment)}
          placeholder="Add a comment… (use @ to mention)"
          className="font-body text-[13px] min-h-[60px]"
        />
        {mentionSearch != null && filteredMentions.length > 0 && !replyTo && (
          <div className="absolute left-0 bottom-full mb-1 bg-popover border border-border rounded-md shadow-lg z-50 min-w-[180px]">
            {filteredMentions.map((m: any) => (
              <button
                key={m.id}
                className="w-full text-left px-3 py-2 font-body text-[12px] text-foreground hover:bg-muted transition-colors"
                onClick={() => insertMention(m.name, setNewComment, newComment)}
              >
                @{m.name} <span className="text-muted-foreground ml-1">{m.email}</span>
              </button>
            ))}
          </div>
        )}
        <div className="flex justify-end">
          <Button
            size="sm"
            onClick={() => handleSubmit()}
            disabled={!newComment.trim() || submitting}
            className="gap-1.5 font-body text-[12px]"
          >
            {submitting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
            Post
          </Button>
        </div>
      </div>

      {/* Thread list */}
      <div className="space-y-3">
        {rootComments.map((comment) => {
          if (comment.is_resolved && !showResolved) return null;
          const replies = repliesByParent[comment.id] || [];

          return (
            <div
              key={comment.id}
              className={cn(
                "border rounded-md overflow-hidden",
                comment.is_resolved ? "border-border/50 bg-muted/30" : "border-border bg-background",
              )}
            >
              {/* Root comment */}
              <div className="p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="font-body text-[12px] font-semibold text-foreground">
                      {getUserName(comment.user_id)}
                    </span>
                    <span className="font-body text-[10px] text-muted-foreground">
                      {format(new Date(comment.created_at), "MMM d, h:mm a")}
                    </span>
                  </div>
                  <button
                    onClick={() => handleToggleResolve(comment.id, comment.is_resolved)}
                    className={cn(
                      "flex items-center gap-1 font-body text-[11px] font-medium transition-colors",
                      comment.is_resolved
                        ? "text-muted-foreground hover:text-foreground"
                        : "text-muted-foreground hover:text-success",
                    )}
                    title={comment.is_resolved ? "Unresolve" : "Resolve"}
                  >
                    {comment.is_resolved ? (
                      <><CheckCircle2 className="h-3.5 w-3.5 text-success" /> Resolved</>
                    ) : (
                      <><Circle className="h-3.5 w-3.5" /> Resolve</>
                    )}
                  </button>
                </div>

                <p className="font-body text-[13px] text-foreground leading-relaxed whitespace-pre-wrap">
                  {renderBody(comment.body)}
                </p>

                {/* Reactions */}
                <div className="flex items-center gap-1.5 flex-wrap">
                  {Object.entries(comment.reactions || {}).map(([emoji, userIds]) => (
                    <button
                      key={emoji}
                      onClick={() => handleReaction(comment.id, emoji)}
                      className={cn(
                        "inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[12px] border transition-colors",
                        (userIds as string[]).includes(user?.id || "")
                          ? "border-primary/30 bg-primary/10"
                          : "border-border hover:bg-muted",
                      )}
                    >
                      {emoji} <span className="font-data text-[10px] font-medium">{(userIds as string[]).length}</span>
                    </button>
                  ))}
                  {REACTIONS.filter((r) => !comment.reactions?.[r]).map((emoji) => (
                    <button
                      key={emoji}
                      onClick={() => handleReaction(comment.id, emoji)}
                      className="px-1 py-0.5 rounded-full text-[12px] opacity-0 group-hover:opacity-100 hover:bg-muted transition-all hover:opacity-100"
                    >
                      {emoji}
                    </button>
                  ))}
                  <button
                    onClick={() => setReplyTo(replyTo === comment.id ? null : comment.id)}
                    className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
                  >
                    <Reply className="h-3 w-3" /> Reply
                  </button>
                </div>
              </div>

              {/* Replies */}
              {replies.length > 0 && (
                <div className="border-t border-border/50 bg-muted/20">
                  {replies.map((reply) => (
                    <div key={reply.id} className="p-3 pl-8 space-y-1.5 border-b border-border/30 last:border-b-0">
                      <div className="flex items-center gap-2">
                        <span className="font-body text-[11px] font-semibold text-foreground">
                          {getUserName(reply.user_id)}
                        </span>
                        <span className="font-body text-[10px] text-muted-foreground">
                          {format(new Date(reply.created_at), "MMM d, h:mm a")}
                        </span>
                      </div>
                      <p className="font-body text-[12px] text-foreground leading-relaxed whitespace-pre-wrap">
                        {renderBody(reply.body)}
                      </p>
                      {/* Reply reactions */}
                      <div className="flex items-center gap-1.5 flex-wrap">
                        {Object.entries(reply.reactions || {}).map(([emoji, userIds]) => (
                          <button
                            key={emoji}
                            onClick={() => handleReaction(reply.id, emoji)}
                            className={cn(
                              "inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[11px] border transition-colors",
                              (userIds as string[]).includes(user?.id || "")
                                ? "border-primary/30 bg-primary/10"
                                : "border-border hover:bg-muted",
                            )}
                          >
                            {emoji} <span className="font-data text-[10px]">{(userIds as string[]).length}</span>
                          </button>
                        ))}
                        {REACTIONS.filter((r) => !reply.reactions?.[r]).map((emoji) => (
                          <button
                            key={emoji}
                            onClick={() => handleReaction(reply.id, emoji)}
                            className="px-1 py-0.5 rounded-full text-[11px] opacity-30 hover:opacity-100 hover:bg-muted transition-all"
                          >
                            {emoji}
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Reply input */}
              {replyTo === comment.id && (
                <div className="p-3 border-t border-border/50 bg-muted/10 space-y-2 relative">
                  <Textarea
                    value={replyText}
                    onChange={(e) => handleTextChange(e.target.value, setReplyText)}
                    placeholder="Write a reply…"
                    className="font-body text-[12px] min-h-[40px]"
                    autoFocus
                  />
                  {mentionSearch != null && filteredMentions.length > 0 && replyTo && (
                    <div className="absolute left-3 bottom-full mb-1 bg-popover border border-border rounded-md shadow-lg z-50 min-w-[180px]">
                      {filteredMentions.map((m: any) => (
                        <button
                          key={m.id}
                          className="w-full text-left px-3 py-2 font-body text-[12px] text-foreground hover:bg-muted transition-colors"
                          onClick={() => insertMention(m.name, setReplyText, replyText)}
                        >
                          @{m.name}
                        </button>
                      ))}
                    </div>
                  )}
                  <div className="flex justify-end gap-2">
                    <Button size="sm" variant="ghost" onClick={() => setReplyTo(null)} className="font-body text-[11px] h-7">
                      Cancel
                    </Button>
                    <Button
                      size="sm"
                      onClick={() => handleSubmit(comment.id)}
                      disabled={!replyText.trim() || submitting}
                      className="gap-1 font-body text-[11px] h-7"
                    >
                      {submitting ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />}
                      Reply
                    </Button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {comments.length === 0 && (
        <div className="text-center py-6">
          <MessageSquare className="h-8 w-8 text-muted-foreground/40 mx-auto mb-2" />
          <p className="font-body text-[13px] text-muted-foreground">
            No comments yet. Start a discussion about this creative.
          </p>
        </div>
      )}
    </div>
  );
}
