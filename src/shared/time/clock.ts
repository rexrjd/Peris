export function clock(seconds: number, rate: 1 | 10 | 100 = 1) { const s = Math.max(0, Math.ceil(seconds / rate)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; }
