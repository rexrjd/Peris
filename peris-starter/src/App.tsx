import { GameCanvas } from './game/GameCanvas'

export default function App() {
  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <span className="eyebrow">PERIS</span>
          <h1>World Prototype</h1>
        </div>
        <div className="resource-strip" aria-label="Resources">
          <span>Wood 1,250</span>
          <span>Stone 900</span>
          <span>Food 2,100</span>
        </div>
      </header>

      <section className="game-layout">
        <aside className="panel">
          <h2>Settlement</h2>
          <p>Greywatch</p>
          <button type="button">Buildings</button>
          <button type="button">Army</button>
          <button type="button">Research</button>
        </aside>

        <div className="game-panel">
          <GameCanvas />
        </div>

        <aside className="panel">
          <h2>Selected army</h2>
          <p>1st Company</p>
          <dl>
            <div><dt>Infantry</dt><dd>120</dd></div>
            <div><dt>Archers</dt><dd>60</dd></div>
            <div><dt>Cavalry</dt><dd>20</dd></div>
          </dl>
          <p className="hint">Click anywhere on the map to move the army marker.</p>
        </aside>
      </section>
    </main>
  )
}
