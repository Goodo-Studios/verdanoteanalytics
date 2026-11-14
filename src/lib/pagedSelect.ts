// PostgREST caps one response at 1000 rows and drops the rest without an error, so a select over a
// table that can grow past that must be read in pages. Callers build the query with a stable
// order that ends in a unique column (usually "id") so the pages never overlap or skip a row, and
// apply `.range(from, to)` to it inside `fetchRange`.
export const PAGE_SIZE = 1000;

/** Read every row by walking pages until one comes back short. `fetchRange` should throw on a database error. */
export async function fetchAllPages<T>(fetchRange: (from: number, to: number) => PromiseLike<T[]>, pageSize: number = PAGE_SIZE): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += pageSize) {
    const page = await fetchRange(from, from + pageSize - 1);
    out.push(...page);
    if (page.length < pageSize) return out;
  }
}
