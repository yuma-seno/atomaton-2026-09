/**
 * issue-links.ts — reads an issue's relationships out of GitHub.
 *
 * One GraphQL request per issue covers all of it: the parent and children come
 * from GitHub's sub-issues, which `create_issue` establishes through
 * `addSubIssue` and which a person gets for free by using the sub-issue control
 * in the web UI; the pull requests come from two places that have to be unioned,
 * for the reason `claimsToClose` explains.
 *
 * Nothing here reads an Atomaton marker. The relationships have to survive an
 * issue a person opened, decomposed and closed without an agent ever touching
 * it, and markers only exist where an agent has been.
 */
import { ghGraphqlRead } from "./gh.ts";
import {
  claimsToClose,
  dedupeByNumber,
  type IssueLinks,
  type LinkedChild,
  type LinkedIssue,
  type LinkedPr,
} from "../../domain/work/issue-links.ts";

/** How many children and pull requests to ask for. Past this the reader is not reading, they are scrolling. */
const LINK_LIMIT = 50;

/**
 * How many labels to read per sub-issue.
 *
 * Only three are ever asked about — the sub-issue, launched and in-progress labels —
 * but they arrive in whatever order GitHub holds them, so this has to be a bound on
 * the issue rather than on what the caller wants. Twenty is far past what an issue in
 * this system carries and still one page.
 */
const LABEL_LIMIT = 20;

interface GqlIssue {
  number: number;
  title: string;
  state: string;
}

interface GqlChild extends GqlIssue {
  labels?: { nodes: { name: string }[] };
}

interface GqlPr extends GqlIssue {
  merged: boolean;
  body: string;
}

interface GqlIssueLinks {
  __typename: string;
  parent?: GqlIssue | null;
  subIssues?: { nodes: GqlChild[] };
  closedByPullRequestsReferences?: { nodes: GqlPr[] };
  timelineItems?: { nodes: { source?: GqlPr }[] };
  /** A pull request's own link: the issues it says it closes. */
  closingIssuesReferences?: { nodes: GqlIssue[] };
}

interface GqlResponse {
  repository?: { issueOrPullRequest?: GqlIssueLinks | null } | null;
}

/**
 * `issueOrPullRequest`, because `issue(number:)` answers only for an issue.
 *
 * Given a pull request's number it returns null and a NOT_FOUND error -- measured:
 * "Could not resolve to an Issue with the number of 826" for a pull request that
 * exists. Every caller passing one therefore got empty links and a message that read
 * like GitHub being unwell, when the number was fine and the question was wrong.
 *
 * The two kinds are asked different things because they ARE different, not to be
 * thorough. An issue has a parent and sub-issues; a pull request has neither, and
 * what it has instead is the issue it closes -- which is its parent in the same
 * sense (see `domain/work/work-tree.ts`). A pull request is a leaf.
 */
const QUERY = `
query($owner:String!, $name:String!, $number:Int!, $limit:Int!, $labelLimit:Int!) {
  repository(owner:$owner, name:$name) {
    issueOrPullRequest(number:$number) {
      __typename
      ... on Issue {
        parent { number title state }
        subIssues(first:$limit) { nodes { number title state labels(first:$labelLimit) { nodes { name } } } }
        closedByPullRequestsReferences(first:$limit, includeClosedPrs:true) {
          nodes { number title state merged body }
        }
        timelineItems(last:$limit, itemTypes:[CROSS_REFERENCED_EVENT]) {
          nodes { ... on CrossReferencedEvent { source { ... on PullRequest { number title state merged body } } } }
        }
      }
      ... on PullRequest {
        closingIssuesReferences(first:$limit) { nodes { number title state } }
      }
    }
  }
}`;

function normalise(node: GqlIssue): LinkedIssue {
  return { number: node.number, title: node.title, state: node.state.toLowerCase() };
}

function asChild(node: GqlChild): LinkedChild {
  return { ...normalise(node), labels: (node.labels?.nodes ?? []).map((label) => label.name) };
}

function asPr(node: GqlPr): LinkedPr {
  return { ...normalise(node), merged: Boolean(node.merged) };
}

/**
 * One issue's parent, children and pull requests.
 *
 * Returns empty links rather than throwing when GitHub cannot be reached: this
 * decorates a read that has already succeeded, and failing the whole read
 * because the decoration failed would be a poor trade.
 */
export function issueLinks(repo: string, number: number): IssueLinks {
  const [owner, name] = repo.split("/");
  if (!owner || !name) {
    return { children: [], pullRequests: [], unavailable: `"${repo}" is not an owner/name repository` };
  }

  let issue: GqlIssueLinks | null = null;
  try {
    issue = ghGraphqlRead<GqlResponse>(QUERY, { owner, name, number, limit: LINK_LIMIT, labelLimit: LABEL_LIMIT })
      .repository?.issueOrPullRequest ?? null;
  } catch (error) {
    const why = (error as Error).message;
    console.error(`[atomaton-github] WARN could not read links for #${number}: ${why}`);
    return { children: [], pullRequests: [], unavailable: `GitHub could not be reached: ${why}` };
  }
  // A null issue is not a failure: the number may simply not exist. Said as
  // itself rather than as empty links.
  if (!issue) return { children: [], pullRequests: [], unavailable: `#${number} was not found` };

  // A pull request is a leaf, and the issue it closes is its parent. Nothing else
  // it could answer is a link in the sense the caller means: its own number is not
  // one of its pull requests, and it has no children.
  if (issue.__typename === "PullRequest") {
    const closes = issue.closingIssuesReferences?.nodes ?? [];
    return {
      parent: closes[0] ? normalise(closes[0]) : undefined,
      children: [],
      pullRequests: [],
    };
  }

  // GitHub's own closing links first — where they exist they are authoritative.
  // Then the cross-reference timeline, filtered to pull requests that say they
  // close this issue, which is the only way a sub-issue's stacked pull request
  // appears at all.
  const declared = (issue.closedByPullRequestsReferences?.nodes ?? []).map(asPr);
  const referenced = (issue.timelineItems?.nodes ?? [])
    .map((node) => node.source)
    .filter((source): source is GqlPr => Boolean(source?.number) && claimsToClose(source?.body ?? "", number))
    .map(asPr);

  return {
    parent: issue.parent ? normalise(issue.parent) : undefined,
    children: (issue.subIssues?.nodes ?? []).map(asChild),
    pullRequests: dedupeByNumber(declared, referenced),
  };
}
