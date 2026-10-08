// Which features are switched on, plus control-panel action buttons.
// No setup() export, so it isn't a feature itself. Lives in its own module so the state
// survives hot-swaps of feature files, and in localStorage so it survives page reloads.
// Everything starts OFF unless a feature exports `defaultOn = true`.
//
// Note: main.js imports this module too, so editing it reloads the page (exits VR).
const STORAGE_KEY = 'vr-games:feature-state:v2';

let state = {}; // name -> boolean, only for things the player has explicitly switched
try {
  state = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') ?? {};
} catch {
  // storage unavailable: use defaults
}

const defaults = new Map();
const listeners = new Set();
let builtIns = []; // [{ name, label, defaultOn }] — things that live in main.js
let features = []; // [{ name, label, defaultOn }] — feature files

export function isEnabled(name) {
  return name in state ? state[name] : (defaults.get(name) ?? false);
}

export function setEnabled(name, on) {
  state[name] = on;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // ignore
  }
  listeners.forEach((fn) => fn(name, on));
}

export function onToggle(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function registerDefaults(list) {
  list.forEach((item) => defaults.set(item.name, !!item.defaultOn));
}

export function registerFeatures(list) {
  features = list;
  registerDefaults(list);
}

export function registerBuiltIns(list) {
  builtIns = list;
  registerDefaults(list);
}

export function getFeatures() {
  return [...builtIns, ...features];
}

// ---------- Panel action buttons ----------
// Features add buttons with addAction({ label, run }) and remove them on dispose.
const actions = [];
const actionListeners = new Set();
function notifyActions() {
  actionListeners.forEach((fn) => fn());
}

export function addAction(action) {
  actions.push(action);
  notifyActions();
  return () => {
    const i = actions.indexOf(action);
    if (i >= 0) actions.splice(i, 1);
    notifyActions();
  };
}

export function getActions() {
  return actions;
}

export function onActionsChanged(fn) {
  actionListeners.add(fn);
  return () => actionListeners.delete(fn);
}
