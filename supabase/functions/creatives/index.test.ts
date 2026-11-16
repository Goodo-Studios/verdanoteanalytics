// The creatives list passes the requested sort to creatives_list_page (audit plan item 7.1, part 1).
//
// The page asked for ?sort=roas&sort_dir=desc but the function never forwarded it, so the
// database always ordered by spend and only the first 100 rows by spend could be re-sorted.
import { assert } from "https://deno.land/std@0.224.0/assert/mod.ts";

Deno.test("the paged list forwards sort and sort_dir to creatives_list_page", async () => {
  const src = await Deno.readTextFile(new URL("./index.ts", import.meta.url));
  const call = src.slice(src.indexOf('rpc("creatives_list_page"'));
  const args = call.slice(0, call.indexOf("});"));
  assert(/p_sort:\s*[^,\n]*searchParams\.get\("sort"\)|p_sort:\s*sort\b/.test(args), "p_sort is not forwarded");
  assert(/p_sort_dir:\s*[^,\n]*searchParams\.get\("sort_dir"\)|p_sort_dir:\s*sortDir\b/.test(args), "p_sort_dir is not forwarded");
});

// Audit 7.1 part 3: the advanced filter conditions (?adv=<json>) reach the RPC as p_conditions.
Deno.test("the paged list forwards the advanced filter conditions to creatives_list_page", async () => {
  const src = await Deno.readTextFile(new URL("./index.ts", import.meta.url));
  const call = src.slice(src.indexOf('rpc("creatives_list_page"'));
  const args = call.slice(0, call.indexOf("});"));
  assert(/p_conditions:/.test(args), "p_conditions is not forwarded");
  assert(/searchParams\.get\("adv"\)/.test(src), "the adv query parameter is not read");
});
