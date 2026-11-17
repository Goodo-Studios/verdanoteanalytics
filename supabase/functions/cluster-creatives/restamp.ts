// Applies cluster stamps in small steps (audit plan item 7.3 follow-up).
//
// restamp_creative_clusters_step changes at most `step` rows whose stamp differs from
// the wanted set and returns how many still differ. Each call is its own short
// transaction, which keeps it under the API's 8 second statement limit even on the
// largest accounts. This loop calls it until nothing is left to change.

export const RESTAMP_STEP = 300;

export type Stamp = { ad_id: string; cluster_id: string; confidence: string };

type RpcClient = {
  rpc(
    fn: string,
    args: Record<string, unknown>,
  ): PromiseLike<{ data: unknown; error: { message: string } | null }>;
};

export async function restampInSteps(
  db: RpcClient,
  accountId: string,
  stamps: Stamp[],
  step: number = RESTAMP_STEP,
): Promise<{ steps: number }> {
  let previous = Number.POSITIVE_INFINITY;
  let steps = 0;
  while (true) {
    const { data, error } = await db.rpc("restamp_creative_clusters_step", {
      p_account_id: accountId,
      p_stamps: stamps,
      p_limit: step,
    });
    steps++;
    if (error) throw new Error(error.message);
    const left = typeof data === "number" ? data : Number.NaN;
    if (!Number.isInteger(left) || left < 0) {
      throw new Error(`unexpected restamp step result: ${JSON.stringify(data)}`);
    }
    if (left === 0) return { steps };
    // Every step changes up to `step` rows, so the count must fall. If it does not,
    // something else is rewriting the same rows; stop rather than loop forever.
    if (left >= previous) throw new Error(`restamp made no progress (${left} rows still differ)`);
    previous = left;
  }
}
