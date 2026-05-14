'use strict';

import { PhoneChatStorage } from '../db/chat-storage.js';
import { PhoneServerStorage } from '../db/server-storage.js';
import { PhoneMemeStorage } from '../db/meme-storage.js';
import { PhoneAIRequest } from '../api/ai-request.js';
import { PhoneContentFilter } from '../api/content-filter.js';
import { PhoneHomeUI } from '../ui/phone-home.js';
import { PhoneMessageUI } from '../ui/phone-message.js';
import { PhoneSettingsUI } from '../ui/phone-settings.js';
import { PhoneMusicUI } from '../ui/phone-music.js';
import { PhoneMapUI } from '../ui/phone-map.js';
import { PhoneNovelUI } from '../ui/phone-novel.js';
import { PhoneRemakeUI } from '../ui/phone-remake.js';
import { PhoneKeepaliveUI } from '../ui/phone-keepalive.js';
import { PhoneMinutesUI } from '../ui/phone-minutes.js';
import { PhoneLivestreamingUI } from '../ui/phone-livestreaming.js';
import { PhoneGomokuUI } from '../ui/phone-gomoku.js';
import { PhoneVirtualPetUI } from '../ui/phone-virtualpet.js';

export class PhoneEmulator {
    constructor(context) {
        this.ctx = context;

        this.chatStorage = new PhoneChatStorage(context);
        this.serverStorage = new PhoneServerStorage(context);
        this.memeStorage = new PhoneMemeStorage(context);
        this.aiRequest = new PhoneAIRequest(context);
        this.contentFilter = new PhoneContentFilter(context);

        this.aiRequest.setChatStorage(this.chatStorage);
        this.aiRequest.setMemeStorage(this.memeStorage);

        this.fabButton = null;
        this.modalOverlay = null;
        this.phoneContainer = null;

        this.currentView = 'home';
        this.currentContact = null;
        this.currentCharacter = null;

        this.contacts = [];
        this.messages = [];

        this.apiConfig = null;

        this.homeUI = null;
        this.messageUI = null;
        this.settingsUI = null;
        this.musicUI = null;
        this.mapUI = null;
        this.novelUI = null;
        this.remakeUI = null;
        this.keepaliveUI = null;
        this.minutesUI = null;
        this.livestreamingUI = null;
        this.virtualpetUI = null;

        this.timeConfig = null;
        this.timeElement = null;

        this._position = { x: 15, y: '65%' };
        this._resizeObserver = null;
        this.isDragging = false;
        this._suppressNextClick = false;
        this.longPressTimer = null;
        this.isLongPressTriggered = false;
        
        this.isChatOpen = false;
        this.currentChatContactId = null;
    }

