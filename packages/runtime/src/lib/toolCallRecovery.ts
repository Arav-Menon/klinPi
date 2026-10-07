import { randomUUID } from "node:crypto";
import type { ModelToolCall } from "../types.js";

export interface RecoveredToolCalls {
    toolCalls: ModelToolCall[];
    /** Assistant prose left after the tool-call JSON is removed; null when the text was only the tool call. */
    remainder: string | null;
}

interface Candidate {
    /** Text parsed as JSON. */
    text: string;
    /** Range removed from the assistant content when this candidate is used. */
    start: number;
    end: number;
}

const MAX_CANDIDATES = 32;
const FENCE_PATTERN = /```[a-zA-Z0-9_-]*\r?\n?([\s\S]*?)```/g;

function isToolName(value: unknown, toolNames: ReadonlySet<string>): value is string {
    return typeof value === "string" && toolNames.has(value);
}

function normalizeArguments(raw: unknown): string | null {
    if (raw === undefined || raw === null) {
        return "{}";
    }
    if (typeof raw === "string") {
        try {
            JSON.parse(raw);
        } catch {
            return null;
        }
        return raw;
    }
    if (typeof raw === "object") {
        return JSON.stringify(raw);
    }
    return null;
}

function matchBracket(content: string, start: number): number {
    const open = content[start];
    const close = open === "{" ? "}" : "]";
    let depth = 0;
    let inString = false;
    let escaped = false;

    for (let i = start; i < content.length; i++) {
        const char = content[i];

        if (inString) {
            if (escaped) {
                escaped = false;
            } else if (char === "\\") {
                escaped = true;
            } else if (char === '"') {
                inString = false;
            }
            continue;
        }

        if (char === '"') {
            inString = true;
        } else if (char === open) {
            depth++;
        } else if (char === close) {
            depth--;
            if (depth === 0) {
                return i + 1;
            }
        }
    }

    return -1;
}

function extractCandidates(content: string): Candidate[] {
    const candidates: Candidate[] = [];

    FENCE_PATTERN.lastIndex = 0;
    let fence: RegExpExecArray | null;
    while ((fence = FENCE_PATTERN.exec(content)) !== null) {
        candidates.push({
            text: (fence[1] ?? "").trim(),
            start: fence.index,
            end: fence.index + fence[0].length,
        });
        if (candidates.length >= MAX_CANDIDATES) {
            return candidates;
        }
    }

    const trimmedStart = content.length - content.trimStart().length;
    const firstChar = content.trimStart()[0];
    if (firstChar === "{" || firstChar === "[") {
        const start = trimmedStart;
        const end = matchBracket(content, start);
        if (end > start) {
            candidates.push({ text: content.slice(start, end), start, end });
        }
    }

    for (let i = 0; i < content.length && candidates.length < MAX_CANDIDATES; i++) {
        const char = content[i];
        if (char !== "{" && char !== "[") {
            continue;
        }
        const end = matchBracket(content, i);
        if (end <= i) {
            continue;
        }
        const text = content.slice(i, end);
        if (candidates.some((c) => c.start === i && c.end === end)) {
            continue;
        }
        candidates.push({ text, start: i, end });
    }

    return candidates.sort((a, b) => a.start - b.start);
}

