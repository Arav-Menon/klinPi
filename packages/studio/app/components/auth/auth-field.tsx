import { Input } from "@/app/components/ui/input";
import { Label } from "@/app/components/ui/label";
import { cn } from "cn";

interface AuthFieldProps extends React.ComponentProps<"input"> {
  label: string;
  hint?: string;
  error?: string;
}

/*
 * Label + input + hint/error, wired for assistive tech:
 * `aria-invalid` on the input, hint/error linked through `aria-describedby`.
 */
export function AuthField({ label, hint, error, className, id, ...props }: AuthFieldProps) {
  const fieldId = id ?? props.name;
  const describedBy =
    [error ? `${fieldId}-error` : null, hint ? `${fieldId}-hint` : null]
      .filter(Boolean)
      .join(" ") || undefined;

  return (
    <div className={cn("space-y-1.5", className)}>
      <Label htmlFor={fieldId}>{label}</Label>
      <Input
        id={fieldId}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        {...props}
      />
      {error ? (
        <p id={`${fieldId}-error`} className="text-xs text-danger">
          {error}
        </p>
      ) : hint ? (
        <p id={`${fieldId}-hint`} className="text-xs text-faint">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