    async init() {
        this.ctx.log('phone-emulator', '初始化手机模拟器');

        await this.chatStorage.init();
        await this.serverStorage.init();
        await this.memeStorage.init();
        await this.aiRequest.init();
        await this.contentFilter.init();

        await this._loadAPIConfig();
        await this._loadTimeConfig();
        await this._loadImageModeConfig();

        this._createFabButton();
        await this._loadPosition();
        this._applyPosition();
        this.fabButton.style.transition = 'transform 0.2s ease';
        this._initResizeObserver();
        this._createModal();

        // 初始化其他UI模块
        this.homeUI = new PhoneHomeUI(this.ctx, this.phoneContainer, this.chatStorage);
        this.contentFilter.setMemeStorage(this.memeStorage);
        this.messageUI = new PhoneMessageUI(this.ctx, this.phoneContainer, this.chatStorage, this.aiRequest, this.contentFilter, this.serverStorage, this.memeStorage, (isOpen, contactId) => {
                this.isChatOpen = isOpen;
                this.currentChatContactId = contactId;
            });
        this.settingsUI = new PhoneSettingsUI(this.ctx, this.phoneContainer, this.chatStorage, this.aiRequest, this.contentFilter, this.memeStorage, this.serverStorage);
        this.musicUI = new PhoneMusicUI(this.ctx, this.phoneContainer);
        this.mapUI = new PhoneMapUI(this.ctx, this.phoneContainer, this.chatStorage, this.aiRequest);
        this.novelUI = new PhoneNovelUI(this.ctx, this.phoneContainer, this.chatStorage, this.aiRequest);
        this.remakeUI = new PhoneRemakeUI(this.ctx, this.phoneContainer, this.aiRequest);
        this.keepaliveUI = new PhoneKeepaliveUI(this.ctx, this.phoneContainer);
        this.livestreamingUI = new PhoneLivestreamingUI(this.ctx, this.phoneContainer, this.chatStorage, this.aiRequest);

        // 初始化剧情百科UI模块
        this.minutesUI = new PhoneMinutesUI(this.ctx, this.phoneContainer, this.chatStorage, this.aiRequest);

        // 初始化云宠物UI模块
        this.virtualpetUI = new PhoneVirtualPetUI(this.ctx, this.phoneContainer, this.chatStorage, this.aiRequest, () => ({
            isChatOpen: this.isChatOpen,
            currentChatContactId: this.currentChatContactId
        }));

        // 绑定回调
        this.homeUI.setAppOpenCallback((appName) => {
            this._openApp(appName);
        });

        this.messageUI.setBackToHomeCallback(() => {
            this.homeUI.renderHomeScreen();
            this._updateStatusBarColor('dark');
        });

        this.settingsUI.setBackToHomeCallback(() => {
            this.homeUI.renderHomeScreen();
            this._updateStatusBarColor('dark');
        });

        this.musicUI.setBackToHomeCallback(() => {
            this.homeUI.renderHomeScreen();
            this._updateStatusBarColor('dark');
        });

        this.messageUI.forumUI.setBackToHomeCallback(() => {
            this.homeUI.renderHomeScreen();
            this._updateStatusBarColor('dark');
        });

        this.mapUI.setBackCallback(() => {
            this.homeUI.renderHomeScreen();
            this._updateStatusBarColor('dark');
        });

        this.novelUI.setBackToHomeCallback(() => {
            this.homeUI.renderHomeScreen();
            this._updateStatusBarColor('dark');
        });

        this.remakeUI.setBackToHomeCallback(() => {
            this.homeUI.renderHomeScreen();
            this._updateStatusBarColor('dark');
        });

        this.keepaliveUI.setBackToHomeCallback(() => {
            this.homeUI.renderHomeScreen();
            this._updateStatusBarColor('dark');
        });

        this.minutesUI.setBackToHomeCallback(() => {
            this.homeUI.renderHomeScreen();
            this._updateStatusBarColor('dark');
        });

        this.livestreamingUI.setBackToHomeCallback(() => {
            this.homeUI.renderHomeScreen();
            this._updateStatusBarColor('dark');
        });

        this.virtualpetUI.setBackToHomeCallback(() => {
            this.homeUI.renderHomeScreen();
            this._updateStatusBarColor('dark');
        });

        // 初始化剧情百科悬浮球（同步执行，确保收纳盒能正确加载已保存的悬浮球）
        await this.minutesUI.init();
        this.ctx.log('phone-emulator', '剧情百科UI初始化完成');

        // 初始化云宠物UI
        await this.virtualpetUI.init();
        this.ctx.log('phone-emulator', '云宠物UI初始化完成');

        this._listenCharacterChange();

        this.ctx.log('phone-emulator', '手机模拟器初始化完成');
    }



    async _loadAPIConfig() {
        try {
            await this.chatStorage.loadPhoneConfigFromServer();

            const activeConfigId = await this.chatStorage.getActiveApiConfigId();
            if (activeConfigId) {
                const config = await this.chatStorage.getAPIConfig(activeConfigId);
                if (config) {
                    this.apiConfig = config;
                    this.ctx.log('phone-emulator', `已加载API配置: ${activeConfigId}`);
                }
            }
        } catch (e) {
            this.ctx.error('phone-emulator', '加载API配置失败:', e);
        }
    }

