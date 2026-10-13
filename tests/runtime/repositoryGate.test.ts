import { describe, it, expect } from "vitest";
import { promptRequiresRepositoryFiles } from "../../packages/runtime/src/lib/repositoryGate.js";

describe("promptRequiresRepositoryFiles", () => {
    it("flags prompts that reference the linked repository", () => {
        const prompts = [
            "Can you deep dive into this repo and explain me the architecture of this repo?",
            "Add a Dockerfile to this repository with a production build",
            "create new issue on this repo bro about redisign the UI",
            "What is the current project structure?",
            "Explain the repository layout",
            "list the files in this repo",
        ];
        for (const prompt of prompts) {
            expect(promptRequiresRepositoryFiles(prompt), prompt).toBe(true);
        }
    });

    it("flags prompts that point at file paths or file actions", () => {
        expect(promptRequiresRepositoryFiles("Open src/app/routes.ts")).toBe(true);
        expect(
            promptRequiresRepositoryFiles("What does packages/runtime/src/model.ts do?"),
        ).toBe(true);
        expect(promptRequiresRepositoryFiles("Read the files in the repository")).toBe(true);
        expect(promptRequiresRepositoryFiles("inspect the codebase for TODOs")).toBe(true);
        // Deliberately conservative: a bare file name with no repository
        // reference falls back to the system-prompt repositoryNote instead
        // of hard-erroring.
        expect(promptRequiresRepositoryFiles("Read main.py and summarize it")).toBe(false);
    });

    it("does not flag ordinary questions that need no repository", () => {
        const prompts = [
            "What tools are available?",
            "Help me fix a bug",
            "Hii, How are you?",
            "What is node.js?",
            "Improve the Dockerfile for production builds.",
            "Create an issue about redesigning the UI",
            "create a bug report about the broken build",
            "What is the difference between a mutex and a semaphore?",
        ];
        for (const prompt of prompts) {
            expect(promptRequiresRepositoryFiles(prompt), prompt).toBe(false);
        }
    });

    it("returns false for an empty prompt", () => {
        expect(promptRequiresRepositoryFiles("")).toBe(false);
    });
});
