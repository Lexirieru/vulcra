// Minimal GraphQL client for the Goldsky subgraph(s). No extra deps — a typed
// fetch wrapper. Used only for at-risk vault discovery (Liquidations); every other
// value in the app still comes from direct chain reads.
export async function gqlFetch<T>(url: string, query: string, variables?: Record<string, unknown>): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) throw new Error(`subgraph HTTP ${res.status}`);
  const json = (await res.json()) as { data?: T; errors?: { message: string }[] };
  if (json.errors?.length) throw new Error(json.errors.map((e) => e.message).join("; "));
  if (!json.data) throw new Error("subgraph returned no data");
  return json.data;
}
