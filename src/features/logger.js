// Sends errors and warnings from the headset to the dev server, which writes them to
// headset.log in the project folder (see vite.config.js). No setup() export, so it isn't a feature.
function describe(value) {
  if (value instanceof Error) return `${value.message}\n${value.stack ?? ''}`;
  if (typeof value === 'object' && value !== null) {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  return String(value);
}

if (import.meta.hot && !window.__headsetLogger) {
  window.__headsetLogger = true;
  const hot = import.meta.hot;
  const send = (level, parts) => {
    try {
      hot.send('vr:log', { level, message: parts.map(describe).join(' ') });
    } catch {
      // never let logging break the game
    }
  };

  const originalError = console.error.bind(console);
  console.error = (...args) => {
    originalError(...args);
    send('error', args);
  };
  const originalWarn = console.warn.bind(console);
  console.warn = (...args) => {
    originalWarn(...args);
    send('warn', args);
  };
  addEventListener('error', (e) => send('error', [e.error ?? e.message]));
  addEventListener('unhandledrejection', (e) => send('rejection', [e.reason]));
  send('info', ['page loaded', navigator.userAgent]);
}
