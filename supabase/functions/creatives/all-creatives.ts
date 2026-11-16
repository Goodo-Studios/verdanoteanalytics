// Every creative matching the list filters, for the ?all=1 path of the creatives function.
// deno-lint-ignore-file no-explicit-any

/**
 * Read every matching creative, highest spend first. `filtered` returns a fresh filtered
 * select (filters applied, no order or range).
 */
export async function fetchAllCreatives(filtered: () => any): Promise<any[]> {
  const out: any[] = [];
  let off = 0;
  const PAGE = 1000;
  while (true) {
    const { data: pageData, error: pageErr } = await filtered()
      .order("spend", { ascending: false })
      .range(off, off + PAGE - 1);
    if (pageErr) throw pageErr;
    if (!pageData || pageData.length === 0) break;
    out.push(...pageData);
    if (pageData.length < PAGE) break;
    off += PAGE;
  }
  return out;
}
