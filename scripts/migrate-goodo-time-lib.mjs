// Pure parts of scripts/migrate-goodo-time.mjs (OS-011): argument and target checks, mapping
// Goodo Time rows to the app's time_ tables, and the per-person per-month totals check.
// Nothing here touches a database, so src/lib/goodoTimeMigration.test.ts covers it.

export const STAGING_REF = 'mnvcksbhbvypuiwozvct';
export const DEFAULT_ZONE = 'America/New_York';

/** Read the command line. Unknown flags are refused so a typo cannot slip through. */
export function parseArgs(argv) {
  const opts = { dryRun: false, allowProduction: false, help: false };
  for (const arg of argv) {
    if (arg === '--dry-run') opts.dryRun = true;
    else if (arg === '--allow-production') opts.allowProduction = true;
    else if (arg === '--help' || arg === '-h') opts.help = true;
    else throw new Error(`Unknown option "${arg}". Use --dry-run, --allow-production or --help.`);
  }
  return opts;
}

/** Refuse any target that is not the staging project unless --allow-production was passed. */
export function assertTarget(url, { allowProduction = false } = {}) {
  if (!url || typeof url !== 'string') throw new Error('Set TARGET_SUPABASE_URL.');
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error('TARGET_SUPABASE_URL is not a valid URL.');
  }
  if (parsed.protocol !== 'https:') throw new Error('TARGET_SUPABASE_URL must use https.');
  if (!parsed.hostname.split('.').includes(STAGING_REF) && !allowProduction) {
    throw new Error(
      `Refusing to write to ${parsed.hostname}: it is not the staging project (${STAGING_REF}). ` +
        'Pass --allow-production only when you mean to copy into production.',
    );
  }
  return parsed.hostname;
}

export function normaliseEmail(email) {
  return String(email ?? '').trim().toLowerCase();
}

function iso(value) {
  if (value == null) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error(`"${value}" is not a valid time.`);
  return date.toISOString();
}

