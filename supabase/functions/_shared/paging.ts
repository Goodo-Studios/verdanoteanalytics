// One way to read every row of a PostgREST query from an edge function (audit plan item 7.3).
//
// PostgREST caps a response (1,000 rows by default, max_rows if lower) and drops the rest
// without an error. Loops that stop on the first page shorter than the page size end early
// whenever the server cap is below the page size, so this helper only stops on an EMPTY page
// and moves on by the number of rows it actually received. The caller's query MUST order by
// a unique key (for example "ad_id" or "id"), otherwise pages can skip or repeat rows.

export const PAGE_SIZE = 1000;

export type PageResult<T> = { data: T[] | null; error: { message?: string } | null };

/**
 * Read every row through `range(from, to)` pages. Throws on the first page error, so a
 * partial read is never mistaken for a full one, and after `maxPages` pages, so a query
 * whose order is not stable cannot loop forever.
 */
export async function fetchAllRows<T>(
  fetchPage: (from: number, to: number) => PromiseLike<PageResult<T>>,
  pageSize = PAGE_SIZE,
  maxPages = 10_000,
): Promise<T[]> {
  const all: T[] = [];
  let from = 0;
  for (let page = 0; page < maxPages; page++) {
    const { data, error } = await fetchPage(from, from + pageSize - 1);
    if (error) throw new Error(error.message ?? "page read failed");
    if (!data || data.length === 0) return all;
    all.push(...data);
    from += data.length;
  }
  throw new Error(`fetchAllRows stopped after ${maxPages} pages`);
}
