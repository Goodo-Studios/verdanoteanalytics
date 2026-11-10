import { forwardRef, useId } from "react";
import type { ComponentProps, ReactNode, SelectHTMLAttributes } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

interface FieldFrameProps {
  label: string;
  /** Keep the label for screen readers but do not show it (filter bars). */
  hideLabel?: boolean;
  hint?: ReactNode;
  error?: string | null;
  className?: string;
}

function FieldFrame({ id, label, hideLabel, hint, error, className, children }: FieldFrameProps & { id: string; children: ReactNode }) {
  return (
    <div className={cn("space-y-1", className)}>
      <Label htmlFor={id} className={cn("text-xs text-muted-foreground", hideLabel && "sr-only")}>
        {label}
      </Label>
      {children}
      {hint && !error ? <p id={`${id}-hint`} className="text-xs text-muted-foreground">{hint}</p> : null}
      {error ? <p id={`${id}-error`} role="alert" className="text-xs text-destructive">{error}</p> : null}
    </div>
  );
}

function describedBy(id: string, hint: ReactNode, error?: string | null): string | undefined {
  if (error) return `${id}-error`;
  return hint ? `${id}-hint` : undefined;
}

export type TextFieldProps = FieldFrameProps & Omit<ComponentProps<"input">, "className" | "id"> & { inputClassName?: string; id?: string };

/** A labelled text input (also dates, numbers, email, phone) built on `ui/input`. */
export const TextField = forwardRef<HTMLInputElement, TextFieldProps>(function TextField(
  { label, hideLabel, hint, error, className, inputClassName, id, ...input },
  ref,
) {
  const auto = useId();
  const fid = id ?? auto;
  return (
    <FieldFrame id={fid} label={label} hideLabel={hideLabel} hint={hint} error={error} className={className}>
      <Input ref={ref} id={fid} aria-invalid={error ? true : undefined} aria-describedby={describedBy(fid, hint, error)} className={inputClassName} {...input} />
    </FieldFrame>
  );
});

export type TextareaFieldProps = FieldFrameProps & Omit<ComponentProps<"textarea">, "className" | "id"> & { inputClassName?: string; id?: string };

/** A labelled textarea built on `ui/textarea`. */
export const TextareaField = forwardRef<HTMLTextAreaElement, TextareaFieldProps>(function TextareaField(
  { label, hideLabel, hint, error, className, inputClassName, id, ...input },
  ref,
) {
  const auto = useId();
  const fid = id ?? auto;
  return (
    <FieldFrame id={fid} label={label} hideLabel={hideLabel} hint={hint} error={error} className={className}>
      <Textarea ref={ref} id={fid} aria-invalid={error ? true : undefined} aria-describedby={describedBy(fid, hint, error)} className={inputClassName} {...input} />
    </FieldFrame>
  );
});

export const NATIVE_SELECT_CLASS =
  "flex h-10 w-full rounded-[6px] border border-border-light bg-background px-2.5 py-1.5 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50";

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export type SelectFieldProps = FieldFrameProps &
  Omit<SelectHTMLAttributes<HTMLSelectElement>, "className" | "id" | "children"> & {
    options: SelectOption[];
    /** Text of an empty first option, for example "Any role". Leave out for none. */
    placeholder?: string;
    inputClassName?: string;
    id?: string;
  };

/**
 * A labelled select. It uses the browser's own select, styled like `ui/select`, so it
 * opens the phone picker on mobile and stays keyboard and test friendly.
 */
export const SelectField = forwardRef<HTMLSelectElement, SelectFieldProps>(function SelectField(
  { label, hideLabel, hint, error, className, inputClassName, id, options, placeholder, ...select },
  ref,
) {
  const auto = useId();
  const fid = id ?? auto;
  return (
    <FieldFrame id={fid} label={label} hideLabel={hideLabel} hint={hint} error={error} className={className}>
      <select ref={ref} id={fid} aria-invalid={error ? true : undefined} aria-describedby={describedBy(fid, hint, error)} className={cn(NATIVE_SELECT_CLASS, inputClassName)} {...select}>
        {placeholder !== undefined ? <option value="">{placeholder}</option> : null}
        {options.map((o) => (
          <option key={o.value} value={o.value} disabled={o.disabled}>
            {o.label}
          </option>
        ))}
      </select>
    </FieldFrame>
  );
});