function recognizeCall(
    value: unknown,
    toolNames: ReadonlySet<string>,
): { name: string; arguments: string } | null {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
        return null;
    }

    const obj = value as Record<string, unknown>;

    let name: string | null = null;
    let rawArgs: unknown;

    if (
        obj.function !== null &&
        typeof obj.function === "object" &&
        !Array.isArray(obj.function)
    ) {
        const fn = obj.function as Record<string, unknown>;
        if (typeof fn.name !== "string") {
            return null;
        }
        name = fn.name;
        rawArgs =
            fn.arguments ?? fn.parameters ?? obj.arguments ?? obj.params;
    } else if (typeof obj.function === "string") {
        name = obj.function;
        rawArgs =
            obj.arguments ?? obj.input ?? obj.args ?? obj.params ?? obj.parameters;
    } else if (typeof obj.function_name === "string") {
        // <function_call>{ "function_name": …, "arguments": {…} }</function_call>
        name = obj.function_name;
        rawArgs =
            obj.arguments ?? obj.input ?? obj.args ?? obj.params ?? obj.parameters;
    } else if (typeof obj.name === "string") {
        name = obj.name;
        rawArgs =
            obj.arguments ?? obj.input ?? obj.args ?? obj.params ?? obj.parameters;
    } else if (typeof obj.tool === "string") {
        name = obj.tool;
        rawArgs =
            obj.arguments ?? obj.input ?? obj.args ?? obj.params ?? obj.parameters;
    } else if (typeof obj.action === "string") {
        // Local models often narrate the call as {"action":"git_branch","params":{…}}.
        name = obj.action;
        rawArgs =
            obj.arguments ?? obj.input ?? obj.args ?? obj.params ?? obj.parameters;
    } else {
        return null;
    }

    // Registered names are always treated as calls (missing arguments default
    // to {}). An unregistered name only counts when it carries an explicit
    // argument payload, so ordinary data JSON with a "name" field is never
    // turned into a call. Recovering unregistered calls is deliberate: they
    // reach the loop's unknown-tool branch and come back as corrective
    // feedback ("Unknown tool: update_file. Available tools: …") instead of
    // ending the run with no feedback at all.
    if (!isToolName(name, toolNames) && rawArgs === undefined) {
        return null;
    }

    const args = normalizeArguments(rawArgs);
    return args === null ? null : { name, arguments: args };
}

function recoverFromCandidate(
    candidate: Candidate,
    toolNames: ReadonlySet<string>,
    hints?: ParamHints,
): ModelToolCall[] | null {
    const fromJson = recoverJsonCandidate(candidate, toolNames);
    if (fromJson !== null) {
        return fromJson;
    }
    // Not JSON: the model may have written the call in shell/assistant style
    // (```bash run_command("...") ```, <function=name>{...}</function>).
    const pseudo = parsePseudoCall(candidate.text, toolNames, hints);
    if (pseudo === null) {
        return null;
    }
    return [pseudoToCall(pseudo)];
}

function pseudoToCall(pseudo: PseudoMatch): ModelToolCall {
    return {
        id: randomUUID(),
        type: "function",
        function: { name: pseudo.name, arguments: pseudo.arguments },
    };
}

function recoverJsonCandidate(
    candidate: Candidate,
    toolNames: ReadonlySet<string>,
): ModelToolCall[] | null {
    let parsed: unknown;
    try {
        parsed = JSON.parse(candidate.text);
    } catch {
        return null;
    }

    const entries = Array.isArray(parsed) ? parsed : [parsed];
    const calls: ModelToolCall[] = [];

    for (const entry of entries) {
        const call = recognizeCall(entry, toolNames);
        if (call === null) {
            return null;
        }
        calls.push({
            id: randomUUID(),
            type: "function",
            function: { name: call.name, arguments: call.arguments },
        });
    }

    return calls.length > 0 ? calls : null;
}

/** Tool name → the single parameter a bare string argument maps to. */
type ParamHints = Readonly<Record<string, string>>;

