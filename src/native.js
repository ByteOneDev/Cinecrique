export const nativeBridge = {
  get available() {
    return Boolean(window.__ANALYSE_NATIVE__ && window.AnalyseNative?.call);
  },

  call(command, payload = {}) {
    if (!this.available) {
      return Promise.reject(new Error("Le pont macOS n’est pas disponible dans le navigateur."));
    }
    return window.AnalyseNative.call(command, payload);
  },

  on(eventName, handler) {
    const listener = (event) => handler(event.detail);
    window.addEventListener(eventName, listener);
    return () => window.removeEventListener(eventName, listener);
  },

  readyForEvents() {
    return this.call("frontendReady");
  },
};

export function isNativeApp() {
  return nativeBridge.available;
}
