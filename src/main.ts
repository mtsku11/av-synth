import { mount } from 'svelte';
import App from './App.svelte';
import { registerAllOps } from './ops';
import { registerAllSources } from './sources';
import './app.css';

registerAllOps();
registerAllSources();

const target = document.getElementById('app');
if (!target) throw new Error('#app mount point missing from index.html');

mount(App, { target });
