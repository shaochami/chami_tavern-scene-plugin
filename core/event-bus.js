'use strict';



export class EventBus {
    constructor() {
        this._listeners = new Map();
        this._onceListeners = new Map();
    }


    on(event, callback) {
        if (!this._listeners.has(event)) {
            this._listeners.set(event, new Set());
        }
        this._listeners.get(event).add(callback);


        return () => this.off(event, callback);
    }


    once(event, callback) {
        if (!this._onceListeners.has(event)) {
            this._onceListeners.set(event, new Set());
        }
        this._onceListeners.get(event).add(callback);

        return () => {
            const listeners = this._onceListeners.get(event);
            if (listeners) {
                listeners.delete(callback);
            }
        };
    }


    off(event, callback) {
        const listeners = this._listeners.get(event);
        if (listeners) {
            listeners.delete(callback);
        }

        const onceListeners = this._onceListeners.get(event);
        if (onceListeners) {
            onceListeners.delete(callback);
        }
    }


    emit(event, data) {

        const listeners = this._listeners.get(event);
        if (listeners) {
            for (const callback of listeners) {
                try {
                    callback(data);
                } catch (error) {
                }
            }
        }

        // 触发一次性监听器
        const onceListeners = this._onceListeners.get(event);
        if (onceListeners) {
            for (const callback of onceListeners) {
                try {
                    callback(data);
                } catch (error) {
                }
            }
            this._onceListeners.delete(event);
        }
    }

    /**
     * 异步触发事件 (等待所有监听器完成)
     * @param {string} event 事件名称
     * @param {*} data 事件数据
     * @returns {Promise<void>}
     */
    async emitAsync(event, data) {
        const promises = [];

        const listeners = this._listeners.get(event);
        if (listeners) {
            for (const callback of listeners) {
                promises.push(
                    Promise.resolve().then(() => callback(data))
                        .catch(error => {
                        })
                );
            }
        }

        const onceListeners = this._onceListeners.get(event);
        if (onceListeners) {
            for (const callback of onceListeners) {
                promises.push(
                    Promise.resolve().then(() => callback(data))
                        .catch(error => {
                        })
                );
            }
            this._onceListeners.delete(event);
        }

        await Promise.all(promises);
    }

    /**
     * 检查是否有监听器
     * @param {string} event 事件名称
     * @returns {boolean}
     */
    hasListeners(event) {
        const listeners = this._listeners.get(event);
        const onceListeners = this._onceListeners.get(event);
        return (listeners && listeners.size > 0) || (onceListeners && onceListeners.size > 0);
    }

    /**
     * 获取监听器数量
     * @param {string} event 事件名称
     * @returns {number}
     */
    listenerCount(event) {
        let count = 0;
        const listeners = this._listeners.get(event);
        if (listeners) count += listeners.size;
        const onceListeners = this._onceListeners.get(event);
        if (onceListeners) count += onceListeners.size;
        return count;
    }

    /**
     * 清除特定事件的所有监听器
     * @param {string} event 事件名称
     */
    removeAllListeners(event) {
        if (event) {
            this._listeners.delete(event);
            this._onceListeners.delete(event);
        } else {
            this.clear();
        }
    }

    /**
     * 清除所有监听器
     */
    clear() {
        this._listeners.clear();
        this._onceListeners.clear();
    }

    /**
     * 获取所有已注册的事件名称
     * @returns {string[]}
     */
    eventNames() {
        const names = new Set([
            ...this._listeners.keys(),
            ...this._onceListeners.keys(),
        ]);
        return Array.from(names);
    }
}

