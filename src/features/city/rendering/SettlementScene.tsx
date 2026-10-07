import { BUILDINGS } from '../domain/buildings';
import { type BuildingType } from '../domain/types';

type SceneProps = {
    selected: BuildingType;
    onSelect: (type: BuildingType) => void;
    levels: Record<string, number>;
};

type Spot = {
    type: BuildingType;
    x: number;
    y: number;
    scale: number;
};

const SPOTS: Spot[] = [
    { type: 'wall', x: 500, y: 185, scale: 1.0 },
    { type: 'lumber', x: 175, y: 270, scale: .88 },
    { type: 'quarry', x: 815, y: 235, scale: .9 },
    { type: 'market', x: 500, y: 360, scale: 1.0 },
    { type: 'farm', x: 160, y: 495, scale: .9 },
    { type: 'storehouse', x: 365, y: 505, scale: .86 },
    { type: 'barracks', x: 735, y: 420, scale: .9 },
    { type: 'stables', x: 845, y: 520, scale: .82 },
];

const clampLevel = (level: number) => Math.max(0, Math.min(5, Math.floor(level || 0)));

function Foundation({ level }: { level: number }) {
    if (level > 0) return null;
    return <g className="building-foundation">
        <ellipse cx="0" cy="18" rx="58" ry="23" className="sprite-shadow"/>
        <path d="M-50 9 L-25 -8 L28 -5 L52 11 L34 26 L-31 27 Z" className="foundation-earth"/>
        <path d="M-42 6 L-22 -3 L-5 2 L-20 8 Z M8 -1 L28 -3 L39 7 L16 9 Z M-11 13 L13 10 L27 18 L2 21 Z" className="foundation-stone"/>
        <path d="M-34 -15 V10 M-30 -15 H-9 M31 -13 V12 M10 -13 H31" className="scaffold"/>
        <path d="M-38 -13 H-7 M8 -11 H35" className="scaffold-rope"/>
    </g>;
}

function Roof({ x = 0, y = 0, width = 86, height = 24, tone = 'red' }: { x?: number; y?: number; width?: number; height?: number; tone?: 'red' | 'blue' | 'gold' }) {
    return <path d={`M${x - width / 2} ${y} L${x} ${y - height} L${x + width / 2} ${y} Z`} className={`roof roof-${tone}`}/>;
}

function Banner({ x, y, flip = false }: { x: number; y: number; flip?: boolean }) {
    return <g transform={`translate(${x} ${y}) scale(${flip ? -1 : 1} 1)`} className="banner">
        <path d="M0 0 V-34" className="banner-pole"/>
        <path d="M2 -32 H21 L16 -23 L21 -14 H2 Z"/>
    </g>;
}

function Lumber({ level }: { level: number }) {
    return <g>
        <Foundation level={level}/>
        {level >= 1 && <>
            <ellipse cx="0" cy="20" rx="64" ry="24" className="sprite-shadow"/>
            <rect x="-43" y="-26" width="72" height="45" rx="2" className="timber-wall"/>
            <Roof x={-7} y={-26} width={84} height={28}/>
            <circle cx="39" cy="4" r="20" className="saw-wheel"/>
            <circle cx="39" cy="4" r="5" className="saw-hub"/>
            <path d="M-58 19 h49 M-54 12 h41 M-50 5 h32" className="stacked-logs"/>
        </>}
        {level >= 2 && <>
            <rect x="-65" y="-8" width="27" height="29" className="timber-annex"/>
            <Roof x={-51} y={-8} width={35} height={14}/>
            <path d="M58 18 V-33 M58 -31 H88 M86 -31 V-18" className="crane"/>
            <path d="M86 -17 l-8 9" className="crane-rope"/>
        </>}
        {level >= 3 && <>
            <rect x="10" y="-47" width="24" height="32" className="timber-tower"/>
            <Roof x={22} y={-47} width={34} height={18} tone="blue"/>
            <path d="M-30 -6 V15 M-13 -6 V15 M4 -6 V15" className="timber-brace"/>
        </>}
        {level >= 4 && <>
            <path d="M-70 22 H72" className="stone-step"/>
            <Banner x={-28} y={-46}/>
            <path d="M46 -10 L70 -19 L72 16 L52 18 Z" className="covered-stack"/>
        </>}
        {level >= 5 && <>
            <Banner x={47} y={-43} flip/>
            <circle cx="39" cy="4" r="25" className="elite-ring"/>
            <path d="M-7 -55 l8 -8 l8 8 l-8 7 Z" className="gold-crest"/>
        </>}
    </g>;
}

