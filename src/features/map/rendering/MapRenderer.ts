import { RenderContext } from '../../../shared/rendering/RenderContext';
import { type MapSelection } from '../domain/types';
import { armyPosition, armyRouteRemaining } from '../domain/movement';
import { siteFor, regionFor } from '../domain/geography';
import { cellAt, cellCenter, getCell, FIELD_COLORS, WORLD_REGIONS, worldRegionAt } from '../domain/worldGrid';
import { CELL_SIZE, WORLD_MIN_X, WORLD_MIN_Y, WORLD_W, WORLD_H, wrappedWorldDelta } from '../domain/dimensions';
import { drawCell } from './terrain';
import { mapArtReady, drawMapSprite } from './mapArt';
import { drawLandmark } from './landmarks';
import { clock } from '../../../shared/time/clock';
import { findMarchPath, type MarchPath } from '../domain/pathfinding';
import { isWalkable } from '../domain/worldGrid';
import { FACTIONS, factionOf } from '../../factions/domain/factions';

/** Strategic presentation only: orders still use the existing command pipeline. */
export class MapRenderer {
    private chunks = new Map<string, HTMLCanvasElement>();
    private readonly chunkCells = 8;
    private artReady = false;
    private previewKey = '';
    private preview: MarchPath | null = null;
    constructor(private ctx: RenderContext) { }
    private now() { return Date.now() + (this.ctx.state().clockOffset ?? 0); }
    private get scale() { return this.ctx.zoomBase * this.ctx.camera.zoom; }
    private imagePoint(x:number,y:number){return{x:this.ctx.camera.x+wrappedWorldDelta(this.ctx.camera.x,x),y:this.ctx.camera.y+wrappedWorldDelta(this.ctx.camera.y,y)};}
    private routeImages(points:readonly [number,number][]){let previous:{x:number;y:number}|undefined;return points.map(([x,y])=>{const point=previous?{x:previous.x+wrappedWorldDelta(previous.x,x),y:previous.y+wrappedWorldDelta(previous.y,y)}:this.imagePoint(x,y);previous=point;return point;});}
    hit(x: number, y: number): MapSelection {
        if(!Number.isFinite(x)||!Number.isFinite(y))return null;
        const s = this.ctx.state(), now = this.now();
        type EntitySelection = Exclude<NonNullable<MapSelection>, { kind: 'cell' }>;
        const candidates: { selection: EntitySelection; distance: number }[] = [];
        const add = (selection: EntitySelection, px: number, py: number, radius: number) => {
            const distance = Math.hypot(wrappedWorldDelta(x,px),wrappedWorldDelta(y,py));
            if (distance < Math.max(radius, 16 / this.scale)) candidates.push({ selection, distance });
        };
        for (const army of s.world.armies) {
            const pos = armyPosition(army, now);
            add({ kind: 'army', id: army.id }, pos.x, pos.y - 5, 22);
        }
        for (const town of s.world.settlements) add({ kind: 'settlement', id: town.id }, town.x, town.y - 12, 28);
        for (const camp of s.world.camps) add({ kind: 'camp', id: camp.id }, camp.x, camp.y - 12, 28);
        const cell = cellAt(x, y);
        return candidates.sort((a, b) => a.distance - b.distance)[0]?.selection ?? { kind: 'cell', col: cell.col, row: cell.row };
    }
    private chunk(col: number, row: number) {
        const key = `${col},${row}`, existing = this.chunks.get(key);
        if (existing) { this.chunks.delete(key); this.chunks.set(key, existing); return existing; }
        const canvas = document.createElement('canvas'), size = this.chunkCells * CELL_SIZE;
        canvas.width = size; canvas.height = size;
        const c = canvas.getContext('2d')!;
        for (let y = 0; y < this.chunkCells; y++) for (let x = 0; x < this.chunkCells; x++) {
            drawCell(c, getCell(col * this.chunkCells + x, row * this.chunkCells + y), x * CELL_SIZE, y * CELL_SIZE, CELL_SIZE, true);
        }
        this.chunks.set(key, canvas);
        // Bounded LRU: never allocate a canvas for the entire world.
        if (this.chunks.size > 24) {
            const oldest = this.chunks.keys().next().value!;
            const old = this.chunks.get(oldest)!; this.chunks.delete(oldest); old.width = 0; old.height = 0;
        }
        return canvas;
    }
    drawTerrain() {
        if (this.artReady !== mapArtReady()) {
            this.artReady = mapArtReady();
            for (const canvas of this.chunks.values()) { canvas.width = 0; canvas.height = 0; }
            this.chunks.clear();
        }
        const c = this.ctx.c, scale = this.scale, camera = this.ctx.camera;
        const left = camera.x - this.ctx.w / scale / 2, right = camera.x + this.ctx.w / scale / 2;
        const top = camera.y - this.ctx.h / scale / 2, bottom = camera.y + this.ctx.h / scale / 2;
        const overview=camera.zoom<=this.ctx.mapMinZoom*1.05&&camera.x===0&&camera.y===0;
        const drawOverview=()=>{for(const dx of overview?[0]:[-WORLD_W,0,WORLD_W])for(const dy of overview?[0]:[-WORLD_H,0,WORLD_H])if(WORLD_MIN_X+dx<right&&WORLD_MIN_X+WORLD_W+dx>left&&WORLD_MIN_Y+dy<bottom&&WORLD_MIN_Y+WORLD_H+dy>top)c.drawImage(this.ctx.terrain!,WORLD_MIN_X+dx,WORLD_MIN_Y+dy,WORLD_W,WORLD_H);};
        if (CELL_SIZE * scale < 8) {
            c.imageSmoothingEnabled = false;
            drawOverview();
            c.imageSmoothingEnabled = true;
        } else if (CELL_SIZE * scale < 34) {
            drawOverview();
            c.save(); c.globalAlpha = .3;
            for (let row = Math.floor(top / CELL_SIZE); row <= Math.floor(bottom / CELL_SIZE); row++) for (let col = Math.floor(left / CELL_SIZE); col <= Math.floor(right / CELL_SIZE); col++) {
                const cell = getCell(col, row); c.fillStyle = FIELD_COLORS[cell.terrain]; c.fillRect(col * CELL_SIZE, row * CELL_SIZE, CELL_SIZE, CELL_SIZE);
            }
            c.restore();
        } else {
            const size = this.chunkCells * CELL_SIZE;
            for (let row = Math.floor(top / size); row <= Math.floor((bottom - 1) / size); row++) for (let col = Math.floor(left / size); col <= Math.floor((right - 1) / size); col++) c.drawImage(this.chunk(col, row), col * size, row * size);
        }
        if (CELL_SIZE * scale >= 9) {
            c.save(); c.strokeStyle = '#213b2c38'; c.lineWidth = 1 / scale; c.beginPath();
            for (let x = Math.ceil(left / CELL_SIZE) * CELL_SIZE; x <= right; x += CELL_SIZE) { c.moveTo(x, top); c.lineTo(x, bottom); }
            for (let y = Math.ceil(top / CELL_SIZE) * CELL_SIZE; y <= bottom; y += CELL_SIZE) { c.moveTo(left, y); c.lineTo(right, y); }
            c.stroke(); c.restore();
        }
        if (scale < .14) {
            const placed: { x: number; y: number; half: number }[] = [];
            for (const region of WORLD_REGIONS) {
                const point=this.imagePoint(region.label.x,region.label.y);
                const x = (point.x - camera.x) * scale + this.ctx.w / 2;
                const y = (point.y - camera.y) * scale + this.ctx.h / 2;
                const half = region.name.length * 3.4 + 6;
                if (x - half < 8 || x + half > this.ctx.w - 8 || y < 20 || y > this.ctx.h - 26) continue;
                if (placed.some(p => Math.abs(p.y - y) < 23 && Math.abs(p.x - x) < p.half + half + 8)) continue;
                placed.push({ x, y, half });
                this.label(point.x, point.y, region.name.toUpperCase(), '#f2dfb8');
            }
        }
    }
    private visible(x: number, y: number) {
        const margin = 110 / this.scale, camera = this.ctx.camera;
        return Math.abs(x - camera.x) < this.ctx.w / this.scale / 2 + margin && Math.abs(y - camera.y) < this.ctx.h / this.scale / 2 + margin;
    }
    private label(x: number, y: number, text: string, color: string, small = false) {
        const c = this.ctx.c, unit = 1 / this.scale, size = small ? 8 : 10;
        c.save();
        c.font = `${small ? '' : '600 '}${size * unit}px ${small ? 'Arial' : 'Georgia'}`;
        c.textAlign = 'center'; c.textBaseline = 'middle';
        const width = c.measureText(text).width + 12 * unit;
        c.fillStyle = '#18251fe8';
        c.fillRect(x - width / 2, y - 8 * unit, width, 16 * unit);
        c.strokeStyle = '#d4bc7740'; c.lineWidth = unit;
        c.strokeRect(x - width / 2, y - 8 * unit, width, 16 * unit);
        c.fillStyle = color; c.fillText(text, x, y);
        c.restore();
    }
    private ring(x: number, y: number, selected: boolean, hover: boolean, radius = 34) {
        if (!selected && !hover) return;
        const c = this.ctx.c;
        c.save();
        c.strokeStyle = selected ? '#ffe7a5' : '#f5e2b294';
        c.fillStyle = selected ? '#ffe5a517' : '#ffe5a50b';
        c.lineWidth = (selected ? 2 : 1) / this.scale;
        c.beginPath(); c.ellipse(x, y, radius, radius * .52, 0, 0, Math.PI * 2); c.fill(); c.stroke();
        c.restore();
    }
    draw(t: number) {
        const c = this.ctx.c, s = this.ctx.state(), now = this.now(), unit = 1 / this.scale;
        const wp = this.ctx.worldPoint(this.ctx.pointer.x, this.ctx.pointer.y);
        const hovered = s.moveMode || this.ctx.down ? null : this.hit(wp.x, wp.y);
        const selected = (kind: 'camp' | 'settlement' | 'army', id: number) => s.selection?.kind !== 'cell' && s.selection?.kind === kind && s.selection.id === id;
        const hover = (kind: 'camp' | 'settlement' | 'army', id: number) => hovered?.kind !== 'cell' && hovered?.kind === kind && hovered.id === id;
        this.ctx.canvas.style.cursor = s.moveMode ? 'crosshair' : this.ctx.down ? 'grabbing' : hovered ? 'pointer' : 'grab';
        for (const cell of [s.selection?.kind === 'cell' ? s.selection : null, hovered?.kind === 'cell' && !s.moveMode && this.scale > .06 ? hovered : null]) {
            if (!cell) continue;
            const point=this.imagePoint((cell.col+.5)*CELL_SIZE,(cell.row+.5)*CELL_SIZE);
            c.save(); c.strokeStyle = cell === s.selection ? '#ffe8a5' : '#fff2caa0'; c.fillStyle = '#fff0b325'; c.lineWidth = (cell === s.selection ? 2 : 1) * unit;
            c.fillRect(point.x-CELL_SIZE/2,point.y-CELL_SIZE/2,CELL_SIZE,CELL_SIZE);c.strokeRect(point.x-CELL_SIZE/2,point.y-CELL_SIZE/2,CELL_SIZE,CELL_SIZE); c.restore();
        }
        for(const plot of s.world.map_plots??[]){if(!plot.building_type||plot.level<1)continue;const point=this.imagePoint((plot.col+.5)*CELL_SIZE,(plot.row+.5)*CELL_SIZE);if(!this.visible(point.x,point.y))continue;
            const color=plot.building_type==='farm'?'#cab573':plot.building_type==='lumber'?'#759061':plot.building_type==='quarry'?'#a5afa6':'#bc9472';
            if(this.scale<.15){this.dot(point.x,point.y,color,2);continue;}
            const faction=factionOf(s.world.settlements.find(town=>town.id===plot.settlement_id)?.faction??plot.faction);
            c.save();c.translate(point.x,point.y);c.fillStyle='#253128';c.fillRect(-25,-16,50,35);c.fillStyle=color;c.fillRect(-23,-15,46,28);c.strokeStyle=`#${FACTIONS[faction].roofLight.toString(16).padStart(6,'0')}`;c.lineWidth=unit;c.strokeRect(-23,-15,46,28);c.restore();
        }
        for (const rawTown of s.world.settlements) {
            const town={...rawTown,...this.imagePoint(rawTown.x,rawTown.y)};
            if (!this.visible(town.x, town.y)) continue;
            const mine = town.owner_id === s.playerId, active = selected('settlement', town.id);
            if (this.scale < .15) { this.dot(town.x, town.y, mine ? '#ffe3a1' : '#a3c7da', 3); continue; }
            this.ring(town.x, town.y + 5, active, hover('settlement', town.id), 43);
            if (!drawMapSprite(c, 8, town.x - 46, town.y - 65, 92)) drawLandmark(c, town.x, town.y, 'home', mine ? '#cba85c' : '#7398ae');
            if (active || this.scale > .3) this.label(town.x, town.y + 32 * unit, town.name, mine ? '#f4dfab' : '#d3e2ea');
            if (active || this.ctx.camera.zoom > 1.5) this.label(town.x, town.y + 49 * unit, mine ? 'YOUR SETTLEMENT' : 'RIVAL SETTLEMENT', '#bfbfa1', true);
        }
        for (const rawCamp of s.world.camps) {
            const camp={...rawCamp,...this.imagePoint(rawCamp.x,rawCamp.y)};
            if (!this.visible(camp.x, camp.y)) continue;
            const site = siteFor(camp.id), region = regionFor(camp.id);
            const cleared = s.world.progress.some(p => p.owner_id === s.playerId && p.camp_id === camp.id && p.defeated > 0), active = selected('camp', camp.id);
            if (this.scale < .15) { this.dot(camp.x, camp.y, '#ce9465', 2); continue; }
            this.ring(camp.x, camp.y + 7, active, hover('camp', camp.id), camp.id === 6 ? 47 : 35);
            const sprite = camp.id === 6 ? 10 : camp.id === 2 ? 11 : camp.id === 5 ? 12 : camp.id === 4 ? 9 : 8;
            if (!drawMapSprite(c, sprite, camp.x - 44, camp.y - 67, 88)) drawLandmark(c, camp.x, camp.y, site.kind, cleared ? '#94b77c' : region.color);
            if (active || this.scale > .3) this.label(camp.x, camp.y + 29 * unit, site.title, active ? '#ffe5a6' : cleared ? '#c9dfb5' : '#eddfbd');
            if (active || this.ctx.camera.zoom > 1.5) this.label(camp.x, camp.y + 46 * unit, `TIER ${camp.tier}${cleared ? ' · STANDARD RECOVERED' : ' · HOSTILE HOLD'}`, '#c4c6ad', true);
        }
        for (const army of s.world.armies) {
            const actual=armyPosition(army,now),pos=this.imagePoint(actual.x,actual.y), mine = army.owner_id === s.playerId, active = selected('army', army.id);
            const moving = army.status === 'moving' && Date.parse(army.arrival_at) > now;
            // Full routes stay useful for our legion or the inspected army;
            // drawing hundreds of rival waypoint lists every frame obscures the atlas.
            if (moving && (mine || active)) {
                c.save(); c.strokeStyle = mine ? '#f7d88fbd' : '#9bbac575'; c.lineWidth = 1.5 * unit;
                c.setLineDash([5 * unit, 5 * unit]); c.lineDashOffset = -t / 100 * unit;
                c.beginPath(); const route = this.routeImages(armyRouteRemaining(army, now)); route.forEach(({x,y}, i) => i ? c.lineTo(x, y) : c.moveTo(x, y)); c.stroke(); c.setLineDash([]);
                const destination=this.imagePoint(army.target_x,army.target_y);c.beginPath(); c.arc(destination.x,destination.y, 9 * unit, 0, Math.PI * 2); c.stroke();
                c.restore();
            }
            if (!this.visible(pos.x, pos.y)) continue;
            if (this.scale < .15) { this.dot(pos.x, pos.y, mine ? '#ffe3a1' : '#97b5ce', 2); continue; }
            this.ring(pos.x, pos.y + 2, active, hover('army', army.id), 26);
            c.save(); c.translate(pos.x, pos.y - 5);
            // Markers stay legible in the full-realm mobile overview.
            const size = Math.max(.85, unit * .8); c.scale(size, size);
            c.fillStyle = '#17251de0'; c.strokeStyle = active ? '#ffe6a1' : '#e4d4b0'; c.lineWidth = 1.3 / size * unit;
            c.beginPath(); c.moveTo(0, -16); c.lineTo(12, 0); c.lineTo(0, 14); c.lineTo(-12, 0); c.closePath(); c.fill(); c.stroke();
            c.fillStyle = mine ? '#d7ac63' : '#81a7be'; c.beginPath(); c.moveTo(0, -10); c.lineTo(7, 0); c.lineTo(0, 8); c.lineTo(-7, 0); c.closePath(); c.fill();
            c.restore();
            this.label(pos.x, pos.y + 18 * unit, `${army.infantry + army.archers + army.cavalry}`, mine ? '#f1d6ac' : '#c9deea', true);
            if (active || (mine && moving)) this.label(pos.x, pos.y - 27 * unit, moving ? `ARRIVES IN ${clock((Date.parse(army.arrival_at) - now) / 1000)}` : army.name, '#f4dfb0', true);
        }
        if (s.moveMode) {
            const army = s.world.armies.find(a => a.owner_id === s.playerId);
            const cell = cellAt(wp.x, wp.y), destination = this.imagePoint((cell.col+.5)*CELL_SIZE,(cell.row+.5)*CELL_SIZE);
            c.save(); c.lineWidth = 1.5 * unit;
            if (army) {
                const pos = armyPosition(army, now);
                const key = `${cell.col}:${cell.row}:${army.departure_at}:${army.target_x}:${army.target_y}:${army.status === 'moving' ? Math.floor(now / 1000) : 'idle'}`;
                if (key !== this.previewKey) { this.previewKey = key; this.preview = isWalkable(cell.col, cell.row) ? findMarchPath(pos,cellCenter(cell.col,cell.row)) : null; }
                c.strokeStyle = this.preview ? '#ffe6a1' : '#e39b79';
                if (this.preview) {
                    c.setLineDash([6 * unit, 5 * unit]); c.beginPath(); this.routeImages(this.preview.path).forEach(({x,y}, i) => i ? c.lineTo(x, y) : c.moveTo(x, y)); c.stroke(); c.setLineDash([]);
                }
                this.label(destination.x, destination.y - 28 * unit, this.preview ? `MARCH · ${clock(Math.max(2, this.preview.distance / 22))}` : cell.terrain === 'water' ? 'SEA · SHIPS REQUIRED' : 'NO CONNECTED LAND ROUTE', this.preview ? '#ffe8ab' : '#f4bda4', true);
            }
            c.beginPath(); c.arc(destination.x, destination.y, 10 * unit, 0, Math.PI * 2);
            c.moveTo(destination.x - 17 * unit, destination.y); c.lineTo(destination.x + 17 * unit, destination.y);
            c.moveTo(destination.x, destination.y - 17 * unit); c.lineTo(destination.x, destination.y + 17 * unit); c.stroke();
            c.restore();
        }
    }
    private dot(x: number, y: number, color: string, radius: number) {
        const c = this.ctx.c; c.fillStyle = color; c.beginPath(); c.arc(x, y, radius / this.scale, 0, Math.PI * 2); c.fill();
    }
    drawHUD() {
        const c = this.ctx.c, cell = cellAt(this.ctx.camera.x, this.ctx.camera.y), region = worldRegionAt(cell.col, cell.row);
        c.save(); c.font = '10px Arial'; c.textAlign = 'left'; c.textBaseline = 'middle';
        const label = `${region.name.toUpperCase()} · (${cell.col} | ${cell.row})`, width = c.measureText(label).width + 20;
        c.fillStyle = '#183228e8'; c.fillRect(14, 14, width, 27); c.strokeStyle = '#c8b37c66'; c.strokeRect(14, 14, width, 27);
        c.fillStyle = '#ead9b1'; c.fillText(label, 24, 28); c.restore();
    }
    dispose(){for(const canvas of this.chunks.values()){canvas.width=0;canvas.height=0;}this.chunks.clear();this.preview=null;}
}
