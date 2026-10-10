import { BufferGeometry, CanvasTexture, Color, Float32BufferAttribute, Group, InstancedMesh, Mesh, MeshStandardMaterial, Object3D, PlaneGeometry, CylinderGeometry, ConeGeometry, RepeatWrapping, DodecahedronGeometry, BoxGeometry } from 'three';
import { type Terrain } from '../../domain/types';
import { GROUND_COLORS, terrainAt } from '../../domain/terrain';
import { FIELD_W, FIELD_H, FIELD_SCALE } from '../../domain/dimensions';
import { seeded } from '../../../../shared/math/random';

/** A visual hill inside the existing high-ground footprint. Never used by combat. */
export function battlefieldHeight(terrain: Terrain, x: number, y: number) {
    if (terrain !== 'highlands') return 0;
    const radius = ((x/FIELD_SCALE - 650) / 240) ** 2 + ((y/FIELD_SCALE - 285) / 180) ** 2;
    return 28 * Math.max(0, 1 - radius) ** 2;
}

export function createBattlefield(terrain: Terrain) {
    const group = new Group(), geometry = new PlaneGeometry(FIELD_W, FIELD_H, 120, 70);
    geometry.rotateX(-Math.PI / 2); geometry.translate(FIELD_W / 2, 0, FIELD_H / 2);
    const positions = geometry.getAttribute('position'), colors: number[] = [], rng = seeded(813);
    for (let i = 0; i < positions.count; i++) {
        const x = positions.getX(i), y = positions.getZ(i), kind = terrainAt(terrain, x, y).kind;
        positions.setY(i, battlefieldHeight(terrain, x, y));
        const color = new Color(kind === 'Shallows' ? '#527f8b' : kind === 'Forest' ? '#354f35' : kind === 'High ground' ? '#93928e' : kind === 'Marsh' ? '#537674' : GROUND_COLORS[terrain]);
        color.multiplyScalar(.92 + rng() * .15); colors.push(color.r, color.g, color.b);
    }
    geometry.setAttribute('color', new Float32BufferAttribute(colors, 3)); geometry.computeVertexNormals();
    // Fine procedural grain makes close views readable while terrain rules stay unchanged.
    let grain: CanvasTexture | undefined;
    if (typeof document !== 'undefined') {
        const canvas = document.createElement('canvas'); canvas.width = canvas.height = 256;
        const ctx = canvas.getContext('2d');
        if (ctx) {
            const data = ctx.createImageData(256,256);
            for (let i=0;i<data.data.length;i+=4) { const n=150+rng()*80; data.data[i]=n; data.data[i+1]=n; data.data[i+2]=n*.85; data.data[i+3]=255; }
            ctx.putImageData(data,0,0); grain=new CanvasTexture(canvas); grain.wrapS=grain.wrapT=RepeatWrapping; grain.repeat.set(90,55); grain.anisotropy=4;
        }
    }
    const ground = new Mesh(geometry, new MeshStandardMaterial({ vertexColors: true, map:grain, roughness: .95, bumpMap:grain,bumpScale:.24 }));
    ground.receiveShadow = true; group.add(ground);
    if (typeof document !== 'undefined' && !['desert','snow','darkland','highlands','coast'].includes(terrain)) {
        const blades = new BufferGeometry();
        blades.setAttribute('position',new Float32BufferAttribute([-.16,0,0,.16,0,0,.08,.85,.09, -.11,0,.12,.09,0,.12,-.18,.65,.14, 0,0,-.12,0,0,.12,.13,1,.02],3)); blades.computeVertexNormals();
        const grass = new InstancedMesh(blades,new MeshStandardMaterial({color:'#71884e',roughness:1,side:2}),9000);
        const dummy=new Object3D(); let count=0;
        for (let i=0;i<9000;i++) {
            const x=rng()*FIELD_W,y=rng()*FIELD_H;
            if (terrainAt(terrain,x,y).kind==='Shallows') continue;
            dummy.position.set(x,battlefieldHeight(terrain,x,y),y); dummy.rotation.y=rng()*Math.PI;
            dummy.scale.setScalar(.6+rng()); dummy.updateMatrix(); grass.setMatrixAt(count++,dummy.matrix);
        }
        grass.count=count; grass.receiveShadow=true; group.add(grass);
    }
    if (terrain === 'woods') {
        const bark = new InstancedMesh(new CylinderGeometry(1.7, 2.3, 17, 5), new MeshStandardMaterial({ color: '#514332' }), 450);
        const leaves = new InstancedMesh(new ConeGeometry(11, 29, 5), new MeshStandardMaterial({ color: '#345137', roughness: 1 }), 450);
        const dummy = new Object3D();
        for (let i = 0; i < 450; i++) {
            let x: number, y: number;
            do { x = rng() * FIELD_W; y = rng() * FIELD_H; } while (terrainAt(terrain, x, y).kind !== 'Forest');
            dummy.position.set(x, 8.5, y); dummy.updateMatrix(); bark.setMatrixAt(i, dummy.matrix);
            dummy.position.y = 28; dummy.updateMatrix(); leaves.setMatrixAt(i, dummy.matrix);
        }
        bark.castShadow = leaves.castShadow = true; group.add(bark, leaves);
    }
    if (['highlands','darkland','desert','snow','coast'].includes(terrain)) {
        const rocks = new InstancedMesh(new DodecahedronGeometry(4,0), new MeshStandardMaterial({color:terrain==='darkland'?'#38323f':terrain==='desert'?'#9d876a':terrain==='snow'?'#9aaab5':'#777778',roughness:1}),220);
        const dummy=new Object3D();
        for(let i=0;i<220;i++){const x=rng()*FIELD_W,y=rng()*FIELD_H;dummy.position.set(x,battlefieldHeight(terrain,x,y)+1,y);dummy.scale.set(1+rng()*2,.5+rng(),1+rng());dummy.rotation.set(rng(),rng()*6,rng());dummy.updateMatrix();rocks.setMatrixAt(i,dummy.matrix);}
        rocks.castShadow=true;rocks.receiveShadow=true;group.add(rocks);
    }
    if(terrain==='river'){
        const bridge=new Mesh(new BoxGeometry(175*FIELD_SCALE,1.8,89*FIELD_SCALE),new MeshStandardMaterial({color:'#b5aa92',roughness:1}));
        bridge.position.set(602.5*FIELD_SCALE,.9,350*FIELD_SCALE);bridge.receiveShadow=true;group.add(bridge);
    }
    if(terrain==='farmland'){
        const furrows=new InstancedMesh(new BoxGeometry(FIELD_W*.7,.15,3),new MeshStandardMaterial({color:'#806749',roughness:1}),24),dummy=new Object3D();
        for(let i=0;i<24;i++){dummy.position.set(FIELD_W/2,.1,(i+.5)*FIELD_H/24);dummy.updateMatrix();furrows.setMatrixAt(i,dummy.matrix);}group.add(furrows);
    }
    return group;
}
