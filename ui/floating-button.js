'use strict';
import { StoreNames } from '../core/db-manager.js';

import { EventTypes } from '../core/event-bus.js';

export class FloatingButton {
    constructor(context) {
        this.ctx = context;
        this.container = null;
        this.isOpen = false;
        this.isDragging = false;
        this._suppressNextClick = false;

        this._position = { x: 15, y: '50%' };
        this._resizeObserver = null;
        // --- 新增：长按与快速换肤相关变量 ---
        this.longPressTimer = null;
        this.isLongPressTriggered = false;
        this.quickStylePage = 1;
        this.quickStylePerPage = 30; // 每页30个
        this.quickStyleObserver = null; // 独立观察器
        this.allPresetsCache = []; // 缓存预设数据
    }

    async init() {
        if (this.initCalled) return;
        this.initCalled = true;

        // 延迟创建DOM元素，避免在初始化阶段占用过多资源
        setTimeout(async () => {
            this.ctx.log('floating-button', '初始化');

            // 1. 初始化 DOM
            this.create();

            // ================== [修复开始] ==================
            // 读取保存的设置，如果设置为不显示，则立即隐藏
            const isVisible = await this.ctx.api.getValue('fab_visible', true);
            if (!isVisible && this.container) {
                this.container.style.display = 'none';
            }
            // ================== [修复结束] ==================

            // 2. 加载位置 (包含手机端强制重置逻辑)
            await this.loadPosition();

            // 3. 应用位置
            this.applyPosition();

            // 4. 绑定交互事件
            this.bindEvents();

            // 5. 初始化尺寸观察器 (替代 window.onresize)
            this._initResizeObserver();

            this.ctx.log('floating-button', '初始化完成');
        }, 500); // 500ms延迟，给浏览器足够时间处理其他初始化任务
    }

    async cleanup() {
        // 清理观察器
        if (this._resizeObserver) {
            this._resizeObserver.disconnect();
            this._resizeObserver = null;
        }

        if (this._outsideClickHandler) {
            document.removeEventListener('click', this._outsideClickHandler, true);
            this._outsideClickHandler = null;
        }

        if (this.container) {
            this.container.remove();
        }
    }

    /**
     * [修改] 获取视口尺寸 (不依赖 window)
     */
    _getViewportSize() {
        const doc = document.documentElement;
        return {
            width: doc.clientWidth,
            height: doc.clientHeight
        };
    }

    /**
     * [修改] 初始化 ResizeObserver
     */
    _initResizeObserver() {
        this._resizeObserver = new ResizeObserver((entries) => {
            // 使用 requestAnimationFrame 避免频繁触发布局计算
            requestAnimationFrame(() => {
                this._ensureVisible();
            });
        });

        this._resizeObserver.observe(document.body);
    }

    /**
     *  确保按钮在可视区域内，且处理手机端重置
     */
    _ensureVisible() {
        if (!this.container) return;

        const { width: vw, height: vh } = this._getViewportSize();
        const rect = this.container.getBoundingClientRect();

        const isMobile = vw <= 900;

        // --- 手机端强制重置逻辑 ---
        // 逻辑：如果是手机模式，并且没有进行过拖拽交互（或为了防止跑偏），强制归位
        // 这里采用“只要是手机端改变尺寸，就检查是否偏离太远”的策略
        if (isMobile) {
            // 设定目标：左侧 5vw, 高度 55vh
            const targetX = vw * 0.05;
            const targetY = vh * 0.55;

            // 如果当前位置和目标位置偏差过大（比如因为旋转屏幕），则重置
            // 或者如果之前从未设置过位置
            this._position = { x: targetX, y: targetY };
            this.applyPosition();
            return;
        }

        // --- PC端边界限制逻辑 ---
        let newX = this._position.x;
        let newY = this._position.y;
        let changed = false;

        // 如果 y 是百分比字符串（初始默认值），先转换为像素进行计算
        if (typeof newY === 'string' && newY.includes('%')) {
            newY = (vh * parseFloat(newY)) / 100;
        }

        // 右边界检查
        if (newX + rect.width > vw) {
            newX = vw - rect.width - 10;
            changed = true;
        }
        // 下边界检查
        if (newY + rect.height > vh) {
            newY = vh - rect.height - 10;
            changed = true;
        }
        // 左/上边界检查
        if (newX < 0) { newX = 10; changed = true; }
        if (newY < 0) { newY = 10; changed = true; }

        if (changed) {
            this._position = { x: newX, y: newY };
            this.applyPosition();
        }
    }

