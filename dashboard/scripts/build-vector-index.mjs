import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const dashboardRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const projectRoot = join(dashboardRoot, "..");
const dataRoot = join(
  projectRoot,
  "zipline_hackathon_practice_pack",
  "data_us_commercial",
);
const historyPath = join(dashboardRoot, "app", "data", "history-index.json");
const outputPath = join(dashboardRoot, "app", "data", "vector-index.json");

function loadEnv(path) {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match || process.env[match[1]]) continue;
    let value = match[2];
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[match[1]] = value;
  }
}

loadEnv(join(dashboardRoot, ".env.local"));
loadEnv(join(dashboardRoot, ".env"));

const apiKey = process.env.OPENAI_API_KEY?.trim();
if (!apiKey) {
  throw new Error("OPENAI_API_KEY is missing from dashboard/.env.local");
}

const model =
  process.env.OPENAI_EMBEDDING_MODEL?.trim() || "text-embedding-3-large";
const dimensions = Number(process.env.OPENAI_EMBEDDING_DIMENSIONS || 1536);
const history = JSON.parse(readFileSync(historyPath, "utf8"));

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field.replace(/\r$/, ""));
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += char;
    }
  }
  if (field || row.length) {
    row.push(field.replace(/\r$/, ""));
    rows.push(row);
  }
  const [headers, ...values] = rows;
  return values
    .filter((valuesRow) => valuesRow.some(Boolean))
    .map((valuesRow) =>
      Object.fromEntries(headers.map((header, index) => [header, valuesRow[index] ?? ""])),
    );
}

function readCsv(name) {
  return parseCsv(readFileSync(join(dataRoot, name), "utf8").replace(/^\uFEFF/, ""));
}

const topicRules = [
  ["weather", /\b(weather|wind|gust|visibility|rain|storm|fog)\b/i],
  ["battery", /\b(battery|cell.?voltage|capacity|charge|temperature)\b/i],
  ["maintenance", /\b(maintenance|motor|vibration|tether|inspection|replace|service)\b/i],
  ["merchant", /\b(merchant|kitchen|ready|readiness|pickup|handoff)\b/i],
  ["customer", /\b(customer|refund|credit|support|sentiment|complaint)\b/i],
  ["delivery", /\b(delivery|drop.?zone|returned|late|promise|order)\b/i],
  ["flight_safety", /\b(launch|flight|aircraft|ground|restrict|safe|release)\b/i],
];

function normalizedTopic(explicitValue, text) {
  const explicit = String(explicitValue || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
  if (explicit && !["none", "other", "operations", "unknown"].includes(explicit)) {
    return explicit;
  }
  return topicRules.find(([, pattern]) => pattern.test(text))?.[0] || explicit || "operations";
}

function splitText(text, targetWords = 450, overlapWords = 75) {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length <= targetWords) return [words.join(" ")];
  const chunks = [];
  const stride = targetWords - overlapWords;
  for (let start = 0; start < words.length; start += stride) {
    chunks.push(words.slice(start, start + targetWords).join(" "));
    if (start + targetWords >= words.length) break;
  }
  return chunks;
}

function hash(value) {
  return createHash("sha256").update(value).digest("hex");
}

