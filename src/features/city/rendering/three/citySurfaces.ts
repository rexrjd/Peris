import * as THREE from 'three';
import { FACTIONS, type Faction } from '../../../factions/domain/factions';
import { cityGrowth } from '../../domain/slots';
import { cityFootprint, riverX, type CityPlot } from './layout';
import { cityStreetClearance } from './cityStreets';
import { cityRandom, type CityEnvironment } from '../../domain/environment';
import { cityBiome } from '../cityBiome';

const legacyNoise = (n: number) => { const v = Math.sin(n * 127.1 + 43.7) * 43758.5453; return v - Math.floor(v); };

/** Flat, material-batched town surfaces. Reserved plots never become decorative gardens. */
export function createCitySurfaces(plots: CityPlot[], faction: Faction, environment?:CityEnvironment) {
    const group = new THREE.Group(); group.name = 'Town stonework and ground variation';
    const main = plots.find(p => p.type === 'market')?.level ?? 0, g = cityGrowth(main), f = cityFootprint(main,environment), palette = FACTIONS[faction],biome=cityBiome(faction,environment);
    const noise=environment?(n:number)=>cityRandom(environment,4000+n):legacyNoise;
    const points: number[] = [], colors: number[] = [], paving: number[] = [], stoneColors: number[] = [];
    const stone = new THREE.Color(palette.light).lerp(new THREE.Color(palette.stone), .35);
    const grass = new THREE.Color(biome.ground).lerp(new THREE.Color(palette.road), environment?.terrain==='snow'?.04:.12);
    let stones = 0, patches = 0;
    const tile = (x: number, z: number, w: number, d: number, tone: THREE.Color, y = .032) => {
        if(plots.some(p=>p.slot!==undefined&&p.slot<16&&!p.level&&x<p.x+1.6&&x+w>p.x-1.6&&z<p.z+1.6&&z+d>p.z-1.6))return;
        paving.push(x,y,z, x,y,z+d, x+w,y,z+d, x,y,z, x+w,y,z+d, x+w,y,z);
        for (let i = 0; i < 6; i++) stoneColors.push(tone.r,tone.g,tone.b);
        stones++;
    };
    const paved = (x: number, z: number, w: number, d: number, tileW = .36, tileD = .26) => {
        for (let row = 0, dz = 0; dz < d; row++, dz += tileD) {
            if(Math.min(tileD,d-dz)<=.024)continue;
            for (let dx = row % 2 ? -tileW / 2 : 0; dx < w; dx += tileW) {
                const left = Math.max(0,dx), right = Math.min(w,dx+tileW);
                if (right-left < .05) continue;
                tile(x-w/2+left+.012,z-d/2+dz+.012,right-left-.024,Math.min(tileD,d-dz)-.024,stone.clone().multiplyScalar(.94+noise(stones)*.10));
            }
        }
    };
    const built = plots.filter(p => p.level > 0 && p.type !== 'wall');
    if (main > 0) {
        // One continuous avenue ties the gate to the civic square.
        const start = -4.2*g, end = f.front*g;
        paved(0,(start+end)/2,(main>=2?1.04:.75)*g,end-start,.33,.3);
    }
    for (const p of built) {
        if (p.type === 'market') {
            paved(p.x,p.z,4.24,3.59,.42,.32);
            paved(p.x,p.z+2.5,4.24,1.74,.42,.32);
            // A restrained geometric inlay gives the square a recognisable centre.
            for(const side of [-1,1]) tile(p.x+side*1.52-.035,p.z+1.68,.07,1.64,stone.clone().multiplyScalar(.74),.035);
        } else if (p.slot !== undefined && p.slot < 16) {
            // A worn stone approach connects the actual doorway to its cross-street.
            const end = p.z+1.75*g;
            paved(p.x,(p.z+.92+end)/2,.72,end-(p.z+.92),.35,.26);
            if (['housing','academy','mage_tower'].includes(p.type ?? '')) paved(p.x,p.z+1.17,2.25,.64,.36,.3);
            if (p.type === 'warehouse' || p.type === 'granary') paved(p.x,p.z+.95,2.65,.95,.42,.32);
        }
    }
    // Broad, irregular grass tones soften the lawn, staying clear of lots, roads and water.
    if (built.length) for (let i = 0; i < 140; i++) {
        const x = (f.left+.65+noise(i*13)*((!environment||environment.water==='river'?riverX(0,environment)-1.5:f.right-.65)-f.left-.65))*g;
        const z = (f.back+.65+noise(i*29+9)*(f.front-f.back-1.3))*g;
        const r = (.5+noise(i*17)*.55)*g;
        if (cityStreetClearance(x/g,z/g,main,environment)*g < r+.15) continue;
        if (plots.some(p=>p.type!=='wall'&&Math.abs(x-p.x)<(p.type==='market'?2.4:1.8)+r&&Math.abs(z-p.z)<(p.type==='market'?3.5:1.8)+r)) continue;
        if ((!environment||environment.water==='river')&&x+r>(riverX(z/g,environment)-1.1)*g) continue;
        const tone = grass.clone().lerp(new THREE.Color(i%3 ? biome.hill : palette.road), i%3 ? .13 : .17);
        for(let j=0;j<7;j++) {
            const a=j*Math.PI*2/7,b=(j+1)*Math.PI*2/7,ra=r*(.75+noise(i*7+j)*.25),rb=r*(.75+noise(i*7+(j+1)%7)*.25);
            points.push(x,-.032,z,x+Math.cos(b)*rb,-.032,z+Math.sin(b)*rb*.65,x+Math.cos(a)*ra,-.032,z+Math.sin(a)*ra*.65);
            // Fade into the existing lawn rather than leaving hard polygon edges.
            colors.push(tone.r,tone.g,tone.b,grass.r,grass.g,grass.b,grass.r,grass.g,grass.b);
        }
        patches++;
    }
    for (const [vertices, tones, name] of [[paving,stoneColors,'Town flagstone'],[points,colors,'Meadow patches']] as const) {
        if (!vertices.length) continue;
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));geometry.setAttribute('color',new THREE.Float32BufferAttribute(tones,3));geometry.computeVertexNormals();
        const mesh = new THREE.Mesh(geometry,new THREE.MeshStandardMaterial({vertexColors:true,roughness:1,flatShading:true}));mesh.receiveShadow=true;mesh.name=name;group.add(mesh);
    }
    group.userData.citySurfaces = {stones,patches}; return group;
}
