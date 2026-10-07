/**
 * Per-agent-run workflow state.
 *
 * Tools record what actually happened during one `Agent.run` so that later
 * tools can enforce ordering invariants in code instead of relying on the
 * model obeying the prompt:
 *
 *   inspect (list_files / read_file)
 *     → modify (edit_file)
 *       → push (git_push)
 *         → create_pull_request
 *
 * The state intentionally lives for a single run only: work completed in an
 * earlier run (or outside the agent) is validated by the tools themselves
 * (e.g. create_pull_request verifies the branch on GitHub).
 */
export interface RunWorkflowState {
    /** A repository listing or file read succeeded this run. */
    inspected: boolean;
    /** Files successfully read this run. */
    readPaths: Set<string>;
    /** Files successfully written this run (for error messages). */
    writtenPaths: Set<string>;
    /** Number of successful edit_file writes this run. */
    writeCount: number;
    /** `writeCount` snapshot taken at the last successful git_push. */
    writesAtLastPush: number;
    /** Branches successfully pushed this run. */
    pushedBranches: Set<string>;
    /** Number of successful git_commit calls this run. */
    commits: number;
    /** A pull request was created through create_pull_request this run. */
    prCreated: boolean;
    /** Successful GitHub issue API operations this run (create/get/list/update/close). */
    issueOps: number;
}

export function createRunWorkflowState(): RunWorkflowState {
    return {
        inspected: false,
        readPaths: new Set(),
        writtenPaths: new Set(),
        writeCount: 0,
        writesAtLastPush: 0,
        pushedBranches: new Set(),
        commits: 0,
        prCreated: false,
        issueOps: 0,
    };
}

const WRITE_INTENT =
    /\b(add|create|writ(?:e|es|ten|ing)|implement|fix|updat(?:e|es|ing)|modif(?:y|ies|ied|ying)|chang(?:e|es|ed|ing)|edit(?:s|ed|ing)?|remov(?:e|es|ed|ing)|delet(?:e|es|ed|ing)|refactor(?:s|ed|ing)?|generat(?:e|es|ed|ing))\b/i;