function Quarry({ level }: { level: number }) {
    return <g>
        <Foundation level={level}/>
        {level >= 1 && <>
            <ellipse cx="0" cy="21" rx="63" ry="23" className="sprite-shadow"/>
            <path d="M-61 16 L-51 -22 L-29 -38 L-6 -26 L12 -43 L36 -31 L57 10 Z" className="quarry-rock"/>
            <rect x="-29" y="1" width="34" height="21" className="quarry-block"/>
            <rect x="10" y="-2" width="29" height="23" className="quarry-block alt"/>
        </>}
        {level >= 2 && <>
            <path d="M-53 -17 H-24 M-53 -17 V-58 M-50 -56 H8 M5 -55 V-17" className="crane"/>
            <path d="M-4 -53 V-17" className="crane-rope"/>
            <rect x="-14" y="-20" width="20" height="15" className="hanging-block"/>
        </>}
        {level >= 3 && <>
            <rect x="34" y="-29" width="31" height="49" className="quarry-house"/>
            <Roof x={49.5} y={-29} width={40} height={18}/>
            <path d="M43 -14 h13 M43 -5 h13" className="window-lines"/>
        </>}
        {level >= 4 && <>
            <path d="M-72 23 H72" className="stone-step"/>
            <Banner x={50} y={-45}/>
            <path d="M-45 8 l18 -10 l15 8 l-18 10 Z" className="cut-stone"/>
        </>}
        {level >= 5 && <>
            <path d="M-67 -4 L-55 -34 L-42 -24 L-29 -51 L-10 -34" className="gold-vein"/>
            <Banner x={-29} y={-52} flip/>
        </>}
    </g>;
}

function Farm({ level }: { level: number }) {
    return <g>
        <Foundation level={level}/>
        {level >= 1 && <>
            <ellipse cx="0" cy="22" rx="68" ry="24" className="sprite-shadow"/>
            <path d="M-72 10 C-44 -8,-12 -6,12 8 C34 -5,52 -3,72 11 V24 H-72 Z" className="field"/>
            <path d="M-64 8 Q-44 16 -26 8 M-47 4 Q-26 12 -8 5 M12 7 Q31 15 51 6" className="field-lines"/>
            <rect x="-22" y="-24" width="46" height="42" className="farm-house"/>
            <Roof x={1} y={-24} width={57} height={21}/>
        </>}
        {level >= 2 && <>
            <rect x="34" y="-13" width="28" height="31" className="barn"/>
            <Roof x={48} y={-13} width={38} height={17}/>
            <path d="M42 18 V0 L55 18 V0" className="barn-door"/>
        </>}
        {level >= 3 && <>
            <path d="M-48 16 V-48" className="mill-post"/>
            <circle cx="-48" cy="-47" r="4" className="mill-hub"/>
            <path d="M-48 -47 L-74 -64 M-48 -47 L-22 -64 M-48 -47 L-74 -30 M-48 -47 L-22 -30" className="mill-blades"/>
        </>}
        {level >= 4 && <>
            <rect x="-8" y="-37" width="16" height="13" className="farm-tower"/>
            <Roof x={0} y={-37} width={24} height={13} tone="blue"/>
            <Banner x={20} y={-39}/>
        </>}
        {level >= 5 && <>
            <path d="M-68 22 H70" className="stone-step"/>
            <path d="M-6 -47 l7 -8 l7 8 l-7 7 Z" className="gold-crest"/>
            <Banner x={-15} y={-39} flip/>
        </>}
    </g>;
}

function Market({ level }: { level: number }) {
    return <g>
        <Foundation level={level}/>
        {level >= 1 && <>
            <ellipse cx="0" cy="23" rx="72" ry="25" className="sprite-shadow"/>
            <rect x="-49" y="-22" width="98" height="42" className="forum-wall"/>
            <Roof y={-22} width={112} height={31} tone="gold"/>
            <path d="M-34 -18 V18 M-17 -18 V18 M0 -18 V18 M17 -18 V18 M34 -18 V18" className="forum-columns"/>
            <path d="M-58 20 H58 M-66 25 H66" className="stone-step"/>
        </>}
        {level >= 2 && <>
            <rect x="-69" y="-9" width="22" height="29" className="forum-wing"/>
            <rect x="47" y="-9" width="22" height="29" className="forum-wing"/>
            <Roof x={-58} y={-9} width={31} height={15}/><Roof x={58} y={-9} width={31} height={15}/>
        </>}
        {level >= 3 && <>
            <rect x="-15" y="-51" width="30" height="29" className="forum-tower"/>
            <Roof y={-51} width={39} height={18} tone="blue"/>
            <circle cx="0" cy="-42" r="5" className="window-gold"/>
        </>}
        {level >= 4 && <>
            <Banner x={-46} y={-40}/><Banner x={46} y={-40} flip/>
            <circle cx="0" cy="6" r="7" className="fountain"/>
            <path d="M0 5 V-7" className="fountain-jet"/>
        </>}
        {level >= 5 && <>
            <path d="M-21 -59 H21" className="gold-line"/>
            <path d="M0 -71 l8 10 l-8 8 l-8 -8 Z" className="gold-crest"/>
            <path d="M-74 28 H74" className="gold-line"/>
        </>}
    </g>;
}

