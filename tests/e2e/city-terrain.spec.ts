import { test, expect } from '@playwright/test';
import sharp from 'sharp';
import { createSolo } from '../../src/features/campaign/domain/newRealm';
import { refreshCityEconomy } from '../../src/features/city/domain/slots';
import { FACTIONS, type Faction } from '../../src/features/factions/domain/factions';
import { PAINTED_CITY } from '../../src/features/city/rendering/paintedLayout';

test('every faction keeps its wall dry, both roads at gates and residents on walkable surfaces', async ({ context }, info) => {
    test.setTimeout(180_000);
    const {data,info: pixels}=await sharp('public/art/city/village-v1/countryside-simple.webp').raw().toBuffer({resolveWithObject:true});
    // Only connected river/pond pixels count; bluish woodland shadows are dry land.
    const water=new Set<number>(),queue=[850*pixels.width+1100];
    const blue=(cell:number)=>{const i=cell*pixels.channels,r=data[i],g=data[i+1],b=data[i+2];return b>r*1.1&&g>r*1.05&&b>g*.84};
    for(let i=0;i<queue.length;i++){
        const cell=queue[i];if(water.has(cell)||!blue(cell))continue;water.add(cell);
        const x=cell%pixels.width,y=Math.floor(cell/pixels.width);
        if(x>0)queue.push(cell-1);if(x<pixels.width-1)queue.push(cell+1);
        if(y>0)queue.push(cell-pixels.width);if(y<pixels.height-1)queue.push(cell+pixels.width);
    }
    expect(water.size).toBeGreaterThan(25_000);
    for(const faction of Object.keys(FACTIONS) as Faction[]) {
        const page=await context.newPage(),world=createSolo(`Terrain ${faction}`);
        world.settlements[0].faction=faction;
        for(const b of world.buildings)b.level=b.building_type==='market'?5:3;
        world.city_slots=Array.from({length:16},(_,slot_index)=>({settlement_id:1,slot_index,building_type:slot_index===0?'barracks' as const:'housing' as const,level:2}));
        world.city_slots.push({settlement_id:1,slot_index:16,building_type:'fishery',level:2});
        refreshCityEconomy(world,1);
        await page.addInitScript(w=>{
            localStorage.setItem('peris-campaign-v6',JSON.stringify(w));
            localStorage.setItem('peris-settings',JSON.stringify({sound:false,music:false,reducedMotion:false}));
            localStorage.setItem(`peris-welcome:${w.players[0].id}:${w.players[0].created_at}`,'yes');
        },world);
        await page.emulateMedia({reducedMotion:'no-preference'});
        await page.goto('/');
        await page.getByRole('button',{name:'Continue campaign',exact:true}).click();
        await page.getByRole('button',{name:'City',exact:true}).click();
        const village=page.locator('.painted-settlement-scene');
        await expect(village).toHaveAttribute('data-faction',faction);
        await expect(village.locator('.city-building-artwork')).toHaveCount(21);
        await expect(village.locator('.painted-city-north-gate')).toHaveCount(1);
        await expect(village.locator('[data-city-road=outside]')).toHaveCount(0);
        await expect(village.locator('[data-fishing-bridge]')).toHaveCount(1);
        const wall=await village.locator('[data-walkable=court]').evaluate(el=>{
            const p=el as SVGPathElement,n=p.getTotalLength();
            return Array.from({length:601},(_,i)=>{const q=p.getPointAtLength(n*i/600);return {x:q.x,y:q.y}});
        });
        // Compare the complete raised wall footprint against the actual unmasked painting.
        const wet=wall.flatMap(q=>[-12,0,12].flatMap(dx=>[-10,0,18].map(dy=>({x:Math.round(q.x+PAINTED_CITY.offsetX+dx),y:Math.round(q.y+PAINTED_CITY.offsetY+dy)})))).filter(q=>water.has(q.y*pixels.width+q.x));
        expect(wet,`${faction}: walls and shadows touch painted water`).toEqual([]);
        const faults=await village.evaluate(async el=>{
            const bad:string[]=[],floor=el.querySelector('[data-walkable=court]') as SVGPathElement;
            for(const image of el.querySelectorAll('[data-building^="slot:"] .city-building-artwork')){
                const r=image.getBoundingClientRect();
                for(const [x,y] of [[r.left,r.top],[r.right,r.top],[r.left,r.bottom],[r.right,r.bottom]]){
                    if(!floor.isPointInFill(new DOMPoint(x,y).matrixTransform(floor.getScreenCTM()!.inverse())))bad.push('building crosses the wall');
                }
            }
            for(const [name,gateY] of [['gate-entrance',625],['north-gate',65]] as const){
                const p=el.querySelector(`[data-city-road=${name}]`) as SVGPathElement,n=p.getTotalLength();let inside=false,entries=0;
                for(let i=0;i<=400;i++){const q=p.getPointAtLength(n*i/400),next=floor.isPointInFill(q);if(next&&!inside){entries++;if(Math.abs(q.x-500)>2||Math.abs(q.y-gateY)>25)bad.push(`${name} misses its gate`)}inside=next}
                if(entries!==1)bad.push(`${name} crosses the boundary ${entries} times`);
            }
            const surfaces=Array.from(el.querySelectorAll('[data-walkable]')) as SVGGeometryElement[];
            const actors=Array.from(el.querySelectorAll('[data-city-activity]')) as SVGGElement[];
            const journeys=el.querySelector('.painted-city-activity')!.getAnimations({subtree:true}).filter(a=>(a as CSSAnimation).animationName==='city-patrol');
            for(const a of journeys)a.pause();
            for(let frame=0;frame<=40;frame++){
                for(const a of journeys)a.currentTime=frame*2000;
                await new Promise<void>(r=>requestAnimationFrame(()=>r()));
                for(const actor of actors){
                    const shadow=actor.querySelector('ellipse') as SVGGraphicsElement,screen=shadow.getScreenCTM()!;
                    const kind=actor.dataset.cityActivity,surface=kind==='patrol'?actor.parentElement!.getAttribute('data-patrol-surface'):undefined;
                    for(const x of [-3,0,3]){
                        const foot=new DOMPoint(x,0).matrixTransform(screen);
                        const safe=surfaces.some(p=>{
                            if(surface&&p.getAttribute('data-walkable')!==surface)return false;
                            const q=foot.matrixTransform(p.getScreenCTM()!.inverse());
                            return p.isPointInFill(q)||p.isPointInStroke(q);
                        });
                        if(!safe)bad.push(`${kind} left walkable ground at frame ${frame}`);
                        if(kind!=='patrol'&&Array.from(el.querySelectorAll('[data-city-boundary] > path')).some(p=>{
                            const wall=p as SVGPathElement,q=foot.matrixTransform(wall.getScreenCTM()!.inverse());
                            return wall.isPointInStroke(q);
                        }))bad.push(`${kind} stands in the wall`);
                    }
                }
            }
            const farmer=el.querySelector('[data-city-activity=harvesting]')!.parentElement as unknown as SVGGraphicsElement;
            const q=new DOMPoint().matrixTransform(farmer.getCTM()!);
            const gate=el.querySelector('.painted-city-north-gate')!.getBoundingClientRect();
            const foot=new DOMPoint().matrixTransform(farmer.getScreenCTM()!);
            if(foot.y>=gate.top)bad.push('farmer is below the wheat fields');
            if(!Number.isFinite(q.x))bad.push('invalid worker transform');
            return [...new Set(bad)];
        });
        expect(faults,`${faction}: terrain safety`).toEqual([]);
        if(['roman','orc','elf'].includes(faction)){
            await village.scrollIntoViewIfNeeded();
            const path=info.outputPath(`${faction}-dry-wall-and-bridge.png`);
            await page.screenshot({path});await info.attach(`${faction}-dry-wall-and-bridge`,{path,contentType:'image/png'});
        }
        expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('peris-campaign-v6')!).city_slots)).toEqual(world.city_slots);
        await page.close();
    }
});
