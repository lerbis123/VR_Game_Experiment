import './logger.js';
import { isEnabled, onToggle, registerFeatures } from './toggles.js';

// Every .js file in this folder that exports setup(game) is a feature.
// Editing or adding one hot-swaps all features without leaving VR.
// Files without setup() (fx.js, hands.js, shared.js, toggles.js, logger.js) are shared helpers.
const modules = import.meta.glob(['./*.js', '!./index.js'], { eager: true });

// "movingTargets" -> "Moving targets"
function labelFor(name) {
  const words = name.replace(/([A-Z])/g, ' $1').toLowerCase();
  return words[0].toUpperCase() + words.slice(1);
}

// Wrap a feature so the control panel can switch it on and off while you play
function switchable(name, mod) {
  return {
    setup(game) {
      let instance = null;
      let errors = 0;
      const start = () => {
        if (instance) return;
        errors = 0;
        try {
          instance = mod.setup(game) ?? {};
        } catch (err) {
          console.error(`Feature "${name}" setup failed`, err);
          instance = {};
        }
      };
      const stop = () => {
        try {
          instance?.dispose?.();
        } catch (err) {
          console.error(`Feature "${name}" dispose failed`, err);
        }
        instance = null;
      };

      if (isEnabled(name)) start();
      const unsubscribe = onToggle((changed, on) => {
        if (changed === name) (on ? start : stop)();
      });

      return {
        update(dt, time) {
          try {
            instance?.update?.(dt, time);
          } catch (err) {
            // Restart the feature rather than leaving it frozen; give up after a few tries
            // (switching it off and on in the control panel starts it fresh)
            console.error(`Feature "${name}" update failed`, err);
            const tries = errors + 1;
            stop();
            if (tries < 3) {
              start();
              errors = tries;
            }
          }
        },
        dispose() {
          unsubscribe();
          stop();
        },
      };
    },
  };
}

// Always-on features (panel, sword fighter) get the same error recovery, without the switch
function resilient(name, mod) {
  return {
    setup(game) {
      let instance = mod.setup(game) ?? {};
      let errors = 0;
      return {
        update(dt, time) {
          try {
            instance.update?.(dt, time);
          } catch (err) {
            console.error(`Feature "${name}" update failed`, err);
            errors++;
            try {
              instance.dispose?.();
            } catch (disposeErr) {
              console.error(`Feature "${name}" dispose failed`, disposeErr);
            }
            instance = errors < 3 ? (mod.setup(game) ?? {}) : {};
          }
        },
        dispose() {
          instance.dispose?.();
        },
      };
    },
  };
}

const entries = Object.entries(modules)
  .filter(([, mod]) => typeof mod.setup === 'function')
  .map(([path, mod]) => ({ name: path.slice(2, -3), mod }));

// Features can opt out of being switchable (the control panel itself does).
// Everything starts off unless the feature exports `defaultOn = true`.
registerFeatures(
  entries
    .filter((e) => e.mod.switchable !== false)
    .map((e) => ({ name: e.name, label: e.mod.label ?? labelFor(e.name), defaultOn: e.mod.defaultOn === true }))
);

export const features = entries.map(({ name, mod }) => (mod.switchable === false ? resilient(name, mod) : switchable(name, mod)));