function Barracks({ level }: { level: number }) {
    return <g>
        <Foundation level={level}/>
        {level >= 1 && <>
            <ellipse cx="0" cy="21" rx="68" ry="24" className="sprite-shadow"/>
            <rect x="-52" y="-18" width="104" height="39" className="barracks-wall"/>
            <Roof y={-18} width={112} height={24}/>
            <path d="M-22 21 V-6 H22 V21" className="barracks-gate"/>
        </>}
        {level >= 2 && <>
            <rect x="-66" y="-37" width="27" height="58" className="fort-tower"/>
            <rect x="39" y="-37" width="27" height="58" className="fort-tower"/>
            <Roof x={-52.5} y={-37} width={36} height={18} tone="blue"/><Roof x={52.5} y={-37} width={36} height={18} tone="blue"/>
        </>}
        {level >= 3 && <>
            <path d="M-40 -18 H40 V-48 H-40 Z" className="upper-keep"/>
            <Roof y={-48} width={86} height={22}/>
            <path d="M-29 -35 h15 M14 -35 h15" className="window-lines"/>
        </>}
        {level >= 4 && <>
            <Banner x={-52} y={-56}/><Banner x={52} y={-56} flip/>
            <path d="M-74 22 H74" className="stone-step"/>
        </>}
        {level >= 5 && <>
            <rect x="-8" y="-66" width="16" height="19" className="watch-tower"/>
            <Roof y={-66} width={27} height={15} tone="gold"/>
            <path d="M-56 -14 h7 M49 -14 h7" className="gold-line"/>
        </>}
    </g>;
}

function Stables({ level }: { level: number }) {
    return <g>
        <Foundation level={level}/>
        {level >= 1 && <>
            <ellipse cx="0" cy="21" rx="68" ry="23" className="sprite-shadow"/>
            <rect x="-52" y="-20" width="104" height="40" className="stable-wall"/>
            <Roof y={-20} width={114} height={26}/>
            <path d="M-33 20 V-5 H-10 V20 M10 20 V-5 H33 V20" className="stable-doors"/>
        </>}
        {level >= 2 && <>
            <path d="M-64 21 V-5 H-54 M64 21 V-5 H54" className="paddock"/>
            <path d="M-66 8 H-48 M48 8 H66" className="paddock"/>
        </>}
        {level >= 3 && <>
            <rect x="-12" y="-47" width="24" height="27" className="stable-tower"/>
            <Roof y={-47} width={34} height={17} tone="blue"/>
            <path d="M0 -37 q9 7 0 13 q-9 -6 0 -13" className="horse-mark"/>
        </>}
        {level >= 4 && <>
            <Banner x={-42} y={-40}/><Banner x={42} y={-40} flip/>
            <path d="M-70 23 H70" className="stone-step"/>
        </>}
        {level >= 5 && <>
            <path d="M-20 -56 H20" className="gold-line"/>
            <path d="M0 -67 l7 9 l-7 7 l-7 -7 Z" className="gold-crest"/>
        </>}
    </g>;
}

