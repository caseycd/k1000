import { useEffect, useRef, useState } from 'react';
import { useStore } from '../store';
import { CATEGORIES, COMPONENTS, getComponent, type DroneComponent } from '../data/components';
import { ARM, ARM_LAYOUT, PROP } from '../data/layout';
import { actions } from '../utils/actions';
import { IconClose, IconEye, IconFocus, IconIsolate } from './Icons';
import { sound } from '../utils/sound';

type Tab = 'overview' | 'technical' | 'location' | 'related' | 'notes';

const STATUS_LABEL: Record<DroneComponent['status'], string> = {
  operational: 'OPERATIONAL',
  attention: 'ATTENTION',
  standby: 'STANDBY',
};

/** Compact technical information panel for the selected component. */
export function ComponentInspector() {
  const selected = useStore((s) => s.selected);
  const engineer = useStore((s) => s.engineer);
  const hidden = useStore((s) => s.hidden);
  const [tab, setTab] = useState<Tab>('overview');
  const [revealed, setRevealed] = useState<Record<string, boolean>>({});
  const pnClicks = useRef<number[]>([]);
  const c = getComponent(selected);

  useEffect(() => {
    if (tab === 'notes' && c && !(engineer || revealed[c.id]) ) setTab('overview');
  }, [c, engineer, revealed, tab]);

  if (!c) return null;
  const cat = CATEGORIES.find((x) => x.id === c.category)!;
  const index = COMPONENTS.findIndex((x) => x.id === c.id) + 1;
  const notesAvailable = !!c.hiddenNote && (engineer || revealed[c.id]);
  const tabs: Tab[] = ['overview', 'technical', 'location', 'related', ...(notesAvailable ? (['notes'] as Tab[]) : [])];

  const onPartNumber = () => {
    if (!c.hiddenNote) return;
    const now = performance.now();
    pnClicks.current = [...pnClicks.current.filter((t) => now - t < 1500), now];
    if (pnClicks.current.length >= 3 && !revealed[c.id]) {
      setRevealed({ ...revealed, [c.id]: true });
      setTab('notes');
      useStore.getState().notify('TECHNICAL NOTE UNLOCKED');
      sound.unlock();
    }
  };

  return (
    <aside className="k-inspector panel" key={c.id} aria-label={`${c.name} inspection panel`}>
      <span className="k-callout-anchor" data-callout-anchor />
      <header className="k-insp-head">
        <div className="k-insp-meta">
          <span>
            {cat.code} · {String(index).padStart(2, '0')}/{COMPONENTS.length}
          </span>
          <button className="k-pn" onClick={onPartNumber} title={c.hiddenNote ? 'Part number' : undefined}>
            {c.partNumber}
          </button>
        </div>
        <h2>{c.name.toUpperCase()}</h2>
        <div className="k-insp-system">{c.system.toUpperCase()}</div>
        <button className="k-icon-btn k-insp-close" onClick={() => actions.select(null)} aria-label="Close inspector">
          <IconClose size={15} />
        </button>
      </header>

      <dl className="k-insp-facts">
        <div>
          <dt>Status</dt>
          <dd className={`st-${c.status}`}>
            <i className={`k-dot ${c.status}`} /> {STATUS_LABEL[c.status]}
          </dd>
        </div>
        <div>
          <dt>Location</dt>
          <dd>{c.location}</dd>
        </div>
        <div>
          <dt>Component Type</dt>
          <dd>{c.type}</dd>
        </div>
      </dl>

      <div className="k-tabs" role="tablist">
        {tabs.map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? 'on' : ''} onClick={() => setTab(t)}>
            {t === 'related' ? 'RELATED' : t.toUpperCase()}
          </button>
        ))}
      </div>

      <div className="k-tab-body">
        {tab === 'overview' && (
          <>
            <p className="k-desc">{c.description}</p>
            {c.statusNote && <p className="k-note warn">{c.statusNote}</p>}
            <div className="k-insp-actions">
              <button onClick={actions.focusSelected}>
                <IconFocus size={14} /> FOCUS
              </button>
              <button onClick={() => actions.isolate(c.id)}>
                <IconIsolate size={14} /> ISOLATE
              </button>
              <button onClick={actions.hideSelected}>
                <IconEye size={14} off /> HIDE
              </button>
            </div>
            {Object.keys(hidden).length > 0 && (
              <button className="k-link small" onClick={actions.showAll}>
                RESTORE ALL COMPONENTS
              </button>
            )}
          </>
        )}
        {tab === 'technical' && (
          <>
            <table className="k-specs">
              <tbody>
                {c.illustrativeSpecifications.map((s) => (
                  <tr key={s.label}>
                    <th>{s.label}</th>
                    <td>{s.value}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="k-note">Illustrative values for visualization only — not official K1000 specifications.</p>
          </>
        )}
        {tab === 'location' && <LocationTab c={c} />}
        {tab === 'related' && (
          <ul className="k-related">
            {c.relatedComponents.map((id) => {
              const r = getComponent(id);
              if (!r) return null;
              return (
                <li key={id}>
                  <button
                    onClick={() => actions.select(id, true)}
                    onMouseEnter={() => useStore.setState({ hovered: id, hoverSource: 'ui' })}
                    onMouseLeave={() => useStore.setState({ hovered: null, hoverSource: null })}
                  >
                    <i className={`k-dot ${r.status}`} />
                    <span>{r.name}</span>
                    <small>{r.partNumber}</small>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        {tab === 'notes' && c.hiddenNote && (
          <div className="k-hidden-note">
            <div className="k-hidden-tag">FIELD NOTE · RESTRICTED</div>
            <p>{c.hiddenNote}</p>
          </div>
        )}
      </div>
    </aside>
  );
}

/** Top-down + side schematic locator with the component marked. */
function LocationTab({ c }: { c: DroneComponent }) {
  const [x, y, z] = c.position;
  const S = 64; // px per metre in schematic
  const cx = 90;
  const cy = 74;
  const pX = (wx: number) => cx - wx * S; // starboard (-X) to the right
  const pZ = (wz: number) => cy - wz * S; // nose up
  return (
    <>
      <div className="k-loc-grid">
        <div>
          <dt>X</dt>
          <dd>{(x * 1000).toFixed(0)} mm</dd>
        </div>
        <div>
          <dt>Y</dt>
          <dd>{(y * 1000).toFixed(0)} mm</dd>
        </div>
        <div>
          <dt>Z</dt>
          <dd>{(z * 1000).toFixed(0)} mm</dd>
        </div>
      </div>
      <svg className="k-locator" viewBox="0 0 180 148" aria-label="Top-down locator">
        <text x="4" y="10">
          TOP · DATUM
        </text>
        {ARM_LAYOUT.map((a) => {
          const mx = a.dir[0] * ARM.tipRadius;
          const mz = a.dir[1] * ARM.tipRadius;
          return (
            <g key={a.index}>
              <line x1={pX(a.dir[0] * 0.15)} y1={pZ(a.dir[1] * 0.15)} x2={pX(mx)} y2={pZ(mz)} />
              <circle cx={pX(mx)} cy={pZ(mz)} r={PROP.radius * S} className="disc" />
              <circle cx={pX(mx)} cy={pZ(mz)} r={3} />
            </g>
          );
        })}
        <ellipse cx={cx} cy={cy} rx={0.17 * S} ry={0.29 * S} className="body" />
        <path d={`M${cx} ${cy - 0.29 * S - 6} l-3 5 h6z`} className="nose" />
        <line x1={cx - 84} y1={cy} x2={cx + 84} y2={cy} className="axis" />
        <line x1={cx} y1={cy - 70} x2={cx} y2={cy + 70} className="axis" />
        <circle cx={pX(x)} cy={pZ(z)} r={4.5} className="mark-ring" />
        <circle cx={pX(x)} cy={pZ(z)} r={2} className="mark" />
      </svg>
      <div className="k-assembly-path">
        K1000 <span>›</span> {CATEGORIES.find((k) => k.id === c.category)?.label} <span>›</span> {c.name}
      </div>
      <p className="k-note">Coordinates relative to the airframe datum (illustrative). +Z forward, +Y up.</p>
    </>
  );
}
