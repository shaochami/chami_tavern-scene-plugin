'use strict';



const PLUGIN_KEY = 'chami_tavern-scene-plugin';

function getStSettingsRoot() {
    const root = globalThis.extension_settings;
    if (!root) return null;
    if (!root[PLUGIN_KEY]) {
        root[PLUGIN_KEY] = {};
    }
    return root[PLUGIN_KEY];
}

function saveStSettingsIfPossible() {
    const saver = globalThis.saveSettingsDebounced || globalThis.saveSettings;
    if (typeof saver === 'function') {
        try { saver(); } catch (e) { console.warn('[ApiAdapter] saveSettings failed', e); }
    }
}

export const ApiAdapter = {
    async request(url, options = {}) {
        const resp = await fetch(url, options);
        if (!resp.ok) {
            const text = await resp.text().catch(() => '');
            throw new Error(`HTTP ${resp.status}: ${text}`);
        }
        // 自动尝试 json，否则返回 text
        const contentType = resp.headers.get('content-type') || '';
        if (contentType.includes('application/json')) {
            return resp.json();
        }
        return resp.text();
    },

    async getJson(url, options = {}) {
        return this.request(url, { ...options, method: 'GET' });
    },

    async postJson(url, body, options = {}) {
        return this.request(url, {
            ...options,
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
            body: JSON.stringify(body),
        });
    },

    /**
     * 存储：优先 ST extension_settings，回落 localStorage
     */
    async getStorage(key, defaultValue = null) {
        const stRoot = getStSettingsRoot();
        if (stRoot) {
            return stRoot[key] ?? defaultValue;
        }
        try {
            const raw = localStorage.getItem(`${PLUGIN_KEY}:${key}`);
            if (raw === null || raw === undefined) return defaultValue;
            return JSON.parse(raw);
        } catch {
            return defaultValue;
        }
    },

    async setStorage(key, value) {
        const stRoot = getStSettingsRoot();
        if (stRoot) {
            stRoot[key] = value;
            saveStSettingsIfPossible();
            return true;
        }
        try {
            localStorage.setItem(`${PLUGIN_KEY}:${key}`, JSON.stringify(value));
            return true;
        } catch (err) {
            return false;
        }
    },

    async removeStorage(key) {
        const stRoot = getStSettingsRoot();
        if (stRoot) {
            delete stRoot[key];
            saveStSettingsIfPossible();
            return true;
        }
        try {
            localStorage.removeItem(`${PLUGIN_KEY}:${key}`);
            return true;
        } catch (err) {
            return false;
        }
    },
};

