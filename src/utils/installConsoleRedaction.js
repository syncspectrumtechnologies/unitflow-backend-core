const { redact, redactString } = require('./redact');

const FLAG = Symbol.for('unitflow.consoleRedactionInstalled');

function sanitizeArg(arg) {
  if (typeof arg === 'string') return redactString(arg);
  return redact(arg);
}

module.exports = function installConsoleRedaction() {
  if (globalThis[FLAG]) return;
  globalThis[FLAG] = true;

  for (const method of ['log', 'info', 'warn', 'error']) {
    const original = console[method].bind(console);
    console[method] = (...args) => original(...args.map(sanitizeArg));
  }
};