function Wall({ level }: { level: number }) {
    return <g>
        <Foundation level={level}/>
        {level >= 1 && <>
            <ellipse cx="0" cy="24" rx="76" ry="24" className="sprite-shadow"/>
            <rect x="-54" y="-22" width="108" height="45" className="wall-stone"/>
            <path d="M-58 -22 h12 v-8 h12 v8 h12 v-8 h12 v8 h20 v-8 h12 v8 h12 v-8 h12 v8 h12" className="crenel"/>
            <path d="M-18 23 V-9 Q0 -27 18 -9 V23 Z" className="gate-dark"/>
        </>}
        {level >= 2 && <>
            <rect x="-72" y="-48" width="32" height="71" className="wall-tower"/>
            <rect x="40" y="-48" width="32" height="71" className="wall-tower"/>
            <Roof x={-56} y={-48} width={41} height={24} tone="blue"/><Roof x={56} y={-48} width={41} height={24} tone="blue"/>
        </>}
        {level >= 3 && <>
            <rect x="-23" y="-51" width="46" height="30" className="gatehouse"/>
            <Roof y={-51} width={56} height={20}/>
            <path d="M0 -43 V-24" className="portcullis"/>
        </>}
        {level >= 4 && <>
            <Banner x={-56} y={-62}/><Banner x={56} y={-62} flip/>
            <path d="M-82 25 H82" className="stone-step"/>
        </>}
        {level >= 5 && <>
            <rect x="-9" y="-76" width="18" height="25" className="watch-tower"/>
            <Roof y={-76} width={31} height={18} tone="gold"/>
            <path d="M-28 -58 H28" className="gold-line"/>
        </>}
    </g>;
}

function Storehouse({ level }: { level: number }) {
    return <g>
        <Foundation level={level}/>
        {level >= 1 && <>
            <ellipse cx="0" cy="22" rx="67" ry="23" className="sprite-shadow"/>
            <rect x="-47" y="-22" width="94" height="42" className="store-wall"/>
            <Roof y={-22} width={106} height={26}/>
            <path d="M-29 20 V0 H-10 V20 M10 20 V0 H29 V20" className="store-doors"/>
        </>}
        {level >= 2 && <>
            <rect x="-63" y="-34" width="24" height="54" rx="5" className="silo"/>
            <path d="M-64 -34 Q-51 -49 -38 -34" className="silo-roof"/>
            <rect x="39" y="-34" width="24" height="54" rx="5" className="silo"/>
            <path d="M38 -34 Q51 -49 64 -34" className="silo-roof"/>
        </>}
        {level >= 3 && <>
            <rect x="-11" y="-50" width="22" height="28" className="store-tower"/>
            <Roof y={-50} width={32} height={17} tone="blue"/>
        </>}
        {level >= 4 && <>
            <Banner x={-31} y={-42}/><Banner x={31} y={-42} flip/>
            <path d="M-72 23 H72" className="stone-step"/>
        </>}
        {level >= 5 && <>
            <path d="M-19 -59 H19" className="gold-line"/>
            <circle cx="0" cy="-43" r="4" className="window-gold"/>
        </>}
    </g>;
}

function Sprite({ type, level }: { type: BuildingType; level: number }) {
    if (type === 'lumber') return <Lumber level={level}/>;
    if (type === 'quarry') return <Quarry level={level}/>;
    if (type === 'farm') return <Farm level={level}/>;
    if (type === 'market') return <Market level={level}/>;
    if (type === 'barracks') return <Barracks level={level}/>;
    if (type === 'stables') return <Stables level={level}/>;
    if (type === 'wall') return <Wall level={level}/>;
    return <Storehouse level={level}/>;
}

function LevelMarks({ level }: { level: number }) {
    return <g className="level-marks" transform="translate(-23 13)">
        {[1, 2, 3, 4, 5].map(i => <circle key={i} cx={(i - 1) * 12} cy="0" r="3" className={i <= level ? 'filled' : ''}/>) }
    </g>;
}

