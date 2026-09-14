export class OrderedSaveQueue {
  constructor(write) {
    if (typeof write !== "function") throw new TypeError("Une fonction de sauvegarde est requise.");
    this.write = write;
    this.latestState = undefined;
    this.latestRevision = 0;
    this.savedRevision = 0;
    this.running = null;
  }

  markDirty(state) {
    this.latestState = state;
    this.latestRevision += 1;
    return this.latestRevision;
  }

  async flush(state) {
    const targetRevision = arguments.length ? this.markDirty(state) : this.latestRevision;
    if (targetRevision <= this.savedRevision) {
      return { saved: true, revision: this.savedRevision };
    }
    while (this.savedRevision < targetRevision) {
      if (!this.running) {
        this.running = this.drain().finally(() => {
          this.running = null;
        });
      }
      await this.running;
    }
    return { saved: true, revision: this.savedRevision };
  }

  async drain() {
    while (this.savedRevision < this.latestRevision) {
      const revision = this.latestRevision;
      const state = this.latestState;
      const result = await this.write(state, revision);
      if (result?.saved === false) throw new Error("La sauvegarde locale n’a pas été confirmée.");
      this.savedRevision = revision;
    }
  }
}
