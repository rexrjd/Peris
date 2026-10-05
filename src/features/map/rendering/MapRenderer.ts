import { RenderContext } from '../../../shared/rendering/RenderContext';
import { type MapSelection } from '../domain/types';
import { dist } from '../../../shared/math/geometry';
import { armyPosition } from '../domain/movement';
import { ellipse } from '../../../shared/rendering/primitives';
import { house } from '../../../shared/rendering/environment';
import { environmentSprite } from '../../../shared/rendering/assets';
export class MapRenderer {
    constructor(private ctx: RenderContext) { }
    hit(x: number, y: number): MapSelection {
        const s = this.ctx.state();
        for (const a of s.world.armies) {
            if (dist(armyPosition(a), { x, y }) < 22)
                return { kind: 'army', id: a.id };
        }
        for (const town of s.world.settlements) {
            if (dist({ x: town.x, y: town.y - 12 }, { x, y }) < 32)
                return { kind: 'settlement', id: town.id };
        }
        for (const camp of s.world.camps) {
            if (dist(camp, { x, y }) < 30)
                return { kind: 'camp', id: camp.id };
        }
        return null;
    }
    draw(t: number) {
        const c = this.ctx.c, s = this.ctx.state(), pulse = .65 + Math.sin(t / 550) * .2;
        for (const town of s.world.settlements) {
            const mine = town.owner_id === s.playerId, selected = s.selection?.kind === 'settlement' && s.selection.id === town.id;
            c.strokeStyle = selected ? '#f1d995' : mine ? '#ecc58a99' : '#6d8ead99';
            c.lineWidth = selected ? 2.5 : 1;
            c.beginPath();
            c.ellipse(town.x, town.y, 43, 21, 0, 0, Math.PI * 2);
            c.stroke();
            house(c, town.x - 19, town.y + 2, .65);
            house(c, town.x + 23, town.y + 8, .7);
            house(c, town.x, town.y, 1, 'keep', mine ? '#ad473b' : '#5c7692');
            this.ctx.label(town.x, town.y + 30, town.name, mine ? '#f0dba6' : '#d3ddec');
        }
        for (const camp of s.world.camps) {
            const cleared = s.world.progress.some(p => p.camp_id === camp.id && p.defeated > 0), selected = s.selection?.kind === 'camp' && s.selection.id === camp.id;
            const campSprite = environmentSprite('camp');
            c.fillStyle = '#20291d48';
            c.beginPath();
            c.ellipse(camp.x + 4, camp.y + 8, 24, 10, 0, 0, Math.PI * 2);
            c.fill();
            if (campSprite) {
                c.save();
                c.globalAlpha = cleared ? .8 : 1;
                c.drawImage(campSprite, camp.x - 27, camp.y - 43, 54, 54 * campSprite.height / campSprite.width);
                c.restore();
            }
            else {
                c.fillStyle = cleared ? '#5c775d' : '#6e4036';
                c.beginPath();
                c.moveTo(camp.x - 20, camp.y + 5);
                c.lineTo(camp.x - 3, camp.y - 18);
                c.lineTo(camp.x + 15, camp.y + 5);
                c.closePath();
                c.fill();
                c.fillStyle = cleared ? '#91a17b' : '#ab7955';
                c.beginPath();
                c.moveTo(camp.x - 20, camp.y + 5);
                c.lineTo(camp.x - 3, camp.y - 18);
                c.lineTo(camp.x - 3, camp.y + 5);
                c.fill();
            }
            c.strokeStyle = '#584e35';
            c.lineWidth = 1;
            c.beginPath();
            c.moveTo(camp.x + 13, camp.y + 5);
            c.lineTo(camp.x + 13, camp.y - 28);
            c.stroke();
            c.fillStyle = cleared ? '#8aaa74' : '#a9503b';
            c.fillRect(camp.x + 13, camp.y - 28, 12, 9);
            if (selected) {
                c.strokeStyle = '#f6dc9b';
                c.lineWidth = 2;
                c.beginPath();
                c.arc(camp.x, camp.y, 30, 0, Math.PI * 2);
                c.stroke();
            }
            this.ctx.label(camp.x, camp.y + 23, camp.name, cleared ? '#b9d2a1' : '#efd1b4');
            this.ctx.label(camp.x, camp.y + 40, `TIER ${camp.tier}${cleared ? ' · CONQUERED' : ''}`, '#bab99e', true);
        }
        for (const army of s.world.armies) {
            const pos = armyPosition(army), mine = army.owner_id === s.playerId, color = mine ? '#cf6c53' : '#6c9fbc';
            if (army.status === 'moving' && Date.parse(army.arrival_at) > Date.now()) {
                c.strokeStyle = mine ? '#f0d49ab0' : '#8eb9ca66';
                c.lineWidth = 2;
                c.setLineDash([5, 7]);
                c.lineDashOffset = -t / 80;
                c.beginPath();
                c.moveTo(pos.x, pos.y);
                c.lineTo(army.target_x, army.target_y);
                c.stroke();
                c.setLineDash([]);
                c.lineWidth = 1;
                c.beginPath();
                c.arc(army.target_x, army.target_y, 10 + pulse * 4, 0, Math.PI * 2);
                c.stroke();
            }
            c.fillStyle = '#242b2290';
            c.beginPath();
            c.ellipse(pos.x + 2, pos.y + 3, 16, 8, 0, 0, Math.PI * 2);
            c.fill();
            c.fillStyle = color;
            c.beginPath();
            c.moveTo(pos.x, pos.y - 17);
            c.lineTo(pos.x + 11, pos.y - 4);
            c.lineTo(pos.x, pos.y + 9);
            c.lineTo(pos.x - 11, pos.y - 4);
            c.closePath();
            c.fill();
            c.strokeStyle = '#efdbac';
            c.lineWidth = 1;
            c.stroke();
            c.strokeStyle = '#f0e0bf';
            c.lineWidth = 1.5;
            c.beginPath();
            c.moveTo(pos.x - 4, pos.y - 9);
            c.lineTo(pos.x + 4, pos.y + 1);
            c.moveTo(pos.x + 4, pos.y - 9);
            c.lineTo(pos.x - 4, pos.y + 1);
            c.stroke();
            this.ctx.label(pos.x, pos.y + 19, `${army.infantry + army.archers + army.cavalry}`, mine ? '#f1d6ac' : '#c9deea', true);
        }
        if (s.moveMode) {
            const wp = this.ctx.worldPoint(this.ctx.pointer.x, this.ctx.pointer.y);
            c.strokeStyle = '#f8e3af';
            c.lineWidth = 2;
            c.beginPath();
            c.arc(wp.x, wp.y, 12, 0, Math.PI * 2);
            c.moveTo(wp.x - 20, wp.y);
            c.lineTo(wp.x + 20, wp.y);
            c.moveTo(wp.x, wp.y - 20);
            c.lineTo(wp.x, wp.y + 20);
            c.stroke();
        }
    }
}
