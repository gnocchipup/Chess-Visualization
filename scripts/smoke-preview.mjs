// Smoke test against a running `vite preview` (expects port 4173).
const base = 'http://localhost:4173';
try {
  const r1 = await fetch(base + '/');
  console.log('/ =>', r1.status);
  const html = await r1.text();
  const js = html.match(/assets\/[^"']+\.js/);
  const wasm = html.match(/assets\/[^"']+\.wasm/);
  console.log('js asset in html:', js ? js[0] : 'none (loaded via module script tag only)');
  if (js) {
    const r2 = await fetch(base + '/' + js[0]);
    const body = await r2.text();
    console.log('bundle =>', r2.status, body.length, 'bytes, ORDER BY RANDOM:', body.includes('ORDER BY RANDOM'));
    const w = body.match(/assets\/sql-wasm-[^"']+\.wasm/);
    if (w) {
      const r3 = await fetch(base + '/' + w[0]);
      console.log('wasm =>', r3.status, r3.headers.get('content-length'), 'bytes');
    } else {
      console.log('wasm reference NOT found in bundle');
      process.exitCode = 1;
    }
  }
} catch (e) {
  console.error('SMOKE FAILED:', e.message);
  process.exitCode = 1;
}
