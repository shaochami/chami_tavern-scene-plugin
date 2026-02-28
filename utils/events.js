'use strict';


export class EventBus {
    constructor() {
        this.st = globalThis.eventSource || null;
        this.emitter = this.st ? null : new EventTarget();
    }

    on(type, listener) {
        if (this.st?.on) {
            this.st.on(type, listener);
            return () => this.off(type, listener);
        }
        this.emitter.addEventListener(type, listener);
        return () => this.off(type, listener);
    }

    off(type, listener) {
        if (this.st?.off) {
            this.st.off(type, listener);
            return;
        }
        this.emitter.removeEventListener(type, listener);
    }

    emit(type, detail) {
        if (this.st?.emit) {
            this.st.emit(type, detail);
            return;
        }
        this.emitter.dispatchEvent(new CustomEvent(type, { detail }));
    }
}

