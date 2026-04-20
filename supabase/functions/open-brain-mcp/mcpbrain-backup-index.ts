import { Hono } from "hono";
import { StreamableHTTPTransport } from "@hono/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const OPENROUTER_API_KEY = Deno.env.get("OPENROUTER_API_KEY")!;
const MCP_ACCESS_KEY = Deno.env.get("MCP_ACCESS_KEY")!;

const OPENROUTER_BASE = "https://openrouter.ai/api/v1";
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

type ThoughtRow = {
  id?: string;
  content: string;
  metadata: Record<string, unknown>;
  created_at: string;
  similarity?: number;
};

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

async function getEmbedding(text: string): Promise<number[]> {
  const r = await fetch(`${OPENROUTER_BASE}/embeddings`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENROUTER_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "openai/text-embedding-3-small",
      input: text,
    }),
  });

  if (!r.ok) {
    const msg = await r.text().catch(() => "");
    throw new Error(`OpenRouter embeddings failed: ${r.status} ${msg}`);
  }

  const d = await r.json();
  return d.data[0].embedding;
}

async function extractMetadata(text: string): Promise<Record<string, unknown>> {
  const r = await fetch(`${OPENROUTER_BASE}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENROUTER_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "openai/gpt-4o-mini",
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: `Extract metadata from the user's captured thought. Return JSON with:
- "people": array of people mentioned (empty if none)
- "action_items": array of implied to-dos (empty if none)
- "dates_mentioned": array of dates YYYY-MM-DD (empty if none)
- "topics": array of 1-3 short topic tags (always at least one)
- "type": one of "observation", "task", "idea", "reference", "person_note"
Only extract what's explicitly there.`,
        },
        { role: "user", content: text },
      ],
    }),
  });

  if (!r.ok) {
    const msg = await r.text().catch(() => "");
    throw new Error(`OpenRouter metadata extraction failed: ${r.status} ${msg}`);
  }

  const d = await r.json();

  try {
    return JSON.parse(d.choices[0].message.content);
  } catch {
    return { topics: ["uncategorized"], type: "observation" };
  }
}

const server = new McpServer({
  name: "open-brain",
  version: "1.0.0",
});

// Tool 1: Semantic Search
server.registerTool(
  "search_thoughts",
  {
    title: "Search Thoughts",
    description:
      "Search captured thoughts by meaning. Use this when the user asks about a topic, person, or idea they've previously captured.",
    inputSchema: {
      query: z.string().describe("What to search for"),
      limit: z.number().optional().default(10),
      threshold: z.number().optional().default(0.5),
    },
  },
  async ({ query, limit, threshold }) => {
    try {
      const qEmb = await getEmbedding(query);

      const { data, error } = await supabase.rpc("match_thoughts", {
        query_embedding: qEmb,
        match_threshold: threshold,
        match_count: limit,
        filter: {},
      });

      if (error) {
        return {
          content: [{ type: "text" as const, text: `Search error: ${error.message}` }],
          isError: true,
        };
      }

      if (!data || data.length === 0) {
        return {
          content: [{ type: "text" as const, text: `No thoughts found matching "${query}".` }],
        };
      }

      const results = data.map((t: ThoughtRow, i: number) => {
        const m = t.metadata || {};
        const topics = asStringArray(m.topics);
        const people = asStringArray(m.people);
        const actions = asStringArray(m.action_items);

        const parts = [
          `--- Result ${i + 1} (${(((t.similarity ?? 0) * 100)).toFixed(1)}% match) ---`,
          `Captured: ${new Date(t.created_at).toLocaleDateString()}`,
          `Type: ${typeof m.type === "string" ? m.type : "unknown"}`,
        ];

        if (topics.length) parts.push(`Topics: ${topics.join(", ")}`);
        if (people.length) parts.push(`People: ${people.join(", ")}`);
        if (actions.length) parts.push(`Actions: ${actions.join("; ")}`);
        parts.push(`\n${t.content}`);

        return parts.join("\n");
      });

      return {
        content: [
          {
            type: "text" as const,
            text: `Found ${data.length} thought(s):\n\n${results.join("\n\n")}`,
          },
        ],
      };
    } catch (err: unknown) {
      return {
        content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }],
        isError: true,
      };
    }
  }
);

// Tool 2: List Recent Thoughts
server.registerTool(
  "list_thoughts",
  {
    title: "List Recent Thoughts",
    description:
      "List recently captured thoughts with optional filters by type, topic, person, or time range.",
    inputSchema: {
      limit: z.number().optional().default(10),
      type: z
        .string()
        .optional()
        .describe("Filter by type: observation, task, idea, reference, person_note"),
      topic: z.string().optional().describe("Filter by topic tag"),
      person: z.string().optional().describe("Filter by person mentioned"),
      days: z.number().optional().describe("Only thoughts from the last N days"),
    },
  },
  async ({ limit, type, topic, person, days }) => {
    try {
      let q = supabase
        .from("thoughts")
        .select("content, metadata, created_at")
        .order("created_at", { ascending: false })
        .limit(limit);

      if (type) q = q.contains("metadata", { type });
      if (topic) q = q.contains("metadata", { topics: [topic] });
      if (person) q = q.contains("metadata", { people: [person] });
      if (days) {
        const since = new Date();
        since.setDate(since.getDate() - days);
        q = q.gte("created_at", since.toISOString());
      }

      const { data, error } = await q;

      if (error) {
        return {
          content: [{ type: "text" as const, text: `Error: ${error.message}` }],
          isError: true,
        };
      }

      if (!data || !data.length) {
        return {
          content: [{ type: "text" as const, text: "No thoughts found." }],
        };
      }

      const results = data.map((t: ThoughtRow, i: number) => {
        const m = t.metadata || {};
        const tags = asStringArray(m.topics).join(", ");
        const typeLabel = typeof m.type === "string" ? m.type : "??";

        return `${i + 1}. [${new Date(t.created_at).toLocaleDateString()}] (${typeLabel}${tags ? " - " + tags : ""})\n   ${t.content}`;
      });

      return {
        content: [
          {
            type: "text" as const,
            text: `${data.length} recent thought(s):\n\n${results.join("\n\n")}`,
          },
        ],
      };
    } catch (err: unknown) {
      return {
        content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }],
        isError: true,
      };
    }
  }
);

