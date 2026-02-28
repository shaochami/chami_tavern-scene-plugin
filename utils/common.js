'use strict';



export function log(scope, ...args) {
}

export function error(scope, ...args) {
}

export function sleep(ms) {
    return new Promise(res => setTimeout(res, ms));
}

// 简单 UUID 占位（非加密，后续可换 crypto.randomUUID）
export function uuid() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
        const r = Math.random() * 16 | 0;
        const v = c === 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}

