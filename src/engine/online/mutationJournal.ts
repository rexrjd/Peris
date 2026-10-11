export type MutationIntent = { requestId: string; fn: string; args: Record<string, unknown> };
export type MutationStorage = { read: () => unknown; write: (intent: MutationIntent | null) => void };
type RpcError = { code?: string; message: string };
type Transport = (intent: MutationIntent) => Promise<{ error: RpcError | null }>;
const validIntent = (value: unknown): value is MutationIntent => {
    if (!value || typeof value !== 'object') return false;
    const intent = value as MutationIntent;
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(intent.requestId) &&
        typeof intent.fn === 'string' && !!intent.args && typeof intent.args === 'object' && !Array.isArray(intent.args);
};
// A retry can be rejected before receipt lookup even if the first call committed.
// Keep the original ID through expired sessions, permissions and schema outages.
const definiteError = (error: RpcError) =>
    !['PGRST202', 'PGRST203', 'PGRST301', 'PGRST302', 'PGRST303', '28000', '28P01', '42501'].includes(error.code ?? '') &&
    !/authentication required|jwt|not authenticated/i.test(error.message) &&
    (/^[0-9A-Z]{5}$/.test(error.code ?? '') || error.code === 'PGRST116');

/** A lost response cannot turn an accepted mutation into a new command. */
export class MutationJournal {
    pending: MutationIntent | null;
    private running = false;
    constructor(private storage: MutationStorage, private transport: Transport, private newId: () => string, private changed: () => void) {
        const saved = storage.read(); this.pending = validIntent(saved) ? saved : null;
    }
    async send(fn: string, args: Record<string, unknown>) {
        if (this.pending) throw new Error('Confirm the pending order before sending another command.');
        if (this.running) throw new Error('An order is already being sent.');
        const intent = { requestId: this.newId(), fn, args: structuredClone(args) };
        // Persist before dispatch. If storage fails, nothing has been sent.
        this.storage.write(intent); this.pending = intent; this.changed();
        await this.execute();
    }
    async retry() {
        if (!this.pending) return;
        if (this.running) throw new Error('The pending order is already being confirmed.');
        await this.execute();
    }
    private clear() {
        this.pending = null;
        // A failed cleanup must not report an acknowledged command as failed.
        // A stale saved request remains safe because its server receipt survives.
        try { this.storage.write(null); } catch { /* Retry after reload uses the same receipt. */ }
        this.changed();
    }
    private async execute() {
        this.running = true;
        try {
            let response: { error: RpcError | null };
            try { response = await this.transport(this.pending!); }
            catch { throw new Error('Order status is unconfirmed. Retry the same order to confirm it safely.'); }
            if (response.error) {
                if (response.error.code === 'PGRST202') throw new Error('Install supabase/UPGRADE_TO_V17.sql, then retry this same order to enable the combined game update.');
                if (definiteError(response.error)) {
                    this.clear();
                    throw new Error(response.error.message);
                }
                throw new Error('Order status is unconfirmed. Retry the same order to confirm it safely.');
            }
            this.clear();
        } finally { this.running = false; }
    }
}
