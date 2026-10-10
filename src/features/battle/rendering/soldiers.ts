import { RenderContext } from '../../../shared/rendering/RenderContext';
import { type Formation } from '../domain/types';
import { ellipse } from '../../../shared/rendering/primitives';
import { unitSprite } from '../../../shared/rendering/assets';
import { preferences } from '../../../platform/preferences/preferences';
export function drawSoldier(ctx: RenderContext, x: number, y: number, f: Formation, index: number, time: number, dead = false) {
    const c=ctx.c,own=f.owner_id===ctx.state().playerId,moving=f.status==='moving'||f.status==='routed';
    const elapsed=ctx.state().battle?.elapsed??0,interval=f.unit_type==='cavalry'?1.4:1.2;
    const sinceStrike=elapsed-((f.attack_ready_at??-10)-interval),strike=sinceStrike>=0&&sinceStrike<.35?Math.sin(sinceStrike/.35*Math.PI):0;
    const jitter=moving&&!preferences().reducedMotion?Math.sin(time/140+index*1.7)*.6:0,melee=f.status==='engaged'&&f.unit_type!=='archers'?strike:0;
    c.save();
    c.translate(x, y + jitter);
    if (dead)
        c.rotate(index * 2.3);
    c.fillStyle = '#26302360';
    c.beginPath();
    c.ellipse(1.5, 2.5, f.unit_type === 'cavalry' ? 7 : 3.2, 2, 0, 0, Math.PI * 2);
    c.fill();
    const sprite = unitSprite(f.unit_type, own);
    if (sprite && !dead) {
        if (moving && !preferences().reducedMotion)
            c.rotate(Math.sin(time / 120 + index) * .065);
        const width = f.unit_type === 'cavalry' ? 15 : f.unit_type === 'archers' ? 9 : 11, height = width * sprite.height / sprite.width;
        c.drawImage(sprite, -width / 2, -height / 2, width, height);
        if (f.status === 'engaged' && f.unit_type === 'infantry' && strike>.35) {
            c.strokeStyle = '#efe3b9bb';
            c.lineWidth = .7;
            c.beginPath();
            c.moveTo(3, -2);
            c.lineTo(10, 3);
            c.stroke();
        }
        c.restore();
        return;
    }
    if (f.unit_type === 'cavalry') {
        c.fillStyle = own ? '#705039' : '#595343';
        c.beginPath();
        c.ellipse(-1, 0, 5.8, 2.8, 0, 0, Math.PI * 2);
        c.fill();
        c.fillRect(3, -1.4, 3, 2.4);
        c.strokeStyle = '#393f30';
        c.lineWidth = 1;
        for (const side of [-1, 1]) {
            c.beginPath();
            c.moveTo(-3, side * 2);
            c.lineTo(-4 + (moving ? Math.sin(time / 75 + index) * 2 : 0), side * 4);
            c.moveTo(2, side * 2);
            c.lineTo(2 + (moving ? Math.cos(time / 75 + index) * 2 : 0), side * 4);
            c.stroke();
        }
    }
    c.fillStyle = dead ? '#644039' : own ? (f.unit_type === 'archers' ? '#697249' : '#bd5540') : (f.unit_type === 'archers' ? '#556448' : '#567587');
    c.fillRect(-2, -2, 5, 4);
    if (f.unit_type === 'infantry') {
        c.fillStyle = '#bfc0aa';
        c.fillRect(-1, -1, 3, 2);
        c.strokeStyle = '#596250';
        c.lineWidth = .45;
        c.beginPath();
        c.moveTo(0, -1);
        c.lineTo(0, 1);
        c.stroke();
    }
    c.fillStyle = '#d3c396';
    c.beginPath();
    c.arc(1, 0, 1.75, 0, Math.PI * 2);
    c.fill();
    c.fillStyle = '#8a917a';
    c.fillRect(1, -1.5, 1.4, 3);
    if (f.unit_type === 'infantry') {
        c.fillStyle = own ? '#b7533c' : '#668ba2';
        c.fillRect(2.5, -3, 2.5, 4.5);
        c.strokeStyle = '#e4cd94';
        c.lineWidth = .6;
        c.strokeRect(2.5, -3, 2.5, 4.5);
        c.strokeStyle = '#eee6c8';
        c.lineWidth = .9;
        c.beginPath();
        c.moveTo(3, 3);
        c.lineTo(9 + melee * 2, 2.5 + melee * 2);
        c.stroke();
    }
    else if (f.unit_type === 'archers') {
        c.strokeStyle = '#c3aa73';
        c.lineWidth = .8;
        c.beginPath();
        c.arc(4, 0, 2.6, -Math.PI * .55, Math.PI * .55);
        c.stroke();
    }
    else {
        c.strokeStyle = '#cbbb8c';
        c.lineWidth = .8;
        c.beginPath();
        c.moveTo(0, 3);
        c.lineTo(11, 3);
        c.stroke();
    }
    c.restore();
}
