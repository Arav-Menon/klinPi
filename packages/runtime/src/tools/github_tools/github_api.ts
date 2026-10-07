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

export const DEFAULT_ISSUES_PER_PAGE = 30;
const LIST_BODY_MAX_LENGTH = 500;

export interface ListIssuesInput {
  owner: string;
  repo: string;
  state?: "open" | "closed" | "all" | undefined;
  labels?: string[] | undefined;
  assignee?: string | undefined;
  milestone?: number | undefined;
  sort?: "created" | "updated" | "comments" | undefined;
  direction?: "asc" | "desc" | undefined;
  perPage?: number | undefined;
  page?: number | undefined;
}

export interface IssueListItem {
  issueNumber: number;
  title: string;
  state: string;
  url: string;
  body: string | null;
  labels: string[];
  assignees: string[];
  createdAt: string;
  updatedAt: string;
}

export interface ListIssuesResult {
  issues: IssueListItem[];
  page: number;
  perPage: number;
  hasMore: boolean;
  excludedPullRequests: number;
}

export interface GetIssueInput {
  owner: string;
  repo: string;
  issueNumber: number;
}

export interface IssueDetail {
  issueNumber: number;
  title: string;
  body: string | null;
  state: string;
  url: string;
  labels: string[];
  assignees: string[];
  milestone: string | null;
  author: string | null;
  createdAt: string;
  updatedAt: string;
}

export type GetIssueResult =
  | { kind: "issue"; issue: IssueDetail }
  | { kind: "pull-request"; pullRequestNumber: number; url: string };

export interface UpdateIssueInput {
  owner: string;
  repo: string;
  issueNumber: number;
  title?: string | undefined;
  body?: string | undefined;
  state?: "open" | "closed" | undefined;
  labels?: string[] | undefined;
  assignees?: string[] | undefined;
  milestone?: number | undefined;
}

interface LabelLike {
  name?: string | null;
}

interface UserLike {
  login?: string | null;
}

interface IssueLike {
  number: number;
  title: string;
  body?: string | null;
  state: string;
  html_url: string;
  labels?: ReadonlyArray<string | LabelLike>;
  assignees?: ReadonlyArray<UserLike | null> | null;
  milestone?: { title?: string | null } | null;
  user?: UserLike | null;
  created_at: string;
  updated_at: string;
}

function toLabelNames(
  labels: ReadonlyArray<string | LabelLike> | undefined | null,
): string[] {
  if (!labels) {
    return [];
  }
  const names: string[] = [];
  for (const label of labels) {
    const name = typeof label === "string" ? label : label.name;
    if (name) {
      names.push(name);
    }
  }
  return names;
}

function toLogins(
  users: ReadonlyArray<UserLike | null> | undefined | null,
): string[] {
  if (!users) {
    return [];
  }
  const logins: string[] = [];
  for (const user of users) {
    if (user?.login) {
      logins.push(user.login);
    }
  }
  return logins;
}

function truncateBody(body: string | null | undefined): string | null {
  if (!body) {
    return null;
  }
  if (body.length <= LIST_BODY_MAX_LENGTH) {
    return body;
  }
  return `${body.slice(0, LIST_BODY_MAX_LENGTH)}…`;
}

function toIssueDetail(issue: IssueLike): IssueDetail {
  return {
    issueNumber: issue.number,
    title: issue.title,
    body: issue.body ?? null,
    state: issue.state,
    url: issue.html_url,
    labels: toLabelNames(issue.labels),
    assignees: toLogins(issue.assignees),
    milestone: issue.milestone?.title ?? null,
    author: issue.user?.login ?? null,
    createdAt: issue.created_at,
    updatedAt: issue.updated_at,
  };
}

export async function listIssues(
  token: string,
  input: ListIssuesInput,
): Promise<ListIssuesResult> {
  const octokit = new Octokit({ auth: token });
  const perPage = input.perPage ?? DEFAULT_ISSUES_PER_PAGE;
  const page = input.page ?? 1;

  const { data, headers } = await octokit.rest.issues.listForRepo({
    owner: input.owner,
    repo: input.repo,
    state: input.state ?? "open",
    ...(input.labels !== undefined && input.labels.length > 0
      ? { labels: input.labels.join(",") }
      : {}),
    ...(input.assignee !== undefined ? { assignee: input.assignee } : {}),
    ...(input.milestone !== undefined
      ? { milestone: String(input.milestone) }
      : {}),
    ...(input.sort !== undefined ? { sort: input.sort } : {}),
    ...(input.direction !== undefined ? { direction: input.direction } : {}),
    per_page: perPage,
    page,
  });

  // GitHub's Issues endpoints also return pull requests — filter them out so
  // the agent never mistakes a pull request for a normal issue.
  const issues: IssueListItem[] = [];
  let excludedPullRequests = 0;
  for (const item of data) {
    if (item.pull_request) {
      excludedPullRequests += 1;
      continue;
    }
    issues.push({
      issueNumber: item.number,
      title: item.title,
      state: item.state,
      url: item.html_url,
      body: truncateBody(item.body),
      labels: toLabelNames(item.labels),
      assignees: toLogins(item.assignees),
      createdAt: item.created_at,
      updatedAt: item.updated_at,
    });
  }

  const link = typeof headers.link === "string" ? headers.link : "";
  return {
    issues,
    page,
    perPage,
    hasMore: link.includes('rel="next"'),
    excludedPullRequests,
  };
}

export async function getIssue(
  token: string,
  input: GetIssueInput,
): Promise<GetIssueResult> {
  const octokit = new Octokit({ auth: token });

  const { data } = await octokit.rest.issues.get({
    owner: input.owner,
    repo: input.repo,
    issue_number: input.issueNumber,
  });

  if (data.pull_request) {
    return {
      kind: "pull-request",
      pullRequestNumber: data.number,
      url: data.html_url,
    };
  }

  return { kind: "issue", issue: toIssueDetail(data as IssueLike) };
}

export async function updateIssue(
  token: string,
  input: UpdateIssueInput,
): Promise<IssueDetail> {
  const octokit = new Octokit({ auth: token });

  const { data } = await octokit.rest.issues.update({
    owner: input.owner,
    repo: input.repo,
    issue_number: input.issueNumber,
    ...(input.title !== undefined ? { title: input.title } : {}),
    ...(input.body !== undefined ? { body: input.body } : {}),
    ...(input.state !== undefined ? { state: input.state } : {}),
    ...(input.labels !== undefined ? { labels: input.labels } : {}),
    ...(input.assignees !== undefined ? { assignees: input.assignees } : {}),
    ...(input.milestone !== undefined ? { milestone: input.milestone } : {}),
  });

  return toIssueDetail(data as IssueLike);
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