function isoDate(value) {
  if (value == null) return null;
  if (value instanceof Date) {
    // pg returns DATE columns as local-midnight Date objects; read the local calendar day.
    const y = value.getFullYear();
    const m = String(value.getMonth() + 1).padStart(2, '0');
    const d = String(value.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  return String(value).slice(0, 10);
}

function need(map, sourceId, what) {
  if (sourceId == null) return null;
  const id = map.get(Number(sourceId));
  if (!id) throw new Error(`No ${what} was copied for Goodo Time id ${sourceId}.`);
  return id;
}

// ---------------------------------------------------------------- mapping
// Each map* function takes a Goodo Time row and returns a row for the target table. Ids that
// point at other tables are looked up in maps of Goodo Time id -> target uuid. Sign-in fields,
// addresses (invoice_from, from_details) and payment details are deliberately not copied.

export function mapPerson(user) {
  const email = normaliseEmail(user.email);
  if (!email.includes('@')) throw new Error(`Goodo Time user ${user.id} has no usable email.`);
  return {
    source_id: Number(user.id),
    email,
    name: String(user.name ?? '').trim() || email,
    source_role: user.role === 'admin' ? 'admin' : 'member',
    active: user.active !== false,
    monthly_fee_cents: user.monthly_fee_cents == null ? null : Number(user.monthly_fee_cents),
  };
}

export function mapClient(client) {
  return {
    source_id: Number(client.id),
    name: client.name,
    archived: Boolean(client.archived),
    created_at: iso(client.created_at),
  };
}

export function mapProject(project, clientIds) {
  return {
    source_id: Number(project.id),
    client_id: need(clientIds, project.client_id, 'client'),
    name: project.name,
    archived: Boolean(project.archived),
    created_at: iso(project.created_at),
  };
}

export function mapInvoice(invoice, personIds) {
  return {
    source_id: Number(invoice.id),
    person_id: need(personIds, invoice.user_id, 'person'),
    number: Number(invoice.number),
    status: invoice.status,
    period_from: isoDate(invoice.period_from),
    period_to: isoDate(invoice.period_to),
    issued_on: isoDate(invoice.issued_on),
    due_on: isoDate(invoice.due_on),
    bill_to: invoice.bill_to ?? '',
    notes: invoice.notes ?? '',
    submitted_at: iso(invoice.submitted_at),
    paid_at: iso(invoice.paid_at),
    created_at: iso(invoice.created_at),
    updated_at: iso(invoice.updated_at),
  };
}

export function mapInvoiceLine(line, invoiceIds) {
  return {
    source_id: Number(line.id),
    invoice_id: need(invoiceIds, line.invoice_id, 'invoice'),
    kind: line.kind,
    description: line.description,
    seconds: line.seconds == null ? null : Number(line.seconds),
    amount_cents: Number(line.amount_cents),
    position: Number(line.position ?? 0),
  };
}

export function mapEntry(entry, { personIds, projectIds, invoiceIds }) {
  return {
    source_id: Number(entry.id),
    person_id: need(personIds, entry.user_id, 'person'),
    project_id: need(projectIds, entry.project_id, 'project'),
    description: entry.description ?? '',
    start_at: iso(entry.start_at),
    end_at: iso(entry.end_at),
    invoice_id: need(invoiceIds, entry.invoice_id, 'invoice'),
    created_at: iso(entry.created_at),
    updated_at: iso(entry.updated_at),
  };
}

// ---------------------------------------------------------------- totals

const monthFormatters = new Map();

/** "YYYY-MM" of a UTC instant in the studio time zone. */
export function monthKey(instant, zone = DEFAULT_ZONE) {
  let fmt = monthFormatters.get(zone);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit' });
    monthFormatters.set(zone, fmt);
  }
  const parts = Object.fromEntries(fmt.formatToParts(new Date(instant)).map((p) => [p.type, p.value]));
  return `${parts.year}-${parts.month}`;
}

/**
 * Tracked milliseconds per person (email) per month (the month the entry started in, studio
 * time zone), counting completed entries only, as Goodo Time's reports do. Rows need
 * { email, start_at, end_at }. Returns a Map of "email|YYYY-MM" -> { ms, entries }.
 */
export function totalsByPersonMonth(rows, zone = DEFAULT_ZONE) {
  const totals = new Map();
  for (const row of rows) {
    if (row.end_at == null) continue;
    const key = `${normaliseEmail(row.email)}|${monthKey(row.start_at, zone)}`;
    const total = totals.get(key) ?? { ms: 0, entries: 0 };
    total.ms += Date.parse(iso(row.end_at)) - Date.parse(iso(row.start_at));
    total.entries += 1;
    totals.set(key, total);
  }
  return totals;
}

/** Every person-month whose total differs between source and target, sorted. Empty means they match. */
export function compareTotals(source, target) {
  const keys = [...new Set([...source.keys(), ...target.keys()])].sort();
  const differences = [];
  for (const key of keys) {
    const a = source.get(key) ?? { ms: 0, entries: 0 };
    const b = target.get(key) ?? { ms: 0, entries: 0 };
    if (a.ms !== b.ms || a.entries !== b.entries) differences.push({ key, source: a, target: b });
  }
  return differences;
}

/** Plain-text table of totals, one line per person-month, hours to two decimals. */
export function formatTotals(source, target) {
  const keys = [...new Set([...source.keys(), ...(target?.keys() ?? [])])].sort();
  const lines = [];
  for (const key of keys) {
    const [email, month] = key.split('|');
    const a = source.get(key) ?? { ms: 0, entries: 0 };
    let line = `${month}  ${email.padEnd(36)}  source ${(a.ms / 3_600_000).toFixed(2).padStart(8)} h (${a.entries})`;
    if (target) {
      const b = target.get(key) ?? { ms: 0, entries: 0 };
      const same = a.ms === b.ms && a.entries === b.entries;
      line += `  target ${(b.ms / 3_600_000).toFixed(2).padStart(8)} h (${b.entries})  ${same ? 'ok' : 'DIFFERENT'}`;
    }
    lines.push(line);
  }
  return lines.join('\n');
}

/** Compare row counts per table. Returns the tables whose counts differ. */
export function compareCounts(source, target) {
  return Object.keys(source)
    .filter((table) => source[table] !== target[table])
    .map((table) => ({ table, source: source[table], target: target[table] ?? 0 }));
}
