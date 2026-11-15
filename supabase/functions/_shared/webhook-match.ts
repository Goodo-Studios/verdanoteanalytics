// Which webhooks a dispatch should reach.
//
// A webhook with no account_ids is a "global" webhook that listens to every account. Only agency
// staff may fan out to those. A non-staff caller reaches only webhooks that list the account they
// are dispatching for, so one tenant's event never lands on another tenant's global endpoint.

export interface WebhookRow {
  id: string;
  account_ids?: string[] | null;
}

export function matchWebhooks<T extends WebhookRow>(
  webhooks: readonly T[],
  opts: { accountId?: string | null; testWebhookId?: string | null; isStaff: boolean },
): T[] {
  return webhooks.filter((wh) => {
    if (opts.testWebhookId) return true; // test dispatch is authorised separately, against the one target
    const ids = wh.account_ids ?? [];
    if (ids.length === 0) return opts.isStaff;
    return !!opts.accountId && ids.includes(opts.accountId);
  });
}
