import { defineConfig } from 'vite';

// GitHub Pages serves project sites from a subpath
// (https://<user>.github.io/<repo>/), where Vite's default absolute
// "/assets/..." URLs 404. A relative base makes the same build work from any
// path — GitHub Pages, Render, or a local `vite preview` — with no per-host
// configuration.
export default defineConfig({
  base: './',
});