// Tool 3: Thought Statistics
server.registerTool(
  "thought_stats",
  {
    title: "Thought Statistics",
    description: "Get a summary of all captured thoughts: totals, types, top topics, and people.",
    inputSchema: {},
  },
  async () => {
    try {
      const { count, error: countError } = await supabase
        .from("thoughts")
        .select("*", { count: "exact", head: true });

      if (countError) {
        return {
          content: [{ type: "text" as const, text: `Error: ${countError.message}` }],
          isError: true,
        };
      }

      const { data, error } = await supabase
        .from("thoughts")
        .select("metadata, created_at")
        .order("created_at", { ascending: false });

      if (error) {
        return {
          content: [{ type: "text" as const, text: `Error: ${error.message}` }],
          isError: true,
        };
      }

      const rows = data ?? [];
      const types: Record<string, number> = {};
      const topics: Record<string, number> = {};
      const people: Record<string, number> = {};

      for (const row of rows) {
        const m = (row.metadata ?? {}) as Record<string, unknown>;

        const type = typeof m.type === "string" ? m.type : "unknown";
        types[type] = (types[type] || 0) + 1;

        for (const topic of asStringArray(m.topics)) {
          topics[topic] = (topics[topic] || 0) + 1;
        }

        for (const person of asStringArray(m.people)) {
          people[person] = (people[person] || 0) + 1;
        }
      }

      const sortDesc = (obj: Record<string, number>) =>
        Object.entries(obj).sort((a, b) => b[1] - a[1]).slice(0, 10);

      const lines: string[] = [];
      lines.push(`Total thoughts: ${count ?? rows.length}`);

      if (rows.length > 0) {
        const newest = rows[0]?.created_at;
        const oldest = rows[rows.length - 1]?.created_at;

        if (oldest) lines.push(`Earliest: ${new Date(oldest).toLocaleDateString()}`);
        if (newest) lines.push(`Latest: ${new Date(newest).toLocaleDateString()}`);
      }

      const sortedTypes = sortDesc(types);
      if (sortedTypes.length) {
        lines.push("", "By type:");
        for (const [k, v] of sortedTypes) lines.push(`  ${k}: ${v}`);
      }

      const sortedTopics = sortDesc(topics);
      if (sortedTopics.length) {
        lines.push("", "Top topics:");
        for (const [k, v] of sortedTopics) lines.push(`  ${k}: ${v}`);
      }

      const sortedPeople = sortDesc(people);
      if (sortedPeople.length) {
        lines.push("", "People mentioned:");
        for (const [k, v] of sortedPeople) lines.push(`  ${k}: ${v}`);
      }

      return {
        content: [{ type: "text" as const, text: lines.join("\n") }],
      };
    } catch (err: unknown) {
      return {
        content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }],
        isError: true,
      };
    }
  }
);

// Tool 4: Capture Thought
server.registerTool(
  "capture_thought",
  {
    title: "Capture Thought",
    description:
      "Save a new thought to the Open Brain. Generates an embedding and extracts metadata automatically. Use this when the user wants to save something to their brain directly from any AI client — notes, insights, decisions, or migrated content from other systems.",
    inputSchema: {
      content: z
        .string()
        .describe(
          "The thought to capture — a clear, standalone statement that will make sense when retrieved later by any AI"
        ),
    },
  },
  async ({ content }) => {
    try {
      const [embedding, metadata] = await Promise.all([
        getEmbedding(content),
        extractMetadata(content),
      ]);

      const { error } = await supabase.from("thoughts").insert({
        content,
        embedding,
        metadata: { ...metadata, source: "mcp" },
      });

      if (error) {
        return {
          content: [{ type: "text" as const, text: `Failed to capture: ${error.message}` }],
          isError: true,
        };
      }

      const meta = metadata as Record<string, unknown>;
      const topics = asStringArray(meta.topics);
      const people = asStringArray(meta.people);
      const actions = asStringArray(meta.action_items);

      let confirmation = `Captured as ${typeof meta.type === "string" ? meta.type : "thought"}`;
      if (topics.length) confirmation += ` — ${topics.join(", ")}`;
      if (people.length) confirmation += ` | People: ${people.join(", ")}`;
      if (actions.length) confirmation += ` | Actions: ${actions.join("; ")}`;

      return {
        content: [{ type: "text" as const, text: confirmation }],
      };
    } catch (err: unknown) {
      return {
        content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }],
        isError: true,
      };
    }
  }
);

// Hono App + access key auth
const app = new Hono();

app.all("*", async (c) => {
  const provided =
    c.req.header("x-brain-key") || new URL(c.req.url).searchParams.get("key");

  if (!provided || provided !== MCP_ACCESS_KEY) {
    return c.json({ error: "Invalid or missing access key" }, 401);
  }

  const transport = new StreamableHTTPTransport();
  await server.connect(transport);
  return transport.handleRequest(c);
});

Deno.serve(app.fetch);