    /**
     * [修改] 加载位置
     */
    async loadPosition() {
        const { width: vw, height: vh } = this._getViewportSize();
        const isMobile = vw <= 900;

        // --- 核心修复：手机端每次初始化都强制重置 ---
        if (isMobile) {
            // 参考你提供的 Tampermonkey 参数: left: 5vw, top: 55vh
            this._position = {
                x: vw * 0.05,
                y: vh * 0.55
            };
            // 不读取 API 保存的值，强制使用默认值
            // this.ctx.log('floating-button', '移动端检测：强制重置位置');
            return;
        }

        // --- PC端：尝试读取保存的位置 ---
        try {
            const saved = await this.ctx.api.getValue('fab_position', null);
            if (saved && saved.x !== undefined && saved.y !== undefined) {
                this._position = saved;
            } else {
                // 默认位置
                this._position = { x: 15, y: '50%' };
            }
        } catch (e) {
            this.ctx.error('floating-button', '加载位置失败:', e);
            this._position = { x: 15, y: '50%' };
        }
    }

    async savePosition() {
        try {
            await this.ctx.api.setValue('fab_position', this._position);
        } catch (e) {
            this.ctx.error('floating-button', '保存位置失败:', e);
        }
    }

    create() {
        const container = document.createElement('div');
        container.id = 'tsp-fab-container';
        container.className = 'tsp-fab-container';

        // 确保 CSS 不会受到外界干扰，设置必要的初始样式
        // 注意：z-index 已经在 styles/settings.css 中设置，这里只需处理动态位置
        container.style.position = 'fixed';

        container.innerHTML = `
            <div id="tsp-fab" class="tsp-fab" title="打开快捷菜单">
                <i class="fa-solid fa-layer-group"></i>
            </div>
            <div id="tsp-fab-menu" class="tsp-fab-menu">
                <div class="tsp-fab-menu-item" data-action="tag-market">
                    <i class="fa-solid fa-tags"></i>
                    <span>标签超市</span>
                </div>
                <div class="tsp-fab-menu-item" data-action="character-db">
                    <i class="fa-solid fa-users"></i>
                    <span>角色数据库</span>
                </div>
                <div class="tsp-fab-menu-item" data-action="ai-settings">
                    <i class="fa-solid fa-wand-magic-sparkles"></i>
                    <span>AI 二次处理</span>
                </div>
                <div class="tsp-fab-menu-item" data-action="settings">
                    <i class="fa-solid fa-gear"></i>
                    <span>设置</span>
                </div>
                <div class="tsp-fab-menu-item" data-action="prompt-preview">
                    <i class="fa-solid fa-eye"></i>
                    <span>提示词预览</span>
                </div>
                <div class="tsp-fab-menu-item tsp-fab-menu-divider"></div>
                <div class="tsp-fab-menu-item" data-action="close" style="color: var(--tsp-accent-red);">
                    <i class="fa-solid fa-times"></i>
                    <span>关闭悬浮球</span>
                </div>
            </div>
        `;

        document.body.appendChild(container);
        this.container = container;
    }