    async _loadTimeConfig() {
        try {
            const config = await this.chatStorage.getTimeConfig('default');
            if (config) {
                this.timeConfig = config;
                this.ctx.log('phone-emulator', `已加载时间配置: 自定义=${config.useCustomTime}, 时间=${config.customTime || '未设置'}`);
            } else {
                this.timeConfig = {
                    useCustomTime: false,
                    customTime: null,
                };
            }
        } catch (e) {
            this.ctx.error('phone-emulator', '加载时间配置失败:', e);
            this.timeConfig = {
                useCustomTime: false,
                customTime: null,
            };
        }
    }

    async _loadImageModeConfig() {
        try {
            await this.aiRequest.updateImageModeConfig();
            this.ctx.log('phone-emulator', '已加载图片模式配置');
        } catch (e) {
            this.ctx.error('phone-emulator', '加载图片模式配置失败:', e);
        }
    }

    _getCurrentTime() {
        if (this.timeConfig && this.timeConfig.useCustomTime && this.timeConfig.customTime) {
            return this.timeConfig.customTime;
        }
        const now = new Date();
        const hours = String(now.getHours()).padStart(2, '0');
        const minutes = String(now.getMinutes()).padStart(2, '0');
        return `${hours}:${minutes}`;
    }

    _updateTimeDisplay() {
        if (this.timeElement) {
            this.timeElement.textContent = this._getCurrentTime();
        }
    }

    _createFabButton() {
        const fab = document.createElement('button');
        fab.className = 'tsp-phone-fab';
        fab.innerHTML = '<i class="fas fa-mobile-alt"></i>';
        fab.title = '打开手机模拟器';
        fab.style.position = 'fixed';

        fab.addEventListener('click', (e) => {
            e.stopPropagation();
            e.preventDefault();

            if (this.isLongPressTriggered || this._suppressNextClick) {
                this._suppressNextClick = false;
                this.isLongPressTriggered = false;
                return;
            }

            if (this.isDragging) {
                this.isDragging = false;
                return;
            }

            this.openModal();
            this.isDragging = false;
        });

        let startX, startY, initialX, initialY;

        const handleStart = (clientX, clientY) => {
            this.isDragging = false;
            this.isLongPressTriggered = false;
            startX = clientX;
            startY = clientY;

            const rect = this.fabButton.getBoundingClientRect();
            initialX = rect.left;
            initialY = rect.top;

            this.fabButton.style.transition = 'none';

            if (this.longPressTimer) clearTimeout(this.longPressTimer);
            this.longPressTimer = setTimeout(() => {
                this.isLongPressTriggered = true;
                this.isDragging = false;
            }, 600);
        };

        const handleMove = (clientX, clientY) => {
            if (this.isLongPressTriggered) return;

            const deltaX = clientX - startX;
            const deltaY = clientY - startY;

            if (Math.abs(deltaX) > 5 || Math.abs(deltaY) > 5) {
                this.isDragging = true;
                if (this.longPressTimer) {
                    clearTimeout(this.longPressTimer);
                    this.longPressTimer = null;
                }
                this.fabButton.classList.add('dragging');
            }

            if (this.isDragging) {
                const newX = initialX + deltaX;
                const newY = initialY + deltaY;
                this._position = { x: newX, y: newY };
                this._applyPosition();
            }
        };

        const handleEnd = () => {
            if (this.longPressTimer) {
                clearTimeout(this.longPressTimer);
                this.longPressTimer = null;
            }
            this.fabButton.classList.remove('dragging');
            this.fabButton.style.transition = 'transform 0.2s ease';
        };

        fab.addEventListener('mousedown', (e) => {
            if (e.button !== 0) return;
            e.stopPropagation();
            handleStart(e.clientX, e.clientY);

            const onMouseMove = (ev) => {
                ev.preventDefault();
                handleMove(ev.clientX, ev.clientY);
            };

            const onMouseUp = () => {
                document.removeEventListener('mousemove', onMouseMove);
                document.removeEventListener('mouseup', onMouseUp);
                handleEnd();
                if (this.isDragging) this._savePosition();
            };

            document.addEventListener('mousemove', onMouseMove);
            document.addEventListener('mouseup', onMouseUp);
        });

        fab.addEventListener('touchstart', (e) => {
            e.stopPropagation();
            e.preventDefault();
            const touch = e.touches[0];
            if (!touch) return;

            this._suppressNextClick = true;
            handleStart(touch.clientX, touch.clientY);

            const onTouchMove = (ev) => {
                const t = ev.touches[0];
                if (!t) return;
                if ((this.isDragging || Math.abs(t.clientX - startX) > 5) && !this.isLongPressTriggered) {
                    ev.preventDefault();
                }
                handleMove(t.clientX, t.clientY);
            };

            const onTouchEnd = () => {
                document.removeEventListener('touchmove', onTouchMove);
                document.removeEventListener('touchend', onTouchEnd);
                handleEnd();
                if (this.isDragging) {
                    this._savePosition();
                } else {
                    if (!this.isLongPressTriggered) {
                        this.openModal();
                    }
                }
            };

            document.addEventListener('touchmove', onTouchMove, { passive: false });
            document.addEventListener('touchend', onTouchEnd);
        }, { passive: false });

        document.body.appendChild(fab);
        this.fabButton = fab;
    }

