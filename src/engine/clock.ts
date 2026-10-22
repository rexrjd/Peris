import { projectGameNow, validateGameClock, type GameClockSample } from '../shared/time/gameClock';
type ClockWorld = { server_now: string; game_clock?: GameClockSample };
/** Runtime owns monotonic sampling; the domain receives numeric game time. */
export class EngineClock {
    private sample!: GameClockSample;
    private receivedAt = 0;
    constructor(world: ClockWorld, private readonly monotonicNow: () => number) { this.accept(world); }
    accept(world: ClockWorld) {
        const sample = validateGameClock(world.game_clock ?? {
            version: 1, rate: 1, profile_id: 'normal-v1', real_now: world.server_now, game_now: world.server_now,
        });
        if (Date.parse(world.server_now) !== Date.parse(sample.game_now)) throw new Error('Invalid game clock snapshot');
        this.sample = sample;
        this.receivedAt = this.monotonicNow();
    }
    nowGameMs = () => projectGameNow(this.sample, this.monotonicNow() - this.receivedAt);
}
