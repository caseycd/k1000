import { useMemo, useState } from 'react';
import { useStore } from '../store';
import { IconClose } from './Icons';

type Format = 'script' | 'iframe';

/** "Embed on your site": generates copy-paste code for the current view. */
export function EmbedDialog() {
  const open = useStore((s) => s.embedOpen);
  const selected = useStore((s) => s.selected);
  const explode = useStore((s) => s.explode);
  const view = useStore((s) => s.view);
  const lighting = useStore((s) => s.lighting);
  const [format, setFormat] = useState<Format>('script');
  const [keepView, setKeepView] = useState(true);
  const [height, setHeight] = useState('');
  const [copied, setCopied] = useState(false);

  const origin = typeof window !== 'undefined' ? window.location.origin : '';

  const opts = useMemo(() => {
    const o: Record<string, string> = {};
    if (!keepView) return o;
    if (selected) o.component = selected;
    const views = [explode > 0.5 && 'exploded', view !== 'exterior' && view].filter(Boolean) as string[];
    if (views.length) o.view = views.join(',');
    if (lighting !== 'studio') o.light = lighting;
    return o;
  }, [keepView, selected, explode, view, lighting]);

  const code = useMemo(() => {
    const h = /^\d+$/.test(height) ? height : '';
    if (format === 'script') {
      const attrs = [
        'data-k1000',
        h && `data-height="${h}"`,
        ...Object.entries(opts).map(([k, v]) => `data-${k}="${v}"`),
      ].filter(Boolean);
      return `<div ${attrs.join(' ')}></div>\n<script src="${origin}/embed.js" async></script>`;
    }
    const q = new URLSearchParams({ embed: '1', ...opts }).toString().replace(/%2C/g, ',');
    const size = h ? `height:${h}px` : 'aspect-ratio:16/9';
    return `<iframe src="${origin}/?${q}" title="K1000ULE 3D viewer"\n  style="width:100%;${size};border:0;border-radius:12px"\n  allow="fullscreen" loading="lazy"></iframe>`;
  }, [format, opts, height, origin]);

  if (!open) return null;
  const close = () => useStore.setState({ embedOpen: false });
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = code;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  return (
    <div className="k-modal-backdrop" onClick={close}>
      <div className="k-modal panel" role="dialog" aria-modal="true" aria-label="Embed on your site" onClick={(e) => e.stopPropagation()}>
        <header>
          <div>
            <h3>EMBED ON YOUR SITE</h3>
            <p>Paste this into any web page or site builder's "custom HTML" block.</p>
          </div>
          <button className="k-icon-btn" onClick={close} aria-label="Close">
            <IconClose size={15} />
          </button>
        </header>

        <div className="k-seg k-modal-seg">
          <button className={format === 'script' ? 'on' : ''} onClick={() => setFormat('script')}>
            SCRIPT (RECOMMENDED)
          </button>
          <button className={format === 'iframe' ? 'on' : ''} onClick={() => setFormat('iframe')}>
            IFRAME ONLY
          </button>
        </div>

        <pre className="k-code">{code}</pre>

        <div className="k-modal-opts">
          <label>
            <input type="checkbox" checked={keepView} onChange={(e) => setKeepView(e.target.checked)} />
            Open with the current view{selected || explode > 0.5 || view !== 'exterior' || lighting !== 'studio' ? '' : ' (default view)'}
          </label>
          <label>
            Height
            <input value={height} onChange={(e) => setHeight(e.target.value.replace(/\D/g, ''))} placeholder="auto 16:9" inputMode="numeric" />
            px
          </label>
        </div>

        <div className="k-modal-actions">
          <button className="k-btn-primary" onClick={() => void copy()}>
            {copied ? 'COPIED ✓' : 'COPY CODE'}
          </button>
          <a className="k-btn-line" href="/embed-demo.html" target="_blank" rel="noopener">
            SEE A LIVE EXAMPLE ↗
          </a>
        </div>
        <p className="k-note">
          The embed won't hijack page scrolling, loads only when scrolled into view, and can be controlled from your page (select a part, explode,
          change view). Full guide: EMBED.md in the project.
        </p>
      </div>
    </div>
  );
}
