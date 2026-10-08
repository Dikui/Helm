// Contract Hub core: schema, state machine and rules.
// Every write goes through here. `actor` is either "human" or "agent:<role>".
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export type Actor = 'human' | `agent:${string}`;
export type Status =
  | 'draft' | 'ready' | 'running' | 'blocked'
  | 'verifying' | 'in_review' | 'changes_requested' | 'accepted';
export type TestKind = 'deterministic' | 'evidence' | 'adversarial' | 'judgment';

export interface Boundary { id: string; text: string; source: 'human' | 'agent_draft'; confirmed: boolean }
export interface Test { id: string; text: string; kind: TestKind }
export interface Contract {
  id: string; parent_id: string | null; title: string; need: string;
  boundaries: Boundary[]; tests: Test[]; status: Status; version: number;
  lease_holder: string | null; lease_until: string | null;
  created_by: Actor; created_at: string; updated_at: string;
}
export interface ChangePatch {
  need?: string;
  add_boundaries?: string[];
  remove_boundary_ids?: string[];
  add_tests?: { text: string; kind: TestKind }[];
  remove_test_ids?: string[];
}

export class RuleError extends Error {}
const fail = (msg: string): never => { throw new RuleError(msg); };
const now = () => new Date().toISOString();
const shortId = (p: string) => `${p}_${randomUUID().slice(0, 8)}`;
const isHuman = (a: Actor) => a === 'human';
const roleOf = (a: Actor) => (isHuman(a) ? 'human' : a.slice('agent:'.length));
const LEASE_MS = 30 * 60 * 1000;

export class Hub {
  db: DatabaseSync;

