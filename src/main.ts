import { VERSION } from './core/version';

// Placeholder entry point; the UI layer will replace this file.
const app = document.getElementById('app')!;
app.textContent = `Repackshot ${VERSION}`;
app.dataset.ready = '1';
