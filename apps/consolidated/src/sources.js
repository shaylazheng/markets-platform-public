import { VIEW_IDS } from './views.js';
export const KIND_LABEL = {local:'Synthetic demo'};
export const SURFACE_SOURCES = Object.fromEntries(VIEW_IDS.map(id => [id,[{kind:'local',name:'Synthetic demo fixtures',label:'Synthetic demo fixtures',detail:'Deterministically generated illustration; not observed market data.'}]]));