    _createModal() {
        const overlay = document.createElement('div');
        overlay.className = 'tsp-phone-modal-overlay';

        overlay.innerHTML = `
            <div class="tsp-phone-container">
                <div class="tsp-phone-notch"></div>
                <button class="tsp-phone-close-btn" title="关闭">
                    <i class="fas fa-times"></i>
                </button>
                <div class="tsp-phone-status-bar">
                    <div class="tsp-phone-status-bar-left">
                        <span class="tsp-phone-status-time"></span>
                    </div>
                    <div class="tsp-phone-status-bar-right">
                        <i class="fas fa-signal tsp-phone-status-icon-svg"></i>
                        <i class="fas fa-wifi tsp-phone-status-icon-svg"></i>
                        <i class="fas fa-battery-three-quarters tsp-phone-status-icon-svg"></i>
                    </div>
                </div>
                <div class="tsp-phone-screen">
                    <div class="tsp-phone-home-screen" id="tsp-phone-home-screen"></div>
                </div>
            </div>
        `

        overlay.querySelector('.tsp-phone-close-btn').addEventListener('click', () => {
            this.closeModal();
        });

        document.body.appendChild(overlay);
        this.modalOverlay = overlay;
        this.phoneContainer = overlay.querySelector('.tsp-phone-container');

        this.timeElement = this.phoneContainer.querySelector('.tsp-phone-status-time');
        this._updateTimeDisplay();
        this._initTimeClickHandler();

        this._initDraggable();
    }

    _initTimeClickHandler() {
        if (!this.timeElement) return;

        this.timeElement.addEventListener('click', () => {
            this._showTimeSettings();
        });
    }