    applyPosition() {
        if (!this.container) return;

        // 如果是百分比字符串（PC端默认），使用 transform 居中
        if (typeof this._position.y === 'string' && this._position.y.includes('%')) {
            this.container.style.left = `${this._position.x}px`;
            this.container.style.top = this._position.y;
            this.container.style.transform = 'translateY(-50%)';
        } else {
            // 绝对像素数值（移动端或拖拽后）
            this.container.style.left = `${this._position.x}px`;
            this.container.style.top = `${this._position.y}px`;
            this.container.style.transform = 'none'; // 移除 transform，防止定位冲突
        }
    }
    /**
     *  创建可供<img>标签显示的URL (兼容Blob, dataURL, 路径)
     * 解决 Blob 对象无法直接作为 src 的问题
     */
    _createDisplayUrl(source) {
        if (!source) return null;

        // 1. 如果是 Blob 对象，创建临时URL
        if (source instanceof Blob) {
            return URL.createObjectURL(source);
        }

        // 2. 如果是字符串 (dataURL 或 路径)，直接返回
        if (typeof source === 'string') {
            return source;
        }

        // 3. 其他情况返回null
        return null;
    }
    /**
     *  打开快速换肤模态框 (UI 修复版)
     */
    async _openQuickStyleModal() {
        // 1. 获取数据
        try {
            this.allPresetsCache = await this.ctx.db.getAll(StoreNames.PRESETS) || [];
            this.allPresetsCache.sort((a, b) => (a.sequence || 0) - (b.sequence || 0));
        } catch (e) {
            this.ctx.helpers.showToast('读取预设失败', 'error');
            return;
        }

        if (this.allPresetsCache.length === 0) {
            this.ctx.helpers.showToast('暂无预设数据', 'info');
            return;
        }

        // 2. 创建模态框 DOM
        const overlay = document.createElement('div');
        overlay.className = 'tsp-modal-overlay';
        overlay.style.display = 'flex';
        overlay.style.zIndex = '10005';

        // --- 修改开始：调整了 HTML 结构，增加了 footer ---
        overlay.innerHTML = `
            <div class="tsp-modal" style="width: 95vw; max-width: 1000px; height: 80vh; max-height: 800px; display:flex; flex-direction:column;">

                <!-- 头部 -->
                <div class="tsp-modal-header" style="flex-shrink: 0;">
                    <div class="tsp-modal-title"><i class="fa-solid fa-paintbrush"></i> 快速切换画风</div>
                    <button class="tsp-btn tsp-btn-icon close-modal"><i class="fa-solid fa-times"></i></button>
                </div>

                <!-- 中间滚动区：只放网格 -->
                <div class="tsp-modal-body" style="flex:1; overflow-y:auto; padding:10px; padding-bottom: 20px;">
                    <!-- 强制设置 height: auto 确保网格撑开 -->
                    <div id="quick-style-grid" class="tsp-preset-grid" style="height: auto !important; display: grid;"></div>
                </div>

                <!-- 底部固定区：放分页按钮 -->
                <div class="tsp-modal-footer" style="flex-shrink: 0; padding: 10px; display: flex; justify-content: center; background: var(--tsp-bg-tertiary); border-top: 1px solid var(--tsp-border);">
                    <div id="quick-style-pagination" class="tsp-pagination" style="margin: 0; padding: 0;"></div>
                </div>

            </div>
        `;
        // --- 修改结束 ---

        document.body.appendChild(overlay);

        requestAnimationFrame(() => overlay.classList.add('visible'));

        // 3. 绑定关闭事件
        const close = () => {
            overlay.classList.remove('visible');
            if(this.quickStyleObserver) {
                this.quickStyleObserver.disconnect();
                this.quickStyleObserver = null;
            }
            setTimeout(() => overlay.remove(), 200);
        };
        overlay.querySelector('.close-modal').addEventListener('click', close);
        overlay.addEventListener('click', (e) => {
            if(e.target === overlay) close();
        });

        // 4. 初始化懒加载观察器 (不变)
        this.quickStyleObserver = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                const img = entry.target;
                if (entry.isIntersecting) {
                    const realSrc = img.dataset.src;
                    if (realSrc && img.src !== realSrc) {
                        img.src = realSrc;
                        img.classList.add('loaded');
                    }
                } else {
                    const emptyImage = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
                    if (img.src && img.src !== emptyImage && img.classList.contains('loaded')) {
                        img.style.minHeight = img.clientHeight + 'px';
                        img.src = emptyImage;
                        img.classList.remove('loaded');
                    }
                }
            });
        }, { root: overlay.querySelector('.tsp-modal-body'), rootMargin: '100px' });

        // 5. 渲染第一页
        this.quickStylePage = 1;
        this._renderQuickPresetGrid(overlay, close);
    }

    /**
     *  渲染快速换肤网格
     */
    async _renderQuickPresetGrid(overlay, closeCallback) {
        const grid = overlay.querySelector('#quick-style-grid');
        const pagination = overlay.querySelector('#quick-style-pagination');
        if (!grid) return;

        // 获取当前激活的预设名称
        const imageGen = this.ctx.getModule('imageGen');
        const activePreset = imageGen?.settings?.activePresetName || '';

        // 分页计算
        const totalItems = this.allPresetsCache.length;
        const totalPages = Math.ceil(totalItems / this.quickStylePerPage);
        if (this.quickStylePage > totalPages) this.quickStylePage = totalPages;
        const startIndex = (this.quickStylePage - 1) * this.quickStylePerPage;
        const endIndex = Math.min(startIndex + this.quickStylePerPage, totalItems);

        const pageItems = this.allPresetsCache.slice(startIndex, endIndex);

        // 渲染卡片
        // 占位图
        const emptyImage = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

        // 读取预览图模式设置
        const previewMode = await this.ctx.api.getValue('preset_preview_mode', 'thumbnail');

        grid.innerHTML = pageItems.map(p => {
            const isActive = p.name === activePreset;
            // 样式处理
            const statusClass = isActive ? 'status-both' : ''; // 借用选中样式
            const checkMark = isActive ?
                `<div class="tsp-preset-check" style="background:var(--tsp-accent-green);"><i class="fa-solid fa-check"></i></div>` : '';

            // 图片源逻辑
            let displaySrc = emptyImage;
            let realSrc = null;

            if (previewMode === 'original') {
                realSrc = p.referenceImage || p.thumbnail;
            } else {
                realSrc = p.thumbnail || p.referenceImage;
            }

            let imgContent = `<div class="tsp-preset-placeholder">无预览图</div>`;
            if (realSrc) {
                // --- 关键修复：将 Blob 或其他源转换为可用的 URL ---
                const displayUrl = this._createDisplayUrl(realSrc);

                // 如果成功转换，则生成 img 标签
                if (displayUrl) {
                    imgContent = `<img class="tsp-lazy-img"
                                       src="${emptyImage}"
                                       data-src="${displayUrl}"
                                       style="object-fit:cover;width:100%;height:100%;">`;
                }
            }

            return `
                <div class="tsp-preset-card ${statusClass}" data-name="${p.name}">
                    ${checkMark}
                    <div class="tsp-preset-header-wrapper">
                        <span class="tsp-preset-title">${p.name}</span>
                    </div>
                    <div class="tsp-preset-img-container">
                        ${imgContent}
                    </div>
                </div>
            `;
        }).join('');

        // 注册观察器
        if (this.quickStyleObserver) {
            grid.querySelectorAll('.tsp-lazy-img').forEach(img => this.quickStyleObserver.observe(img));
        }

        // 绑定卡片点击事件 (切换画风)
        grid.querySelectorAll('.tsp-preset-card').forEach(card => {
            card.addEventListener('click', async () => {
                const name = card.dataset.name;
                if (!name) return;

                // 执行切换
                if (imageGen) {
                    imageGen.settings.activePresetName = name;
                    await imageGen.saveSettings();

                    this.ctx.helpers.showToast(`画风已切换为: ${name}`, 'success');

                    // 关闭模态框
                    closeCallback();
                }
            });
        });

        // 渲染分页器
        if (totalPages > 1) {
            pagination.innerHTML = `
                <button class="tsp-btn tsp-btn-sm" ${this.quickStylePage === 1 ? 'disabled' : ''} data-action="prev">上一页</button>
                <span class="tsp-page-info" style="margin:0 10px;">${this.quickStylePage} / ${totalPages}</span>
                <button class="tsp-btn tsp-btn-sm" ${this.quickStylePage === totalPages ? 'disabled' : ''} data-action="next">下一页</button>
            `;

            pagination.querySelector('[data-action="prev"]')?.addEventListener('click', () => {
                this.quickStylePage--;
                this._renderQuickPresetGrid(overlay, closeCallback);
            });
            pagination.querySelector('[data-action="next"]')?.addEventListener('click', () => {
                this.quickStylePage++;
                this._renderQuickPresetGrid(overlay, closeCallback);
            });
        } else {
            pagination.innerHTML = '';
        }
    }

    bindEvents() {
        const fab = this.container.querySelector('#tsp-fab');
        const menu = this.container.querySelector('#tsp-fab-menu');

        // 点击事件 (处理普通点击开菜单)
        fab.addEventListener('click', (e) => {
            e.stopPropagation();
            e.preventDefault();

            // 如果触发了长按，或者是触摸导致的额外点击，则阻止菜单弹出
            if (this.isLongPressTriggered || this._suppressNextClick) {
                this._suppressNextClick = false;
                this.isLongPressTriggered = false; // 重置
                return;
            }

            if (this.isDragging) {
                this.isDragging = false;
                return;
            }

            this.toggleMenu();
            this.isDragging = false;
        });

        // 统一处理拖拽逻辑的变量
        let startX, startY, initialX, initialY;

        // --- 鼠标/触摸 开始 (修改部分) ---
        const handleStart = (clientX, clientY) => {
            this.isDragging = false;
            this.isLongPressTriggered = false; // 重置长按标志
            startX = clientX;
            startY = clientY;

            const rect = this.container.getBoundingClientRect();
            initialX = rect.left;
            initialY = rect.top;

            //  启动长按计时器 (600ms)
            if (this.longPressTimer) clearTimeout(this.longPressTimer);
            this.longPressTimer = setTimeout(() => {
                this.isLongPressTriggered = true; // 标记为长按
                this.isDragging = false; // 禁止后续拖拽

                // 震动反馈 (如果设备支持)
                if (navigator.vibrate) navigator.vibrate(50);

                // 打开快速换肤 UI
                this._openQuickStyleModal();

            }, 600);
        };

        // --- 鼠标/触摸 移动 (修改部分) ---
        const handleMove = (clientX, clientY) => {
            const dx = clientX - startX;
            const dy = clientY - startY;

            // 设置一个小的阈值，防止误触
            if (Math.abs(dx) > 5 || Math.abs(dy) > 5) {
                //  如果移动了，取消长按计时器
                if (this.longPressTimer) {
                    clearTimeout(this.longPressTimer);
                    this.longPressTimer = null;
                }

                // 如果已经触发了长按，禁止移动
                if (this.isLongPressTriggered) return;

                this.isDragging = true;
                this.isOpen = false;
                this.container.classList.remove('open');
            }

            if (this.isDragging) {
                // ... 原有移动逻辑保持不变 ...
                let newX = initialX + dx;
                let newY = initialY + dy;
                const { width: vw, height: vh } = this._getViewportSize();
                const rect = this.container.getBoundingClientRect();
                const maxX = vw - rect.width;
                const maxY = vh - rect.height;
                newX = Math.max(0, Math.min(newX, maxX));
                newY = Math.max(0, Math.min(newY, maxY));
                this.container.style.left = `${newX}px`;
                this.container.style.top = `${newY}px`;
                this.container.style.transform = 'none';
                this._position = { x: newX, y: newY };
            }
        };

        // --- 鼠标/触摸 结束 (修改部分) ---
        const handleEnd = () => {
             // 鼠标/手指抬起，清除长按计时器
            if (this.longPressTimer) {
                clearTimeout(this.longPressTimer);
                this.longPressTimer = null;
            }
        };

        // --- 鼠标拖拽监听 ---
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

                handleEnd(); // 调用结束处理

                if (this.isDragging) this.savePosition();
            };

            document.addEventListener('mousemove', onMouseMove);
            document.addEventListener('mouseup', onMouseUp);
        });

        // --- 触摸拖拽监听 ---
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
                // 仅在拖拽或非长按状态阻止默认
                if ((this.isDragging || Math.abs(t.clientX - startX) > 5) && !this.isLongPressTriggered) {
                    ev.preventDefault();
                }
                handleMove(t.clientX, t.clientY);
            };

            const onTouchEnd = () => {
                document.removeEventListener('touchmove', onTouchMove);
                document.removeEventListener('touchend', onTouchEnd);

                handleEnd(); // 调用结束处理

                if (this.isDragging) {
                    this.savePosition();
                } else {
                    // 如果不是拖拽，也不是长按触发，才切换菜单
                    if (!this.isLongPressTriggered) {
                         this.toggleMenu();
                    }
                }
            };

            document.addEventListener('touchmove', onTouchMove, { passive: false });
            document.addEventListener('touchend', onTouchEnd);
        }, { passive: false });


        // 菜单项点击
        menu.querySelectorAll('.tsp-fab-menu-item').forEach(item => {
            item.addEventListener('click', (e) => {
                e.stopPropagation();
                e.preventDefault();

                const action = item instanceof HTMLElement ? item.dataset?.action : undefined;
                if (action === 'close') {
                    setTimeout(() => {
                        this.handleAction(action);
                        this.toggleMenu(false);
                    }, 10);
                } else {
                    this.handleAction(action);
                    setTimeout(() => {
                        this.toggleMenu(false);
                    }, 50);
                }
            });
        });

        // 外部点击关闭
        let clickOutsideTimeout = null;
        this._outsideClickHandler = (e) => {
            const target = e.target;
            if (this.container && this.container.contains(target)) {
                if (clickOutsideTimeout) clearTimeout(clickOutsideTimeout);
                return;
            }

            if (!this.isOpen) return;

            if (clickOutsideTimeout) clearTimeout(clickOutsideTimeout);
            clickOutsideTimeout = setTimeout(() => {
                if (this.isOpen && this.container && !this.container.contains(e.target)) {
                    this.toggleMenu(false);
                }
            }, 200);
        };
        document.addEventListener('click', this._outsideClickHandler, true);
    }

    toggleMenu(force = null) {
        this.isOpen = force !== null ? force : !this.isOpen;
        this.container.classList.toggle('open', this.isOpen);

        if (this.isOpen) {
            const fab = this.container.querySelector('#tsp-fab');
            const menu = this.container.querySelector('#tsp-fab-menu');
            const rect = fab.getBoundingClientRect();
            const { width: vw } = this._getViewportSize();

            // [修改] 使用视口宽度判断菜单展开方向
            if (rect.left > vw / 2) {
                menu.classList.add('open-left');
            } else {
                menu.classList.remove('open-left');
            }

            if (menu instanceof HTMLElement) {
                menu.style.pointerEvents = 'auto';
                menu.style.visibility = 'visible';
            }
        } else {
            const menu = this.container.querySelector('#tsp-fab-menu');
            if (menu instanceof HTMLElement) {
                setTimeout(() => {
                    if (!this.isOpen && menu) {
                        menu.style.pointerEvents = 'none';
                        menu.style.visibility = 'hidden';
                    }
                }, 200);
            }
        }
    }

    handleAction(action) {
        switch (action) {
            case 'tag-market':
                this.ctx.events.emit(EventTypes.TAG_UI_OPEN);
                break;
            case 'character-db':
                this.ctx.events.emit(EventTypes.CHARACTER_DB_OPEN);
                break;
            case 'ai-settings':
                // 动态导入并打开 AI 设置面板
                import('../ui/ai-settings-modal.js').then(({ AISettingsModal }) => {
                    const modal = new AISettingsModal(this.ctx);
                    modal.open();
                }).catch(err => {
                    this.ctx.helpers.showToast('无法打开面板: ' + err.message, 'error');
                });
                break;
            case 'settings':
                this.ctx.events.emit('settings:open');
                break;
            case 'prompt-preview':
                const promptBuilder = this.ctx.promptBuilder;
                if (promptBuilder) {
                    promptBuilder.openPreviewModal();
                } else {
                    this.ctx.helpers.showToast('提示词构建器未就绪', 'warning');
                }
                break;
            case 'close':
                this.hide();
                break;
        }
    }

    async show() {
        if (this.container) {
            this.container.style.display = 'flex';
            await this.ctx.api.setValue('fab_visible', true);
        }
    }

    async hide() {
        if (this.container) {
            this.container.style.display = 'none';
            await this.ctx.api.setValue('fab_visible', false);
            this.ctx.helpers.showToast('悬浮球已隐藏，可在设置中重新启用', 'info');
        }
    }
}
