import {
  findSimilarIncidentSolutions,
  type SimilarIncidentIssue,
} from "../../lib/similar-incidents";

function validateIssue(value: unknown): SimilarIncidentIssue {
  if (!value || typeof value !== "object") {
    throw new Error("Issue payload is required");
  }
  const issue = value as Partial<SimilarIncidentIssue>;
  if (
    typeof issue.id !== "string" ||
    typeof issue.title !== "string" ||
    typeof issue.summary !== "string" ||
    typeof issue.category !== "string" ||
    typeof issue.entity !== "string" ||
    typeof issue.effect !== "string" ||
    !Array.isArray(issue.ruleIds) ||
    !issue.ruleIds.every((item) => typeof item === "string") ||
    !Array.isArray(issue.evidence)
  ) {
    throw new Error("Issue payload failed the similarity-search contract");
  }
  return issue as SimilarIncidentIssue;
}

export async function POST(request: Request) {
  try {
    const payload = (await request.json()) as { issue?: unknown };
    const issue = validateIssue(payload.issue);
    return Response.json(await findSimilarIncidentSolutions(issue));
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unable to search incident history";
    return Response.json({ error: message }, { status: 400 });
  }
}
