import vectorIndex from "../data/vector-index.json";

export type VectorSourceType =
  | "policy"
  | "incident"
  | "maintenance"
  | "support"
  | "operator_note";

export type VectorMetadata = {
  sourceType: VectorSourceType;
  sourceId: string;
  dataset: string;
  title: string;
  date: string;
  topic: string;
  chunk: number;
  chunkCount: number;
  authoritative?: boolean;
  policyRuleId?: string;
  droneId?: string;
  site?: string;
  merchant?: string;
  orderId?: string;
};

export type VectorMatch = {
  id: string;
  score: number;
  text: string;
  metadata: VectorMetadata;
};

type VectorChunk = {
  id: string;
  text: string;
  metadata: VectorMetadata;
  embedding: number[];
};

function normalize(value: string | null | undefined) {
  return (value ?? "").trim().toLowerCase().replaceAll("_", " ");
}

function keywordTokens(value: string) {
  return normalize(value)
    .split(/[^a-z0-9.-]+/)
    .filter((token) => token.length > 2);
}

function keywordScore(query: string, chunk: VectorChunk) {
  const text = normalize(
    `${chunk.metadata.title} ${chunk.metadata.topic} ${chunk.text}`,
  );
  return keywordTokens(query).reduce(
    (score, token) => score + (text.includes(token) ? 1 : 0),
    0,
  );
}

function cosineSimilarity(left: number[], right: number[]) {
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  const length = Math.min(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    dot += left[index] * right[index];
    leftNorm += left[index] * left[index];
    rightNorm += right[index] * right[index];
  }
  if (!leftNorm || !rightNorm) return 0;
  return dot / Math.sqrt(leftNorm * rightNorm);
}

async function embedQuery(query: string): Promise<number[] | null> {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) return null;
  const response = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model:
        process.env.OPENAI_EMBEDDING_MODEL?.trim() ||
        "text-embedding-3-large",
      dimensions: Number(process.env.OPENAI_EMBEDDING_DIMENSIONS || 1536),
      input: query,
    }),
  });
  if (!response.ok) return null;
  const payload = (await response.json()) as {
    data?: Array<{ embedding?: number[] }>;
  };
  return payload.data?.[0]?.embedding ?? null;
}

export async function searchVectorIndex(input: {
  query: string;
  sourceTypes: VectorSourceType[];
  topic?: string | null;
  limit?: number;
}): Promise<VectorMatch[]> {
  const limit = Math.min(12, Math.max(1, input.limit ?? 8));
  const allowedTypes = new Set(input.sourceTypes);
  const candidates = (vectorIndex.chunks as VectorChunk[]).filter((chunk) => {
    if (!allowedTypes.has(chunk.metadata.sourceType)) return false;
    if (
      input.topic &&
      !normalize(
        `${chunk.metadata.topic} ${chunk.metadata.title} ${chunk.text}`,
      ).includes(normalize(input.topic))
    ) {
      return false;
    }
    return true;
  });
  if (!candidates.length) return [];

  const queryVector = input.query.trim()
    ? await embedQuery(input.query)
    : null;
  return candidates
    .map((chunk) => ({
      id: chunk.id,
      score: queryVector
        ? cosineSimilarity(queryVector, chunk.embedding)
        : keywordScore(input.query, chunk),
      text: chunk.text,
      metadata: chunk.metadata,
    }))
    .filter((match) => match.score > 0 || !input.query.trim())
    .sort(
      (left, right) =>
        right.score - left.score ||
        right.metadata.date.localeCompare(left.metadata.date),
    )
    .slice(0, limit);
}

export function getVectorIndexStatus() {
  return {
    ready: vectorIndex.chunks.length > 0,
    chunks: vectorIndex.chunks.length,
    model: vectorIndex.model,
    dimensions: vectorIndex.dimensions,
    generatedAt: vectorIndex.generatedAt,
  };
}