    _showTimeSettings() {
        const existingDialog = document.getElementById('tsp-time-settings-dialog');
        if (existingDialog) {
            existingDialog.remove();
        }

        const dialog = document.createElement('div');
        dialog.id = 'tsp-time-settings-dialog';
        dialog.className = 'tsp-time-settings-dialog';

        const useCustomTime = this.timeConfig?.useCustomTime || false;
        const customTime = this.timeConfig?.customTime || '12:00';

        dialog.innerHTML = `
            <div class="tsp-time-settings-content">
                <div class="tsp-time-settings-header">
                    <h3>时间设置</h3>
                    <button class="tsp-time-settings-close"><i class="fas fa-times"></i></button>
                </div>
                <div class="tsp-time-settings-body">
                    <div class="tsp-time-setting-item">
                        <label class="tsp-time-setting-label">
                            <input type="checkbox" id="tsp-use-custom-time" ${useCustomTime ? 'checked' : ''}>
                            <span>使用自定义时间</span>
                        </label>
                    </div>
                    <div class="tsp-time-setting-item">
                        <label class="tsp-time-setting-label">自定义时间</label>
                        <input type="time" id="tsp-custom-time-input" value="${customTime}" ${!useCustomTime ? 'disabled' : ''}>
                    </div>
                </div>
                <div class="tsp-time-settings-footer">
                    <button class="tsp-time-settings-btn tsp-time-settings-cancel">取消</button>
                    <button class="tsp-time-settings-btn tsp-time-settings-save">保存</button>
                </div>
            </div>
        `;

        document.body.appendChild(dialog);

        const useCustomTimeCheckbox = dialog.querySelector('#tsp-use-custom-time');
        const customTimeInput = dialog.querySelector('#tsp-custom-time-input');
        const closeBtn = dialog.querySelector('.tsp-time-settings-close');
        const cancelBtn = dialog.querySelector('.tsp-time-settings-cancel');
        const saveBtn = dialog.querySelector('.tsp-time-settings-save');

        useCustomTimeCheckbox.addEventListener('change', (e) => {
            customTimeInput.disabled = !e.target.checked;
        });

        const closeDialog = () => {
            dialog.remove();
        };

        closeBtn.addEventListener('click', closeDialog);
        cancelBtn.addEventListener('click', closeDialog);

        dialog.addEventListener('click', (e) => {
            if (e.target === dialog) {
                closeDialog();
            }
        });

        saveBtn.addEventListener('click', async () => {
            const newUseCustomTime = useCustomTimeCheckbox.checked;
            const newCustomTime = customTimeInput.value;

            this.timeConfig = {
                useCustomTime: newUseCustomTime,
                customTime: newUseCustomTime ? newCustomTime : null,
            };

            await this.chatStorage.saveTimeConfig(this.timeConfig);
            await this.chatStorage.savePhoneConfigToServer();

            this._updateTimeDisplay();
            this.ctx.log('phone-emulator', `时间配置已保存: 自定义=${newUseCustomTime}, 时间=${newCustomTime}`);
            this.ctx.helpers.showToast('✨ 时间设置已保存', 'success');

            closeDialog();
        });
    }

    _initDraggable() {
        const notch = this.phoneContainer.querySelector('.tsp-phone-notch');
        if (!notch) return;

        let isDragging = false;
        let startX, startY;
        let containerRect;
        let offsetX, offsetY;

        const handleStart = (clientX, clientY) => {
            isDragging = true;
            startX = clientX;
            startY = clientY;
            containerRect = this.phoneContainer.getBoundingClientRect();
            offsetX = clientX - containerRect.left;
            offsetY = clientY - containerRect.top;

            this.phoneContainer.style.transition = 'none';
            this.phoneContainer.style.cursor = 'grabbing';
            notch.style.cursor = 'grabbing';
        };

        const handleMove = (clientX, clientY) => {
            if (!isDragging) return;

            const deltaX = clientX - startX;
            const deltaY = clientY - startY;

            let newLeft = containerRect.left + deltaX;
            let newTop = containerRect.top + deltaY;

            const viewportWidth = window.innerWidth;
            const viewportHeight = window.innerHeight;
            const containerWidth = containerRect.width;
            const containerHeight = containerRect.height;

            const minLeft = 0;
            const maxLeft = viewportWidth - containerWidth;
            const minTop = 0;
            const maxTop = viewportHeight - containerHeight;

            newLeft = Math.max(minLeft, Math.min(newLeft, maxLeft));
            newTop = Math.max(minTop, Math.min(newTop, maxTop));

            this.phoneContainer.style.position = 'fixed';
            this.phoneContainer.style.left = `${newLeft}px`;
            this.phoneContainer.style.top = `${newTop}px`;
            this.phoneContainer.style.transform = 'none';
        };

        const handleEnd = () => {
            if (!isDragging) return;
            isDragging = false;
            this.phoneContainer.style.transition = 'transform 0.3s ease';
            this.phoneContainer.style.cursor = '';
            notch.style.cursor = 'move';
        };

        notch.addEventListener('mousedown', (e) => {
            e.preventDefault();
            handleStart(e.clientX, e.clientY);
        });

        notch.addEventListener('touchstart', (e) => {
            e.preventDefault();
            const touch = e.touches[0];
            handleStart(touch.clientX, touch.clientY);
        }, { passive: false });

        document.addEventListener('mousemove', (e) => {
            handleMove(e.clientX, e.clientY);
        });

        document.addEventListener('touchmove', (e) => {
            if (isDragging) {
                e.preventDefault();
                const touch = e.touches[0];
                handleMove(touch.clientX, touch.clientY);
            }
        }, { passive: false });

        document.addEventListener('mouseup', handleEnd);
        document.addEventListener('touchend', handleEnd);
    }

