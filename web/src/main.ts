import { mount } from 'svelte';
import './app.css';
import App from './App.svelte';
import { applyTheme } from './lib/theme.ts';

applyTheme();

mount(App, { target: document.getElementById('app')! });

// Service Worker für Installierbarkeit (PWA) und schnelleren Start
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
}
