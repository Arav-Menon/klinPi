import { Octokit } from "octokit";

export interface CreateIssueInput {
  owner: string;
  repo: string;
  title: string;
  body?: string | undefined;
  labels?: string[] | undefined;
  assignees?: string[] | undefined;
  milestone?: number | undefined;
}

export interface IssueSummary {
  issueNumber: number;
  url: string;
  title: string;
  state: string;
}

export interface CreatePullRequestInput {
  owner: string;
  repo: string;
  title: string;
  body?: string | undefined;
  head: string;
  base: string;
}

export interface PullRequestSummary {
  pullRequestNumber: number;
  url: string;
  title: string;
  state: string;
  head: string;
  base: string;
}

export async function createIssue(
  token: string,
  input: CreateIssueInput,
): Promise<IssueSummary> {
  const octokit = new Octokit({ auth: token });

  const { data: issue } = await octokit.rest.issues.create({
    owner: input.owner,
    repo: input.repo,
    title: input.title,
    ...(input.body !== undefined ? { body: input.body } : {}),
    ...(input.labels !== undefined ? { labels: input.labels } : {}),
    ...(input.assignees !== undefined ? { assignees: input.assignees } : {}),
    ...(input.milestone !== undefined ? { milestone: input.milestone } : {}),
  });

  return {
    issueNumber: issue.number,
    url: issue.html_url,
    title: issue.title,
    state: issue.state,
  };
}

export interface CompareBranchesInput {
  owner: string;
  repo: string;
  base: string;
  head: string;
}

export interface CompareBranchesResult {
  aheadBy: number;
  totalCommits: number;
}

export async function compareBranches(
  token: string,
  input: CompareBranchesInput,
): Promise<CompareBranchesResult> {
  const octokit = new Octokit({ auth: token });

  const { data } = await octokit.rest.repos.compareCommitsWithBasehead({
    owner: input.owner,
    repo: input.repo,
    basehead: `${input.base}...${input.head}`,
  });

  return {
    aheadBy: data.ahead_by,
    totalCommits: data.total_commits,
  };
}

export async function createPullRequest(
  token: string,
  input: CreatePullRequestInput,
): Promise<PullRequestSummary> {
  const octokit = new Octokit({ auth: token });

  const { data: pr } = await octokit.rest.pulls.create({
    owner: input.owner,
    repo: input.repo,
    title: input.title,
    head: input.head,
    base: input.base,
    ...(input.body !== undefined ? { body: input.body } : {}),
  });

  return {
    pullRequestNumber: pr.number,
    url: pr.html_url,
    title: pr.title,
    state: pr.state,
    head: pr.head.ref,
    base: pr.base.ref,
  };
}