    _listenCharacterChange() {
        const win = window;

        let switchDebounceTimer = null;

        const runWhenIdle = (cb, timeout = 2000) => {
            if ('requestIdleCallback' in window) {
                window.requestIdleCallback(cb, { timeout });
            } else {
                setTimeout(cb, 50);
            }
        };

        const cleanupBeforeSwitch = () => {
            this.ctx.log('phone-emulator', '[角色卡切换] 开始清理旧资源');

            this.currentContact = null;
            this.messages = [];
            this.contacts = [];

            if (this.mapUI) {
                this.mapUI.currentMapData = null;
            }

            if (this.novelUI) {
                this.novelUI.novelData = null;
                this.novelUI.generatedBooks = [];
            }

            if (this.livestreamingUI) {
                this.livestreamingUI.livestreamingData = null;
                this.livestreamingUI.generatedRooms = [];
            }

            this.ctx.log('phone-emulator', '[角色卡切换] 旧资源清理完成');
        };

        const trySetupListener = (retryCount = 0) => {
            let eventSource = null;
            if (typeof win.SillyTavern !== 'undefined' && typeof win.SillyTavern.getContext === 'function') {
                try {
                    const ctx = win.SillyTavern.getContext();
                    eventSource = ctx?.eventSource;
                } catch (e) {}
            }
            if (!eventSource) eventSource = win.eventSource;

            if (!eventSource) {
                if (retryCount < 20) {
                    setTimeout(() => trySetupListener(retryCount + 1), 1000);
                }
                return;
            }

            eventSource.on('chatLoaded', async (event) => {
                if (switchDebounceTimer) clearTimeout(switchDebounceTimer);

                const eventDetail = event?.detail || event;
                const characterFromEvent = eventDetail?.character?.name || eventDetail?.character;

                switchDebounceTimer = setTimeout(async () => {
                    let characterName = this._getCurrentCharacterName();
                    if (!characterName && characterFromEvent) {
                        characterName = this.chatStorage._sanitizeCharacterName(characterFromEvent);
                    }

                    if (!characterName) return;

                    if (characterName === this.currentCharacter) {
                        this.ctx.log('phone-emulator', `[角色卡切换] 角色卡未变化: ${characterName}`);
                        // 同个角色卡切换聊天时，也要重新映射关系数据到世界书
                        await this.minutesUI.onChatSwitch();
                        return;
                    }

                    cleanupBeforeSwitch();

                    runWhenIdle(async () => {
                        this.ctx.log('phone-emulator', `[角色卡切换] 开始加载角色卡数据: ${characterName}`);

                        this.currentCharacter = characterName;

                        await this.chatStorage.switchCharacter(characterName);

                        const loadedContacts = await this.chatStorage.getContacts();
                        this.contacts = loadedContacts;
                        this.ctx.log('phone-emulator', `[角色卡切换] 已加载 ${loadedContacts.length} 个联系人`);

                        this.messageUI.setCurrentCharacter(characterName);
                        this.settingsUI.setCurrentCharacter(characterName);
                        this.novelUI.setCurrentCharacter(characterName);
                        this.minutesUI.setCurrentCharacter(characterName);
                        this.livestreamingUI.setCurrentCharacter(characterName);
                        await this.messageUI.setContacts(loadedContacts);

                        // 切换聊天后重新映射关系数据到世界书
                        await this.minutesUI.onChatSwitch();

                        await this.novelUI.loadNovelData();
                        if (this.novelUI.novelData && this.novelUI.novelData.books) {
                            this.ctx.log('phone-emulator', `[角色卡切换] 已加载 ${this.novelUI.novelData.books.length} 本小说`);
                        }

                        await this.livestreamingUI.loadLivestreamingData();
                        if (this.livestreamingUI.livestreamingData && this.livestreamingUI.livestreamingData.rooms) {
                            this.ctx.log('phone-emulator', `[角色卡切换] 已加载 ${this.livestreamingUI.livestreamingData.rooms.length} 个直播间`);
                        }

                        runWhenIdle(() => {
                            if (this.modalOverlay && this.modalOverlay.classList.contains('visible')) {
                                const chatList = document.getElementById('tsp-phone-chat-list');
                                if (chatList) {
                                    this.messageUI.loadAndRenderContacts();
                                } else {
                                    this.homeUI.renderHomeScreen();
                                }
                            }

                            setTimeout(() => {
                                if (loadedContacts.length > 0) {
                                    this.ctx.helpers.showToast(`✨ 已加载 ${loadedContacts.length} 个联系人`, 'success');
                                }
                            }, 0);

                            setTimeout(() => {
                                if (this.modalOverlay && this.modalOverlay.classList.contains('visible')) {
                                    const chatList = document.getElementById('tsp-phone-chat-list');
                                    if (chatList) {
                                        this.messageUI.loadAndRenderContacts();
                                    }
                                }
                            }, 3000);
                        });
                    });
                }, 2500);
            });

            this.ctx.log('phone-emulator', '已注册角色卡切换监听器');
        };

        setTimeout(() => trySetupListener(), 1000);
    }