function makeChunks() {
  const chunks = [];
  function add({ sourceType, sourceId, dataset, title, date = "", topic, text, extra = {} }) {
    const decidedTopic = normalizedTopic(topic, `${title} ${text}`);
    const parts = splitText(text);
    parts.forEach((part, index) => {
      const id = `${sourceType}:${sourceId}:${index + 1}`;
      const metadata = {
        sourceType,
        sourceId,
        dataset,
        title,
        date,
        topic: decidedTopic,
        chunk: index + 1,
        chunkCount: parts.length,
        ...extra,
      };
      const header = [
        `source_type=${sourceType}`,
        `source_id=${sourceId}`,
        `topic=${decidedTopic}`,
        date ? `date=${date}` : "",
        title ? `title=${title}` : "",
      ]
        .filter(Boolean)
        .join(" | ");
      const embeddingText = `${header}\n${part}`;
      chunks.push({
        id,
        hash: hash(embeddingText),
        text: part,
        embeddingText,
        metadata,
      });
    });
  }

  for (const policy of history.policies) {
    add({
      sourceType: "policy",
      sourceId: policy.id,
      dataset: policy.dataset,
      title: policy.section,
      topic: policy.section,
      text: policy.text,
      extra: { authoritative: true, policyRuleId: policy.id },
    });
  }
  for (const incident of history.incidents) {
    add({
      sourceType: "incident",
      sourceId: incident.id,
      dataset: incident.dataset,
      title: incident.title,
      date: incident.date,
      topic: incident.topic,
      text: incident.narrative,
    });
  }
  for (const row of history.maintenance) {
    const text =
      `Maintenance ${row.maintenance_id} for ${row.drone_id} at ${row.site}. ` +
      `Component: ${row.component}. Type: ${row.maintenance_type}. ` +
      `Reason: ${row.reason}. Action: ${row.action}. Release status: ${row.release_status}.`;
    add({
      sourceType: "maintenance",
      sourceId: row.maintenance_id,
      dataset: "maintenance_events.csv",
      title: `${row.drone_id} ${row.component}`,
      date: row.opened_at,
      topic: row.component,
      text,
      extra: { droneId: row.drone_id, site: row.site },
    });
  }
  for (const row of readCsv("customer_support_tickets.csv")) {
    const text =
      `Customer support ticket ${row.ticket_id} for order ${row.order_id}. ` +
      `Reason: ${row.contact_reason}. Resolution: ${row.resolution}. ` +
      `Refund: ${row.refund_amount_usd || "0"} USD. Sentiment: ${row.customer_sentiment}.`;
    add({
      sourceType: "support",
      sourceId: row.ticket_id,
      dataset: "customer_support_tickets.csv",
      title: `${row.contact_reason} · ${row.resolution}`,
      date: row.opened_at,
      topic: row.contact_reason,
      text,
      extra: { orderId: row.order_id },
    });
  }
  for (const row of readCsv("commercial_delivery_operations.csv")) {
    if (!row.operator_note?.trim()) continue;
    const text =
      `Operator note for flight ${row.flight_id}, order ${row.order_id}, drone ${row.drone_id}, ` +
      `site ${row.fulfillment_site}, merchant ${row.merchant_name}. ` +
      `Status: ${row.status}. Anomaly: ${row.anomaly_flag}. Note: ${row.operator_note}`;
    add({
      sourceType: "operator_note",
      sourceId: row.flight_id,
      dataset: "commercial_delivery_operations.csv",
      title: `${row.flight_id} operator note`,
      date: row.launch_at,
      topic: row.anomaly_flag,
      text,
      extra: {
        droneId: row.drone_id,
        site: row.fulfillment_site,
        merchant: row.merchant_name,
        orderId: row.order_id,
      },
    });
  }
  return chunks;
}

async function embed(inputs) {
  const response = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ model, dimensions, input: inputs }),
  });
  if (!response.ok) {
    const message = await response.text();
    throw new Error(`Embedding request failed (${response.status}): ${message.slice(0, 500)}`);
  }
  const payload = await response.json();
  return payload.data
    .sort((a, b) => a.index - b.index)
    .map((item) => item.embedding);
}

const chunks = makeChunks();
let previous = { chunks: [] };
if (existsSync(outputPath)) {
  try {
    previous = JSON.parse(readFileSync(outputPath, "utf8"));
  } catch {
    previous = { chunks: [] };
  }
}
const cached = new Map(
  (previous.chunks || [])
    .filter((chunk) => chunk.embedding?.length === dimensions)
    .map((chunk) => [`${chunk.id}:${chunk.hash}`, chunk.embedding]),
);
const pending = chunks.filter((chunk) => !cached.has(`${chunk.id}:${chunk.hash}`));
console.log(
  `Prepared ${chunks.length} record-aware chunks; ${pending.length} require embedding.`,
);

for (let start = 0; start < pending.length; start += 64) {
  const batch = pending.slice(start, start + 64);
  const vectors = await embed(batch.map((chunk) => chunk.embeddingText));
  batch.forEach((chunk, index) => cached.set(`${chunk.id}:${chunk.hash}`, vectors[index]));
  console.log(`Embedded ${Math.min(start + batch.length, pending.length)}/${pending.length}.`);
}

const output = {
  version: 1,
  generatedAt: new Date().toISOString(),
  model,
  dimensions,
  chunking: {
    strategy: "record-aware",
    longRecordTargetTokensApprox: 600,
    overlapTokensApprox: 100,
  },
  topicAssignment:
    "Explicit source topic/category first; deterministic keyword rules only when missing or generic.",
  chunks: chunks.map(({ embeddingText: _embeddingText, ...chunk }) => ({
    ...chunk,
    embedding: cached.get(`${chunk.id}:${chunk.hash}`),
  })),
};
writeFileSync(outputPath, JSON.stringify(output), "utf8");
console.log(`Wrote ${outputPath}`);
