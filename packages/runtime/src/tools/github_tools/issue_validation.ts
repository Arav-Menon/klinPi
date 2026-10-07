export type ParsedValue<T> =
  | { ok: true; value: T; error?: undefined }
  | { ok: false; value?: undefined; error: string };

export function parseIssueNumber(value: unknown): ParsedValue<number> {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
    return {
      ok: false,
      error: "Error: 'issueNumber' is required and must be a positive integer.",
    };
  }
  return { ok: true, value };
}

export function parseEnumField<T extends string>(
  value: unknown,
  field: string,
  allowed: readonly T[],
): ParsedValue<T | undefined> {
  if (value === undefined) {
    return { ok: true, value: undefined };
  }
  if (typeof value !== "string" || !allowed.includes(value as T)) {
    return {
      ok: false,
      error: `Error: '${field}' must be one of: ${allowed.join(", ")}.`,
    };
  }
  return { ok: true, value: value as T };
}

export function parseOptionalString(
  value: unknown,
  field: string,
): ParsedValue<string | undefined> {
  if (value === undefined) {
    return { ok: true, value: undefined };
  }
  if (typeof value !== "string") {
    return { ok: false, error: `Error: '${field}' must be a string.` };
  }
  return { ok: true, value };
}

export function parseOptionalNonEmptyString(
  value: unknown,
  field: string,
): ParsedValue<string | undefined> {
  if (value === undefined) {
    return { ok: true, value: undefined };
  }
  if (typeof value !== "string" || !value.trim()) {
    return {
      ok: false,
      error: `Error: '${field}' must be a non-empty string.`,
    };
  }
  return { ok: true, value: value.trim() };
}

export function parseStringArrayField(
  value: unknown,
  field: string,
): ParsedValue<string[] | undefined> {
  if (value === undefined) {
    return { ok: true, value: undefined };
  }
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) {
    return { ok: false, error: `Error: '${field}' must be an array of strings.` };
  }
  return { ok: true, value: value as string[] };
}

export function parseIntegerField(
  value: unknown,
  field: string,
  min: number,
  max?: number,
): ParsedValue<number | undefined> {
  if (value === undefined) {
    return { ok: true, value: undefined };
  }
  const invalid =
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < min ||
    (max !== undefined && value > max);
  if (invalid) {
    if (max !== undefined) {
      return {
        ok: false,
        error: `Error: '${field}' must be an integer between ${min} and ${max}.`,
      };
    }
    if (min === 1) {
      return { ok: false, error: `Error: '${field}' must be a positive integer.` };
    }
    return {
      ok: false,
      error: `Error: '${field}' must be an integer of at least ${min}.`,
    };
  }
  return { ok: true, value };
}