    _getCurrentCharacterName() {
        try {
            if (typeof win.SillyTavern !== 'undefined' && typeof win.SillyTavern.getContext === 'function') {
                const ctx = win.SillyTavern.getContext();
                if (ctx && ctx.name2 && ctx.name2 !== 'System') {
                    return this.chatStorage._sanitizeCharacterName(ctx.name2);
                }
            }

            if (win.name2 && win.name2 !== 'System') {
                return this.chatStorage._sanitizeCharacterName(win.name2);
            }

            return null;
        } catch (e) {
            return null;
        }
    }

    openModal() {
        this.modalOverlay.classList.add('visible');
        this.homeUI.renderHomeScreen();
        this._updateStatusBarColor('dark');
    }

    closeModal() {
        this.musicUI.stopAudio();
        this.modalOverlay.classList.remove('visible');
    }

    _openApp(appName) {
        switch (appName) {
            case 'chat':
                this.messageUI.renderChatListView();
                this._updateStatusBarColor('dark');
                break;
            case 'forum':
                // 显示论坛摘要视图，包含发布者昵称和帖子标题
                this.messageUI.renderForumSummaryView();
                this._updateStatusBarColor('dark');
                break;
            case 'moments':
                this.messageUI.renderAllMomentsView();
                this._updateStatusBarColor('dark');
                break;
            case 'map':
                this.mapUI.renderMapScreen();
                this._updateStatusBarColor('dark');
                break;
            case 'music':
                this.musicUI.renderMusicSearch();
                this._updateStatusBarColor('dark');
                break;
            case 'novel':
                this.novelUI.renderNovelMainView();
                this._updateStatusBarColor('light');
                break;
            case 'settings':
                this.settingsUI.renderSettingsView();
                this._updateStatusBarColor('dark');
                break;
            case 'remake':
                this.remakeUI.render();
                this._updateStatusBarColor('light');
                break;
            case 'keepalive':
                this.keepaliveUI.render();
                this._updateStatusBarColor('dark');
                break;
            case 'minutes':
                this.minutesUI.render();
                this._updateStatusBarColor('dark');
                break;
            case 'livestreaming':
                this.livestreamingUI.renderLivestreamingMainView();
                this._updateStatusBarColor('dark');
                break;
            case 'virtualpet':
                this.virtualpetUI.renderSettings();
                this._updateStatusBarColor('dark');
                break;
        }
    }

