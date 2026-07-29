"use client";

import {
  Archive,
  ArrowUp,
  Bot,
  CalendarDays,
  ChevronDown,
  Database,
  FileSearch,
  Filter,
  MessageSquare,
  Plus,
  RotateCcw,
  Search,
  Table2,
} from "lucide-react";
import { FormEvent, useEffect, useMemo, useState } from "react";

type HistoryEvidence = {
  id: string;
  dataset: string;
  label: string;
  value: string;
  timestamp: string;
};

type HistoryResultRow = {
  label: string;
  value: number;
};

type ToolTrace = {
  name: string;
  summary: string;
  evidenceCount: number;
};

type HistoryAnswer = {
  status: "ready";
  source: "openai" | "dataset_engine";
  answer: string;
  evidence: HistoryEvidence[];
  rows: HistoryResultRow[];
  toolsUsed: ToolTrace[];
  limitations: string[];
};

type HistoryMeta = {
  summary: {
    datasetCount: number;
    recordCount: number;
    dateFrom: string;
    dateTo: string;
    flightCount: number;
    incidentCount: number;
    sites: string[];
  };
  datasets: Array<{ name: string; records: number }>;
  suggestions: string[];
  aiConfigured: boolean;
  semanticSearchConfigured: boolean;
};

type ConversationItem = {
  id: string;
  question: string;
  result: HistoryAnswer | null;
  loading: boolean;
  error?: string;
};

type HistoryThread = {
  id: string;
  title: string;
  status: "active" | "archived";
  conversations: ConversationItem[];
  createdAt: string;
  updatedAt: string;
};

const HISTORY_THREADS_KEY = "zipline-history-threads-v1";

const toolLabels: Record<string, string> = {
  query_structured_history: "Structured data query",
  search_incident_reports: "Incident search",
  search_operating_policy: "Policy search",
  file_search: "Semantic search",
};

function displayName(value: string) {
  return value.replaceAll("_", " ").replace(/\b\w/g, (character) => character.toUpperCase());
}

function displayDate(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(value));
}