export function SettlementScene({ selected, onSelect, levels }: SceneProps) {
    return <svg className="settlement-scene" viewBox="0 0 1000 620" role="img" aria-label="Interactive settlement with buildings that visually grow from level zero to level five">
        <defs>
            <linearGradient id="sceneSky" x1="0" y1="0" x2="0" y2="1"><stop stopColor="#b9c5c4"/><stop offset=".52" stopColor="#7c9694"/><stop offset="1" stopColor="#506b62"/></linearGradient>
            <linearGradient id="sceneGround" x1="0" y1="0" x2="0" y2="1"><stop stopColor="#65735a"/><stop offset="1" stopColor="#344634"/></linearGradient>
            <linearGradient id="sceneRoad" x1="0" y1="0" x2="1" y2="1"><stop stopColor="#aa9e79"/><stop offset="1" stopColor="#766d53"/></linearGradient>
            <linearGradient id="water" x1="0" y1="0" x2="0" y2="1"><stop stopColor="#718f8e"/><stop offset="1" stopColor="#385b5c"/></linearGradient>
            <filter id="selectedGlow" x="-60%" y="-60%" width="220%" height="220%"><feGaussianBlur stdDeviation="5" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
        </defs>

        <rect width="1000" height="620" fill="url(#sceneSky)"/>
        <path d="M0 165 L90 80 L165 145 L255 55 L335 147 L425 100 L506 156 L610 62 L690 146 L770 90 L850 150 L930 52 L1000 128 L1000 245 L0 245 Z" className="mountain-back"/>
        <path d="M0 204 L110 126 L186 191 L301 113 L394 196 L492 132 L583 200 L707 120 L795 198 L900 111 L1000 186 L1000 265 L0 265 Z" className="mountain-front"/>
        <path d="M0 183 L87 92 L113 116 L160 151 L255 65 L282 91 L335 151 L426 109 L450 126 L506 160 L610 72 L638 103 L690 151 L770 99 L800 119 L850 154 L930 61 L957 91 L1000 132" className="snow-line"/>
        <path d="M0 220 C155 196 270 221 372 232 C512 248 665 212 1000 222 V620 H0 Z" fill="url(#sceneGround)"/>
        <path d="M376 234 C428 259 566 258 626 232 C610 288 626 332 675 370 C583 398 444 397 347 365 C393 323 398 278 376 234 Z" fill="url(#water)" className="scene-lake"/>
        <path d="M447 241 C459 294 449 340 422 389 C412 431 428 498 462 620 H545 C527 511 525 443 552 387 C574 338 574 287 560 243 Z" className="river"/>
        <path d="M500 218 C496 287 499 326 500 356 M500 356 C424 391 344 428 160 482 M500 356 C601 382 710 405 840 490 M500 356 C377 334 276 313 169 269 M500 356 C627 321 715 279 819 236 M500 356 C453 416 411 457 366 497 M500 356 C587 405 661 438 735 421" className="main-roads"/>
        <path d="M111 431 C185 401 252 407 313 444 L271 584 L69 584 Z" className="farm-terrace"/>
        <path d="M747 185 C821 159 905 167 960 217 L926 326 L751 305 Z" className="quarry-terrace"/>
        <path d="M82 229 C145 192 229 194 289 234 L260 331 L84 342 Z" className="wood-terrace"/>
        <path d="M616 348 C708 323 815 346 879 397 L864 520 L660 513 Z" className="military-terrace"/>
        <path d="M300 425 C363 399 440 416 479 464 L454 565 L298 563 Z" className="store-terrace"/>
        <path d="M410 293 C462 272 543 272 595 300 L583 424 L409 423 Z" className="forum-terrace"/>
        <path d="M392 150 C456 128 547 130 610 166 L594 255 L403 253 Z" className="wall-terrace"/>

        <g className="ambient-details" aria-hidden="true">
            <path d="M32 375 q18 -42 36 0 q18 -52 35 0 q19 -39 35 0" className="tree-line"/>
            <path d="M877 349 q15 -36 30 0 q15 -45 29 0 q15 -34 29 0" className="tree-line"/>
            <path d="M262 366 q12 -31 25 0 q12 -38 24 0" className="tree-line"/>
            <circle cx="388" cy="276" r="3" className="torch"/><circle cx="612" cy="278" r="3" className="torch"/>
        </g>

        {SPOTS.map(spot => {
            const level = clampLevel(levels[spot.type] ?? 0);
            const active = selected === spot.type;
            const label = level === 0 ? 'Unbuilt' : `Level ${level}`;
            return <g key={spot.type} transform={`translate(${spot.x} ${spot.y}) scale(${spot.scale})`} className={`settlement-building ${active ? 'selected' : ''} level-${level}`} role="button" tabIndex={0} aria-label={`${BUILDINGS[spot.type].name}, ${label}`} onClick={() => onSelect(spot.type)} onKeyDown={event => {
                if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    onSelect(spot.type);
                }
            }}>
                {active && <ellipse cx="0" cy="8" rx="82" ry="48" className="selection-aura" filter="url(#selectedGlow)"/>}
                <Sprite type={spot.type} level={level}/>
                <g className="building-nameplate" transform="translate(0 52)">
                    <rect x="-54" y="-12" width="108" height="32" rx="3"/>
                    <text y="0" textAnchor="middle">{BUILDINGS[spot.type].name}</text>
                    <text y="12" textAnchor="middle" className="building-level-text">{label}</text>
                    <LevelMarks level={level}/>
                </g>
            </g>;
        })}

        <g className="scene-vignette" aria-hidden="true"><rect x="8" y="8" width="984" height="604" rx="2"/></g>
    </svg>;
}