    _updateStatusBarColor(mode) {
        const statusBar = this.phoneContainer.querySelector('.tsp-phone-status-bar');
        const timeElement = this.phoneContainer.querySelector('.tsp-phone-status-time');
        const icons = this.phoneContainer.querySelectorAll('.tsp-phone-status-icon-svg');

        if (mode === 'light') {
            timeElement.style.color = '#333333';
            icons.forEach(icon => {
                icon.style.color = '#333333';
            });
        } else {
            timeElement.style.color = 'white';
            icons.forEach(icon => {
                icon.style.color = 'white';
            });
        }
    }

    cleanup() {
        if (this._resizeObserver) {
            this._resizeObserver.disconnect();
            this._resizeObserver = null;
        }
        if (this.fabButton) {
            this.fabButton.remove();
        }
        if (this.modalOverlay) {
            this.modalOverlay.remove();
        }
        if (this.minutesUI) {
            this.minutesUI.cleanup();
        }
        if (this.virtualpetUI) {
            this.virtualpetUI.cleanup();
        }
        this.chatStorage.cleanup();
    }

    _getViewportSize() {
        const doc = document.documentElement;
        return {
            width: doc.clientWidth,
            height: doc.clientHeight
        };
    }

    _initResizeObserver() {
        this._resizeObserver = new ResizeObserver(() => {
            requestAnimationFrame(() => {
                this._ensureVisible();
            });
        });
        this._resizeObserver.observe(document.body);
    }

    _ensureVisible() {
        if (!this.fabButton) return;

        const { width: vw, height: vh } = this._getViewportSize();
        const rect = this.fabButton.getBoundingClientRect();
        const isMobile = vw <= 900;

        if (isMobile) {
            const targetX = vw * 0.05;
            const targetY = vh * 0.65;
            this._position = { x: targetX, y: targetY };
            this._applyPosition();
            this.fabButton.style.transition = 'transform 0.2s ease';
            return;
        }

        let newX = this._position.x;
        let newY = this._position.y;
        let changed = false;

        if (typeof newY === 'string' && newY.includes('%')) {
            newY = (vh * parseFloat(newY)) / 100;
        }

        if (newX + rect.width > vw) {
            newX = vw - rect.width - 10;
            changed = true;
        }
        if (newY + rect.height > vh) {
            newY = vh - rect.height - 10;
            changed = true;
        }
        if (newX < 0) { newX = 10; changed = true; }
        if (newY < 0) { newY = 10; changed = true; }

        if (changed) {
            this._position = { x: newX, y: newY };
            this._applyPosition();
            this.fabButton.style.transition = 'transform 0.2s ease';
        }
    }

    async _loadPosition() {
        const { width: vw, height: vh } = this._getViewportSize();
        const isMobile = vw <= 900;

        if (isMobile) {
            this._position = {
                x: vw * 0.05,
                y: vh * 0.65
            };
            return;
        }

        try {
            const saved = await this.ctx.api.getValue('phone_fab_position', null);
            if (saved && saved.x !== undefined && saved.y !== undefined) {
                this._position = saved;
            } else {
                this._position = { x: 15, y: '65%' };
            }
        } catch (e) {
            this.ctx.error('phone-emulator', '加载位置失败:', e);
            this._position = { x: 15, y: '65%' };
        }
    }

    async _savePosition() {
        try {
            await this.ctx.api.setValue('phone_fab_position', this._position);
            this.fabButton.style.transition = 'transform 0.2s ease';
        } catch (e) {
            this.ctx.error('phone-emulator', '保存位置失败:', e);
        }
    }

    _applyPosition() {
        if (!this.fabButton) return;

        this.fabButton.style.transition = 'none';

        if (typeof this._position.y === 'string' && this._position.y.includes('%')) {
            this.fabButton.style.left = `${this._position.x}px`;
            this.fabButton.style.top = this._position.y;
            this.fabButton.style.transform = 'translateY(-50%)';
        } else {
            this.fabButton.style.left = `${this._position.x}px`;
            this.fabButton.style.top = `${this._position.y}px`;
            this.fabButton.style.transform = 'none';
        }
    }
}