  constructor(path = 'data/helm.db') {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS contracts (
        id TEXT PRIMARY KEY, parent_id TEXT, title TEXT NOT NULL, need TEXT NOT NULL,
        boundaries TEXT NOT NULL, tests TEXT NOT NULL, status TEXT NOT NULL,
        version INTEGER NOT NULL, lease_holder TEXT, lease_until TEXT,
        created_by TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS changes (
        id TEXT PRIMARY KEY, contract_id TEXT NOT NULL, proposed_by TEXT NOT NULL,
        patch TEXT NOT NULL, reason TEXT NOT NULL, status TEXT NOT NULL,
        note TEXT, created_at TEXT NOT NULL, decided_at TEXT);
      CREATE TABLE IF NOT EXISTS evidence (
        id TEXT PRIMARY KEY, contract_id TEXT NOT NULL, test_id TEXT NOT NULL,
        claim TEXT NOT NULL, source_ref TEXT NOT NULL, submitted_by TEXT NOT NULL,
        created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS checks (
        id TEXT PRIMARY KEY, contract_id TEXT NOT NULL, test_id TEXT NOT NULL,
        checker TEXT NOT NULL, verdict TEXT NOT NULL, note TEXT NOT NULL,
        created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS events (
        seq INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT NOT NULL, actor TEXT NOT NULL,
        action TEXT NOT NULL, contract_id TEXT, payload TEXT NOT NULL);
    `);
  }

  // ---------- reads ----------

  get(id: string): Contract {
    const r = this.db.prepare('SELECT * FROM contracts WHERE id = ?').get(id) as any;
    if (!r) fail(`contract ${id} not found`);
    return { ...r, boundaries: JSON.parse(r.boundaries), tests: JSON.parse(r.tests) };
  }

  list(): Contract[] {
    return (this.db.prepare('SELECT id FROM contracts ORDER BY created_at').all() as any[])
      .map((r) => this.get(r.id));
  }

  children(id: string): Contract[] {
    return this.list().filter((c) => c.parent_id === id);
  }

  detail(id: string) {
    const c = this.get(id);
    const q = (sql: string) => this.db.prepare(sql).all(id) as any[];
    return {
      ...c,
      children: this.children(id).map(({ id, title, status }) => ({ id, title, status })),
      evidence: q('SELECT * FROM evidence WHERE contract_id = ? ORDER BY created_at'),
      checks: q('SELECT * FROM checks WHERE contract_id = ? ORDER BY created_at'),
      changes: q('SELECT * FROM changes WHERE contract_id = ? ORDER BY created_at')
        .map((x) => ({ ...x, patch: JSON.parse(x.patch) })),
      test_status: this.testStatus(c),
    };
  }

  events(contractId?: string, limit = 200) {
    const rows = contractId
      ? this.db.prepare('SELECT * FROM events WHERE contract_id = ? ORDER BY seq DESC LIMIT ?').all(contractId, limit)
      : this.db.prepare('SELECT * FROM events ORDER BY seq DESC LIMIT ?').all(limit);
    return (rows as any[]).map((e) => ({ ...e, payload: JSON.parse(e.payload) }));
  }

  /** Latest check verdict per test. */
  testStatus(c: Contract): Record<string, 'pass' | 'fail' | 'unchecked'> {
    const out: Record<string, 'pass' | 'fail' | 'unchecked'> = {};
    for (const t of c.tests) {
      const last = this.db.prepare(
        'SELECT verdict FROM checks WHERE contract_id = ? AND test_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1',
      ).get(c.id, t.id) as any;
      out[t.id] = last ? last.verdict : 'unchecked';
    }
    return out;
  }

  /** What needs attention. Humans: decisions. Agents: work to pick up. */
  inbox(actor: Actor) {
    const all = this.list();
    if (isHuman(actor)) {
      const pending = this.db.prepare("SELECT * FROM changes WHERE status = 'pending' ORDER BY created_at").all() as any[];
      return {
        drafts_to_approve: all.filter((c) => c.status === 'draft').map(brief),
        blocked: all.filter((c) => c.status === 'blocked').map(brief),
        to_review: all.filter((c) => c.status === 'in_review').map(brief),
        change_requests: pending.map((x) => ({ ...x, patch: JSON.parse(x.patch) })),
      };
    }
    return {
      ready: all.filter((c) => c.status === 'ready' || c.status === 'changes_requested').map(brief),
      running: all.filter((c) => c.status === 'running').map(brief),
      verifying: all.filter((c) => c.status === 'verifying').map(brief),
    };
  }

  // ---------- writes ----------

  private log(actor: Actor, action: string, contractId: string | null, payload: object = {}) {
    this.db.prepare('INSERT INTO events (ts, actor, action, contract_id, payload) VALUES (?, ?, ?, ?, ?)')
      .run(now(), actor, action, contractId, JSON.stringify(payload));
  }

  private save(c: Contract) {
    c.updated_at = now();
    this.db.prepare(`UPDATE contracts SET title=?, need=?, boundaries=?, tests=?, status=?, version=?,
      lease_holder=?, lease_until=?, updated_at=? WHERE id=?`)
      .run(c.title, c.need, JSON.stringify(c.boundaries), JSON.stringify(c.tests), c.status,
        c.version, c.lease_holder, c.lease_until, c.updated_at, c.id);
  }

  private setStatus(actor: Actor, c: Contract, to: Status, payload: object = {}) {
    const from = c.status;
    c.status = to;
    if (to !== 'running' && to !== 'blocked') { c.lease_holder = null; c.lease_until = null; }
    this.save(c);
    this.log(actor, 'status', c.id, { from, to, ...payload });
  }

  private expect(c: Contract, ...allowed: Status[]) {
    if (!allowed.includes(c.status)) fail(`contract ${c.id} is ${c.status}, expected ${allowed.join(' | ')}`);
  }

  private requireHuman(actor: Actor, what: string) {
    if (!isHuman(actor)) fail(`only a human can ${what}`);
  }

  private requireAgent(actor: Actor, what: string) {
    if (isHuman(actor)) fail(`${what} is done by an agent`);
  }

  private tx<T>(fn: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try { const r = fn(); this.db.exec('COMMIT'); return r; }
    catch (e) { this.db.exec('ROLLBACK'); throw e; }
  }

  createContract(actor: Actor, input: {
    title: string; need: string; parent_id?: string | null;
    boundaries?: string[]; tests?: { text: string; kind: TestKind }[];
  }): Contract {
    return this.tx(() => {
      if (input.parent_id) this.get(input.parent_id);
      const ts = now();
      const c: Contract = {
        id: shortId('c'), parent_id: input.parent_id ?? null, title: input.title, need: input.need,
        boundaries: (input.boundaries ?? []).map((text) => newBoundary(text, actor)),
        tests: (input.tests ?? []).map(newTest),
        status: 'draft', version: 1, lease_holder: null, lease_until: null,
        created_by: actor, created_at: ts, updated_at: ts,
      };
      this.db.prepare(`INSERT INTO contracts VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`)
        .run(c.id, c.parent_id, c.title, c.need, JSON.stringify(c.boundaries), JSON.stringify(c.tests),
          c.status, c.version, null, null, c.created_by, c.created_at, c.updated_at);
      this.log(actor, 'create', c.id, { title: c.title, parent_id: c.parent_id });
      return c;
    });
  }

  /** Edit a contract directly. Agents may only edit drafts; humans may edit anything not yet accepted. */
  editContract(actor: Actor, id: string, patch: ChangePatch & { title?: string; confirm_boundary_ids?: string[] }) {
    return this.tx(() => {
      const c = this.get(id);
      if (isHuman(actor)) this.expect(c, 'draft', 'ready', 'running', 'blocked', 'changes_requested', 'in_review', 'verifying');
      else this.expect(c, 'draft');
      if (patch.title) c.title = patch.title;
      applyPatch(c, patch, actor);
      if (isHuman(actor)) for (const b of c.boundaries) if (patch.confirm_boundary_ids?.includes(b.id)) b.confirmed = true;
      if (c.status !== 'draft') c.version++;
      this.save(c);
      this.log(actor, 'edit', id, patch);
      return c;
    });
  }

  /** Human approves the contract: all boundaries become confirmed, work may start. */
  approve(actor: Actor, id: string) {
    this.requireHuman(actor, 'approve a contract');
    return this.tx(() => {
      const c = this.get(id);
      this.expect(c, 'draft');
      if (!c.tests.length) fail('a contract needs at least one test before approval');
      for (const b of c.boundaries) b.confirmed = true;
      this.setStatus(actor, c, 'ready');
      return c;
    });
  }

  claim(actor: Actor, id: string) {
    this.requireAgent(actor, 'claiming');
    return this.tx(() => {
      const c = this.get(id);
      const leaseValid = c.lease_until && c.lease_until > now();
      if (c.status === 'running' && leaseValid && c.lease_holder !== actor) fail(`leased by ${c.lease_holder}`);
      this.expect(c, 'ready', 'changes_requested', 'running');
      if (this.children(id).some((k) => k.status === 'draft'))
        fail('child contracts still in draft; ask the human to approve them first');
      c.lease_holder = actor;
      c.lease_until = new Date(Date.now() + LEASE_MS).toISOString();
      if (c.status === 'running') { this.save(c); this.log(actor, 'renew_lease', id); }
      else this.setStatus(actor, c, 'running');
      return c;
    });
  }

  progress(actor: Actor, id: string, note: string) {
    this.get(id);
    this.log(actor, 'progress', id, { note });
  }

  block(actor: Actor, id: string, question: string) {
    this.requireAgent(actor, 'blocking');
    return this.tx(() => {
      const c = this.get(id);
      this.expect(c, 'running');
      this.setStatus(actor, c, 'blocked', { question });
      return c;
    });
  }

  answer(actor: Actor, id: string, answer: string) {
    this.requireHuman(actor, 'answer a blocked contract');
    return this.tx(() => {
      const c = this.get(id);
      this.expect(c, 'blocked');
      this.setStatus(actor, c, 'running', { answer });
      return c;
    });
  }

  submitEvidence(actor: Actor, id: string, input: { test_id: string; claim: string; source_ref: string }) {
    this.requireAgent(actor, 'submitting evidence');
    return this.tx(() => {
      const c = this.get(id);
      this.expect(c, 'running');
      if (!c.tests.some((t) => t.id === input.test_id)) fail(`unknown test ${input.test_id}`);
      const e = { id: shortId('e'), contract_id: id, ...input, submitted_by: actor, created_at: now() };
      this.db.prepare('INSERT INTO evidence VALUES (?,?,?,?,?,?,?)')
        .run(e.id, id, e.test_id, e.claim, e.source_ref, actor, e.created_at);
      this.log(actor, 'evidence', id, { test_id: e.test_id, claim: e.claim });
      return e;
    });
  }

  proposeChange(actor: Actor, id: string, patch: ChangePatch, reason: string) {
    this.requireAgent(actor, 'proposing a change (humans edit directly)');
    return this.tx(() => {
      const c = this.get(id);
      if (c.status === 'accepted') fail('contract already accepted');
      const ch = { id: shortId('chg'), contract_id: id, proposed_by: actor, patch, reason, status: 'pending', created_at: now() };
      this.db.prepare('INSERT INTO changes (id, contract_id, proposed_by, patch, reason, status, created_at) VALUES (?,?,?,?,?,?,?)')
        .run(ch.id, id, actor, JSON.stringify(patch), reason, 'pending', ch.created_at);
      this.log(actor, 'propose_change', id, { change_id: ch.id, reason });
      return ch;
    });
  }

  decideChange(actor: Actor, changeId: string, approve: boolean, note = '') {
    this.requireHuman(actor, 'decide a change request');
    return this.tx(() => {
      const ch = this.db.prepare('SELECT * FROM changes WHERE id = ?').get(changeId) as any;
      if (!ch) fail(`change ${changeId} not found`);
      if (ch.status !== 'pending') fail(`change ${changeId} already ${ch.status}`);
      const status = approve ? 'approved' : 'rejected';
      this.db.prepare('UPDATE changes SET status = ?, note = ?, decided_at = ? WHERE id = ?').run(status, note, now(), changeId);
      if (approve) {
        const c = this.get(ch.contract_id);
        applyPatch(c, JSON.parse(ch.patch), 'human'); // human approval confirms the new boundaries
        c.version++;
        this.save(c);
      }
      this.log(actor, `change_${status}`, ch.contract_id, { change_id: changeId, note });
      return { ...ch, status };
    });
  }

  submitForVerification(actor: Actor, id: string) {
    this.requireAgent(actor, 'submitting for verification');
    return this.tx(() => {
      const c = this.get(id);
      this.expect(c, 'running');
      const pending = this.db.prepare("SELECT COUNT(*) n FROM changes WHERE contract_id = ? AND status = 'pending'").get(id) as any;
      if (pending.n) fail('there are pending change requests; wait for the human to decide');
      const open = this.children(id).filter((k) => k.status !== 'accepted');
      if (open.length) fail(`child contracts not accepted: ${open.map((k) => k.id).join(', ')}`);
      for (const t of c.tests) {
        if (t.kind !== 'deterministic' && t.kind !== 'evidence') continue;
        const n = this.db.prepare('SELECT COUNT(*) n FROM evidence WHERE contract_id = ? AND test_id = ?').get(id, t.id) as any;
        if (!n.n) fail(`test ${t.id} (${t.kind}) has no evidence`);
      }
      this.setStatus(actor, c, 'verifying');
      this.maybeAdvance(actor, c);
      return this.get(id);
    });
  }

  /**
   * Record a verdict on a test. Who may check what:
   *   deterministic / evidence → verifier (or human)
   *   adversarial              → redteam
   *   judgment                 → human only (normally via signoff)
   * A checker may never check a test it submitted evidence for.
   * A failing check sends the contract back to running.
   */
  recordCheck(actor: Actor, id: string, input: { test_id: string; verdict: 'pass' | 'fail'; note: string }) {
    return this.tx(() => {
      const c = this.get(id);
      this.expect(c, 'verifying');
      const t = c.tests.find((x) => x.id === input.test_id) ?? fail(`unknown test ${input.test_id}`);
      const role = roleOf(actor);
      const allowed: Record<TestKind, string[]> = {
        deterministic: ['verifier', 'human'], evidence: ['verifier', 'human'],
        adversarial: ['redteam'], judgment: ['human'],
      };
      if (!allowed[t.kind].includes(role)) fail(`${t.kind} tests are checked by ${allowed[t.kind].join(' or ')}, not ${role}`);
      const own = this.db.prepare('SELECT COUNT(*) n FROM evidence WHERE contract_id = ? AND test_id = ? AND submitted_by = ?')
        .get(id, t.id, actor) as any;
      if (own.n) fail(`${actor} submitted evidence for ${t.id} and cannot check it`);
      const k = { id: shortId('k'), contract_id: id, ...input, checker: actor, created_at: now() };
      this.db.prepare('INSERT INTO checks VALUES (?,?,?,?,?,?,?)')
        .run(k.id, id, k.test_id, actor, k.verdict, k.note, k.created_at);
      this.log(actor, 'check', id, { test_id: k.test_id, verdict: k.verdict, note: k.note });
      if (k.verdict === 'fail') this.setStatus(actor, c, 'running', { reason: `${t.id} failed: ${k.note}` });
      else this.maybeAdvance(actor, c);
      return k;
    });
  }

  /** verifying → in_review once every non-judgment test's latest check passes. */
  private maybeAdvance(actor: Actor, c: Contract) {
    const st = this.testStatus(c);
    const ok = c.tests.filter((t) => t.kind !== 'judgment').every((t) => st[t.id] === 'pass');
    if (ok) this.setStatus(actor, this.get(c.id), 'in_review');
  }

  /** Human sign-off. Accepting records a pass on every judgment test. */
  signoff(actor: Actor, id: string, accept: boolean, note = '') {
    this.requireHuman(actor, 'sign off');
    return this.tx(() => {
      const c = this.get(id);
      this.expect(c, 'in_review');
      for (const t of c.tests.filter((x) => x.kind === 'judgment')) {
        this.db.prepare('INSERT INTO checks VALUES (?,?,?,?,?,?,?)')
          .run(shortId('k'), id, t.id, 'human', accept ? 'pass' : 'fail', note, now());
      }
      this.setStatus(actor, c, accept ? 'accepted' : 'changes_requested', { note });
      return c;
    });
  }
}

function newBoundary(text: string, actor: Actor): Boundary {
  return { id: shortId('b'), text, source: isHuman(actor) ? 'human' : 'agent_draft', confirmed: isHuman(actor) };
}
function newTest(t: { text: string; kind: TestKind }): Test {
  return { id: shortId('t'), text: t.text, kind: t.kind };
}
function applyPatch(c: Contract, p: ChangePatch, actor: Actor) {
  if (p.need !== undefined) c.need = p.need;
  if (p.remove_boundary_ids) c.boundaries = c.boundaries.filter((b) => !p.remove_boundary_ids!.includes(b.id));
  if (p.add_boundaries) c.boundaries.push(...p.add_boundaries.map((t) => newBoundary(t, actor)));
  if (p.remove_test_ids) c.tests = c.tests.filter((t) => !p.remove_test_ids!.includes(t.id));
  if (p.add_tests) c.tests.push(...p.add_tests.map(newTest));
}
function brief(c: Contract) {
  return { id: c.id, parent_id: c.parent_id, title: c.title, status: c.status, updated_at: c.updated_at };
}