function createThread(): HistoryThread {
  const now = new Date().toISOString();
  return {
    id: `history-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    title: "New chat",
    status: "active",
    conversations: [],
    createdAt: now,
    updatedAt: now,
  };
}

function threadTitle(question: string) {
  return question.length > 46 ? `${question.slice(0, 46).trim()}…` : question;
}

export function HistoryWorkspace() {
  const [meta, setMeta] = useState<HistoryMeta | null>(null);
  const [question, setQuestion] = useState("");
  const [site, setSite] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [threads, setThreads] = useState<HistoryThread[]>([]);
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null);
  const [threadsLoaded, setThreadsLoaded] = useState(false);

  useEffect(() => {
    let restored: HistoryThread[] = [];
    try {
      const stored = window.localStorage.getItem(HISTORY_THREADS_KEY);
      const parsed = stored ? (JSON.parse(stored) as HistoryThread[]) : [];
      if (Array.isArray(parsed)) {
        restored = parsed
          .filter(
            (thread) =>
              typeof thread?.id === "string" &&
              typeof thread?.title === "string" &&
              Array.isArray(thread?.conversations),
          )
          .map((thread) => ({
            ...thread,
            status: thread.status === "archived" ? "archived" : "active",
            conversations: thread.conversations.map((conversation) => ({
              ...conversation,
              loading: false,
              error: conversation.loading
                ? "This request was interrupted. Send it again to retry."
                : conversation.error,
            })),
          }));
      }
    } catch {
      restored = [];
    }
    if (!restored.length) restored = [createThread()];
    setThreads(restored);
    setSelectedThreadId(
      restored.find((thread) => thread.status === "active")?.id ?? restored[0].id,
    );
    setThreadsLoaded(true);
  }, []);

  useEffect(() => {
    if (!threadsLoaded) return;
    window.localStorage.setItem(HISTORY_THREADS_KEY, JSON.stringify(threads));
  }, [threads, threadsLoaded]);

  useEffect(() => {
    let cancelled = false;
    void fetch("/api/history")
      .then((response) => response.json() as Promise<HistoryMeta>)
      .then((payload) => {
        if (cancelled) return;
        setMeta(payload);
        setDateFrom(payload.summary.dateFrom.slice(0, 10));
        setDateTo(payload.summary.dateTo.slice(0, 10));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const selectedThread = useMemo(
    () => threads.find((thread) => thread.id === selectedThreadId) ?? null,
    [selectedThreadId, threads],
  );
  const conversations = selectedThread?.conversations ?? [];
  const activeThreads = useMemo(
    () =>
      threads
        .filter((thread) => thread.status === "active")
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    [threads],
  );
  const archivedThreads = useMemo(
    () =>
      threads
        .filter((thread) => thread.status === "archived")
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    [threads],
  );
  const latestResult = useMemo(
    () =>
      [...conversations]
        .reverse()
        .find((conversation) => conversation.result)?.result ?? null,
    [conversations],
  );

  async function askHistory(nextQuestion: string) {
    const trimmed = nextQuestion.trim();
    if (!trimmed) return;
    let threadId = selectedThreadId;
    if (!threadId || !threads.some((thread) => thread.id === threadId)) {
      const thread = createThread();
      threadId = thread.id;
      setThreads((current) => [thread, ...current]);
      setSelectedThreadId(threadId);
    }
    const id = `${Date.now()}-${Math.random()}`;
    const now = new Date().toISOString();
    setQuestion("");
    setThreads((current) =>
      current.map((thread) =>
        thread.id === threadId
          ? {
              ...thread,
              title:
                thread.conversations.length === 0 ? threadTitle(trimmed) : thread.title,
              status: "active",
              updatedAt: now,
              conversations: [
                ...thread.conversations,
                { id, question: trimmed, result: null, loading: true },
              ],
            }
          : thread,
      ),
    );
    try {
      const response = await fetch("/api/history", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          question: trimmed,
          conversationHistory: conversations.slice(-8).map((conversation) => ({
            question: conversation.question,
            answer: conversation.result?.answer ?? conversation.error ?? "",
          })),
          filters: {
            site: site || null,
            dateFrom: dateFrom || null,
            dateTo: dateTo || null,
          },
        }),
      });
      if (!response.ok) throw new Error("Historical analysis request failed.");
      const result = (await response.json()) as HistoryAnswer;
      setThreads((current) =>
        current.map((thread) =>
          thread.id === threadId
            ? {
                ...thread,
                updatedAt: new Date().toISOString(),
                conversations: thread.conversations.map((conversation) =>
                  conversation.id === id
                    ? { ...conversation, loading: false, result }
                    : conversation,
                ),
              }
            : thread,
        ),
      );
    } catch {
      setThreads((current) =>
        current.map((thread) =>
          thread.id === threadId
            ? {
                ...thread,
                updatedAt: new Date().toISOString(),
                conversations: thread.conversations.map((conversation) =>
                  conversation.id === id
                    ? {
                        ...conversation,
                        loading: false,
                        error: "The historical data service is unavailable.",
                      }
                    : conversation,
                ),
              }
            : thread,
        ),
      );
    }
  }

  function startNewChat() {
    const thread = createThread();
    setThreads((current) => [thread, ...current]);
    setSelectedThreadId(thread.id);
    setQuestion("");
  }

  function archiveCurrentThread() {
    if (!selectedThread) return;
    setThreads((current) =>
      current.map((thread) =>
        thread.id === selectedThread.id
          ? { ...thread, status: "archived", updatedAt: new Date().toISOString() }
          : thread,
      ),
    );
    const next = activeThreads.find((thread) => thread.id !== selectedThread.id);
    if (next) setSelectedThreadId(next.id);
    else startNewChat();
  }

  function restoreThread(threadId: string) {
    setThreads((current) =>
      current.map((thread) =>
        thread.id === threadId
          ? { ...thread, status: "active", updatedAt: new Date().toISOString() }
          : thread,
      ),
    );
    setSelectedThreadId(threadId);
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    void askHistory(question);
  }

  return (
    <div className="page-content history-page">
      <div className="page-heading history-heading">
        <div>
          <h1>Historical analysis</h1>
        </div>
        <div className="history-config">
          <span className={meta?.aiConfigured ? "connected" : ""}>
            <Bot size={14} />
            {meta?.aiConfigured ? "OpenAI tools connected" : "Dataset engine"}
          </span>
          <span className={meta?.semanticSearchConfigured ? "connected" : ""}>
            <FileSearch size={14} />
            {meta?.semanticSearchConfigured
              ? "Semantic index ready"
              : "Semantic index unavailable"}
          </span>
        </div>
      </div>

      <section className="history-summary" aria-label="Historical dataset summary">
        <div>
          <span>Datasets</span>
          <strong>{meta?.summary.datasetCount ?? "—"}</strong>
        </div>
        <div>
          <span>Records</span>
          <strong>{meta?.summary.recordCount.toLocaleString() ?? "—"}</strong>
        </div>
        <div>
          <span>Flights</span>
          <strong>{meta?.summary.flightCount.toLocaleString() ?? "—"}</strong>
        </div>
        <div>
          <span>Incident reports</span>
          <strong>{meta?.summary.incidentCount ?? "—"}</strong>
        </div>
        <div className="history-range">
          <span>Date range</span>
          <strong>
            {meta
              ? `${displayDate(meta.summary.dateFrom)} – ${displayDate(meta.summary.dateTo)}`
              : "—"}
          </strong>
        </div>
      </section>

      <section className="history-filters" aria-label="Historical filters">
        <span className="history-filter-label">
          <Filter size={14} />
          Filters
        </span>
        <label>
          <span>Site</span>
          <select value={site} onChange={(event) => setSite(event.target.value)}>
            <option value="">All sites</option>
            {(meta?.summary.sites ?? []).map((value) => (
              <option value={value} key={value}>
                {displayName(value)}
              </option>
            ))}
          </select>
          <ChevronDown size={13} />
        </label>
        <label>
          <span>From</span>
          <input
            type="date"
            value={dateFrom}
            onChange={(event) => setDateFrom(event.target.value)}
          />
        </label>
        <label>
          <span>To</span>
          <input
            type="date"
            value={dateTo}
            onChange={(event) => setDateTo(event.target.value)}
          />
        </label>
      </section>

      <div className="history-workspace">
        <aside className="panel history-thread-panel">
          <button className="history-new-chat" type="button" onClick={startNewChat}>
            <Plus size={14} />
            New chat
          </button>

          <div className="history-thread-section">
            <div className="history-thread-section-title">
              <span>Active</span>
              <span>{activeThreads.length}</span>
            </div>
            <div className="history-thread-list">
              {activeThreads.map((thread) => (
                <button
                  className={thread.id === selectedThreadId ? "selected" : ""}
                  key={thread.id}
                  type="button"
                  onClick={() => setSelectedThreadId(thread.id)}
                >
                  <MessageSquare size={13} />
                  <span>{thread.title}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="history-thread-section history-thread-archived">
            <div className="history-thread-section-title">
              <span>Archived</span>
              <span>{archivedThreads.length}</span>
            </div>
            <div className="history-thread-list">
              {archivedThreads.map((thread) => (
                <button
                  className={thread.id === selectedThreadId ? "selected" : ""}
                  key={thread.id}
                  type="button"
                  onClick={() => setSelectedThreadId(thread.id)}
                >
                  <Archive size={13} />
                  <span>{thread.title}</span>
                  <RotateCcw
                    className="history-thread-restore"
                    size={12}
                    onClick={(event) => {
                      event.stopPropagation();
                      restoreThread(thread.id);
                    }}
                  />
                </button>
              ))}
            </div>
          </div>
        </aside>

        <section className="panel history-chat">
          <div className="history-chat-header">
            <div>
              <Search size={16} />
              <strong>{selectedThread?.title ?? "Historical analysis"}</strong>
            </div>
            {selectedThread?.status === "active" && (
              <button type="button" onClick={archiveCurrentThread}>
                <Archive size={13} />
                Archive
              </button>
            )}
          </div>

          <div className="history-conversation">
            {!conversations.length && (
              <div className="history-empty">
                <Database size={22} />
                <strong>Ask a question about past operations</strong>
                <div className="history-suggestions">
                  {(meta?.suggestions ?? []).map((suggestion) => (
                    <button key={suggestion} onClick={() => void askHistory(suggestion)}>
                      {suggestion}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {conversations.map((conversation) => (
              <article className="history-exchange" key={conversation.id}>
                <div className="history-question">{conversation.question}</div>
                <div className="history-answer">
                  {conversation.loading ? (
                    <div className="history-loading">
                      <span />
                      <span />
                      <span />
                    </div>
                  ) : conversation.error ? (
                    <p className="history-error">{conversation.error}</p>
                  ) : conversation.result ? (
                    <>
                      <div className="history-answer-meta">
                        <span>
                          {conversation.result.source === "openai"
                            ? "OpenAI + tools"
                            : "Dataset query"}
                        </span>
                        <span>{conversation.result.evidence.length} sources</span>
                      </div>
                      <p>{conversation.result.answer}</p>
                      {conversation.result.toolsUsed.length > 0 && (
                        <div className="history-tools">
                          {conversation.result.toolsUsed.map((tool, index) => (
                            <span key={`${tool.name}-${index}`}>
                              {toolLabels[tool.name] ?? displayName(tool.name)}
                            </span>
                          ))}
                        </div>
                      )}
                      {conversation.result.rows.length > 0 && (
                        <ResultBars rows={conversation.result.rows.slice(0, 8)} />
                      )}
                      {conversation.result.limitations.map((limitation) => (
                        <small className="history-limitation" key={limitation}>
                          {limitation}
                        </small>
                      ))}
                    </>
                  ) : null}
                </div>
              </article>
            ))}
          </div>

          <form className="history-composer" onSubmit={submit}>
            <textarea
              value={question}
              onChange={(event) => setQuestion(event.target.value)}
              placeholder="Ask about incidents, policies, trends, drones, merchants, or sites"
              rows={2}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  if (question.trim()) void askHistory(question);
                }
              }}
              aria-label="Historical analysis question"
            />
            <button type="submit" disabled={!question.trim()} aria-label="Ask question">
              <ArrowUp size={17} />
            </button>
          </form>
        </section>

        <aside className="panel history-evidence">
          <div className="history-evidence-header">
            <div>
              <Database size={16} />
              <strong>Evidence</strong>
            </div>
            <span>{latestResult?.evidence.length ?? 0}</span>
          </div>

          {latestResult?.evidence.length ? (
            <div className="history-evidence-list">
              {latestResult.evidence.map((evidence) => (
                <article key={`${evidence.dataset}-${evidence.id}`}>
                  <div>
                    <span>{evidence.dataset}</span>
                    <small>{displayDate(evidence.timestamp)}</small>
                  </div>
                  <strong>{evidence.label}</strong>
                  <p>{evidence.value}</p>
                  <code>{evidence.id}</code>
                </article>
              ))}
            </div>
          ) : (
            <div className="history-evidence-empty">
              <Table2 size={20} />
              <span>Sources used in the latest answer will appear here.</span>
            </div>
          )}

          <details className="dataset-catalog">
            <summary>
              <span>
                <CalendarDays size={14} />
                Dataset catalog
              </span>
              <span>{meta?.datasets.length ?? 0}</span>
            </summary>
            <div>
              {(meta?.datasets ?? []).map((dataset) => (
                <span key={dataset.name}>
                  <b>{dataset.name}</b>
                  <small>{dataset.records.toLocaleString()} records</small>
                </span>
              ))}
            </div>
          </details>
        </aside>
      </div>
    </div>
  );
}

function ResultBars({ rows }: { rows: HistoryResultRow[] }) {
  const maximum = Math.max(...rows.map((row) => row.value), 1);
  return (
    <div className="history-bars">
      {rows.map((row) => (
        <div key={row.label}>
          <span>{row.label}</span>
          <div>
            <i style={{ width: `${Math.max(3, (row.value / maximum) * 100)}%` }} />
          </div>
          <strong>{row.value.toLocaleString()}</strong>
        </div>
      ))}
    </div>
  );
}
