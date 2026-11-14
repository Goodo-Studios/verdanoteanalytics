// Cut review (OS-020): the versions of a task, a player for the chosen version and its
// timestamped comments. Used on the client Review page (viewer "client") and in the staff task
// side panel (viewer "staff").
//
// A direct video file plays inline and a new comment takes the player's current time. Any other
// link (Air, Drive, Frame, Vimeo) gets an "Open the cut" button and an optional m:ss field.
// Clicking a timecode seeks the player. A client only ever sees client-thread comments: the
// server returns no others and toCutComments drops any that arrive anyway.
import { memo, useRef, useState } from "react";
import { ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/contexts/AuthContext";
import { useAddVersion, useCutComments, usePostCutComment, useTaskVersions, type Viewer } from "@/hooks/useCutReview";
import { formatTimecode, isDirectVideo, parseTimecode, seekTo, versionName, type CommentThread, type CutComment, type TaskVersion } from "@/lib/cutReview";
import { shortDate } from "@/lib/homeData";

function CommentRow({ c, viewer, mine, onSeek }: { c: CutComment; viewer: Viewer; mine: boolean; onSeek: ((ms: number) => void) | null }) {
  const who = viewer === "client" ? (mine ? "You" : "Goodo") : (c.author_name ?? (mine ? "You" : "Someone"));
  return (
    <li className="text-sm" data-testid="cut-comment" data-thread={c.thread}>
      {c.timecode_ms !== null ? (
        onSeek ? (
          <button
            type="button"
            className="mr-2 rounded bg-secondary px-1.5 py-0.5 font-mono text-xs underline-offset-2 hover:underline"
            onClick={() => onSeek(c.timecode_ms!)}
            data-testid="cut-timecode"
            aria-label={`Go to ${formatTimecode(c.timecode_ms)}`}
          >
            {formatTimecode(c.timecode_ms)}
          </button>
        ) : (
          <span className="mr-2 rounded bg-secondary px-1.5 py-0.5 font-mono text-xs" data-testid="cut-timecode">{formatTimecode(c.timecode_ms)}</span>
        )
      ) : (
        <span className="mr-2 text-xs text-muted-foreground">Whole cut</span>
      )}
      {viewer === "staff" && c.thread === "internal" ? (
        <span className="mr-2 rounded border border-border px-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground" data-testid="cut-internal-label">
          Internal
        </span>
      ) : null}
      <span className="text-xs text-muted-foreground">{who}, {shortDate(c.created_at)}: </span>
      <span className="whitespace-pre-wrap break-words">{c.body}</span>
    </li>
  );
}

function VersionBody({ version, viewer }: { version: TaskVersion; viewer: Viewer }) {
  const { user } = useAuth();
  const videoRef = useRef<HTMLVideoElement>(null);
  const inline = isDirectVideo(version.video_url);
  const comments = useCutComments(viewer, version.id);
  const post = usePostCutComment(viewer, version.id);
  const [text, setText] = useState("");
  const [atTime, setAtTime] = useState(true);
  const [manual, setManual] = useState("");
  const [thread, setThread] = useState<CommentThread>(viewer === "client" ? "client" : "internal");
  const [problem, setProblem] = useState<string | null>(null);

  const submit = () => {
    const body = text.trim();
    if (!body) return;
    let timecodeMs: number | null = null;
    if (inline) {
      timecodeMs = atTime ? Math.floor((videoRef.current?.currentTime ?? 0) * 1000) : null;
    } else if (manual.trim()) {
      timecodeMs = parseTimecode(manual);
      if (timecodeMs === null) {
        setProblem("Write the time as m:ss or h:mm:ss, for example 1:05.");
        return;
      }
    }
    setProblem(null);
    post.mutate(
      { thread: viewer === "client" ? "client" : thread, body, timecodeMs },
      { onSuccess: () => { setText(""); setManual(""); } },
    );
  };

  return (
    <div className="space-y-3" data-testid="cut-version-body">
      {inline ? (
        <video
          ref={videoRef}
          src={version.video_url}
          controls
          preload="metadata"
          playsInline
          className="w-full rounded-md bg-black"
          data-testid="cut-player"
        />
      ) : (
        <a
          href={version.video_url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-sm underline"
          data-testid="cut-open-link"
        >
          Open the cut
          <ExternalLink className="h-3 w-3" aria-hidden />
        </a>
      )}

      {comments.isLoading ? null : comments.isError ? (
        <p className="text-sm text-muted-foreground">Comments could not load.</p>
      ) : (comments.data ?? []).length === 0 ? (
        <p className="text-sm text-muted-foreground">No comments on this version yet.</p>
      ) : (
        <ul className="space-y-2" data-testid="cut-comments">
          {(comments.data ?? []).map((c) => (
            <CommentRow
              key={c.id}
              c={c}
              viewer={viewer}
              mine={!!user?.id && c.author_user_id === user.id}
              onSeek={inline ? (ms) => seekTo(videoRef.current, ms) : null}
            />
          ))}
        </ul>
      )}

      <form
        className="space-y-2"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <Textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Add a comment on this version"
          aria-label="Add a comment on this version"
          rows={2}
        />
        <div className="flex flex-wrap items-center gap-3 text-sm">
          {inline ? (
            <label className="inline-flex items-center gap-1.5">
              <input type="checkbox" checked={atTime} onChange={(e) => setAtTime(e.target.checked)} data-testid="cut-at-time" />
              At the current time
            </label>
          ) : (
            <label className="inline-flex items-center gap-1.5">
              Time (m:ss)
              <Input value={manual} onChange={(e) => setManual(e.target.value)} placeholder="1:05" aria-label="Time (m:ss)" className="h-8 w-20" />
            </label>
          )}
          {viewer === "staff" ? (
            <label className="inline-flex items-center gap-1.5">
              Thread
              <select
                value={thread}
                onChange={(e) => setThread(e.target.value as CommentThread)}
                aria-label="Thread"
                className="h-8 rounded-md border border-input bg-background px-2"
              >
                <option value="internal">Internal</option>
                <option value="client">Client</option>
              </select>
            </label>
          ) : null}
          <Button type="submit" variant="outline" size="sm" className="ml-auto" disabled={!text.trim() || post.isPending}>
            Send
          </Button>
        </div>
        {problem || post.isError ? (
          <p className="text-xs text-[var(--gos-late)]" role="alert">{problem ?? (post.error as Error).message}</p>
        ) : null}
      </form>
    </div>
  );
}

function AddVersion({ taskId }: { taskId: string }) {
  const add = useAddVersion(taskId);
  const [url, setUrl] = useState("");
  const [label, setLabel] = useState("");
  return (
    <form
      className="flex flex-wrap items-center gap-2"
      data-testid="cut-add-version"
      onSubmit={(e) => {
        e.preventDefault();
        if (!url.trim()) return;
        add.mutate({ url, label }, { onSuccess: () => { setUrl(""); setLabel(""); } });
      }}
    >
      <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https:// link to the cut" aria-label="Link to the cut" className="h-8 min-w-[12rem] flex-1" />
      <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Label (optional)" aria-label="Label" maxLength={120} className="h-8 w-36" />
      <Button type="submit" size="sm" variant="outline" disabled={!url.trim() || add.isPending}>
        Add version
      </Button>
      {add.isError ? <p className="w-full text-xs text-[var(--gos-late)]" role="alert">{(add.error as Error).message}</p> : null}
    </form>
  );
}

export const CutReview = memo(function CutReview({ taskId, viewer, canAdd = false }: { taskId: string; viewer: Viewer; canAdd?: boolean }) {
  const versions = useTaskVersions(viewer, taskId);
  const [picked, setPicked] = useState<string | null>(null);
  const list = versions.data ?? [];
  const current = list.find((v) => v.id === picked) ?? list[0] ?? null;

  return (
    <div className="space-y-3" data-testid="cut-review">
      {versions.isLoading ? null : versions.isError ? (
        <p className="text-sm text-muted-foreground">Versions could not load.</p>
      ) : list.length === 0 ? (
        <p className="text-sm text-muted-foreground" data-testid="cut-no-versions">
          {viewer === "client" ? "No cut to watch yet." : "No versions yet."}
        </p>
      ) : (
        <>
          <ul className="flex flex-wrap gap-2" data-testid="cut-versions" aria-label="Versions">
            {list.map((v) => (
              <li key={v.id}>
                <button
                  type="button"
                  onClick={() => setPicked(v.id)}
                  aria-pressed={current?.id === v.id}
                  data-testid="cut-version"
                  className={
                    "rounded-full border px-3 py-1 text-xs " +
                    (current?.id === v.id ? "border-forest bg-forest text-white" : "border-border text-foreground hover:bg-secondary")
                  }
                >
                  {versionName(v)}
                  <span className="ml-1 opacity-70">{shortDate(v.created_at)}</span>
                </button>
              </li>
            ))}
          </ul>
          {current ? <VersionBody key={current.id} version={current} viewer={viewer} /> : null}
        </>
      )}
      {canAdd ? <AddVersion taskId={taskId} /> : null}
    </div>
  );
});