// 预定义事件类型常量
export const EventTypes = {
    // 模块生命周期
    MODULE_REGISTERED: 'module:registered',
    MODULE_READY: 'module:ready',
    MODULE_CLEANUP: 'module:cleanup',

    // 标签超市
    TAG_UI_OPEN: 'tag-ui:open',
    TAG_UI_CLOSE: 'tag-ui:close',
    TAG_SELECTED: 'tag:selected',
    TAG_BATCH_SUBMIT: 'tag:batch-submit',
    TAG_DATA_UPDATED: 'tag:data-updated',

    // 角色数据库
    CHARACTER_DB_OPEN: 'character-db:open',
    CHARACTER_DB_CLOSE: 'character-db:close',
    CHARACTER_SAVED: 'character:saved',
    CHARACTER_DELETED: 'character:deleted',
    CHARACTER_DATA_CHANGED: 'character:data-changed',
    CHARACTER_APPLIED: 'character:applied',

    // 提示词构建器 (联动核心)
    PROMPT_UPDATED: 'prompt:updated',
    PROMPT_CLEARED: 'prompt:cleared',
    PROMPT_SUBMIT: 'prompt:submit',
    PROMPT_GENERATE: 'prompt:generate',
    PROMPT_PREVIEW_OPEN: 'prompt:preview-open',
    PROMPT_CHARACTER_APPLIED: 'prompt:character-applied',
    PROMPT_PRESET_APPLIED: 'prompt:preset-applied',

    // 图像生成
    IMAGE_GEN_START: 'image-gen:start',
    IMAGE_GEN_COMPLETE: 'image-gen:complete',
    IMAGE_GEN_ERROR: 'image-gen:error',
    IMAGE_GEN_PROGRESS: 'image-gen:progress',

    // AI 处理
    AI_PROCESS_START: 'ai-process:start',
    AI_PROCESS_COMPLETE: 'ai-process:complete',
    AI_BATCH_START: 'ai-batch:start',
    AI_BATCH_COMPLETE: 'ai-batch:complete',

    // 设置
    SETTINGS_CHANGED: 'settings:changed',
    SETTINGS_SAVED: 'settings:saved',

    // UI
    FAB_OPEN: 'fab:open',
    FAB_CLOSE: 'fab:close',
    MODAL_OPEN: 'modal:open',
    MODAL_CLOSE: 'modal:close',

    // 三击检测
    TRIPLE_CLICK_DETECTED: 'triple-click:detected',

    // 手机模拟器
    PHONE_CHAT_OPEN: 'phone:chat-open',
    PHONE_CHAT_MESSAGE_RECEIVED: 'phone:chat-message-received',
    PHONE_CHAT_RENDER_BUTTONS: 'phone:chat-render-buttons',
    PHONE_CHAT_MESSAGES_LOADED: 'phone:chat-messages-loaded',
    PHONE_MESSAGE_LIMIT_CHANGED: 'phone:message-limit-changed',
    PHONE_WALLPAPER_CHANGED: 'phone:wallpaper-changed',
    PHONE_USER_SETTINGS_CHANGED: 'phone:user-settings-changed',

    // 朋友圈
    PHONE_MOMENTS_OPEN: 'phone:moments-open',
    PHONE_MOMENTS_LOADED: 'phone:moments-loaded',
    PHONE_MOMENTS_RENDER_BUTTONS: 'phone:moments-render-buttons',
    PHONE_MOMENTS_LIMIT_CHANGED: 'phone:moments-limit-changed',
    PHONE_MOMENTS_BACK_TO_CHAT_MANAGEMENT: 'phone:moments-back-to-chat-management',
    PHONE_MOMENTS_BACK_TO_CONTACT_SETTINGS: 'phone:moments-back-to-contact-settings',

    // 论坛
    PHONE_FORUM_OPEN: 'phone:forum-open',
    PHONE_FORUM_LOADED: 'phone:forum-loaded',
    PHONE_FORUM_RENDER_BUTTONS: 'phone:forum-render-buttons',

    // 剧情百科
    PHONE_MINUTES_RENDER_BUTTONS: 'phone:minutes-render-buttons',

    // 直播页面
    PHONE_LIVESTREAMING_RENDER_TAGS: 'phone:livestreaming-render-tags',
};