function parseStringLiteral(raw: string): string | null {
    if (raw.length >= 2 && raw.startsWith('"') && raw.endsWith('"')) {
        try {
            const parsed = JSON.parse(raw);
            return typeof parsed === "string" ? parsed : null;
        } catch {
            return raw.slice(1, -1);
        }
    }
    if (raw.length >= 2 && raw.startsWith("'") && raw.endsWith("'")) {
        return raw.slice(1, -1).replace(/\\'/g, "'");
    }
    return null;
}

function normalizePseudoArguments(
    name: string,
    rawArgs: string,
    hints?: ParamHints,
): string | null {
    const raw = rawArgs.trim();
    if (!raw) {
        return "{}";
    }
    if (raw.startsWith("{") || raw.startsWith("[")) {
        try {
            return JSON.stringify(JSON.parse(raw));
        } catch {
            const lenient = raw
                .replace(/'/g, '"')
                .replace(/([{,]\s*)([A-Za-z_][A-Za-z0-9_]*)\s*:/g, '$1"$2":');
            try {
                return JSON.stringify(JSON.parse(lenient));
            } catch {
                return null;
            }
        }
    }
    const literal = parseStringLiteral(raw);
    if (literal === null) {
        return null;
    }
    // A bare string only maps safely onto a tool with exactly one obvious
    // argument (e.g. run_command("npm test") → {command: "npm test"}).
    const hint = hints?.[name];
    return hint === undefined ? null : JSON.stringify({ [hint]: literal });
}

function matchParentheses(text: string, openIndex: number): number {
    let depth = 0;
    let inSingle = false;
    let inDouble = false;

    for (let i = openIndex; i < text.length; i++) {
        const char = text[i];
        if (char === "'" && !inDouble) {
            inSingle = !inSingle;
            continue;
        }
        if (char === '"' && !inSingle) {
            inDouble = !inDouble;
            continue;
        }
        if (inSingle || inDouble) {
            continue;
        }
        if (char === "(") {
            depth++;
        } else if (char === ")") {
            depth--;
            if (depth === 0) {
                return i;
            }
        }
    }
    return -1;
}

interface PseudoMatch {
    name: string;
    arguments: string;
    /** Range of the call inside the parsed text. */
    start: number;
    end: number;
}

const TRAILING_OK = /^['"`;,)].*$/;

function parseJsonObject(raw: string): Record<string, unknown> | null {
    const text = raw.trim();
    if (!text) {
        return null;
    }
    const attempts = [
        text,
        text
            .replace(/'/g, '"')
            .replace(/([{,]\s*)([A-Za-z_][A-Za-z0-9_]*)\s*:/g, '$1"$2":'),
    ];
    for (const attempt of attempts) {
        try {
            const parsed = JSON.parse(attempt);
            if (
                parsed !== null &&
                typeof parsed === "object" &&
                !Array.isArray(parsed)
            ) {
                return parsed as Record<string, unknown>;
            }
        } catch {
            // try the next (lenient) form
        }
    }
    return null;
}

/**
 * Recognize a tool call written as prose/code instead of a structured entry:
 *
 *   ```bash
 *   run_command("npm test")
 *   ```
 *   <function=edit_file>{"path":"/workspace/x"}</function>
 *   <function_call>{"function_name":"create_issue","arguments":{…}}</function_call>
 *   list_files({"path":"/workspace"})
 *   run_command: "npm test"
 *
 * The call must end the text (only trivial trailing punctuation is allowed)
 * so an explanation that merely mentions a call is never executed.
 */
function parsePseudoCall(
    text: string,
    toolNames: ReadonlySet<string>,
    hints?: ParamHints,
): PseudoMatch | null {
    if (!text.trim()) {
        return null;
    }

    const tag = /<function\s*=?\s*([A-Za-z_][A-Za-z0-9_]*)\s*>/.exec(text);
    if (tag && tag.index <= 200) {
        const rawTag = tag[0];
        // `<function=name>…</function>` carries the tool name in the tag, while
        // `<function_call>…</function_call>` carries it inside the JSON payload
        // as "function_name".
        const wrapperName = /^<function_[A-Za-z0-9_]+>$/.test(rawTag)
            ? rawTag.slice(1, -1)
            : null;
        const closeTag = wrapperName ? `</${wrapperName}>` : "</function>";
        const argsStart = tag.index + rawTag.length;
        const close = text.indexOf(closeTag, argsStart);
        if (close !== -1) {
            const after = text.slice(close + closeTag.length).trim();
            if (!after || TRAILING_OK.test(after)) {
                const body = text.slice(argsStart, close);
                let name: string | null = null;
                let args: string | null = null;
                let end = close + closeTag.length;

                if (wrapperName !== null) {
                    const parsed = parseJsonObject(body);
                    const call =
                        parsed !== null ? recognizeCall(parsed, toolNames) : null;
                    if (call !== null) {
                        name = call.name;
                        args = call.arguments;
                    } else {
                        // Fall back to the tag-derived name so the loop still
                        // sends feedback (e.g. "Unknown tool: function_call").
                        name = wrapperName;
                        args = normalizePseudoArguments(wrapperName, body, hints);
                    }
                } else {
                    name = tag[1]!;
                    args = normalizePseudoArguments(name, body, hints);
                }

                if (args !== null && name !== null) {
                    return { name, arguments: args, start: tag.index, end };
                }
            }
        }
    }

    const paren =
        /(?:^|[^A-Za-z0-9_$])([A-Za-z_][A-Za-z0-9_]*)\s*\(/.exec(text);
    if (paren && paren.index <= 120) {
        const name = paren[1]!;
        const nameStart = paren.index + paren[0].indexOf(name);
        const openIndex = text.indexOf("(", nameStart + name.length);
        if (openIndex !== -1) {
            const closeIndex = matchParentheses(text, openIndex);
            if (closeIndex !== -1) {
                const after = text.slice(closeIndex + 1).trim();
                if (!after || TRAILING_OK.test(after)) {
                    const args = normalizePseudoArguments(
                        name,
                        text.slice(openIndex + 1, closeIndex),
                        hints,
                    );
                    if (args !== null) {
                        return {
                            name,
                            arguments: args,
                            start: nameStart,
                            end: closeIndex + 1,
                        };
                    }
                }
            }
        }
    }

    const colon = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*:\s*([\s\S]+)$/.exec(text);
    if (colon) {
        const name = colon[1]!;
        const args = normalizePseudoArguments(name, colon[2]!, hints);
        if (args !== null) {
            return {
                name,
                arguments: args,
                start: text.length - text.trimStart().length,
                end: text.length,
            };
        }
    }

    return null;
}

/**
 * Some local models answer a tool request by writing the tool call as text
 * instead of a structured `tool_calls` entry (`finish_reason: "stop"`):
 *
 *   JSON:    {"name":"create_pull_request","arguments":{...}}
 *   pseudo:  ```bash\nrun_command("npm test")\n```
 *            <function=edit_file>{"path":"/workspace/x"}</function>
 *
 * Without this the loop treats that text as the final answer and the run ends
 * — or, for an invented tool name, ends with no corrective feedback at all.
 *
 * Registered names are always accepted; an unregistered name is only accepted
 * when it carries an explicit argument payload — it then flows into the loop's
 * unknown-tool branch, which answers with the list of available tools so the
 * model can correct itself. `hints` maps a tool to its single string parameter
 * so a bare string argument (`run_command("npm test")`) can be wrapped.
 * Native `tool_calls` always win: call this only when the provider returned none.
 */
export function recoverTextToolCalls(
    content: string,
    toolNames: ReadonlySet<string>,
    hints?: ParamHints,
): RecoveredToolCalls | null {
    if (!content || toolNames.size === 0) {
        return null;
    }

    for (const candidate of extractCandidates(content)) {
        const calls = recoverFromCandidate(candidate, toolNames, hints);
        if (calls === null) {
            continue;
        }

        // A model may wrap the JSON payload in <function…>…</function…> tags —
        // remove the wrapper too so no tag junk is left as the assistant
        // remainder of the conversation.
        let start = candidate.start;
        let end = candidate.end;
        const openWrapper = /<function[A-Za-z0-9_=\s]*>\s*$/.exec(
            content.slice(0, start),
        );
        if (openWrapper) {
            start -= openWrapper[0].length;
        }
        const closeWrapper = /^\s*<\/function[A-Za-z0-9_=\s]*>/.exec(
            content.slice(end),
        );
        if (closeWrapper) {
            end += closeWrapper[0].length;
        }

        const withoutCall = content.slice(0, start) + content.slice(end);
        const remainder = withoutCall.trim().length > 0 ? withoutCall.trim() : null;

        return { toolCalls: calls, remainder };
    }

    // No JSON/fenced candidate matched: the whole message may still be a call
    // ("run_command: \"npm test\"", "<function=...>" with leading prose).
    const pseudo = parsePseudoCall(content, toolNames, hints);
    if (pseudo !== null) {
        const withoutCall =
            content.slice(0, pseudo.start) + content.slice(pseudo.end);
        const remainder = withoutCall.trim().length > 0 ? withoutCall.trim() : null;
        return { toolCalls: [pseudoToCall(pseudo)], remainder };
    }

    return null;
}