const NEGATED_WRITE =
    /\b(don'?t|do not|without|no|never)\s+(add|create|write|implement|fix|update|modify|change|edit|remove|delete|refactor|generate)\b/i;
const COMMIT_INTENT = /\bcommit(s|ted|ting)?\b/i;
const PUSH_INTENT = /\bpush(es|ed|ing)?\b/i;
const PR_INTENT =
    /\b(pull[- ]request|pullrequest|open (a |an |the )?(pr|pull)|create (a |an |the )?(pr|pull)|pr against)\b/i;

const TASK_WORDS =
    "add|create|write|implement|fix|update|modify|change|edit|remove|delete|refactor|commit|push|open|merge|generate|restore|revert|rename|move|install|configure|run|test|validate|deploy|build";
/** Polite or imperative opener: "please …", "can you …", "Add …". */
const TASK_LEAD = new RegExp(
    `^\\s*(please|pls|kindly|can you|could you|would you|will you|help me|i want|i'd like|let's|go ahead|${TASK_WORDS})\\b`,
    "i",
);
/** Any sentence starting with an action verb: "… then fix it and open a PR". */
const IMPERATIVE_SENTENCE = new RegExp(
    `(^|[.!?]\\s+)(please\\s+)?(${TASK_WORDS})\\b`,
    "i",
);
const LEAD_WRITE =
    /^\s*(add|create|write|implement|fix|update|modify|change|edit|remove|delete|refactor|generate)\b/i;
/**
 * The lead write verb targets a GitHub work item rather than repository
 * content: "create an issue…", "delete this issue", "create a branch called
 * X", "update the issue title". Such requests are GitHub API operations and
 * must never be classified as an unfinished file change.
 */
const LEAD_WORK_ITEM =
    /^\s*(?:[a-z]+\s+){0,3}(?:issues?|tickets?|pull requests?|prs?|branch(?:es)?|tags?|releases?|labels?|milestones?)\b/i;
/** Work-item wording anywhere in a prompt (used by the issue-task latch). */
const WORK_ITEM_MENTION =
    /\b(issues?|tickets?|pull requests?|prs?|bugs?|bug reports?|reports?)\b/i;

interface TaskIntents {
    wantsWrite: boolean;
    wantsCommit: boolean;
    wantsPush: boolean;
    wantsPr: boolean;
}

function isTaskPrompt(text: string): boolean {
    return TASK_LEAD.test(text) || IMPERATIVE_SENTENCE.test(text);
}

function taskIntents(text: string): TaskIntents {
    const wantsCommit = COMMIT_INTENT.test(text);
    const wantsPush = PUSH_INTENT.test(text);
    const wantsPr = PR_INTENT.test(text);
    const leadVerb = LEAD_WRITE.exec(text);
    const leadTargetsWorkItem =
        leadVerb !== null &&
        LEAD_WORK_ITEM.test(text.slice(leadVerb[0].length));
    const wantsWrite =
        WRITE_INTENT.test(text) &&
        !NEGATED_WRITE.test(text) &&
        !leadTargetsWorkItem &&
        (leadVerb !== null || wantsCommit || wantsPush || wantsPr);
    return { wantsWrite, wantsCommit, wantsPush, wantsPr };
}

interface WorkflowGaps {
    /** What the user's prompt asked for that this run has not achieved yet. */
    missing: string[];
    /** One concrete tool call to make next, or null when nothing is missing. */
    directive: string | null;
}

/**
 * A weak model can ignore the first directive and keep inspecting the
 * repository. `repeat` escalates the wording: the tool that closes the gap is
 * named on its own, inspection tools are ruled out, and the message says the
 * instruction was already given.
 */
function workflowGaps(
    prompt: string,
    state: RunWorkflowState,
    repeat: boolean,
): WorkflowGaps {
    const text = prompt.toLowerCase();

    // Issue-task latch: once a GitHub issue operation has actually succeeded
    // this run and no repository work has happened, the run's requested work
    // is issue-side — never force repository tools (list_files / edit_file /
    // git_*) afterwards, whatever verbs the prompt contains.
    if (
        state.issueOps > 0 &&
        state.writeCount === 0 &&
        state.commits === 0 &&
        state.pushedBranches.size === 0 &&
        !state.prCreated &&
        WORK_ITEM_MENTION.test(text)
    ) {
        return { missing: [], directive: null };
    }

    if (!isTaskPrompt(text)) {
        return { missing: [], directive: null };
    }

    const { wantsWrite, wantsCommit, wantsPush, wantsPr } = taskIntents(text);

    const missing: string[] = [];
    let directive: string | null = null;

    if (wantsWrite && state.writeCount === 0 && state.commits === 0) {
        missing.push(
            "the requested file change has not been made (list_files → read_file → edit_file)",
        );
        directive = repeat
            ? 'Call edit_file NOW with {"path":"/workspace/<file>","content":"<file contents>"} to make the change. The repository has already been inspected — do not call list_files, run_command, cat, or ls again.'
            : 'Immediately emit ONE tool call: list_files with {"path":"/workspace"} to inspect the repository, then read_file on the files you will change, then edit_file to apply the change.';
    }
    if (wantsCommit && state.commits === 0) {
        missing.push("the changes have not been committed (git_stage → git_commit)");
        directive ??= repeat
            ? "Call git_stage for the changed files and then git_commit NOW — do not inspect the repository again."
            : 'Immediately emit ONE tool call: git_stage for the changed files, then git_commit with {"message":"<summary>"} to commit on the current branch.';
    }
    if (wantsPush && state.pushedBranches.size === 0) {
        missing.push("the branch has not been pushed (git_push)");
        directive ??= repeat
            ? 'Call git_push with {"branch":"<the branch you created>"} NOW — do not run any other tool first.'
            : 'Immediately emit ONE tool call: git_push with {"branch":"<the branch you created>"} to push it to origin.';
    }
    if (wantsPr && !state.prCreated) {
        missing.push(
            "the pull request has not been opened (create_pull_request, after pushing)",
        );
        directive ??= repeat
            ? "Call create_pull_request NOW to open the pull request against the default branch."
            : 'Immediately emit ONE tool call: create_pull_request with {"title":"…","body":"…"} to open the pull request against the default branch.';
    }

    return { missing, directive };
}

/**
 * What the user's prompt asked for that this run has not achieved yet.
 * Used by the loop to decide whether a "final" answer is premature.
 *
 * Returns nothing for read-only questions ("why did my push fail?") so a
 * diagnostic prompt never triggers a "you did not push yet" continuation,
 * for GitHub issue/API requests (the lead write verb targets an issue, PR,
 * branch, …), and once a GitHub issue operation has succeeded this run while
 * no repository work happened.
 */
export function missingWorkflowSteps(
    prompt: string,
    state: RunWorkflowState,
): string[] {
    return workflowGaps(prompt, state, false).missing;
}

/**
 * The single tool call that closes the first outstanding gap. Local models
 * respond to a vague "continue" with more narration; a concrete call shape
 * ("list_files with {\"path\":\"/workspace\"}") is what actually moves the
 * run forward. Pass `{ repeat: true }` when the same gap has already survived
 * a nudge: the wording then rules out further inspection and names only the
 * tool that performs the step. Null when nothing is missing (or the prompt is
 * read-only).
 */
export function nextStepDirective(
    prompt: string,
    state: RunWorkflowState,
    options?: { repeat?: boolean },
): string | null {
    return workflowGaps(prompt, state, options?.repeat === true).directive;
}

export const WORKSPACE_ROOT = "/workspace";

/** Repository files live under /workspace. */
export function isRepositoryPath(path: string): boolean {
    return (
        path === WORKSPACE_ROOT || path.startsWith(`${WORKSPACE_ROOT}/`)
    );
}
