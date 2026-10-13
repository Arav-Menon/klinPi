/**
 * Pre-model detector for prompts that require a linked repository.
 *
 * The runtime rejects these with a clear AGENT_ERROR when the session has
 * no repository, instead of spending a full model round-trip only for the
 * model to explain the missing context. Deliberately conservative: a false
 * negative merely falls back to the repositoryNote in the system prompt,
 * while a false positive would block an innocent question.
 */

/** "this repo", "our repository", "current project", "linked codebase", … */
const DEICTIC_REPOSITORY_REFERENCE =
    /\b(?:this|our|my|current|linked)\s+(?:repo|repository|codebase|project)\b/i;

/** A path-like reference with a file extension: src/app.ts, docs/api.yml */
const REPOSITORY_FILE_PATH = /\b[\w.-]+\/[\w./-]*[\w-]+\.[a-z0-9]{1,8}\b/i;

/** "repository structure", "project files", "files in this repo", … */
const REPOSITORY_STRUCTURE_REFERENCE =
    /\b(?:repo|repository|project|codebase)\s+(?:files?|structure|layout|architecture|contents?|tree|source)\b|\b(?:files?|source(?:\s+code)?)\s+(?:in|of|from|inside)\s+(?:this|the|our)\s+(?:repo|repository|project|codebase)\b/i;

/** An inspection/action verb operating on the repository itself. */
const REPOSITORY_ACTION =
    /\b(?:read|open|inspect|list|show|find|search|grep|scan|review|explain|analy[sz]e|refactor|fix|modify|change|update|edit|delete|remove|move|rename|diff)\b[^.!?\n]{0,80}\b(?:repo|repository|codebase)\b/i;

export function promptRequiresRepositoryFiles(prompt: string): boolean {
    if (!prompt) return false;
    return (
        DEICTIC_REPOSITORY_REFERENCE.test(prompt) ||
        REPOSITORY_FILE_PATH.test(prompt) ||
        REPOSITORY_STRUCTURE_REFERENCE.test(prompt) ||
        REPOSITORY_ACTION.test(prompt)
    );
}
