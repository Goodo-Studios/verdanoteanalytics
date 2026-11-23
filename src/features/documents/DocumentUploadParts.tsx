// Small shared pieces for the upload forms: the file chooser and the link to a stored original.
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { ACCEPT_ATTRIBUTE, type DocumentArea, TYPES_HINT, validateDocumentFile } from "./model";
import { originalFileUrl } from "./upload";

/** File chooser with the allowed types and size shown. Reports the file, or a plain error. */
export function FileChooser({ file, onFile, label = "File" }: { file: File | null; onFile: (file: File | null) => void; label?: string }) {
  const [problem, setProblem] = useState<string | null>(null);
  return (
    <div className="space-y-1">
      <input
        type="file"
        aria-label={label}
        accept={ACCEPT_ATTRIBUTE}
        className="block w-full text-sm file:mr-3 file:rounded file:border file:border-input file:bg-background file:px-3 file:py-1.5 file:text-sm"
        onChange={(e) => {
          const next = e.target.files?.[0] ?? null;
          const issue = next ? validateDocumentFile(next) : null;
          setProblem(issue);
          onFile(issue ? null : next);
          if (issue) e.target.value = "";
        }}
      />
      <p className="text-[12px] text-muted-foreground">{file ? `${file.name} chosen. ` : ""}{TYPES_HINT}</p>
      {problem ? <p role="alert" className="text-sm text-destructive">{problem}</p> : null}
    </div>
  );
}

interface FileRow {
  file_path: string;
  file_name: string;
}
interface FileQuery extends PromiseLike<{ data: unknown; error: { message: string } | null }> {
  eq(column: string, value: string): FileQuery;
}
interface FileDb {
  from(table: string): { select(columns: string): FileQuery };
}

/** Link to the original file uploaded with a document. Shows nothing when there is none. */
export function OriginalFileLink({ area, targetId }: { area: DocumentArea; targetId: string }) {
  const [row, setRow] = useState<FileRow | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    setRow(null);
    setError(null);
    void (supabase as unknown as FileDb)
      .from("staff_document_files")
      .select("file_path, file_name")
      .eq("area", area)
      .eq("target_id", targetId)
      .then(({ data }) => {
        const rows = (Array.isArray(data) ? data : []) as Partial<FileRow>[];
        const first = rows.find((r) => typeof r.file_path === "string" && typeof r.file_name === "string") as FileRow | undefined;
        if (live) setRow(first ?? null);
      });
    return () => {
      live = false;
    };
  }, [area, targetId]);
  if (!row) return null;
  const open = async () => {
    setError(null);
    const url = await originalFileUrl(row.file_path);
    if (!url) return setError("The original file could not be opened. Try again.");
    window.open(url, "_blank", "noopener,noreferrer");
  };
  return (
    <div className="flex flex-wrap items-center gap-2 text-[12px] text-muted-foreground" data-testid="original-file">
      <span>Original file: {row.file_name}</span>
      <Button size="sm" variant="outline" onClick={() => void open()}>Open original</Button>
      {error ? <span role="alert" className="text-destructive">{error}</span> : null}
    </div>
  );
}
