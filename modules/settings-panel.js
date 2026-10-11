'use strict';

import { EventTypes } from '../core/event-bus.js';
import { StoreNames } from '../core/db-manager.js';
import { SDSettings } from '../ui/settings/sd-settings.js';
import { NAISettings } from '../ui/settings/nai-settings.js';
import { ComfyUISettings } from '../ui/settings/comfyui-settings.js';
import { OtherAPISettings } from '../ui/settings/other-settings.js';
import { getRequestHeaders } from '../../../../../script.js';
import { changelogData } from './changelog.js';
import { getThemePresetData } from './theme.js';
import { ImageAnalyzer } from './image-analyzer.js';
import { MultiCharacterParser } from './multi-character-parser.js';


export class SettingsPanel {
    constructor(context) {
        this.ctx = context;
        this.isOpen = false;
        this.modalEl = null;
        this.currentTab = 'general';

        // TauriTavern 客户端环境检测
        this.isTauriTavern = this._detectTauriTavern();


        this.modeSettings = {
            sd: new SDSettings(context),
            nai: new NAISettings(context),
            comfyui: new ComfyUISettings(context),
            other: new OtherAPISettings(context),
        };


        this.promptPresets = [];
        this.promptSelectedTags = [];
        this.currentPresetPage = 1;
        const isMobile = window.matchMedia('(max-width: 900px)').matches;
        this.presetItemsPerPage = isMobile ? 20 : 30; // 预设页也相应减少
        this.cachePage = 1;
        this.cachePageSize = isMobile ? 18 : 24; // 手机端改为18张
        this.isPresetMultiSelectMode = false;
        this.selectedPresets = new Set();
        this.presetClickTimer = null;
        //  缓存多选模式状态
        this.isCacheMultiSelectMode = false;
        this.selectedCacheImages = new Set();
        //  自定义主题列表缓存
        this.customThemes = {};
        this.activeThemeName = 'xuan'; // 默认玄色
        //  背景自定义设置
        this.backgroundSettings = {
            landscape: null,    // 横向背景路径
            portrait: null,     // 竖向背景路径
            opacity: 0.8,       // 背景上浮动元素的透明度
        };
        //  更新检测状态
        this.updateState = {
            hasUpdate: false,
            currentHash: '',
            remoteHash: '',
            checking: false
        };
        //  懒加载观察器引用（用于图片缓存网格）
        this.lazyObserver = null;
        //  透明占位图 (1x1像素)，用于图片缓存网格卸载图片时释放内存
        this.emptyImage = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
        //  预设图片按需加载观察器（用于预设网格，从DB按需加载图片数据）
        this.presetImageObserver = null;
        //  缓存已创建的 blob:URL，用于 revoke 管理
        this._presetBlobUrls = new Set();
        //  防傻操作：跟踪预设是否被修改但未更新
        this.isPresetModified = false;
        //  当前编辑模式：'prefix' 表示前置提示词，'suffix' 表示后置提示词
        this.currentPromptMode = 'prefix';
        //  防傻操作：跟踪各个模式的API预设是否被修改但未更新
        this.isApiPresetModified = {
            sd: false,
            nai: false,
            comfyui: false,
            other: false
        };
        //  图片解析器实例
        this.imageAnalyzer = new ImageAnalyzer();
        //  视觉模块开关状态
        this.visualNovelEnabled = false;
    }

    async init() {
        this.ctx.log('settings-panel', '初始化');

        // 预加载视觉模块开关状态
        this.visualNovelEnabled = await this.ctx.api.getValue('module_visualNovel', false);

        // [修改] 在后台预渲染并挂载设置面板DOM
        await this.renderModalAndMount();

        // [修改] 初始化懒加载观察器（在DOM挂载后）
        this._initLazyObserver();
        this._unsubscribe = this.ctx.events.on('settings:open', () => this.open());

        //  初始化入口按钮注入逻辑
        this._initEntryButton();

        //  加载保存的主题颜色
        await this.loadSavedTheme();
        setTimeout(() => this._checkForUpdates(true), 2000);
        this.ctx.log('settings-panel', '初始化完成');
    }
    /**
     *  每次打开面板时刷新数据，确保显示最新状态
     */
    async _refreshData() {
        this.ctx.log('settings-panel', '刷新设置面板数据');

        // 1. 刷新当前模式显示和对应的模式面板
        const currentMode = this._getCurrentMode();
        this._switchMode(currentMode, false);
        this._loadGeneralParams(); // 这里面有些 await API，也可以不 await

        // 2. 关键：检测当前所在的 Tab
        // 如果当前在“提示词”页面，才加载预设
        if (this.currentTab === 'prompts') {
             // 只有在提示词页时，才等待预设加载
             await this._loadPromptPresets({ keepEditor: true });
        }

        // 同理优化其他重型操作
        if (this.currentTab === 'triggers') {
             await this._loadTriggersSettings();
        } else {
             this._loadTriggersSettings().catch(()=>{});
        }

        // 主题和更新检查通常不频繁变动，可以异步处理
        this._loadAndRenderThemeList().catch(()=>{});
        this._loadAdvancedParams().catch(()=>{});
        this._refreshUpdateUI();

        // 重新加载模块化开关设置（确保显示存储中的值，而不是上次修改的DOM状态）
        this._loadModuleToggleSettings().catch(()=>{});

        // 如果当前在更新标签页，绑定变更日志事件
        if (this.currentTab === 'update') {
            this._bindChangelogEvents();
        }

        // 如果当前在图片解析标签页，加载图片解析器内容
        if (this.currentTab === 'imageAnalyzer') {
            const imageAnalyzerPane = this.modalEl.querySelector('.tsp-settings-pane[data-pane="imageAnalyzer"]');
            if (imageAnalyzerPane) {
                imageAnalyzerPane.innerHTML = this._renderImageAnalyzerSettings();
                if (this.imageAnalyzer) {
                    const container = imageAnalyzerPane.querySelector('#tsp-image-analyzer-container');
                    if (container) {
                        this.imageAnalyzer.render(container);
                    }
                }
            }
        }
    }
    async cleanup() {
        if (this._unsubscribe) this._unsubscribe();
        //  断开观察器
        if (this.lazyObserver) {
            this.lazyObserver.disconnect();
            this.lazyObserver = null;
        }
        //  断开预设图片观察器
        if (this.presetImageObserver) {
            this.presetImageObserver.disconnect();
            this.presetImageObserver = null;
        }
        //  释放所有 blob:URL
        for (const url of this._presetBlobUrls) {
            URL.revokeObjectURL(url);
        }
        this._presetBlobUrls.clear();
        //  清理入口按钮和观察器
        if (this._entryObserver) {
            this._entryObserver.disconnect();
            this._entryObserver = null;
        }
        const btn = document.getElementById('tsp-settings-entry-btn');
        if (btn) btn.remove();

        // [修改] 直接移除DOM元素，不再调用 close()
        if (this.modalEl) {
            this.modalEl.remove();
            this.modalEl = null;
        }
    }

    async open() {
        if (this.isOpen || !this.modalEl) return;
        this.isOpen = true;

        // 1. ✅ 立即让面板可见 (利用内存中上次的状态)
        this.modalEl.style.display = 'flex';
        requestAnimationFrame(() => {
            if (this.modalEl) {
                this.modalEl.classList.add('visible');
            }
        });

        // 2. ✅ 在界面显示动画播放的同时，异步刷新数据
        // 不要加 await，让它在后台跑，或者为了保险加上 catch
        this._refreshData().catch(err => {
            console.error('Settings refresh failed:', err);
        });

        // 3. 如果当前标签页是提示词页或图片管理页或图片解析页，重新加载内容
        if (this.currentTab === 'prompts' || this.currentTab === 'gallery' || this.currentTab === 'imageAnalyzer') {
            this._switchTab(this.currentTab);
        }
    }


    close() {
        if (!this.isOpen || !this.modalEl) return;
        this.isOpen = false;

        // 清理预设图片观察器和 blob:URL（防止 DOM 移除后观察器仍在运行）
        if (this.presetImageObserver) {
            this.presetImageObserver.disconnect();
            this.presetImageObserver = null;
        }
        if (this._presetBlobUrls) {
            for (const url of this._presetBlobUrls) {
                URL.revokeObjectURL(url);
            }
            this._presetBlobUrls.clear();
        }

        // 销毁提示词内容
        const promptsPane = this.modalEl.querySelector('.tsp-settings-pane[data-pane="prompts"]');
        if (promptsPane) {
            promptsPane.innerHTML = `
                <div class="tsp-settings-loading-placeholder" style="padding: 20px; text-align: center; color: var(--tsp-text-muted);">
                    <i class="fa-solid fa-spinner fa-spin"></i> 正在加载提示词设置...
                </div>
            `;
        }

        // 销毁图片管理内容
        const galleryPane = this.modalEl.querySelector('.tsp-settings-pane[data-pane="gallery"]');
        if (galleryPane) {
            galleryPane.innerHTML = `
                <div class="tsp-settings-loading-placeholder" style="padding: 20px; text-align: center; color: var(--tsp-text-muted);">
                    <i class="fa-solid fa-spinner fa-spin"></i> 正在加载图片管理设置...
                </div>
            `;
        }

        // 销毁图片解析内容
        const imageAnalyzerPane = this.modalEl.querySelector('.tsp-settings-pane[data-pane="imageAnalyzer"]');
        if (imageAnalyzerPane) {
            imageAnalyzerPane.innerHTML = `
                <div class="tsp-settings-loading-placeholder" style="padding: 20px; text-align: center; color: var(--tsp-text-muted);">
                    <i class="fa-solid fa-spinner fa-spin"></i> 正在加载图片解析器...
                </div>
            `;
        }
        if (this.imageAnalyzer) {
            this.imageAnalyzer.clear();
        }

        // [修改] 不再移除元素，只是通过移除 'visible' 类使其透明
        this.modalEl.classList.remove('visible');

        // 动画结束后，设置 display: none 来彻底优化性能，避免浏览器渲染一个透明的元素
        setTimeout(() => {
            if (!this.isOpen && this.modalEl) {
                this.modalEl.style.display = 'none';
            }
        }, 200); // 这个时间应与你的CSS过渡时间一致
    }


    _getCurrentMode() {
        const imageGen = this.ctx.getModule('imageGen');
        return imageGen?.settings?.currentMode || 'sd';
    }


    _getModeName(mode) {
        const names = {
            sd: 'Stable Diffusion',
            nai: 'NovelAI',
            comfyui: 'ComfyUI',
            other: 'Other API',
        };
        return names[mode] || mode;
    }


    _getModeIcon(mode) {
        const icons = {
            sd: 'fa-solid fa-paint-brush',
            nai: 'fa-solid fa-wand-magic-sparkles',
            comfyui: 'fa-solid fa-diagram-project',
            other: 'fa-solid fa-plug',
        };
        return icons[mode] || 'fa-solid fa-cog';
    }

    /**
     *  初始化入口按钮注入器
     * 监听 DOM 变化，确保按钮在菜单重新渲染时被注入
     */
    _initEntryButton() {
        // 立即尝试注入一次
        this._injectSettingsButton();

        // 创建观察器，监听 #options 菜单的出现或变化
        // 酒馆的下拉菜单经常会被销毁重建，所以需要持续监听
        this._entryObserver = new MutationObserver(() => {
            this._injectSettingsButton();
        });

        // 监听 document.body 的子节点变化（因为 #options 通常直接挂载在 body 下）
        this._entryObserver.observe(document.body, { childList: true, subtree: true });
    }

    /**
     *  执行具体的按钮插入逻辑
     */
    _injectSettingsButton() {
        // 2. 寻找锚点：作者注释开关 (#option_toggle_AN)
        const anchor = document.getElementById('option_toggle_AN');

        // 如果找不到锚点，或者锚点不在目标容器 #options 内，则不注入
        if (!anchor) return;
        const optionsMenu = anchor.closest('#options');
        if (!optionsMenu) return;

        // 1. 如果插件入口按钮不存在则创建
        if (!document.getElementById('tsp-settings-entry-btn')) {
            const btn = document.createElement('a');
            btn.id = 'tsp-settings-entry-btn';
            btn.className = anchor.className;
            btn.tabIndex = 0;
            btn.innerHTML = `
                <i class="fa-lg fa-solid fa-wand-magic-sparkles"></i>
                <span data-i18n="酒馆场景插件">酒馆场景插件</span>
            `;
            btn.title = '打开酒馆文生图插件设置';
            btn.style.cursor = 'pointer';
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.open();
            });
            anchor.parentNode.insertBefore(btn, anchor.nextSibling);
            this.ctx.log('settings-panel', '入口按钮已注入到作者注释下方');
        }

        // 视觉模块入口按钮：仅当视觉模块开启时注入
        if (this.visualNovelEnabled) {
            if (!document.getElementById('tsp-visual-novel-entry-btn')) {
                const settingsBtn = document.getElementById('tsp-settings-entry-btn');
                if (!settingsBtn) return;
                const vnBtn = document.createElement('a');
                vnBtn.id = 'tsp-visual-novel-entry-btn';
                vnBtn.className = anchor.className;
                vnBtn.tabIndex = 0;
                vnBtn.innerHTML = `
                    <i class="fa-lg fa-solid fa-book-open"></i>
                    <span data-i18n="进入视觉模式">进入视觉模式</span>
                `;
                vnBtn.title = '进入仿Galgame视觉小说模式';
                vnBtn.style.cursor = 'pointer';
                vnBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    this._enterVisualNovelMode();
                });
                settingsBtn.parentNode.insertBefore(vnBtn, settingsBtn.nextSibling);
                this.ctx.log('settings-panel', '视觉模式入口按钮已注入');
            }
        } else {
            // 视觉模块关闭时移除按钮（如果存在）
            const vnBtn = document.getElementById('tsp-visual-novel-entry-btn');
            if (vnBtn) {
                vnBtn.remove();
                this.ctx.log('settings-panel', '视觉模式入口按钮已移除');
            }
        }
    }

    /**
     *  进入视觉小说（Galgame）模式
     */
    async _enterVisualNovelMode() {
        try {
            this.ctx.log('settings-panel', '进入视觉小说模式');
            const { initVisualNovel } = await import('../Visual_Novel/index.js');
            if (typeof initVisualNovel === 'function') {
                initVisualNovel(this.ctx);
            } else {
                this.ctx.helpers.showToast('视觉模块加载失败', 'error');
            }
        } catch (e) {
            console.error('加载视觉模块失败:', e);
            this.ctx.helpers.showToast(`视觉模块加载失败: ${e.message}`, 'error');
        }
    }
    /**
     *  初始化懒加载观察器
     * 实现进入视窗加载，移出视窗卸载(释放内存)
     */
    _initLazyObserver() {
        if (this.lazyObserver) return;

        const options = {
            root: this.modalEl ? this.modalEl.querySelector('.tsp-modal-body') : null, // 监听滚动容器
            rootMargin: '100px', // 预加载范围，提前100px加载
            threshold: 0.01
        };

        this.lazyObserver = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                const img = entry.target;

                if (entry.isIntersecting) {
                    // [进入视窗]：加载图片
                    const realSrc = img.dataset.src;
                    if (realSrc && img.src !== realSrc) {
                        img.src = realSrc;
                        img.classList.add('loaded');
                    }
                } else {
                    // [移出视窗]：卸载图片，这是手机端防崩溃的关键！
                    // 只有当图片已经加载过，且不在视窗内时才执行
                    if (img.src && img.src !== this.emptyImage && img.classList.contains('loaded')) {
                        // 保留 style 尺寸防止页面抖动
                        img.style.minHeight = img.clientHeight + 'px';
                        img.src = this.emptyImage;
                        img.classList.remove('loaded');
                    }
                }
            });
        }, options);
    }
    /**
     *  将 Base64 转换为 Blob URL 以优化渲染性能
     */
    _base64ToBlobUrl(input) {
        //  直接处理 Blob
        if (input instanceof Blob) {
            return URL.createObjectURL(input);
        }

        // 检查 input 是否是字符串类型
        if (!input || typeof input !== 'string' || !input.startsWith('data:')) return input;

        // ... (旧的 Base64 转换逻辑保持不变) ...
        try {
            const arr = input.split(',');
            const mime = arr[0].match(/:(.*?);/)[1];
            const bstr = atob(arr[1]);
            let n = bstr.length;
            const u8arr = new Uint8Array(n);
            while (n--) {
                u8arr[n] = bstr.charCodeAt(n);
            }
            return URL.createObjectURL(new Blob([u8arr], { type: mime }));
        } catch (e) {
            return input;
        }
    }
    async renderModalAndMount() {
        //  防止重复渲染和挂载
        if (this.modalEl) {
            return;
        }

        // 1. 获取当前模式和模块化设置
        const currentMode = this._getCurrentMode();
        const moduleSettings = {
            aiProcessor: await this.ctx.api.getValue('module_aiProcessor', false),
            triggers: await this.ctx.api.getValue('module_triggers', true),
            characterDB: await this.ctx.api.getValue('module_characterDB', true),
            tagMarket: await this.ctx.api.getValue('module_tagMarket', false),
            phoneEmulator: await this.ctx.api.getValue('module_phoneEmulator', false),
            tagVisualization: await this.ctx.api.getValue('module_tagVisualization', false),
            visualNovel: await this.ctx.api.getValue('module_visualNovel', false)
        };

        //  根据是否有更新改变标题
        let titleHtml = '<i class="fa-solid fa-gear"></i> 插件设置';
        if (this.updateState.hasUpdate) {
            titleHtml = `
                <i class="fa-solid fa-gift" style="color: var(--tsp-accent-red)"></i>
                <span>插件设置 <span class="tsp-update-status-badge">有新版本！</span></span>
            `;
        }

        // 2. 生成模式容器的占位符 (Skeleton)
        // 我们不再一次性生成 content，而是生成空的 div 容器，稍后填充
        let allModesContent = '';
        const modes = ['sd', 'nai', 'comfyui', 'other'];

        modes.forEach(modeKey => {
            const isVisible = modeKey === currentMode;
            // 预先创建容器，但里面是空的
            allModesContent += `
                <div class="tsp-mode-settings-pane" data-mode-pane="${modeKey}" style="display: ${isVisible ? 'block' : 'none'};">
                    <!-- ${modeKey} 内容将异步加载 -->
                    <div class="tsp-settings-loading-placeholder" style="padding: 20px; text-align: center; color: var(--tsp-text-muted);">
                        <i class="fa-solid fa-spinner fa-spin"></i> 正在加载 ${this._getModeName(modeKey)} 设置...
                    </div>
                </div>
            `;
        });

        // 3. 生成导航项（根据模块化设置决定是否显示）
        const triggersNavHtml = moduleSettings.triggers ? `
                            <a href="#" class="tsp-nav-link" data-tab="triggers">
                                <i class="fa-solid fa-bolt"></i>
                                <span>触发词</span>
                            </a>` : '';

        const tagMarketNavHtml = moduleSettings.tagMarket ? `
                            <a href="#" class="tsp-nav-link" id="nav-tag-market">
                                <i class="fa-solid fa-tags"></i>
                                <span>标签超市</span>
                            </a>` : '';

        const charDBNavHtml = moduleSettings.characterDB ? `
                            <a href="#" class="tsp-nav-link" id="nav-char-db">
                                <i class="fa-solid fa-users"></i>
                                <span>角色数据库</span>
                            </a>` : '';

        const aiProcessorNavHtml = moduleSettings.aiProcessor ? `
                            <a href="#" class="tsp-nav-link" id="nav-ai-processor">
                                <i class="fa-solid fa-robot"></i>
                                <span>AI二次处理</span>
                            </a>` : '';

        const overlay = document.createElement('div');
        overlay.className = 'tsp-modal-overlay';
        overlay.style.display = 'none';

        // 生成主框架 HTML
        overlay.innerHTML = `
            <div class="tsp-modal tsp-settings-modal">
                <div class="tsp-modal-header">
                    <div class="tsp-modal-title">
                        ${titleHtml}
                    </div>
                    <div class="tsp-header-controls">
                        <div class="tsp-mode-switcher">
                            <label>当前模式:</label>
                            <select class="tsp-input" id="settings-mode-select">
                                <option value="sd" ${currentMode === 'sd' ? 'selected' : ''}>Stable Diffusion</option>
                                <option value="nai" ${currentMode === 'nai' ? 'selected' : ''}>NovelAI</option>
                                <option value="comfyui" ${currentMode === 'comfyui' ? 'selected' : ''}>ComfyUI</option>
                                <option value="other" ${currentMode === 'other' ? 'selected' : ''}>Other API</option>
                            </select>
                    </div>
                    <button class="tsp-btn tsp-btn-icon" id="tsp-settings-close" title="关闭">
                        <i class="fa-solid fa-times"></i>
                    </button>
                    </div>
                </div>
                <div class="tsp-modal-body">
                    <div class="tsp-settings-layout">
                        <!-- 侧边栏导航 -->
                        <nav class="tsp-settings-sidebar">
                            <a href="#" class="tsp-nav-link active" data-tab="general">
                                <i class="fa-solid fa-sliders"></i>
                                <span>通用设置</span>
                            </a>
                            <a href="#" class="tsp-nav-link" data-tab="prompts">
                                <i class="fa-solid fa-message"></i>
                                <span>提示词</span>
                            </a>
                            <a href="#" class="tsp-nav-link tsp-nav-mode" data-tab="mode">
                                <i class="${this._getModeIcon(currentMode)}"></i>
                                <span>${this._getModeName(currentMode)}</span>
                            </a>
                            <a href="#" class="tsp-nav-link" data-tab="multichar">
                                <i class="fa-solid fa-users-gear"></i>
                                <span>多角色定义</span>
                            </a>
                            <a href="#" class="tsp-nav-link" data-tab="gallery">
                                <i class="fa-solid fa-images"></i>
                                <span>图片管理</span>
                            </a>
                            <a href="#" class="tsp-nav-link" data-tab="advanced">
                                <i class="fa-solid fa-cog"></i>
                                <span>高级设置</span>
                            </a>
                            ${triggersNavHtml}
                            <hr class="tsp-nav-divider">
                            ${tagMarketNavHtml}
                            ${charDBNavHtml}
                            ${aiProcessorNavHtml}
                            <a href="#" class="tsp-nav-link" data-tab="theme">
                                <i class="fa-solid fa-paintbrush"></i>
                                <span>界面自定义</span>
                            </a>
                            <a href="#" class="tsp-nav-link" data-tab="console">
                                <i class="fa-solid fa-terminal"></i>
                                <span>调试控制台</span>
                            </a>
                            <a href="#" class="tsp-nav-link" data-tab="imageAnalyzer">
                                <i class="fa-solid fa-image"></i>
                                <span>图片解析</span>
                            </a>
                            <a href="#" class="tsp-nav-link" data-tab="moduleToggle">
                                <i class="fa-solid fa-plug"></i>
                                <span>模块化开关</span>
                            </a>
                            <a href="#" class="tsp-nav-link" data-tab="update">
                                <i class="fa-solid fa-sync"></i>
                                <span>更新 & 日志</span>
                                ${this.updateState.hasUpdate ? '<i class="fa-solid fa-circle" style="font-size: 8px; color: var(--tsp-accent-red); margin-left: auto;"></i>' : ''}
                            </a>
                        </nav>

                        <!-- 设置内容区 -->
                        <main class="tsp-settings-content">
                            <!-- 通用设置 -->
                            <div class="tsp-settings-pane active" data-pane="general">
                                ${this._renderGeneralSettings()}
                            </div>

                            <!-- 提示词设置 -->
                            <div class="tsp-settings-pane" data-pane="prompts">
                                <div class="tsp-settings-loading-placeholder" style="padding: 20px; text-align: center; color: var(--tsp-text-muted);">
                                    <i class="fa-solid fa-spinner fa-spin"></i> 正在加载提示词设置...
                                </div>
                            </div>

                            <!-- 模式设置 (容器) -->
                            <div class="tsp-settings-pane" data-pane="mode" id="mode-settings-container">
                                ${allModesContent}
                            </div>
                            <div class="tsp-settings-pane" data-pane="multichar">
                                ${this._renderMultiCharSettings()}
                            </div>
                            <div class="tsp-settings-pane" data-pane="gallery">
                                <div class="tsp-settings-loading-placeholder" style="padding: 20px; text-align: center; color: var(--tsp-text-muted);">
                                    <i class="fa-solid fa-spinner fa-spin"></i> 正在加载图片管理设置...
                                </div>
                            </div>
                            <!-- 高级设置 -->
                            <div class="tsp-settings-pane" data-pane="advanced">
                                ${this._renderAdvancedSettings()}
                            </div>

                            <!-- 触发词设置 -->
                            <div class="tsp-settings-pane" data-pane="triggers">
                                ${this._renderTriggersSettings()}
                        </div>
                            <div class="tsp-settings-pane" data-pane="theme">
                                ${this._renderThemeSettings()}
                            </div>
                            <div class="tsp-settings-pane" data-pane="console">
                                ${this._renderConsoleSettings()}
                            </div>
                            <div class="tsp-settings-pane" data-pane="imageAnalyzer">
                                <div class="tsp-settings-loading-placeholder" style="padding: 20px; text-align: center; color: var(--tsp-text-muted);">
                                    <i class="fa-solid fa-spinner fa-spin"></i> 正在加载图片解析器...
                                </div>
                            </div>
                            <div class="tsp-settings-pane" data-pane="moduleToggle">
                                ${this._renderModuleToggleSettings()}
                            </div>
                            <div class="tsp-settings-pane" data-pane="update">
                                ${this._renderUpdateSettings()}
                            </div>
                        </main>
                    </div>
                </div>
                <div class="tsp-modal-footer">
                    <div class="tsp-footer-left">
                        <button class="tsp-btn" id="tsp-settings-reset" title="重置当前页">
                            <i class="fa-solid fa-undo"></i> <span class="tsp-btn-text">重置当前页</span>
                        </button>
                        <button class="tsp-btn tsp-btn-danger" id="tsp-settings-clear-cache" title="清除缓存">
                            <i class="fa-solid fa-trash"></i> <span class="tsp-btn-text">清除缓存</span>
                        </button>
                    </div>
                    <div class="tsp-footer-right">
                        <button class="tsp-btn tsp-btn-primary" id="tsp-settings-save" title="保存关闭">
                            <i class="fa-solid fa-save"></i> <span class="tsp-btn-text">保存关闭</span>
                        </button>
                    </div>
                </div>
            </div>
        `;

        document.body.appendChild(overlay);
        this.modalEl = overlay;

        // 3. 优先渲染当前模式 (高优先级)
        this._renderSingleMode(currentMode);

        // 4. 绑定通用事件 (不再包含模式特定的事件，模式特定的事件在 _renderSingleMode 中绑定)
        this._bindEvents();

        // 5. 加载数据
        await this._loadSettings();

        this.ctx.log('settings-panel', `核心UI已挂载，优先模式: ${currentMode}`);

        // 6. 关键优化：延迟渲染其他模式
        // 使用 setTimeout 将其他模式的渲染推迟到主线程空闲时，每个模式之间间隔一定时间
        this._queueRemainingModes(currentMode);
    }
    /**
     *  渲染单个模式的内容并绑定事件
     * @param {string} modeKey
     */
    _renderSingleMode(modeKey) {
        if (!this.modalEl || !this.modeSettings[modeKey]) return;

        const container = this.modalEl.querySelector(`.tsp-mode-settings-pane[data-mode-pane="${modeKey}"]`);
        if (!container) return;

        // 如果已经渲染过（即内容不是加载占位符），则跳过
        if (!container.querySelector('.tsp-settings-loading-placeholder') && container.children.length > 0) {
            return;
        }

        try {
            // 1. 生成 HTML (可能比较耗时，特别是 NAI)
            const content = this.modeSettings[modeKey].render();

            // 2. 插入 DOM
            container.innerHTML = content;

            // 3. 绑定该模式的事件
            this.modeSettings[modeKey].bindEvents(container);

            this.ctx.log('settings-panel', `模式 ${modeKey} 已延迟渲染完成`);
        } catch (e) {
            console.error(`渲染模式 ${modeKey} 失败`, e);
            container.innerHTML = `
                <div class="tsp-settings-group"><p class="tsp-text-muted">加载 ${modeKey} 设置失败: ${e.message}</p></div>
            `;
        }
    }
    /**
     *  队列式渲染剩余模式，防止主线程阻塞
     * @param {string} skipMode 已经渲染过的模式
     */
    _queueRemainingModes(skipMode) {
        const allModes = ['sd', 'nai', 'comfyui', 'other'];
        const remaining = allModes.filter(m => m !== skipMode);

        const renderNext = () => {
            if (remaining.length === 0) return;

            const mode = remaining.shift();
            // 在 requestAnimationFrame 中执行渲染，保证在每一帧之间执行
            requestAnimationFrame(() => {
                this._renderSingleMode(mode);

                // 设置延迟，给浏览器响应时间。
                // 移动端建议设置 300ms 或更高，特别是处理 NAI 这种重型 DOM 时
                setTimeout(renderNext, 500);
            });
        };

        // 初始延迟 1秒，确保主界面初始化动画流畅完成，且首屏已完全可交互
        setTimeout(renderNext, 1000);
    }

    /**
     * [修改] 渲染通用设置
     * 改为生成全量 HTML 结构，不再依赖当前模式做条件渲染，
     * 具体的显示状态由 _updateGeneralUI 动态控制。
     */
    _renderGeneralSettings() {
        // 定义两套下拉菜单的 HTML，方便后续 JS 填充，这里只渲染一个空的或者默认的
        // 实际内容会由 _updateGeneralUI 填充

        return `
            <div class="tsp-settings-group">
                <h4 class="tsp-settings-group-title">
                    <i class="fa-solid fa-desktop"></i> 界面设置
                </h4>
                <div class="tsp-info-box" style="margin-bottom: 15px; background: rgba(247, 118, 142, 0.1); border-color: var(--tsp-accent-secondary);">
                    <i class="fa-solid fa-circle-info"></i> <strong>提示：</strong>手机模拟器、标签超市、Tag编辑可视化功能已集成到模块化入口，请在倒数第二个标签页内切换开关。
                </div>
                <div class="tsp-form-group">
                    <label class="tsp-switch-label">
                        <input type="checkbox" class="tsp-switch" id="settings-text2img-enabled" checked>
                        <span class="tsp-switch-slider"></span>
                        <span>文生图</span>
                    </label>
                </div>
                <div class="tsp-form-group">
                    <label class="tsp-switch-label">
                        <input type="checkbox" class="tsp-switch" id="settings-inject-buttons-enabled">
                        <span class="tsp-switch-slider"></span>
                        <span>小铅笔旁边注入按钮</span>
                    </label>
                </div>
                <div class="tsp-form-group">
                    <label class="tsp-switch-label">
                        <input type="checkbox" class="tsp-switch" id="settings-fab-visible" checked>
                        <span class="tsp-switch-slider"></span>
                        <span>显示悬浮球</span>
                    </label>
                </div>
                <div class="tsp-form-group">
                    <label class="tsp-switch-label">
                        <input type="checkbox" class="tsp-switch" id="settings-quick-gen-fab-visible">
                        <span class="tsp-switch-slider"></span>
                        <span>显示快捷生成悬浮球</span>
                    </label>
                </div>
                <div class="tsp-form-group">
                    <label class="tsp-switch-label">
                        <input type="checkbox" class="tsp-switch" id="settings-auto-insert" checked>
                        <span class="tsp-switch-slider"></span>
                        <span>生成后自动插入聊天</span>
                    </label>
                </div>
                <div class="tsp-form-group">
                    <label class="tsp-switch-label">
                        <input type="checkbox" class="tsp-switch" id="settings-auto-generate">
                        <span class="tsp-switch-slider"></span>
                        <span>检测到图像标签时自动生成</span>
                    </label>
                </div>
                <div class="tsp-form-group">
                    <label class="tsp-switch-label">
                        <input type="checkbox" class="tsp-switch" id="settings-floating-ball-shelter-enabled">
                        <span class="tsp-switch-slider"></span>
                        <span>收纳盒悬浮球</span>
                    </label>
                </div>
                <div class="tsp-form-group">
                    <label class="tsp-switch-label">
                        <input type="checkbox" class="tsp-switch" id="settings-concurrent-requests-enabled">
                        <span class="tsp-switch-slider"></span>
                        <span>并发</span>
                    </label>
                </div>
                <div class="tsp-form-group">
                    <label class="tsp-switch-label">
                        <input type="checkbox" class="tsp-switch" id="settings-fix-hashline-enabled">
                        <span class="tsp-switch-slider"></span>
                        <span>修复###换行</span>
                    </label>
                </div>
            </div>

            <div class="tsp-settings-group">
                <h4 class="tsp-settings-group-title">
                    <i class="fa-solid fa-expand"></i> 图像尺寸
                </h4>
                <div class="tsp-form-row">
                    <div class="tsp-form-group">
                        <label>预设尺寸</label>
                        <select class="tsp-input" id="general-size">
                        </select>
                    </div>
                    <div class="tsp-form-group">
                        <label>宽度</label>
                        <input type="number" class="tsp-input" id="settings-default-width" value="832" min="64" step="64">
                    </div>
                    <div class="tsp-form-group">
                        <label>高度</label>
                        <input type="number" class="tsp-input" id="settings-default-height" value="1216" min="64" step="64">
                    </div>
                </div>
                <div class="tsp-form-row">
                    <div class="tsp-form-group">
                        <label>步数 (Steps)</label>
                        <input type="number" class="tsp-input" id="settings-default-steps" value="20" min="1" max="200">
                    </div>

                    <div class="tsp-form-group">
                        <label id="lbl-general-cfg">CFG Scale</label>
                        <input type="number" class="tsp-input" id="general-cfg" step="0.5" value="7">
                    </div>

                    <div class="tsp-form-group" id="group-general-scale">
                        <label id="lbl-general-scale">CFG Rescale</label>
                        <input type="number" class="tsp-input" id="general-scale" step="0.05" value="0">
                    </div>
                </div>

                <div class="tsp-form-group" id="group-general-seed">
                    <label>种子 (Seed) <small style="color: var(--tsp-text-muted);">-1 = 随机</small></label>
                    <input type="number" class="tsp-input" id="general-seed" value="-1">
                </div>
            </div>
        `;
    }
    /**
     *  根据模式动态更新通用设置面板的 UI
     * 解决预渲染导致的 UI 不随模式切换变化的问题
     */
    _updateGeneralUI(mode) {
        if (!this.modalEl) return;

        // 1. 定义分辨率预设 HTML
        const sizeOptsNAI = `
            <option value="竖图">竖图 (832x1216)</option>
            <option value="横图">横图 (1216x832)</option>
            <option value="方图">方图 (1024x1024)</option>
            <option value="768x1344">768x1344 (高竖图)</option>
            <option value="1344x768">1344x768 (宽横图)</option>
            <option value="896x1152">896x1152</option>
            <option value="1152x896">1152x896</option>
            <option value="Custom">自定义</option>
        `;
        const sizeOptsSD = `
            <option value="832x1216">832x1216 (推荐)</option>
            <option value="1216x832">1216x832</option>
            <option value="1024x1024">1024x1024</option>
            <option value="768x1344">768x1344</option>
            <option value="1344x768">1344x768</option>
            <option value="896x1152">896x1152</option>
            <option value="1152x896">1152x896</option>
            <option value="640x640">640x640</option>
            <option value="Custom">自定义</option>
        `;

        // 2. 更新下拉菜单
        const sizeSelect = this.modalEl.querySelector('#general-size');
        // 保存当前选中的值，如果在切模式后该值还存在，则保持选中
        const currentSizeVal = sizeSelect ? sizeSelect.value : '';
        if (sizeSelect) {
            sizeSelect.innerHTML = (mode === 'nai') ? sizeOptsNAI : sizeOptsSD;
            // 尝试恢复选中，如果新options里没有，则默认选中第一个或Custom
            if(Array.from(sizeSelect.options).some(o => o.value === currentSizeVal)){
                sizeSelect.value = currentSizeVal;
            }
        }

        // 3. 更新标签和显隐逻辑
        const lblCfg = this.modalEl.querySelector('#lbl-general-cfg');
        const groupScale = this.modalEl.querySelector('#group-general-scale');
        const lblScale = this.modalEl.querySelector('#lbl-general-scale');
        const groupSeed = this.modalEl.querySelector('#group-general-seed');

        if (mode === 'nai') {
            // NAI 模式
            if (lblCfg) lblCfg.textContent = 'Scale (引导)';

            // 显示 Rescale
            if (groupScale) groupScale.style.display = 'block';
            if (lblScale) lblScale.textContent = 'CFG Rescale';

            // 显示 Seed
            if (groupSeed) groupSeed.style.display = 'block';

        } else {
            // SD / ComfyUI / Other
            if (lblCfg) lblCfg.textContent = 'CFG Scale';

            // 隐藏 Rescale
            if (groupScale) groupScale.style.display = 'none';

            // 显示 Seed (SD & ComfyUI)
            const showSeed = (mode === 'sd' || mode === 'comfyui');
            if (groupSeed) groupSeed.style.display = showSeed ? 'block' : 'none';
        }
    }

    /**
     *  渲染调试控制台 UI
     */
    _renderConsoleSettings() {
        return `
            <div class="tsp-settings-group" style="height: 100%; display: flex; flex-direction: column;">
                <h4 class="tsp-settings-group-title">
                    <i class="fa-solid fa-bug"></i> 错误排查控制台
                </h4>
                <div class="tsp-info-box" style="margin-bottom: 15px;">
                    <i class="fa-solid fa-info-circle"></i> 此处记录了插件运行时的关键请求和报错。截图或导出此日志可帮助开发者修复问题。
                    <br><strong>注意：</strong> 刷新网页后日志会自动清空。
                    <br>
                    <span style="display: block; margin-top: 6px; padding-top: 6px; border-top: 1px dashed rgba(128,128,128,0.3);">
                        问题无法自行解决可以尝试进群咨询：
                        <a href="https://qm.qq.com/q/EpncCSVEnS" target="_blank" style="color: var(--tsp-accent-primary); font-weight: bold; text-decoration: none;">
                            【宇宙机器人粉丝交流群♡】
                        </a>
                    </span>
                </div>

                <div class="tsp-form-row" style="flex-shrink: 0;">
                    <div class="tsp-btn-group">
                        <button class="tsp-btn" id="tsp-console-refresh">
                            <i class="fa-solid fa-sync"></i> 刷新列表
                        </button>
                        <button class="tsp-btn tsp-btn-primary" id="tsp-console-export">
                            <i class="fa-solid fa-file-export"></i> 导出日志 (TXT)
                        </button>
                        <button class="tsp-btn tsp-btn-danger" id="tsp-console-clear">
                            <i class="fa-solid fa-trash"></i> 清空
                        </button>
                    </div>
                </div>

                <div id="tsp-console-output" class="tsp-card tsp-console-container" style="flex: 1; overflow-y: auto; margin-top: 10px; padding: 10px; font-family: monospace; background: rgba(0,0,0,0.2);">
                    加载中...
                </div>
            </div>
        `;
    }

    _renderImageAnalyzerSettings() {
        return `
            <div class="tsp-image-analyzer">
                <div class="tsp-settings-group">
                    <h4 class="tsp-settings-group-title">
                        <i class="fa-solid fa-image"></i> 图片元数据解析
                    </h4>
                    <div id="tsp-image-analyzer-container"></div>
                </div>
            </div>
        `;
    }

    /**
     *  渲染主题设置面板
     */
    _renderThemeSettings() {
        // 构建预设列表
        // 注意：这里需要先把默认预设和自定义预设合并，或者在JS里动态填充 Select
        // 为了方便 HTML 字符串拼接，这里仅渲染基本结构，Select 的 option 在 _bindThemeEvents 或之后动态填充
        return `
            <div class="tsp-settings-group">
                <h4 class="tsp-settings-group-title">
                    <i class="fa-solid fa-palette"></i> 主题管理
                </h4>
                <div class="tsp-form-group">
                    <label>选择主题</label>
                    <div style="display:flex; gap:10px;">
                        <select class="tsp-input" id="theme-select-preset">
                            <!-- JS 动态填充 -->
                        </select>
                    </div>
                </div>
                <div class="tsp-btn-group" style="margin-top: 10px;">
                    <button class="tsp-btn tsp-btn-primary" id="theme-btn-update">
                        <i class="fa-solid fa-sync"></i> 更新当前
                    </button>
                    <button class="tsp-btn" id="theme-btn-saveas">
                        <i class="fa-solid fa-save"></i> 另存为新主题
                    </button>
                    <button class="tsp-btn tsp-btn-danger" id="theme-btn-delete">
                        <i class="fa-solid fa-trash"></i> 删除
                    </button>
                </div>
                <p class="tsp-text-muted" style="margin-top:8px; font-size:0.85em;">
                    注："更新"和"删除"仅对自定义主题有效。切换主题后会自动应用。
                </p>
            </div>

            <div class="tsp-settings-group">
                <h4 class="tsp-settings-group-title">
                    <i class="fa-solid fa-fill-drip"></i> 细节微调 (修改下方颜色后点击"更新"或"另存")
                </h4>

                <h4 class="tsp-settings-group-title" style="font-size: 0.9em; border:none; margin-top:10px;">
                    生成按钮样式 (Chat)
                </h4>
                <div class="tsp-form-row">
                    <div class="tsp-form-group">
                        <label>渐变起始色</label>
                        <input type="color" class="tsp-input tsp-color-picker" id="theme-color-btn-grad-1">
                    </div>
                    <div class="tsp-form-group">
                        <label>渐变结束色</label>
                        <input type="color" class="tsp-input tsp-color-picker" id="theme-color-btn-grad-2">
                    </div>
                    <div class="tsp-form-group">
                        <label>文字颜色</label>
                        <input type="color" class="tsp-input tsp-color-picker" id="theme-color-btn-text">
                    </div>
                </div>
                <div class="tsp-form-group" style="padding: 10px; background: rgba(0,0,0,0.1); border-radius: 8px; text-align: center;">
                    <label style="margin-bottom: 8px; display: block;">预览效果</label>
                    <button class="tsp-inline-gen-btn" id="theme-btn-preview" style="pointer-events: none;">
                        <i class="fa-solid fa-image"></i> 生成图片
                    </button>
                </div>
            </div>

            <div class="tsp-settings-group">
                <h4 class="tsp-settings-group-title" style="font-size: 0.9em; border:none;">
                    全局界面颜色
                </h4>
                <div class="tsp-form-row">
                    <div class="tsp-form-group">
                        <label>主背景色 (Main Bg)</label>
                        <input type="color" class="tsp-input tsp-color-picker" id="theme-color-bg-main">
                    </div>
                    <div class="tsp-form-group">
                        <label>次背景色 (Panel Bg)</label>
                        <input type="color" class="tsp-input tsp-color-picker" id="theme-color-bg-secondary">
                    </div>
                    <div class="tsp-form-group">
                        <label>输入框背景</label>
                        <input type="color" class="tsp-input tsp-color-picker" id="theme-color-bg-input">
                    </div>
                     <div class="tsp-form-group">
                        <label>输入框文字</label>
                        <input type="color" class="tsp-input tsp-color-picker" id="theme-color-text-input">
                    </div>
                    <div class="tsp-form-group">
                        <label>边框颜色</label>
                        <input type="color" class="tsp-input tsp-color-picker" id="theme-color-border">
                    </div>
                </div>
                <div class="tsp-form-row">
                    <div class="tsp-form-group">
                        <label>主要文字</label>
                        <input type="color" class="tsp-input tsp-color-picker" id="theme-color-text-primary">
                    </div>
                    <div class="tsp-form-group">
                        <label>次要文字</label>
                        <input type="color" class="tsp-input tsp-color-picker" id="theme-color-text-secondary">
                    </div>
                    <div class="tsp-form-group">
                        <label>注释文字</label>
                        <input type="color" class="tsp-input tsp-color-picker" id="theme-color-text-muted">
                    </div>
                </div>
                <div class="tsp-form-row">
                    <div class="tsp-form-group">
                        <label>确认按钮/高亮色</label>
                        <input type="color" class="tsp-input tsp-color-picker" id="theme-color-accent-primary">
                    </div>
                    <div class="tsp-form-group">
                        <label>危险/删除按钮</label>
                        <input type="color" class="tsp-input tsp-color-picker" id="theme-color-accent-red">
                    </div>
                    <div class="tsp-form-group">
                        <label>启用状态 (眼睛)</label>
                        <input type="color" class="tsp-input tsp-color-picker" id="theme-color-status-enabled">
                    </div>
                    <div class="tsp-form-group">
                        <label>禁用状态 (眼睛)</label>
                        <input type="color" class="tsp-input tsp-color-picker" id="theme-color-status-disabled">
                    </div>
                </div>
            </div>
            <div class="tsp-settings-group">
                <h4 class="tsp-settings-group-title">
                    <i class="fa-solid fa-image"></i> 背景自定义
                </h4>
                <p class="tsp-text-muted" style="margin-top:-10px; margin-bottom:15px; font-size:0.85em;">
                    上传背景后，侧边栏、内容块等将变为半透明。支持图片、GIF、视频。
                </p>

                <div class="tsp-form-row">
                    <div class="tsp-form-group" style="flex:1;">
                        <label>横向背景 (电脑端)</label>
                        <div class="tsp-bg-preview" id="bg-preview-landscape">
                            <span class="tsp-text-muted">点击下方按钮上传</span>
                        </div>
                        <div class="tsp-btn-group" style="width:100%;">
                            <button class="tsp-btn" id="theme-bg-upload-landscape" style="flex:1;"><i class="fa-solid fa-upload"></i> 上传</button>
                            <button class="tsp-btn tsp-btn-danger" id="theme-bg-clear-landscape" style="flex:0;"><i class="fa-solid fa-trash"></i></button>
                        </div>
                        <input type="file" id="theme-bg-input-landscape" style="display:none" accept="image/*,video/*">
                    </div>

                    <div class="tsp-form-group" style="flex:1;">
                        <label>竖向背景 (手机端)</label>
                        <div class="tsp-bg-preview" id="bg-preview-portrait">
                            <span class="tsp-text-muted">点击下方按钮上传</span>
                        </div>
                         <div class="tsp-btn-group" style="width:100%;">
                            <button class="tsp-btn" id="theme-bg-upload-portrait" style="flex:1"> <i class="fa-solid fa-upload"></i> 上传</button>
                            <button class="tsp-btn tsp-btn-danger" id="theme-bg-clear-portrait" style="flex:0;"><i class="fa-solid fa-trash"></i></button>
                        </div>
                        <input type="file" id="theme-bg-input-portrait" style="display:none" accept="image/*,video/*">
                    </div>
                </div>

                <div class="tsp-form-group" style="margin-top:10px;">
                    <label>浮动元素不透明度: <span id="theme-bg-opacity-value">80%</span></label>
                    <input type="range" class="tsp-input" id="theme-bg-opacity-slider" min="0.1" max="1" step="0.05" value="0.8">
                </div>
            </div>
            <div class="tsp-settings-group">
                <h4 class="tsp-settings-group-title">
                    <i class="fa-solid fa-circle-dot"></i> 悬浮球图标自定义
                </h4>
                <p class="tsp-text-muted" style="margin-top:-10px; margin-bottom:15px; font-size:0.85em;">
                    上传图标后，将替代悬浮球的默认图层图标。支持 PNG、GIF 等图片格式。
                </p>
                <div class="tsp-form-row">
                    <div class="tsp-form-group" style="flex:1;">
                        <label>悬浮球图标</label>
                        <div class="tsp-bg-preview" id="fab-icon-preview">
                            <span class="tsp-text-muted">点击下方按钮上传</span>
                        </div>
                        <div class="tsp-btn-group" style="width:100%;">
                            <button class="tsp-btn" id="fab-icon-upload" style="flex:1;"><i class="fa-solid fa-upload"></i> 上传</button>
                            <button class="tsp-btn tsp-btn-danger" id="fab-icon-clear" style="flex:0;"><i class="fa-solid fa-trash"></i></button>
                        </div>
                        <input type="file" id="fab-icon-input" style="display:none" accept="image/*">
                        <div class="tsp-form-group" style="margin-top:15px;">
                            <label>图标大小: <span id="fab-icon-scale-value">100%</span></label>
                            <input type="range" class="tsp-input" id="fab-icon-scale-slider" min="0.333" max="10" step="0.05" value="1">
                            <p class="tsp-text-muted" style="margin-top:5px; font-size:0.8em;">调整范围：默认的 1/3 (33%) 到 10 倍 (1000%)</p>
                        </div>
                    </div>
                </div>
            </div>
        `;
    }
    /**
     * 获取模块化开关设置 (从存储读取，默认全部开启)
     */
    async _loadModuleToggleSettings() {
        const aiProcessor = await this.ctx.api.getValue('module_aiProcessor', false);
        const triggers = await this.ctx.api.getValue('module_triggers', true);
        const characterDB = await this.ctx.api.getValue('module_characterDB', true);
        const tagMarket = await this.ctx.api.getValue('module_tagMarket', false);
        const phoneEmulator = await this.ctx.api.getValue('module_phoneEmulator', false);
        const tagVisualization = await this.ctx.api.getValue('module_tagVisualization', false);
        const visualNovel = await this.ctx.api.getValue('module_visualNovel', false);

        this._setChecked('module-aiProcessor', aiProcessor);
        this._setChecked('module-triggers', triggers);
        this._setChecked('module-characterDB', characterDB);
        this._setChecked('module-tagMarket', tagMarket);
        this._setChecked('module-phoneEmulator', phoneEmulator);
        this._setChecked('module-tagVisualization', tagVisualization);
        this._setChecked('module-visualNovel', visualNovel);

        // AI二次处理关闭时，联动关闭并禁用依赖它的界面开关
        this._syncAiProcessorDependentToggles(aiProcessor);

        // 同步视觉模块开关状态并刷新入口按钮
        this.visualNovelEnabled = visualNovel;
        this._injectSettingsButton();
    }
    /**
     * AI二次处理模块开关联动：关闭时强制取消勾选并禁用依赖它的界面开关
     * （注入按钮/快捷生成悬浮球依赖 AI 处理器，未开启时点击会报错）
     * @param {boolean} aiProcessorOn
     */
    _syncAiProcessorDependentToggles(aiProcessorOn) {
        ['settings-inject-buttons-enabled', 'settings-quick-gen-fab-visible'].forEach(id => {
            const el = this.modalEl?.querySelector(`#${id}`);
            if (!(el instanceof HTMLInputElement)) return;
            if (!aiProcessorOn) {
                el.checked = false;
            }
            el.disabled = !aiProcessorOn;
            const group = el.closest('.tsp-form-group');
            if (group) {
                group.style.opacity = aiProcessorOn ? '' : '0.5';
                group.title = aiProcessorOn ? '' : '需先在「模块管理」中开启 AI二次处理';
            }
        });
    }
    /**
     * 获取模块化开关设置 (用于渲染时的默认值)
     */
    _getModuleToggleSettings() {
        // 这里只是用于初始渲染时的默认值，实际值会在 _loadSettings 中覆盖
        return {
            aiProcessor: false,
            triggers: true,
            characterDB: true,
            tagMarket: false,
            phoneEmulator: false,
            tagVisualization: false,
            visualNovel: false
        };
    }
    /**
     * 渲染模块化开关设置
     */
    _renderModuleToggleSettings() {
        const moduleSettings = this._getModuleToggleSettings();
        return `
            <div class="tsp-settings-group">
                <h4 class="tsp-settings-group-title">
                    <i class="fa-solid fa-plug-circle-bolt"></i> 模块管理
                </h4>
                <div class="tsp-info-box" style="margin-bottom: 15px; background: rgba(247, 118, 142, 0.1); border-color: var(--tsp-accent-secondary);">
                    <i class="fa-solid fa-circle-info"></i> <strong>提示：</strong>修改后点击<span style="color: var(--tsp-accent-primary); font-weight: bold;">"保存关闭"</span>按钮保存，然后<span style="color: var(--tsp-accent-red); font-weight: bold;">刷新浏览器</span>生效。
                </div>

                <div class="tsp-form-row">
                    <div class="tsp-form-group">
                        <label class="tsp-switch-label">
                            <input type="checkbox" class="tsp-switch" id="module-aiProcessor" ${moduleSettings.aiProcessor ? 'checked' : ''}>
                            <span class="tsp-switch-slider"></span>
                            <span>AI二次处理 (Tag二次处理)</span>
                        </label>
                        <p class="tsp-text-muted" style="margin:6px 0 0 0; font-size:0.8em;">关闭时将同时关闭「小铅笔旁边注入按钮」与「显示快捷生成悬浮球」（这两个功能依赖 AI 处理器）。</p>
                    </div>
                </div>

                <div class="tsp-form-row">
                    <div class="tsp-form-group">
                        <label class="tsp-switch-label">
                            <input type="checkbox" class="tsp-switch" id="module-triggers" ${moduleSettings.triggers ? 'checked' : ''}>
                            <span class="tsp-switch-slider"></span>
                            <span>触发词</span>
                        </label>
                    </div>
                </div>

                <div class="tsp-form-row">
                    <div class="tsp-form-group">
                        <label class="tsp-switch-label">
                            <input type="checkbox" class="tsp-switch" id="module-characterDB" ${moduleSettings.characterDB ? 'checked' : ''}>
                            <span class="tsp-switch-slider"></span>
                            <span>角色数据库</span>
                        </label>
                    </div>
                </div>

                <div class="tsp-form-row">
                    <div class="tsp-form-group">
                        <label class="tsp-switch-label">
                            <input type="checkbox" class="tsp-switch" id="module-tagMarket" ${moduleSettings.tagMarket ? 'checked' : ''}>
                            <span class="tsp-switch-slider"></span>
                            <span>标签超市</span>
                        </label>
                    </div>
                </div>

                <div class="tsp-form-row">
                    <div class="tsp-form-group">
                        <label class="tsp-switch-label">
                            <input type="checkbox" class="tsp-switch" id="module-phoneEmulator" ${moduleSettings.phoneEmulator ? 'checked' : ''}>
                            <span class="tsp-switch-slider"></span>
                            <span>手机模拟器</span>
                        </label>
                    </div>
                </div>

                <div class="tsp-form-row">
                    <div class="tsp-form-group">
                        <label class="tsp-switch-label">
                            <input type="checkbox" class="tsp-switch" id="module-tagVisualization" ${moduleSettings.tagVisualization ? 'checked' : ''}>
                            <span class="tsp-switch-slider"></span>
                            <span>图片编辑可视化</span>
                        </label>
                    </div>
                </div>

                <div class="tsp-form-row">
                    <div class="tsp-form-group">
                        <label class="tsp-switch-label">
                            <input type="checkbox" class="tsp-switch" id="module-visualNovel" ${moduleSettings.visualNovel ? 'checked' : ''}>
                            <span class="tsp-switch-slider"></span>
                            <span>视觉模块</span>
                        </label>
                    </div>
                </div>
            </div>
        `;
    }
    /**
     *  渲染更新页面 (兼容 TauriTavern)
     */
    _renderUpdateSettings() {
        const isTauriEnv = this.isTauriTavern || this.updateState.isTauriTavern;

        // TauriTavern 环境的提示信息
        const tauriInfoBox = isTauriEnv
            ? `<br><i class="fa-solid fa-desktop" style="color: var(--tsp-accent)"></i> <strong style="color: var(--tsp-accent)">TauriTavern 客户端</strong>：请通过客户端扩展管理器更新插件`
            : (this.updateState.hasUpdate
                ? `<br><i class="fa-solid fa-bell" style="color: var(--tsp-accent-red)"></i> <strong>发现新版本！请点击更新按钮。</strong>`
                : '<br><i class="fa-solid fa-check"></i> 当前已是最新版本');

        // TauriTavern 环境：按钮保持可点击，用于跳转仓库；非 Tauri 环境：正常逻辑
        const updateButtonDisabled = isTauriEnv ? '' : (this.updateState.hasUpdate ? '' : 'disabled');
        const updateButtonIcon = isTauriEnv ? 'fa-brands fa-github' : 'fa-solid fa-download';
        const updateButtonText = isTauriEnv ? '访问仓库获取' : '立即更新';

        const updateNotice = isTauriEnv
            ? `<p class="tsp-text-muted" style="margin-top: 5px; color: var(--tsp-accent);">
                    <i class="fa-solid fa-circle-info"></i>
                    TauriTavern 客户端使用独立的扩展管理机制。点击"访问仓库获取"可跳转到 GitHub 下载最新版本。
               </p>`
            : `<p class="tsp-text-muted" style="margin-top: 5px;">
                    注意：更新操作本质是 Git Pull，由于网络原因可能会失败，请确保你的酒馆终端可以访问 Github。
               </p>`;

        return `
            <div class="tsp-settings-group">
                <h4 class="tsp-settings-group-title">
                    <i class="fa-solid fa-cloud-arrow-down"></i> 版本控制
                    ${isTauriEnv ? '<span style="font-size: 12px; margin-left: 8px; padding: 2px 8px; background: var(--tsp-accent); color: white; border-radius: 10px;">TauriTavern</span>' : ''}
                </h4>
                <div class="tsp-info-box" style="margin-bottom: 15px;">
                    <i class="fa-solid fa-info-circle"></i> 当前版本: <strong>v${this.ctx.version}</strong>
                    ${this.updateState.currentHash && !isTauriEnv ? ` (${this.updateState.currentHash.substring(0, 8)})` : ''}
                    ${tauriInfoBox}
                </div>

                <div class="tsp-form-row">
                    <div class="tsp-form-group">
                        <label>更新操作</label>
                        <div class="tsp-btn-group">
                            <button class="tsp-btn tsp-btn-primary" id="tsp-btn-do-update" ${updateButtonDisabled}>
                                <i class="${updateButtonIcon}"></i> ${updateButtonText}
                            </button>
                            <button class="tsp-btn" id="tsp-btn-check-update">
                                <i class="fa-solid fa-rotate-right"></i> 检查更新
                            </button>
                        </div>
                    </div>
                    <div class="tsp-form-group" style="flex: 1;">
                        <label>仓库地址</label>
                        <input type="text" class="tsp-input" readonly value="https://github.com/shaochami/chami_tavern-scene-plugin" style="cursor: text;">
                    </div>
                </div>
                ${updateNotice}
            </div>

            <div class="tsp-settings-group" style="flex: 1; display: flex; flex-direction: column;">
                <h4 class="tsp-settings-group-title">
                    <i class="fa-solid fa-clipboard-list"></i> 更新日志 (Changelog)
                </h4>
                <div class="tsp-changelog-container">
                    ${this._getChangelogContent()}
                </div>
            </div>
        `;
    }

    /**
     *  更新日志内容定义 (请在此处维护日志)
     */
    _getChangelogContent() {
        const displayCount = 5;
        const totalVersions = changelogData.length;

        return `
            <div class="tsp-changelog-controls">
                <button class="tsp-btn tsp-btn-sm" id="tsp-changelog-expand-all">
                    <i class="fa-solid fa-chevron-down"></i> 展开全部 (${totalVersions})
                </button>
                <button class="tsp-btn tsp-btn-sm" id="tsp-changelog-collapse-all">
                    <i class="fa-solid fa-chevron-up"></i> 收起全部
                </button>
            </div>
            <div id="tsp-changelog-list" class="tsp-changelog-list-container">
                ${changelogData.map((log, index) => `
                    <div class="tsp-changelog-item" data-index="${index}">
                        <div class="tsp-changelog-header" data-expanded="${index < displayCount}">
                            <span class="tsp-changelog-version">${log.version}</span>
                            <i class="fa-solid fa-chevron-down tsp-changelog-toggle"></i>
                        </div>
                    </div>
                `).join('')}
            </div>
        `;
    }

    /**
     * 渲染提示词设置
     */
    _renderPromptsSettings() {
        return `
            <div class="tsp-settings-group">
                <h4 class="tsp-settings-group-title">
                    <i class="fa-solid fa-magnifying-glass"></i> 标签搜索
                </h4>
                <div class="tsp-form-group">
                    <label>通过关键词查找标准化的标签 (需要科学网络)：</label>
                    <div class="tsp-input-group">
                        <input type="text" class="tsp-input" id="prompt-tag-search" placeholder="例如：原神、1girl...">
                        <button class="tsp-btn" id="prompt-tag-search-btn"><i class="fa-solid fa-search"></i></button>
                </div>
            </div>
                <div class="tsp-form-row" style="align-items: stretch;">
                    <div class="tsp-form-group" style="flex:3;">
                        <label>搜索结果 (点击选择):</label>
                        <div id="prompt-tag-results" class="tsp-card muted">尚未搜索</div>
                </div>
                    <div class="tsp-form-group" style="flex:1; display:flex; flex-direction:column; gap:8px; justify-content:flex-end;">
                        <button class="tsp-btn" id="prompt-copy-tags"><i class="fa-solid fa-copy"></i> 复制标签</button>
                        <button class="tsp-btn tsp-btn-primary" id="prompt-fill-tags"><i class="fa-solid fa-arrow-down"></i> 填入提示词</button>
                    </div>
                    </div>
                </div>

            <div class="tsp-settings-group">
                <h4 class="tsp-settings-group-title">
                    <i class="fa-solid fa-pen-to-square"></i> 提示词预设编辑
                </h4>

                <div class="tsp-form-row">
                    <div class="tsp-form-group" style="flex:1;">
                        <label>提示词</label>
                        <select class="tsp-input" id="prompt-preset-prefix"></select>
                    </div>
                    </div>
                    <!--  固定形象输入框（支持多组） -->
                    <div class="tsp-form-group" id="prompt-fixed-appearance-group">
                        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
                            <label>固定形象 (用于生成参考图，最多3组)</label>
                            <button class="tsp-btn tsp-btn-sm" id="prompt-fixed-appearance-add" title="添加一组固定形象"><i class="fa-solid fa-plus"></i> 添加</button>
                        </div>
                        <div id="prompt-fixed-appearance-list"></div>
                    </div>

                <div class="tsp-btn-group">
                    <button class="tsp-btn" id="prompt-generate-ref-btn" title="使用当前参数+固定形象生成预览图"><i class="fa-solid fa-magic"></i> 生成参考图片</button>

                    <button class="tsp-btn tsp-btn-primary" id="prompt-preset-update"><i class="fa-solid fa-upload"></i> 更新</button>
                    <button class="tsp-btn" id="prompt-preset-saveas"><i class="fa-solid fa-save"></i> 另存</button>
                    <button class="tsp-btn tsp-btn-danger" id="prompt-preset-delete"><i class="fa-solid fa-trash"></i> 删除</button>
            </div>


                <div class="tsp-form-group" style="margin-top: 12px;">
                    <div class="tsp-btn-group" style="margin-bottom: 8px;">
                        <button class="tsp-btn tsp-btn-primary" id="prompt-switch-prefix">前置提示词</button>
                        <button class="tsp-btn" id="prompt-switch-suffix">后置提示词</button>
                    </div>
                    <label>正向提示词 (画师串)</label>
                    <textarea class="tsp-input" id="prompt-positive-text" rows="4" placeholder="1girl, solo, beautiful detailed eyes..."></textarea>
                </div>
                    <div class="tsp-form-group">
                    <label>负面提示词 (Negative Prompt)</label>
                    <textarea class="tsp-input" id="prompt-negative-text" rows="3" placeholder="low quality, bad anatomy..."></textarea>
                    </div>

                <div class="tsp-form-row" style="align-items:center; flex-wrap:wrap; gap:8px; border-top:1px solid var(--tsp-border); padding-top:12px;">
                    <label style="margin-bottom:0;">数据管理:</label>
                    <button class="tsp-btn" id="prompt-import-btn"><i class="fa-solid fa-file-import"></i> 导入</button>
                    <input type="file" id="prompt-import-input" style="display:none;" accept=".json">
                    <button class="tsp-btn" id="prompt-export-current"><i class="fa-solid fa-file-export"></i> 导出当前</button>
                    <button class="tsp-btn" id="prompt-export-multi" style="display:none;"><i class="fa-solid fa-file-export"></i> 导出选中</button>
                    <button class="tsp-btn" id="prompt-export-all"><i class="fa-solid fa-file-archive"></i> 导出全部</button>
                    <button class="tsp-btn" id="prompt-sort-btn"><i class="fa-solid fa-sort"></i> 排序</button>
                    <button class="tsp-btn" id="prompt-multi-btn"><i class="fa-solid fa-check-square"></i> 多选</button>
                    <button class="tsp-btn" id="prompt-upload-image"><i class="fa-solid fa-image"></i> 上传效果图</button>
                    <input type="file" id="prompt-upload-image-input" style="display:none;" accept="image/*">
                    <button class="tsp-btn" id="prompt-cancel-btn" style="display:none;"><i class="fa-solid fa-xmark"></i> 取消</button>
                    <button class="tsp-btn" id="prompt-select-all-btn" style="display:none;"><i class="fa-solid fa-square-check"></i> 全选</button>
                    </div>

                <h4 class="tsp-settings-group-title" style="margin-top: 18px;">
                    <i class="fa-solid fa-images"></i> 预设浏览器 (单击选择, 长按多选)
                </h4>
                <div id="prompt-preset-grid" class="tsp-preset-grid tsp-card muted">
                    <p class="tsp-text-muted">暂无预设</p>
                </div>
                <div id="prompt-preset-pagination" class="tsp-pagination"></div>
            </div>
        `;
    }

    /**
     * 渲染多角色定义设置
     */
    _renderMultiCharSettings() {
        const defaultConfig = {
            sceneCompositionHeader: 'Scene Composition:',
            characterPromptTemplate: 'Character {n} Prompt:',
            characterUCTemplate: 'Character {n} UC:',
            negativePromptHeader: 'Negative prompt:',
            coordinateTemplate: '|centers:{coord}',
            resolutionTemplate: 'size:',
            stylePresetTemplate: 'preset:',
            maxCharacters: 4,
            coordinateFormat: 'A-E,1-5'
        };

        return `
            <div class="tsp-settings-group">
                <h4 class="tsp-settings-group-title">
                    <i class="fa-solid fa-users-gear"></i> 多角色字段定义
                </h4>
                <p class="tsp-text-muted" style="margin-bottom: 15px;">
                    自定义多角色提示词的字段头格式。使用 <code>{n}</code> 作为角色数字占位符，使用 <code>{coord}</code> 作为坐标占位符。
                </p>

                <div class="tsp-form-row" style="margin-bottom: 15px;">
                    <div class="tsp-form-group" style="flex: 1;">
                        <label><i class="fa-solid fa-palette"></i> 字段预设</label>
                        <select class="tsp-input" id="multichar-preset-select">
                            <option value="common">通用 (Scene Composition / Character {n} Prompt)</option>
                            <option value="moyu">摸鱼 (Scene: / Char{n}:)</option>
                        </select>
                        <small class="tsp-text-muted">选择预设将自动填入字段头，切换前会自动保存当前预设的修改</small>
                    </div>
                </div>

                <div class="tsp-form-row">
                    <div class="tsp-form-group" style="flex: 1;">
                        <label>场景组合字段头</label>
                        <input type="text" class="tsp-input" id="multichar-scene-header"
                               placeholder="Scene Composition:" />
                        <small class="tsp-text-muted">场景描述的字段头，可包含分类标签</small>
                    </div>
                </div>

                <div class="tsp-form-row">
                    <div class="tsp-form-group" style="flex: 1;">
                        <label>角色提示词模板</label>
                        <input type="text" class="tsp-input" id="multichar-prompt-template"
                               placeholder="Character {n} Prompt:" />
                        <small class="tsp-text-muted">{n} 将被替换为角色编号 (1, 2, 3, 4...)</small>
                    </div>
                </div>

                <div class="tsp-form-row">
                    <div class="tsp-form-group" style="flex: 1;">
                        <label>角色负面词模板</label>
                        <input type="text" class="tsp-input" id="multichar-uc-template"
                               placeholder="Character {n} UC:" />
                        <small class="tsp-text-muted">角色专属负面提示词的字段头</small>
                    </div>
                </div>

                <div class="tsp-form-row">
                    <div class="tsp-form-group" style="flex: 1;">
                        <label>负面提示词字段头</label>
                        <input type="text" class="tsp-input" id="multichar-negative-header"
                               placeholder="Negative prompt:" />
                        <small class="tsp-text-muted">全局负面提示词的字段头</small>
                    </div>
                </div>

                <div class="tsp-form-row">
                    <div class="tsp-form-group" style="flex: 1;">
                        <label>坐标标记模板</label>
                        <input type="text" class="tsp-input" id="multichar-coord-template"
                               placeholder="|centers:{coord}" />
                        <small class="tsp-text-muted">{coord} 将被替换为坐标 (如 C3, A1), 若省略此标记或使用centers:auto，NAI 模式下将自动关闭坐标参数，由模型自行分配角色位置</small>
                    </div>
                </div>

                <div class="tsp-form-row">
                    <div class="tsp-form-group" style="flex: 1;">
                        <div style="display: flex; align-items: center; justify-content: space-between;">
                            <label>分辨率模板</label>
                            <label class="tsp-switch-label">
                                <input type="checkbox" class="tsp-switch" id="multichar-resolution-enabled">
                                <span class="tsp-switch-slider"></span>
                            </label>
                        </div>
                        <input type="text" class="tsp-input" id="multichar-resolution-template"
                               placeholder="size:" />
                        <small class="tsp-text-muted">匹配 Scene Composition 中的分辨率标记，格式：尺寸前缀 + 宽x高 (如 size: 1216x832)</small>
                    </div>
                </div>

                <div class="tsp-form-row">
                    <div class="tsp-form-group" style="flex: 1;">
                        <div style="display: flex; align-items: center; justify-content: space-between;">
                            <label>风格预设模板</label>
                            <label class="tsp-switch-label">
                                <input type="checkbox" class="tsp-switch" id="multichar-style-preset-enabled">
                                <span class="tsp-switch-slider"></span>
                            </label>
                        </div>
                        <input type="text" class="tsp-input" id="multichar-style-preset-template"
                               placeholder="preset:" />
                        <small class="tsp-text-muted">匹配 Scene Composition 中的风格预设标记 (如 preset:动漫)，将临时替换为同名「提示词预设」进行生成，不修改当前已选预设。</small><br><small class="tsp-text-muted" style="font-weight: bold; font-size: 14px; color: #ff6b6b;">⚠️ 注意！！！设备性能低预设多的用户不建议打开，临时加载在内存中会卡顿！！！</small>
                    </div>
                </div>

                <div class="tsp-form-row">
                    <div class="tsp-form-group" style="max-width: 150px;">
                        <label>最大角色数</label>
                        <select class="tsp-input" id="multichar-max-characters">
                            <option value="1">1 个角色</option>
                            <option value="2">2 个角色</option>
                            <option value="3">3 个角色</option>
                            <option value="4" selected>4 个角色</option>
                            <option value="5">5 个角色</option>
                            <option value="6">6 个角色</option>
                        </select>
                    </div>
                    <div class="tsp-form-group" style="flex: 1;">
                        <label>坐标格式说明</label>
                        <input type="text" class="tsp-input" id="multichar-coord-format"
                               placeholder="A-E (列), 1-5 (行)" readonly />
                        <small class="tsp-text-muted">列: A=左, B=偏左, C=中, D=偏右, E=右 | 行: 1=上, 3=中, 5=下</small>
                    </div>
                </div>
            </div>

            <div class="tsp-settings-group">
                <h4 class="tsp-settings-group-title">
                    <i class="fa-solid fa-eye"></i> 格式预览
                </h4>
                <div id="multichar-preview" style="background: rgba(0,0,0,0.3); padding: 15px; border-radius: 6px; font-family: monospace; font-size: 12px; white-space: pre-wrap; line-height: 1.6;">
                    <span class="tsp-text-muted">输入上方配置后，这里将显示格式预览...</span>
                </div>
            </div>

            <div class="tsp-settings-group">
                <h4 class="tsp-settings-group-title">
                    <i class="fa-solid fa-undo"></i> 操作
                </h4>
                <div class="tsp-form-row">
                    <button class="tsp-btn" id="multichar-reset-defaults">
                        <i class="fa-solid fa-rotate-left"></i> 恢复默认配置
                    </button>
                    <button class="tsp-btn tsp-btn-primary" id="multichar-apply">
                        <i class="fa-solid fa-check"></i> 应用配置
                    </button>
                </div>
            </div>
        `;
    }
    /**
     *  渲染图片管理设置
     */
    _renderGallerySettings() {
        return `
            <div class="tsp-settings-group">
                <h4 class="tsp-settings-group-title">
                    <i class="fa-solid fa-image"></i> 图片缓存查看
                </h4>
                <div class="tsp-form-row" style="align-items:flex-end; gap:8px; margin-bottom: 10px; background: rgba(0,0,0,0.2); padding: 10px; border-radius: 6px;">
                    <div class="tsp-form-group" style="flex: 1; max-width: 150px;">
                        <label style="font-size:0.8em">来源模式</label>
                        <select class="tsp-input" id="adv-cache-filter-mode">
                            <option value="all">全部 (All)</option>
                            <option value="sd">Stable Diffusion</option>
                            <option value="nai">NovelAI</option>
                            <option value="comfyui">ComfyUI</option>
                            <option value="other">OpenAI / Other</option>
                            <option value="tag_supermarket">标签超市</option>
                        </select>
                    </div>
                    <div class="tsp-form-group" style="flex: 1; min-width: 260px;">
                        <label style="font-size:0.8em">日期范围 (开始 - 结束)</label>
                        <div style="display:flex; gap:5px; align-items:center;">
                            <input type="date" class="tsp-input" id="adv-cache-filter-start">
                            <span class="tsp-text-muted">-</span>
                            <input type="date" class="tsp-input" id="adv-cache-filter-end">
                        </div>
                    </div>
                    <div class="tsp-form-group" style="flex: 0; min-width: 80px;">
                        <button class="tsp-btn tsp-btn-primary" id="adv-cache-apply-filter" style="width: 100%;">
                            <i class="fa-solid fa-filter"></i> 筛选
                        </button>
                    </div>
                </div>
                <div class="tsp-form-row tsp-cache-toolbar" style="align-items:center; gap:8px;">
                    <div class="tsp-text-muted" id="adv-cache-info" style="flex: 1; min-width: 200px;">点击刷新加载缓存...</div>

                    <div class="tsp-btn-group" style="flex-wrap:wrap;">
                        <button class="tsp-btn tsp-btn-primary" id="adv-cache-refresh" title="刷新">
                            <i class="fa-solid fa-sync"></i> <span class="tsp-btn-text">刷新</span>
                        </button>
                        <button class="tsp-btn" id="adv-cache-multi-select" title="多选">
                            <i class="fa-solid fa-check-square"></i> <span class="tsp-btn-text">多选</span>
                        </button>
                        <button class="tsp-btn" id="adv-cache-download-selected" title="下载选中图片" style="display:none;">
                            <i class="fa-solid fa-download"></i> <span class="tsp-btn-text">下载选中</span>
                        </button>
                        <button class="tsp-btn" id="adv-cache-select-all" title="全选当前页" style="display:none;">
                            <i class="fa-solid fa-square-check"></i> <span class="tsp-btn-text">全选</span>
                        </button>
                        <button class="tsp-btn" id="adv-cache-export" title="导出数据">
                            <i class="fa-solid fa-file-export"></i> <span class="tsp-btn-text">导出</span>
                        </button>
                        <button class="tsp-btn" id="adv-cache-import" title="导入数据">
                            <i class="fa-solid fa-file-import"></i> <span class="tsp-btn-text">导入</span>
                        </button>
                        <input type="file" id="adv-cache-import-input" style="display:none;" accept=".json">
                        <button class="tsp-btn" id="adv-cache-download-all" title="下载全部图片(ZIP)">
                            <i class="fa-solid fa-archive"></i> <span class="tsp-btn-text">下载全部</span>
                        </button>
                        <button class="tsp-btn tsp-btn-danger" id="adv-cache-clear-page" title="清空当前页">
                            <i class="fa-solid fa-eraser"></i> <span class="tsp-btn-text">清空当前页</span>
                        </button>
                    </div>
                </div>
                <div id="adv-cache-grid" class="tsp-cache-grid tsp-card muted">
                    <p class="tsp-text-muted">请点击刷新按钮或等待加载...</p>
                </div>
            </div>
        `;
    }
    /**
     * 渲染高级设置
     */
    _renderAdvancedSettings() {
        return `
            <div class="tsp-settings-group">
                <h4 class="tsp-settings-group-title">
                    <i class="fa-solid fa-code"></i> 内容解析
                </h4>
                <div class="tsp-form-row">
                <div class="tsp-form-group">
                        <label>开始标记 (Start Tag)</label>
                        <input type="text" class="tsp-input" id="adv-start-tag" placeholder="image###" />
                </div>
                <div class="tsp-form-group">
                        <label>结束标记 (End Tag)</label>
                        <input type="text" class="tsp-input" id="adv-end-tag" placeholder="###" />
                    </div>
                </div>
            </div>

            <div class="tsp-settings-group">
                <h4 class="tsp-settings-group-title">
                    <i class="fa-solid fa-robot"></i> 自动化与显示
                </h4>
                <div class="tsp-form-row">
                    <div class="tsp-form-group">
                        <label>自动点击生成</label>
                        <select class="tsp-input" id="adv-auto-generate">
                            <option value="true">启用</option>
                            <option value="false">禁用</option>
                    </select>
                </div>
                <div class="tsp-form-group">
                        <label>最大自动点击数</label>
                        <input type="number" class="tsp-input" id="adv-max-auto-clicks" min="1" />
                </div>
                    <div class="tsp-form-group">
                        <label>流式预加载</label>
                        <select class="tsp-input" id="adv-streaming">
                            <option value="false">禁用</option>
                            <option value="true">启用</option>
                        </select>
                        <small class="tsp-text-muted">AI输出时提前生成图片以加速响应</small>
            </div>
                <div class="tsp-form-group">
                        <label>显示图片数量</label>
                        <input type="number" class="tsp-input" id="adv-show-count" min="0" />
                </div>
                </div>
                <div class="tsp-form-row">
                <div class="tsp-form-group">
                        <label>隐藏按钮为双击图片</label>
                        <select class="tsp-input" id="adv-double-click">
                            <option value="false">禁用</option>
                            <option value="true">启用</option>
                        </select>
                    </div>
                    <div class="tsp-form-group">
                        <label>预设预览图质量</label>
                        <select class="tsp-input" id="adv-preset-quality">
                            <option value="thumbnail">缩略图 (快速)</option>
                            <option value="original">原图 (高清)</option>
                        </select>
                    </div>
                    <div class="tsp-form-group">
                        <label>兼容前端</label>
                        <select class="tsp-input" id="adv-display-mode">
                            <option value="默认">默认(快速扫描)</option>
                            <option value="兼容前端">深度扫描(兼容大部分前端)</option>
                        </select>
                    </div>
                    <div class="tsp-form-group">
                        <label>缓存有效期</label>
                        <select class="tsp-input" id="adv-cache-days">
                            <option value="0">不缓存</option>
                            <option value="1">缓存一天</option>
                            <option value="7">缓存一星期</option>
                            <option value="30">缓存一个月</option>
                            <option value="365">缓存一年</option>
                        </select>
                    </div>
                    <div class="tsp-form-group">
                        <label>隐私模式 (折叠显示)</label>
                        <select class="tsp-input" id="adv-privacy-mode">
                            <option value="false">禁用 (直接显示)</option>
                            <option value="true">启用 (点击展开)</option>
                        </select>
                        <small class="tsp-text-muted">开启后图片默认隐藏，需手动点击展开</small>
                    </div>
                </div>
                <div class="tsp-form-group">
                    <label>图片缩放比例: <span id="adv-zoom-value">100%</span></label>
                    <input type="range" class="tsp-input" id="adv-zoom" min="20" max="100" step="1" value="100">
                </div>
            </div>
            <div class="tsp-settings-group">
                <h4 class="tsp-settings-group-title">
                    <i class="fa-solid fa-hard-drive"></i> 图片存储设置
                </h4>
                <p class="tsp-text-muted">选择图片的存储位置。酒馆模式下图片保存到服务器，换设备也能使用。</p>
                <div class="tsp-form-row">
                    <div class="tsp-form-group">
                        <label>存储模式</label>
                        <select class="tsp-input" id="adv-storage-mode">
                            <option value="browser">浏览器 (IndexedDB)</option>
                            <option value="tavern">酒馆服务器 (跨设备)</option>
                            <option value="github">GitHub 存储</option>
                        </select>
                    </div>
                    <div class="tsp-form-group">
                        <label class="tsp-switch-label" style="margin-top: 24px;">
                            <input type="checkbox" class="tsp-switch" id="adv-keep-browser-cache" checked>
                            <span class="tsp-switch-slider"></span>
                            <span>保留浏览器缓存</span>
                        </label>
                        <small class="tsp-text-muted">酒馆模式下同时保留本地缓存以加速加载</small>
                    </div>
                </div>
                <!-- GitHub 存储模式相关设置 -->
                <div id="adv-github-storage-settings" class="tsp-form-row" style="display: none; margin-top: 12px;">
                    <div class="tsp-form-group" style="flex: 1;">
                        <label>插件库名字</label>
                        <input type="text" class="tsp-input" id="adv-github-repo" placeholder="例如：shaochami/image-cache">
                    </div>
                    <div class="tsp-form-group" style="flex: 1;">
                        <label>权限token</label>
                        <input type="text" class="tsp-input" id="adv-github-token" placeholder="例如：ghp_xxxxxxxxxxxx">
                    </div>
                </div>

                <div class="tsp-form-row" style="align-items:center; gap:8px; margin-top: 12px;">
                    <div class="tsp-text-muted" id="adv-storage-stats">点击刷新查看存储统计...</div>
                    <div class="tsp-btn-group">
                        <button class="tsp-btn" id="adv-storage-stats-refresh"><i class="fa-solid fa-sync"></i> 刷新统计</button>
                        <button class="tsp-btn" id="adv-sync-from-server"><i class="fa-solid fa-cloud-download-alt"></i> 从服务器同步</button>
                        <button class="tsp-btn tsp-btn-primary" id="adv-migrate-to-tavern"><i class="fa-solid fa-cloud-upload-alt"></i> 迁移到酒馆</button>
                        <button class="tsp-btn" id="adv-migrate-to-browser"><i class="fa-solid fa-download"></i> 迁移到浏览器</button>
                    </div>
                </div>
                <div id="adv-migration-progress" style="display:none; margin-top: 12px;">
                    <div class="tsp-progress-bar">
                        <div class="tsp-progress-fill" style="width: 0%;"></div>
                    </div>
                    <div class="tsp-text-muted" id="adv-migration-status">准备中...</div>
                </div>
            </div>
            <div class="tsp-settings-group">
                <h4 class="tsp-settings-group-title">
                    <i class="fa-solid fa-database"></i> 数据管理
                </h4>
                <div class="tsp-settings-group" style="padding: 12px; background: var(--tsp-bg-tertiary); border-radius:8px; margin-top:10px;">
                    <h4 class="tsp-settings-group-title" style="font-size: 0.95em; border:none; margin-top:0; margin-bottom:12px;">
                        <i class="fa-solid fa-gears"></i> 生图主设置数据
                    </h4>
                    <div class="tsp-form-row" style="flex-wrap:wrap; gap:8px;">
                        <button class="tsp-btn" id="settings-export-main-settings">
                            <i class="fa-solid fa-download"></i> 导出设置
                        </button>
                        <button class="tsp-btn" id="settings-import-main-settings">
                            <i class="fa-solid fa-upload"></i> 导入设置
                        </button>
                        <input type="file" id="settings-import-main-input" style="display: none;" accept=".json">
                        <button class="tsp-btn tsp-btn-danger" id="settings-clear-main-settings">
                            <i class="fa-solid fa-trash"></i> 清空设置
                        </button>
                    </div>
                </div>
                <div class="tsp-settings-group" style="padding: 12px; background: var(--tsp-bg-tertiary); border-radius:8px; margin-top:10px;">
                    <h4 class="tsp-settings-group-title" style="font-size: 0.95em; border:none; margin-top:0; margin-bottom:12px;">
                        <i class="fa-solid fa-wand-magic-sparkles"></i> 二次处理
                    </h4>
                    <div class="tsp-form-row" style="flex-wrap:wrap; gap:8px;">
                        <button class="tsp-btn" id="settings-export-prompt-opt">
                            <i class="fa-solid fa-download"></i> 导出数据
                        </button>
                        <button class="tsp-btn" id="settings-import-prompt-opt">
                            <i class="fa-solid fa-upload"></i> 导入数据
                        </button>
                        <input type="file" id="settings-import-prompt-opt-input" style="display: none;" accept=".json">
                        <button class="tsp-btn tsp-btn-danger" id="settings-clear-prompt-opt">
                            <i class="fa-solid fa-trash"></i> 清空数据
                        </button>
                    </div>
                </div>
            </div>
        `;
    }

    /**
     * 渲染触发词设置
     */
    _renderTriggersSettings() {
        return `
            <div class="tsp-settings-group">
                <h4 class="tsp-settings-group-title">
                    <i class="fa-solid fa-toggle-on"></i> 数据源开关
                </h4>
                <p class="tsp-text-muted">选择启用哪些触发词数据源进行替换处理。</p>
                <div class="tsp-form-group">
                    <label class="tsp-switch-label">
                        <input type="checkbox" class="tsp-switch" id="trigger-enable-tag-supermarket">
                        <span class="tsp-switch-slider"></span>
                        <span>标签超市数据源 (中文→英文)</span>
                    </label>
                    <small class="tsp-text-muted">使用标签超市的中英文映射进行替换</small>
                </div>
                <div class="tsp-form-group">
                    <label class="tsp-switch-label">
                        <input type="checkbox" class="tsp-switch" id="trigger-enable-json-file">
                        <span class="tsp-switch-slider"></span>
                        <span>JSON 文件触发词</span>
                    </label>
                    <small class="tsp-text-muted">从导入的 JSON 文件加载触发词</small>
                </div>
                <div class="tsp-form-group">
                    <label class="tsp-switch-label">
                        <input type="checkbox" class="tsp-switch" id="trigger-enable-custom" checked>
                        <span class="tsp-switch-slider"></span>
                        <span>自定义触发词</span>
                    </label>
                    <small class="tsp-text-muted">使用下方手动添加的触发词</small>
                </div>
                <div class="tsp-form-group">
                    <label class="tsp-switch-label">
                        <input type="checkbox" class="tsp-switch" id="trigger-enable-character-db" checked disabled>
                        <span class="tsp-switch-slider"></span>
                        <span>角色数据库专属触发词 (自动)</span>
                    </label>
                    <small class="tsp-text-muted">自动从角色数据库读取触发词，支持上下文感知</small>
                </div>
            </div>

            <div class="tsp-settings-group">
                <h4 class="tsp-settings-group-title">
                    <i class="fa-solid fa-bolt"></i> 自定义触发词
                </h4>
                <p class="tsp-text-muted">手动添加触发词规则，支持 | 分隔多个触发词。</p>
                <div class="tsp-form-row" style="gap:8px;">
                    <div class="tsp-form-group" style="flex:1;">
                        <label>触发词 (支持 | 分隔)</label>
                        <input type="text" class="tsp-input" id="trigger-new-key" placeholder="例如: 爱丽丝|alice">
                    </div>
                    <div class="tsp-form-group" style="flex:2;">
                        <label>替换内容</label>
                        <input type="text" class="tsp-input" id="trigger-new-value" placeholder="例如: <lora:alice_v1:0.8>, alice, blonde hair">
                    </div>
                    <div class="tsp-form-group" style="align-self:flex-end;">
                        <button class="tsp-btn tsp-btn-primary" id="trigger-add-custom">
                            <i class="fa-solid fa-plus"></i> 添加
                        </button>
                    </div>
                </div>

                <!-- JSON 文件导入功能 -->
                <div class="tsp-form-row" style="align-items:center; gap:8px; margin-top:12px;">
                    <button class="tsp-btn" id="trigger-import-json">
                        <i class="fa-solid fa-upload"></i> 导入 JSON
                    </button>
                    <input type="file" id="trigger-import-json-input" style="display:none;" accept=".json">
                    <button class="tsp-btn" id="trigger-export-json">
                        <i class="fa-solid fa-download"></i> 导出 JSON
                    </button>
                    <button class="tsp-btn tsp-btn-danger" id="trigger-clear-json">
                        <i class="fa-solid fa-trash"></i> 清除 JSON
                    </button>
                    <span class="tsp-text-muted" id="trigger-json-status">未导入</span>
                </div>
                <small class="tsp-text-muted">JSON 格式: <code>{ "触发词1": "替换内容1", "触发词2": "替换内容2" }</code></small>

                <div class="tsp-form-group" style="margin-top:16px;">
                    <label>已添加的触发词</label>
                    <div id="trigger-custom-list" class="tsp-triggers-list tsp-card">
                        <p class="tsp-text-muted">暂无触发词</p>
                    </div>
                </div>
            </div>

            <div class="tsp-settings-group">
                <h4 class="tsp-settings-group-title">
                    <i class="fa-solid fa-trash"></i> 自定义删除触发词
                </h4>
                <p class="tsp-text-muted">手动添加删除触发词规则，支持 | 分隔多个触发词。</p>
                <div class="tsp-form-row" style="align-items:center; gap:8px; margin-bottom:12px;">
                    <button class="tsp-btn" id="trigger-import-delete-json">
                        <i class="fa-solid fa-upload"></i> 导入删除触发词
                    </button>
                    <input type="file" id="trigger-import-delete-json-input" style="display:none;" accept=".json">
                    <button class="tsp-btn" id="trigger-export-delete-json">
                        <i class="fa-solid fa-download"></i> 导出删除触发词
                    </button>
                    <button class="tsp-btn tsp-btn-danger" id="trigger-clear-delete-json">
                        <i class="fa-solid fa-trash"></i> 清除所有
                    </button>
                    <span class="tsp-text-muted" id="trigger-delete-json-status">未导入</span>
                </div>
                <div class="tsp-form-row" style="gap:8px;">
                    <div class="tsp-form-group">
                        <label>自定义占位符 (支持 | 分隔)</label>
                        <input type="text" class="tsp-input" id="trigger-placeholders" placeholder="例如: {x}|[x]|{n}|[n]">
                    </div>
                </div>
                <div class="tsp-form-row" style="gap:8px;">
                    <div class="tsp-form-group" style="flex:1;">
                        <label>触发词 (支持 | 分隔)</label>
                        <input type="text" class="tsp-input" id="trigger-delete-new-key" placeholder="例如: close one's eyes">
                    </div>
                    <div class="tsp-form-group" style="flex:2;">
                        <label>删除内容 (支持 | 分隔)</label>
                        <input type="text" class="tsp-input" id="trigger-delete-new-value" placeholder="例如: {n} eyes|eyes [x]">
                    </div>
                    <div class="tsp-form-group" style="align-self:flex-end;">
                        <button class="tsp-btn tsp-btn-primary" id="trigger-add-delete-custom">
                            <i class="fa-solid fa-plus"></i> 添加
                        </button>
                    </div>
                </div>
                <div class="tsp-form-group">
                    <label>已添加的删除触发词</label>
                    <div id="trigger-delete-custom-list" class="tsp-triggers-list tsp-card">
                        <p class="tsp-text-muted">暂无自定义删除触发词</p>
                    </div>
                </div>
            </div>

            <div class="tsp-settings-group">
                <h4 class="tsp-settings-group-title">
                    <i class="fa-solid fa-flask"></i> 测试触发词
                </h4>
                <div class="tsp-form-group">
                    <label>输入测试文本</label>
                    <textarea class="tsp-input" id="trigger-test-input" rows="2" placeholder="输入包含触发词的文本进行测试..."></textarea>
                </div>
                <div class="tsp-form-row" style="gap:8px; align-items:center;">
                    <button class="tsp-btn tsp-btn-primary" id="trigger-test-btn">
                        <i class="fa-solid fa-play"></i> 测试替换
                    </button>
                </div>
                <div class="tsp-form-group">
                    <label>替换结果</label>
                    <textarea class="tsp-input" id="trigger-test-output" rows="2" readonly placeholder="替换结果将显示在这里..."></textarea>
                </div>
            </div>

            <div class="tsp-settings-group">
                <h4 class="tsp-settings-group-title">
                    <i class="fa-solid fa-info-circle"></i> 使用说明
                </h4>
                <div class="tsp-text-muted" style="font-size: 0.9em; line-height: 1.6;">
                    <p><strong>触发词优先级:</strong> 角色数据库专属 > 自定义 > JSON 文件 > 标签超市</p>
                    <p><strong>LoRA 保护:</strong> <code>&lt;lora:xxx&gt;</code> 格式的标签不会被替换</p>
                    <p><strong>权重继承:</strong> 触发词后的权重 (如 <code>:1.2</code>) 会应用到替换内容</p>
                    <p><strong>上下文感知:</strong> 角色数据库触发词会根据当前角色上下文进行智能替换</p>
                </div>
            </div>
        `;
    }
    /**
     * [修改] 绑定主题相关事件
     */
    _bindThemeEvents() {
        this.defaultThemes = {
            'xuan': { name: '玄色', data: getThemePresetData('xuan') },
            'day': { name: '纯白', data: getThemePresetData('day') },
            'sakura': { name: '樱花粉', data: getThemePresetData('sakura') },
            'paper': { name: '羊皮纸', data: getThemePresetData('paper') },
            'eyecare': { name: '护眼绿', data: getThemePresetData('eyecare') },
            'deep_sea': { name: '深海', data: getThemePresetData('deep_sea') },
            'dark_gold': { name: '流金', data: getThemePresetData('dark_gold') },
            'violet': { name: '紫罗兰', data: getThemePresetData('violet') },
            'cyberpunk': { name: '赛博朋克', data: getThemePresetData('cyberpunk') },
            'midnight': { name: '午夜', data: getThemePresetData('midnight') },
            'ocean': { name: '海洋', data: getThemePresetData('ocean') },
            'sunset': { name: '日落', data: getThemePresetData('sunset') }
        };

        // 变量映射表
        const varMap = {
            '--tsp-bg-main': 'theme-color-bg-main',
            '--tsp-bg-secondary': 'theme-color-bg-secondary',
            '--tsp-bg-input': 'theme-color-bg-input',
            '--tsp-text-input': 'theme-color-text-input', //  映射关系
            '--tsp-border': 'theme-color-border',
            '--tsp-text-primary': 'theme-color-text-primary',
            '--tsp-text-secondary': 'theme-color-text-secondary',
            '--tsp-text-muted': 'theme-color-text-muted', //
            '--tsp-accent-primary': 'theme-color-accent-primary',
            '--tsp-accent-red': 'theme-color-accent-red',
            '--tsp-status-enabled': 'theme-color-status-enabled',
            '--tsp-status-disabled': 'theme-color-status-disabled',
            '--tsp-btn-gen-grad-1': 'theme-color-btn-grad-1',
            '--tsp-btn-gen-grad-2': 'theme-color-btn-grad-2',
            '--tsp-btn-gen-text': 'theme-color-btn-text'
        };

        // 实时预览
        Object.entries(varMap).forEach(([cssVar, inputId]) => {
            const input = this.modalEl.querySelector(`#${inputId}`);
            if (input) {
                input.addEventListener('input', (e) => {
                    document.documentElement.style.setProperty(cssVar, e.target.value);
                });
            }
        });

        // 绑定按钮事件
        this.modalEl.querySelector('#theme-btn-update')?.addEventListener('click', () => this._updateTheme());
        this.modalEl.querySelector('#theme-btn-saveas')?.addEventListener('click', () => this._saveThemeAs());
        this.modalEl.querySelector('#theme-btn-delete')?.addEventListener('click', () => this._deleteTheme());

        const select = this.modalEl.querySelector('#theme-select-preset');
        if (select) {
            select.addEventListener('change', (e) => {
                this._applyTheme(e.target.value);
            });
        }

        //  绑定背景自定义事件
        const setupBgUpload = (type) => {
            const uploadBtn = this.modalEl.querySelector(`#theme-bg-upload-${type}`);
            const clearBtn = this.modalEl.querySelector(`#theme-bg-clear-${type}`);
            const input = this.modalEl.querySelector(`#theme-bg-input-${type}`);

            uploadBtn?.addEventListener('click', () => input.click());
            clearBtn?.addEventListener('click', () => this._handleBackgroundClear(type));
            input?.addEventListener('change', (e) => {
                if (e.target.files && e.target.files[0]) {
                    this._handleBackgroundUpload(e.target.files[0], type);
                }
            });
        };

        setupBgUpload('landscape');
        setupBgUpload('portrait');

        const fabUploadBtn = this.modalEl.querySelector('#fab-icon-upload');
        const fabClearBtn = this.modalEl.querySelector('#fab-icon-clear');
        const fabInput = this.modalEl.querySelector('#fab-icon-input');
        fabUploadBtn?.addEventListener('click', () => fabInput.click());
        fabClearBtn?.addEventListener('click', () => this._handleFabIconClear());
        fabInput?.addEventListener('change', (e) => {
            if (e.target.files && e.target.files[0]) {
                this._handleFabIconUpload(e.target.files[0]);
            }
        });

        const opacitySlider = this.modalEl.querySelector('#theme-bg-opacity-slider');
        const opacityValue = this.modalEl.querySelector('#theme-bg-opacity-value');
        opacitySlider?.addEventListener('input', (e) => {
            const value = parseFloat(e.target.value);
            this.backgroundSettings.opacity = value;
            if (opacityValue) {
                opacityValue.textContent = `${Math.round(value * 100)}%`;
            }
            // 实时应用透明度
            this._applyCustomBackground(true); // 传入 true 表示只更新样式，不重新加载媒体
        });

        const fabScaleSlider = this.modalEl.querySelector('#fab-icon-scale-slider');
        const fabScaleValue = this.modalEl.querySelector('#fab-icon-scale-value');
        fabScaleSlider?.addEventListener('input', (e) => {
            const value = parseFloat(e.target.value);
            this.backgroundSettings.fabIconScale = value;
            if (fabScaleValue) {
                fabScaleValue.textContent = `${Math.round(value * 100)}%`;
            }
            // 实时应用缩放
            this._applyFabIcon();
        });


        // 初始化加载
        this._loadAndRenderThemeList();
    }
    /**
     *  应用主题预设
     */
    async _applyThemePreset(presetKey) {
        const theme = this.themePresets[presetKey];
        if (!theme) return;

        // 应用到 DOM
        Object.entries(theme).forEach(([key, val]) => {
            document.documentElement.style.setProperty(key, val);
        });

        // 更新 Input 显示
        this._loadThemeToInputs(); // 重新读取 CSS 变量刷新 Input

        // 自动保存
        await this.ctx.api.setValue('current_theme_data', theme);
        this.ctx.helpers.showToast(`已应用预设：${presetKey === 'xuan' ? '玄色' : presetKey === 'day' ? '白天' : '樱花粉'}`, 'success');
    }

    /**
     *  保存当前自定义主题
     */
    async _saveCurrentTheme() {
        // 获取所有相关变量的当前计算值
        const computedStyle = getComputedStyle(document.documentElement);
        const keys = Object.keys(this.themePresets.xuan); // 使用玄色作为键模板
        const saveData = {};

        keys.forEach(key => {
            saveData[key] = computedStyle.getPropertyValue(key).trim();
        });

        await this.ctx.api.setValue('current_theme_data', saveData);
        this.ctx.helpers.showToast('自定义主题已保存', 'success');
    }

    /**
     *  将当前 CSS 变量值同步到颜色选择器 Input
     */
    _loadThemeToInputs(varMapOverride = null) {
        const varMap = varMapOverride || {
            '--tsp-bg-main': 'theme-color-bg-main',
            '--tsp-bg-secondary': 'theme-color-bg-secondary',
            '--tsp-bg-input': 'theme-color-bg-input',
            '--tsp-text-input': 'theme-color-text-input', //  映射关系
            '--tsp-border': 'theme-color-border',
            '--tsp-text-primary': 'theme-color-text-primary',
            '--tsp-text-secondary': 'theme-color-text-secondary',
            '--tsp-text-muted': 'theme-color-text-muted', //
            '--tsp-accent-primary': 'theme-color-accent-primary',
            '--tsp-accent-red': 'theme-color-accent-red',
            '--tsp-btn-gen-grad-1': 'theme-color-btn-grad-1',
            '--tsp-btn-gen-grad-2': 'theme-color-btn-grad-2',
            '--tsp-btn-gen-text': 'theme-color-btn-text'
        };

        const computedStyle = getComputedStyle(document.documentElement);

        Object.entries(varMap).forEach(([cssVar, inputId]) => {
            const input = this.modalEl.querySelector(`#${inputId}`);
            if (input) {
                let val = computedStyle.getPropertyValue(cssVar).trim();
                // 确保是 HEX 格式 (input type=color 需要 #RRGGBB)
                // 如果浏览器返回 rgb()，这个简单的实现可能无法正确显示在 color picker 上，但大部分情况变量定义就是 HEX
                if (val.startsWith('#')) {
                    input.value = val;
                }
            }
        });
    }

    /**
     *  加载并渲染主题列表 (核心逻辑)
     */
    async _loadAndRenderThemeList() {
        const select = this.modalEl.querySelector('#theme-select-preset');
        if (!select) return;

        // 1. 加载数据
        // 尝试从 ImageStorageManager (服务器) 加载 tavern_scene.json
        const imageGen = this.ctx.getModule('imageGen');
        let serverData = null;
        if (imageGen && imageGen.storageManager) {
            serverData = await imageGen.storageManager.loadThemeData();
        }

        // 如果服务器没有，降级到本地 API 存储
        const localData = await this.ctx.api.getValue('custom_themes_data', { active: 'xuan', customs: {} });

        // 优先使用服务器数据
        const data = serverData || localData;
        this.customThemes = data.customs || {};
        this.activeThemeName = data.active || 'xuan';
        //  加载背景设置，如果不存在则使用默认值
        this.backgroundSettings = data.backgroundSettings || {
            landscape: null,
            portrait: null,
            opacity: 0.8,
            fabIcon: null,
            fabIconScale: 1
        };
        // 确保 opacity 字段存在
        if (typeof this.backgroundSettings.opacity === 'undefined') {
            this.backgroundSettings.opacity = 1;
        }
        // 确保 fabIcon 字段存在
        if (typeof this.backgroundSettings.fabIcon === 'undefined') {
            this.backgroundSettings.fabIcon = null;
        }
        // 确保 fabIconScale 字段存在
        if (typeof this.backgroundSettings.fabIconScale === 'undefined') {
            this.backgroundSettings.fabIconScale = 1;
        }

        //  应用一次背景
        this._applyCustomBackground();
        //  更新背景设置UI的显示
        this._updateBackgroundUI();
        // 2. 渲染 Select
        select.innerHTML = '';

        // 组 1: 默认主题
        const grpDefault = document.createElement('optgroup');
        grpDefault.label = "默认主题";
        Object.keys(this.defaultThemes).forEach(key => {
            const opt = document.createElement('option');
            opt.value = key;
            opt.textContent = this.defaultThemes[key].name;
            grpDefault.appendChild(opt);
        });
        select.appendChild(grpDefault);

        // 组 2: 自定义主题
        const grpCustom = document.createElement('optgroup');
        grpCustom.label = "自定义主题";
        Object.keys(this.customThemes).forEach(key => {
            const opt = document.createElement('option');
            opt.value = key;
            opt.textContent = key;
            grpCustom.appendChild(opt);
        });
        select.appendChild(grpCustom);

        // 3. 选中当前项 & 应用一次
        select.value = this.activeThemeName;
        // 如果当前 active 的主题不在列表里(被删了?)，回退到 xuan
        if (!select.value) {
            select.value = 'xuan';
            this.activeThemeName = 'xuan';
        }

        // 刷新输入框颜色
        this._loadThemeToInputs();

        // 更新按钮状态
        this._updateThemeButtonsState();

        // 应用悬浮球自定义图标
        this._applyFabIcon();
    }

    /**
     * [修改] 应用主题 (并保存选中状态)
     */
    async _applyTheme(name) {
        this.activeThemeName = name;

        // 获取 CSS 变量数据
        let themeVars = {};
        if (this.defaultThemes[name]) {
            themeVars = this.defaultThemes[name].data;
        } else if (this.customThemes[name]) {
            themeVars = this.customThemes[name];
        } else {
            return;
        }

        // 应用到 DOM
        Object.entries(themeVars).forEach(([k, v]) => {
            document.documentElement.style.setProperty(k, v);
        });

        // 刷新 UI
        this._loadThemeToInputs();
        this._updateThemeButtonsState();

        // 自动保存状态
        await this._persistThemes();
    }

    /**
     *  获取当前 DOM 中的颜色 (作为新数据)
     */
    _getCurrentColorsFromDOM() {
        const style = getComputedStyle(document.documentElement);
        const keys = Object.keys(this.defaultThemes.xuan.data); // 以玄色的 key 为模板
        const data = {};
        keys.forEach(k => {
            data[k] = style.getPropertyValue(k).trim();
        });
        return data;
    }

    /**
     *  按钮逻辑: 更新
     */
    async _updateTheme() {
        const name = this.activeThemeName;
        if (this.defaultThemes[name]) {
            this.ctx.helpers.showToast('无法修改默认主题，请使用"另存为"', 'warning');
            return;
        }

        const newData = this._getCurrentColorsFromDOM();
        this.customThemes[name] = newData;

        await this._persistThemes();
        this.ctx.helpers.showToast(`主题 "${name}" 已更新`, 'success');
    }

    /**
     *  按钮逻辑: 另存
     */
    async _saveThemeAs() {
        const newName = await this.ctx.helpers.promptInput('输入新主题名称', 'Theme Name', 'My Theme');
        if (!newName) return;

        if (this.defaultThemes[newName] || this.customThemes[newName]) {
             const confirm = await this.ctx.helpers.promptConfirm(`主题 "${newName}" 已存在，是否覆盖？`);
             if (!confirm) return;
        }

        const newData = this._getCurrentColorsFromDOM();
        this.customThemes[newName] = newData;
        this.activeThemeName = newName;

        await this._persistThemes();
        await this._loadAndRenderThemeList(); // 重新渲染下拉框
        this.ctx.helpers.showToast(`主题 "${newName}" 已保存`, 'success');
    }

    /**
     *  按钮逻辑: 删除
     */
    async _deleteTheme() {
        const name = this.activeThemeName;
        if (this.defaultThemes[name]) return; // UI应该已经禁用了

        const confirm = await this.ctx.helpers.promptConfirm(`确定删除自定义主题 "${name}" 吗？`);
        if (!confirm) return;

        delete this.customThemes[name];
        this.activeThemeName = 'xuan'; // 回退默认
        this._applyTheme('xuan');

        await this._persistThemes();
        await this._loadAndRenderThemeList();
        this.ctx.helpers.showToast('主题已删除', 'success');
    }

    /**
     *  持久化数据 (双向保存)
     */
    async _persistThemes() {
        const data = {
            active: this.activeThemeName,
            customs: this.customThemes,
            //  保存背景设置
            backgroundSettings: this.backgroundSettings,
        };

        // 1. 本地备份
        await this.ctx.api.setValue('custom_themes_data', data);

        // 2. 酒馆服务器保存 (如果可能)
        const imageGen = this.ctx.getModule('imageGen');
        if (imageGen && imageGen.storageManager) {
            // 调用 image-storage.js 新增的方法
            imageGen.storageManager.saveThemeData(data);
        }
    }

    /**
     *  更新按钮启用/禁用状态
     */
    _updateThemeButtonsState() {
        const isDefault = !!this.defaultThemes[this.activeThemeName];
        const btnUpdate = this.modalEl.querySelector('#theme-btn-update');
        const btnDelete = this.modalEl.querySelector('#theme-btn-delete');

        if (btnUpdate) btnUpdate.disabled = isDefault;
        if (btnDelete) btnDelete.disabled = isDefault;
    }

    /**
     * [修改] 初始化时调用，改为只加载并应用当前 active 主题
     */
    async loadSavedTheme() {
        // 复用 _loadAndRenderThemeList 的逻辑部分，但不需要渲染 UI (因为此时 Modal 可能还没开)
        // 这里只是为了在酒馆启动时应用 CSS 变量

        const imageGen = this.ctx.getModule('imageGen');
        let serverData = null;
        if (imageGen && imageGen.storageManager) {
            serverData = await imageGen.storageManager.loadThemeData();
        }
        const localData = await this.ctx.api.getValue('custom_themes_data', { active: 'xuan', customs: {} });
        const data = serverData || localData;
        //  加载背景设置
        this.backgroundSettings = data.backgroundSettings || { landscape: null, portrait: null, opacity: 0.8, fabIcon: null, fabIconScale: 1 };
        this.customThemes = data.customs || {};
        this.defaultThemes = this.defaultThemes || {
            'xuan': { data: getThemePresetData('xuan') },
            'day': { data: getThemePresetData('day') },
            'sakura': { data: getThemePresetData('sakura') },
            'paper': { data: getThemePresetData('paper') },
            'eyecare': { data: getThemePresetData('eyecare') },
            'deep_sea': { data: getThemePresetData('deep_sea') },
            'dark_gold': { data: getThemePresetData('dark_gold') }
       };

        const active = data.active || 'xuan';

        let themeVars = {};
        if (this.defaultThemes[active]) {
            themeVars = this.defaultThemes[active].data;
        } else if (this.customThemes[active]) {
            themeVars = this.customThemes[active];
        }

        if (themeVars) {
            Object.entries(themeVars).forEach(([k, v]) => {
                document.documentElement.style.setProperty(k, v);
            });
            this.ctx.log('settings-panel', `已应用保存的主题: ${active}`);
        }
        this._applyCustomBackground();
    }
    /**
     *  应用自定义背景到UI
     * @param {boolean} onlyStyle - 如果为 true, 只更新样式（如透明度），不重新加载媒体元素
     */
    _applyCustomBackground(onlyStyle = false) {
        if (!this.modalEl) return; // 仅当 modal 存在时操作

        const modal = this.modalEl.querySelector('.tsp-modal');
        if (!modal) return;

        // 根据屏幕宽高比决定使用哪个背景
        const usePortrait = window.innerHeight > window.innerWidth;
        const bgPath = usePortrait
            ? (this.backgroundSettings.portrait || this.backgroundSettings.landscape)
            : (this.backgroundSettings.landscape || this.backgroundSettings.portrait);

        let bgContainer = modal.querySelector('#tsp-modal-background');

        // 设置透明度变量
        modal.style.setProperty('--tsp-bg-opacity', this.backgroundSettings.opacity);

        if (bgPath) {
            modal.classList.add('tsp-custom-bg-active');

            if (!onlyStyle) {
                if (!bgContainer) {
                    bgContainer = document.createElement('div');
                    bgContainer.id = 'tsp-modal-background';
                    modal.insertBefore(bgContainer, modal.firstChild);
                }
                bgContainer.innerHTML = ''; // 清空旧内容

                const isVideo = bgPath.endsWith('.mp4') || bgPath.endsWith('.webm');

                if (isVideo) {
                    const video = document.createElement('video');
                    video.src = bgPath;
                    video.autoplay = true;
                    video.loop = true;
                    video.muted = true;
                    video.playsInline = true;
                    bgContainer.appendChild(video);
                } else {
                    bgContainer.style.backgroundImage = `url(${bgPath})`;
                }
            }
        } else {
            // 如果没有背景，移除样式和容器
            modal.classList.remove('tsp-custom-bg-active');
            if (bgContainer) {
                bgContainer.remove();
            }
        }
    }

    /**
     *  更新背景设置面板的UI显示（预览图和滑块）
     */
    _updateBackgroundUI() {
        const updatePreview = (type) => {
            const previewEl = this.modalEl.querySelector(`#bg-preview-${type}`);
            const path = this.backgroundSettings[type];
            if (previewEl) {
                if (path) {
                    previewEl.innerHTML = path.endsWith('.mp4') || path.endsWith('.webm')
                        ? `<video src="${path}" muted loop autoplay playsinline></video>`
                        : `<img src="${path}" alt="${type} background preview">`;
                } else {
                    previewEl.innerHTML = '<span class="tsp-text-muted">点击下方按钮上传</span>';
                }
            }
        };

        updatePreview('landscape');
        updatePreview('portrait');

        const fabPreviewEl = this.modalEl.querySelector('#fab-icon-preview');
        const fabIconPath = this.backgroundSettings.fabIcon;
        if (fabPreviewEl) {
            if (fabIconPath) {
                fabPreviewEl.innerHTML = `<img src="${fabIconPath}" alt="悬浮球图标预览">`;
            } else {
                fabPreviewEl.innerHTML = '<span class="tsp-text-muted">点击下方按钮上传</span>';
            }
        }

        const opacitySlider = this.modalEl.querySelector('#theme-bg-opacity-slider');
        const opacityValue = this.modalEl.querySelector('#theme-bg-opacity-value');
        if (opacitySlider) opacitySlider.value = this.backgroundSettings.opacity;
        if (opacityValue) opacityValue.textContent = `${Math.round(this.backgroundSettings.opacity * 100)}%`;

        const fabScaleSlider = this.modalEl.querySelector('#fab-icon-scale-slider');
        const fabScaleValue = this.modalEl.querySelector('#fab-icon-scale-value');
        if (fabScaleSlider) fabScaleSlider.value = this.backgroundSettings.fabIconScale ?? 1;
        if (fabScaleValue) fabScaleValue.textContent = `${Math.round((this.backgroundSettings.fabIconScale ?? 1) * 100)}%`;
    }

    /**
     *  处理背景文件上传
     * @param {File} file - 用户选择的文件
     * @param {'landscape' | 'portrait'} type - 背景类型
     */
    async _handleBackgroundUpload(file, type) {
        this.ctx.helpers.showToast(`正在上传 ${type} 背景...`, 'info');
        const imageGen = this.ctx.getModule('imageGen');
        if (!imageGen || !imageGen.storageManager) {
            this.ctx.helpers.showToast('存储管理器不可用，无法上传', 'error');
            return;
        }

        try {
            // 调用 image-storage 的新方法来处理上传和旧文件删除
            const newPath = await imageGen.storageManager.uploadBackground(
                file,
                this.backgroundSettings[type] // 传入旧路径以便删除
            );

            if (newPath) {
                this.backgroundSettings[type] = newPath;
                this.ctx.helpers.showToast('背景上传成功！', 'success');

                // 保存设置并更新UI
                await this._persistThemes();
                this._applyCustomBackground();
                this._updateBackgroundUI();
            } else {
                throw new Error('服务器未返回路径');
            }

        } catch (e) {
            this.ctx.error('settings-panel', `背景上传失败: ${e.message}`);
            this.ctx.helpers.showToast(`上传失败: ${e.message}`, 'error');
        }
    }

    /**
     *  处理清除背景的逻辑
     * @param {'landscape' | 'portrait'} type - 背景类型
     */
    async _handleBackgroundClear(type) {
        const oldPath = this.backgroundSettings[type];
        if (!oldPath) return;

        const confirmed = await this.ctx.helpers.promptConfirm(`确定要删除这个背景吗？服务器上的文件也将被移除。`);
        if (!confirmed) return;

        const imageGen = this.ctx.getModule('imageGen');
        if (!imageGen || !imageGen.storageManager) {
            this.ctx.helpers.showToast('存储管理器不可用', 'error');
            return;
        }

        try {
            // 调用 image-storage 的方法删除文件
            await imageGen.storageManager.deleteBackground(oldPath);

            this.backgroundSettings[type] = null;
            this.ctx.helpers.showToast('背景已清除', 'success');

            // 保存设置并更新UI
            await this._persistThemes();
            this._applyCustomBackground();
            this._updateBackgroundUI();

        } catch (e) {
            this.ctx.error('settings-panel', `背景删除失败: ${e.message}`);
            this.ctx.helpers.showToast(`删除失败: ${e.message}`, 'error');
        }
    }

    /**
     *  处理悬浮球图标文件上传
     * @param {File} file - 用户选择的文件
     */
    async _handleFabIconUpload(file) {
        this.ctx.helpers.showToast('正在上传悬浮球图标...', 'info');
        const imageGen = this.ctx.getModule('imageGen');
        if (!imageGen || !imageGen.storageManager) {
            this.ctx.helpers.showToast('存储管理器不可用，无法上传', 'error');
            return;
        }

        try {
            const newPath = await imageGen.storageManager.uploadFabIcon(
                file,
                this.backgroundSettings.fabIcon
            );

            if (newPath) {
                this.backgroundSettings.fabIcon = newPath;
                this.ctx.helpers.showToast('悬浮球图标上传成功！', 'success');

                await this._persistThemes();
                this._updateBackgroundUI();
                this._applyFabIcon();
            } else {
                throw new Error('服务器未返回路径');
            }

        } catch (e) {
            this.ctx.error('settings-panel', `悬浮球图标上传失败: ${e.message}`);
            this.ctx.helpers.showToast(`上传失败: ${e.message}`, 'error');
        }
    }

    /**
     *  处理清除悬浮球图标的逻辑
     */
    async _handleFabIconClear() {
        const oldPath = this.backgroundSettings.fabIcon;
        if (!oldPath) return;

        const confirmed = await this.ctx.helpers.promptConfirm('确定要删除悬浮球图标吗？服务器上的文件也将被移除。');
        if (!confirmed) return;

        const imageGen = this.ctx.getModule('imageGen');
        if (!imageGen || !imageGen.storageManager) {
            this.ctx.helpers.showToast('存储管理器不可用', 'error');
            return;
        }

        try {
            await imageGen.storageManager.deleteFabIcon(oldPath);

            this.backgroundSettings.fabIcon = null;
            this.ctx.helpers.showToast('悬浮球图标已清除', 'success');

            await this._persistThemes();
            this._updateBackgroundUI();
            this._applyFabIcon();

        } catch (e) {
            this.ctx.error('settings-panel', `悬浮球图标删除失败: ${e.message}`);
            this.ctx.helpers.showToast(`删除失败: ${e.message}`, 'error');
        }
    }

    /**
     *  应用悬浮球自定义图标到悬浮球元素
     */
    _applyFabIcon() {
        const fabEl = document.querySelector('#tsp-fab');
        if (!fabEl) return;

        const fabIconPath = this.backgroundSettings.fabIcon;
        const scale = this.backgroundSettings.fabIconScale ?? 1;
        fabEl.style.setProperty('--fab-scale', scale);
        if (fabIconPath) {
            fabEl.innerHTML = `<img src="${fabIconPath}" alt="悬浮球图标" class="tsp-fab-custom-icon">`;
            fabEl.classList.add('has-custom-icon');
        } else {
            fabEl.innerHTML = '<i class="fa-solid fa-layer-group"></i>';
            fabEl.classList.remove('has-custom-icon');
        }
    }

    /**
     * 绑定事件
     */
    _bindEvents() {
        // 关闭按钮
        this.modalEl.querySelector('#tsp-settings-close')?.addEventListener('click', () => this.close());
        this.modalEl.addEventListener('click', (e) => {
            if (e.target === this.modalEl) this.close();
        });

        // 导航切换
        this.modalEl.querySelectorAll('.tsp-nav-link[data-tab]').forEach(link => {
            link.addEventListener('click', (e) => {
                e.preventDefault();
                const tab = /** @type {HTMLElement} */ (link)?.dataset?.tab;
                if (tab) this._switchTab(tab);
            });
        });

        // 模式切换
        this.modalEl.querySelector('#settings-mode-select')?.addEventListener('change', (e) => {
            const target = /** @type {EventTarget | null} */ (e.target);
            if (target instanceof HTMLSelectElement) {
                // 【修改】这里是用户手动切换，传入 true，允许弹窗和后端切换
                this._switchMode(target.value, true);
            }
        });

        // AI二次处理模块开关联动（关闭时同时关闭依赖它的注入按钮/快捷生成悬浮球开关）
        this.modalEl.querySelector('#module-aiProcessor')?.addEventListener('change', (e) => {
            const target = /** @type {EventTarget | null} */ (e.target);
            if (target instanceof HTMLInputElement) {
                this._syncAiProcessorDependentToggles(target.checked);
            }
        });

        // 保存按钮
        this.modalEl.querySelector('#tsp-settings-save')?.addEventListener('click', async () => {

            // 定义后台保存函数
            const doBackgroundSave = async () => {
                try {
                    await this._saveSettings();
                } catch (e) {
                    this.ctx.error('settings-panel', '后台保存失败:', e);
                    this.ctx.helpers.showToast('设置保存失败: ' + e.message, 'error');
                }
            };

            // 定义需要确认的保存函数
            const doConfirmSave = async () => {
                // 用于实现秒关后台保存的辅助函数：仅隐藏不破坏 DOM
                const hideAndBackgroundSave = () => {
                    if (this.modalEl) {
                        this.modalEl.classList.remove('visible');
                        this.modalEl.style.display = 'none';
                    }
                    doBackgroundSave(); // 此方法内的 _saveSettings 运行完毕后会自己调 this.close() 清理内存
                };

                // 获取下拉框当前选择状态，判断用户是否切换了预设
                let isPresetDropdownChanged = false;
                if (this.currentTab === 'prompts') {
                    const presetSelect = this.modalEl.querySelector('#prompt-preset-prefix');
                    const imageGen = this.ctx.getModule('imageGen');
                    if (presetSelect && imageGen) {
                        isPresetDropdownChanged = presetSelect.value !== '' && presetSelect.value !== (imageGen.settings.activePresetName || '');
                    }
                }

                // 防傻操作：检查预设是否被修改（或是下拉框被切换）但未更新
                if (this.isPresetModified || isPresetDropdownChanged) {
                    const confirmed = await this.ctx.helpers.promptConfirm('提示词预设已被修改或切换选择但未更新，是否先更新预设再保存关闭？');
                    if (confirmed) {
                        // 先更新预设
                        await this._updatePreset();
                        // 重置修改状态
                        this.isPresetModified = false;
                    }
                    // 无论用户是否确认，都立即关闭面板并后台保存
                    hideAndBackgroundSave();
                } else {
                    // 防傻操作：检查各个模式的API预设是否被修改但未更新
                    const currentMode = this._getCurrentMode();
                    if (this.isApiPresetModified[currentMode]) {
                        const confirmed = await this.ctx.helpers.promptConfirm(`${this._getModeName(currentMode)} API预设已被修改但未更新，是否先更新预设再保存关闭？`);
                        if (confirmed) {
                            // 先更新API预设
                            if (typeof this.modeSettings[currentMode]._updateApiPreset === 'function') {
                                await this.modeSettings[currentMode]._updateApiPreset();
                                // 重置修改状态
                                this.isApiPresetModified[currentMode] = false;
                            }
                        }
                        // 无论用户是否确认，都立即关闭面板并后台保存
                        hideAndBackgroundSave();
                    } else {
                        // 无未保存修改，直接关闭面板并后台保存
                        hideAndBackgroundSave();
                    }
                }
            };

            // 没有问题，直接关闭面板并后台保存
            await doConfirmSave();
        });

        // 重置按钮
        this.modalEl.querySelector('#tsp-settings-reset')?.addEventListener('click', async () => {
            const confirmed = await this.ctx.helpers.promptConfirm('确定重置当前页面设置为默认值吗？');
            if (confirmed) {
                this._resetCurrentTab();
            }
        });

        // 清除缓存
        this.modalEl.querySelector('#tsp-settings-clear-cache')?.addEventListener('click', async () => {
            const confirmed = await this.ctx.helpers.promptConfirm('确定清除所有图像缓存吗？');
            if (confirmed) {
                await this._clearCache();
            }
        });

        // 生图主设置数据：导出/导入/清空
        this.modalEl.querySelector('#settings-export-main-settings')?.addEventListener('click', () => this._exportMainSettings());
        this.modalEl.querySelector('#settings-import-main-settings')?.addEventListener('click', () => {
            const inputEl = this.modalEl.querySelector('#settings-import-main-input');
            if (inputEl instanceof HTMLElement) {
                inputEl.click();
            }
        });
        this.modalEl.querySelector('#settings-import-main-input')?.addEventListener('change', (e) => {
            const target = /** @type {EventTarget | null} */ (e.target);
            if (target instanceof HTMLInputElement) {
                this._importMainSettings(target.files);
            }
        });
        this.modalEl.querySelector('#settings-clear-main-settings')?.addEventListener('click', async () => {
            const confirmed = await this.ctx.helpers.promptConfirm('确定清空生图主设置吗？此操作不可恢复！');
            if (confirmed) {
                await this._clearMainSettings();
            }
        });

        // 二次处理数据：导出/导入/清空
        this.modalEl.querySelector('#settings-export-prompt-opt')?.addEventListener('click', () => this._exportPromptOptimization());
        this.modalEl.querySelector('#settings-import-prompt-opt')?.addEventListener('click', () => {
            const inputEl = this.modalEl.querySelector('#settings-import-prompt-opt-input');
            if (inputEl instanceof HTMLElement) {
                inputEl.click();
            }
        });
        this.modalEl.querySelector('#settings-import-prompt-opt-input')?.addEventListener('change', (e) => {
            const target = /** @type {EventTarget | null} */ (e.target);
            if (target instanceof HTMLInputElement) {
                this._importPromptOptimization(target.files);
            }
        });
        this.modalEl.querySelector('#settings-clear-prompt-opt')?.addEventListener('click', async () => {
            const confirmed = await this.ctx.helpers.promptConfirm('确定清空二次处理数据吗？此操作不可恢复！');
            if (confirmed) {
                await this._clearPromptOptimization();
            }
        });

        // 快捷跳转
        this.modalEl.querySelector('#nav-tag-market')?.addEventListener('click', (e) => {
            e.preventDefault();
            this.close();
            this.ctx.events.emit(EventTypes.TAG_UI_OPEN);
        });
        this.modalEl.querySelector('#nav-char-db')?.addEventListener('click', (e) => {
            e.preventDefault();
            this.close();
            this.ctx.events.emit(EventTypes.CHARACTER_DB_OPEN);
        });
        this.modalEl.querySelector('#nav-ai-processor')?.addEventListener('click', async (e) => {
            e.preventDefault();
            e.stopPropagation();
            // 先关闭当前设置面板
            this.close();
            // 延迟打开 AI 设置，确保当前面板已关闭
            setTimeout(async () => {
                try {
                    const { AISettingsModal } = await import('../ui/ai-settings-modal.js');
                    const modal = new AISettingsModal(this.ctx);
                    await modal.open();
                } catch (err) {
                    this.ctx.error('settings-panel', '打开 AI 设置失败:', err);
                    this.ctx.helpers.showToast('打开 AI 设置失败: ' + err.message, 'error');
                }
            }, 250);
        });

        // 通用尺寸预设
        this.modalEl.querySelector('#general-size')?.addEventListener('change', (e) => {
            const val = /** @type {HTMLSelectElement} */ (e.target)?.value;
            this._applySizePreset(val);
        });

        // 高级页事件
        this._bindAdvancedTabEvents();
        // 触发词页事件
        this._bindTriggersTabEvents();
        // 多角色定义页事件
        this._bindMultiCharTabEvents();

        this._bindConsoleEvents();
    }

    /**
     * 绑定提示词标签页事件
     */
    _bindPromptTabEvents() {
        // ===  下拉框懒加载绑定 ===
        const setupLazyHandler = (id, allowEmpty) => {
            const el = this.modalEl.querySelector(`#${id}`);
            if (el) {
                // 使用 pointerdown 确保在下拉框展开前填充数据
                const handler = () => {
                    this._fillLazySelectOptions(el, allowEmpty);
                };
                el.addEventListener('pointerdown', handler);
                el.addEventListener('keydown', handler); // 支持键盘操作
            }
        };

        setupLazyHandler('prompt-preset-prefix', true);

        // 标签搜索
        const searchBtn = this.modalEl.querySelector('#prompt-tag-search-btn');
        const searchInput = this.modalEl.querySelector('#prompt-tag-search');
        const doSearch = () => {
            const q = this._getValue('prompt-tag-search');
            this._searchTags(q || '');
        };
        searchBtn?.addEventListener('click', doSearch);
        searchInput?.addEventListener('keydown', (e) => {
            const evt = /** @type {KeyboardEvent | Event} */ (e);
            if (evt instanceof KeyboardEvent && evt.key === 'Enter') doSearch();
        });

        // 复制/填入
        this.modalEl.querySelector('#prompt-copy-tags')?.addEventListener('click', () => this._copySelectedTags());
        this.modalEl.querySelector('#prompt-fill-tags')?.addEventListener('click', () => this._fillSelectedTags());

        // 前置预设选择
        this.modalEl.querySelector('#prompt-preset-prefix')?.addEventListener('change', (e) => {
            const val = /** @type {HTMLSelectElement} */ (e.target)?.value;
            if (val) {
                this._applyPresetToEditor(val, true);
            }
        });

        // 前置/后置切换按钮
        this.modalEl.querySelector('#prompt-switch-prefix')?.addEventListener('click', () => {
            this._switchPromptMode('prefix');
        });
        this.modalEl.querySelector('#prompt-switch-suffix')?.addEventListener('click', () => {
            this._switchPromptMode('suffix');
        });

        // 预设 CRUD
        this.modalEl.querySelector('#prompt-generate-ref-btn')?.addEventListener('click', () => this._handleGenerateReferenceImage());
        this.modalEl.querySelector('#prompt-preset-update')?.addEventListener('click', () => this._updatePreset());
        this.modalEl.querySelector('#prompt-preset-saveas')?.addEventListener('click', () => this._savePresetAs());
        this.modalEl.querySelector('#prompt-preset-delete')?.addEventListener('click', () => this._deletePreset());

        // 固定形象多组输入框管理
        this.modalEl.querySelector('#prompt-fixed-appearance-add')?.addEventListener('click', () => this._addFixedAppearanceInput());
        this._initFixedAppearanceInputs();

        // 导入/导出
        this.modalEl.querySelector('#prompt-import-btn')?.addEventListener('click', () => {
            const input = this.modalEl.querySelector('#prompt-import-input');
            if (input instanceof HTMLInputElement) input.click();
        });
        this.modalEl.querySelector('#prompt-import-input')?.addEventListener('change', (e) => {
            const target = /** @type {EventTarget | null} */ (e.target);
            if (target instanceof HTMLInputElement) {
                this._importPresets(target.files);
            }
        });
        this.modalEl.querySelector('#prompt-export-current')?.addEventListener('click', async () => await this._exportCurrentPreset());
        this.modalEl.querySelector('#prompt-export-multi')?.addEventListener('click', async () => await this._exportSelectedPresets());
        this.modalEl.querySelector('#prompt-export-all')?.addEventListener('click', async () => await this._exportAllPresets());

        // 排序
        this.modalEl.querySelector('#prompt-sort-btn')?.addEventListener('click', () => {
            this._openPresetSorterModal();
        });

        // 多选模式
        this.modalEl.querySelector('#prompt-multi-btn')?.addEventListener('click', () => {
            this._togglePresetMultiSelect();
        });

        // 取消按钮
        this.modalEl.querySelector('#prompt-cancel-btn')?.addEventListener('click', () => {
            this._togglePresetMultiSelect(true);
        });

        // 全选按钮
        this.modalEl.querySelector('#prompt-select-all-btn')?.addEventListener('click', () => {
            this._selectAllPresets();
        });

        // 上传效果图
        this.modalEl.querySelector('#prompt-upload-image')?.addEventListener('click', () => {
            const input = this.modalEl.querySelector('#prompt-upload-image-input');
            if (input instanceof HTMLInputElement) input.click();
        });

        this.modalEl.querySelector('#prompt-upload-image-input')?.addEventListener('change', (e) => {
            const target = /** @type {HTMLInputElement} */ (e.target);
            if (target.files && target.files[0]) {
                this._handleUploadPresetImage(target.files[0]);
            }
            target.value = '';
        });

        // 预设网格点击
        this.modalEl.querySelector('#prompt-preset-grid')?.addEventListener('click', (e) => {
            const target = e.target;
            if (!(target instanceof HTMLElement)) return;

            if (target.classList.contains('tsp-preset-rename')) {
                e.stopPropagation();
                const card = target.closest('.tsp-preset-card');
                if (card) this._renamePreset(card.dataset.name);
                return;
            }

            const card = target.closest('.tsp-preset-card');
            if (card instanceof HTMLElement) {
                const name = card.dataset.name;
                if (name) {
                    this._handlePresetInteraction(name);
                    // 重置修改状态
                    this.isPresetModified = false;
                }
            }
        });

        // 防傻操作：监听提示词输入框变化
        const positiveInput = this.modalEl.querySelector('#prompt-positive-text');
        const negativeInput = this.modalEl.querySelector('#prompt-negative-text');
        if (positiveInput) {
            positiveInput.addEventListener('input', () => {
                this.isPresetModified = true;
            });
        }
        if (negativeInput) {
            negativeInput.addEventListener('input', () => {
                this.isPresetModified = true;
            });
        }
    }

    /**
    * 绑定高级设置事件
    */
    _bindAdvancedTabEvents() {
        // 缩放滑条
        const zoom = this.modalEl.querySelector('#adv-zoom');
        const zoomVal = this.modalEl.querySelector('#adv-zoom-value');
        if (zoom instanceof HTMLInputElement && zoomVal instanceof HTMLElement) {
            zoom.addEventListener('input', () => {
                zoomVal.textContent = `${zoom.value}%`;

                //  实时预览效果
                const imageGen = this.ctx.getModule('imageGen');
                if (imageGen && typeof imageGen.setZoomRatio === 'function') {
                    imageGen.setZoomRatio(zoom.value);
                }
            });
        }

        //  存储模式切换 (逻辑修复版)
        this.modalEl.querySelector('#adv-storage-mode')?.addEventListener('change', async (e) => {
            const mode = e.target.value;
            const imageGen = this.ctx.getModule('imageGen');

            if (imageGen && mode) {
                // 1. 【关键修复】必须先切换模式，更新内部状态
                // 否则 storageManager 会因为当前模式不是 tavern 而拒绝下载预设文件
                await imageGen.setStorageMode(mode);

                // 更新提示消息
                let modeName = '浏览器';
                if (mode === 'tavern') {
                    modeName = '酒馆服务器';
                } else if (mode === 'github') {
                    modeName = 'GitHub 存储';
                }
                this.ctx.helpers.showToast(`存储模式已切换为: ${modeName}`, 'success');

                // 2. 切换成功后，如果是酒馆模式，再询问同步
                if (mode === 'tavern') {
                    const confirmSync = await this.ctx.helpers.promptConfirm(
                        '模式切换成功。\n是否立即从服务器拉取所有配置(预设、工作流、设置)覆盖本地？\n\n(推荐：新设备或数据丢失时使用)'
                    );

                    if (confirmSync) {
                        this.ctx.helpers.showToast('正在全量同步服务器数据...', 'info');
                        // 此时 storageMode 已经是 'tavern'，下载逻辑将正常执行
                        await this._syncAllDataFromServer(imageGen);
                    }
                }

                // 3. 显示/隐藏 GitHub 存储设置
                const githubSettings = this.modalEl.querySelector('#adv-github-storage-settings');
                if (githubSettings) {
                    githubSettings.style.display = mode === 'github' ? 'flex' : 'none';
                }

                // 4. 刷新下方的统计显示
                this._refreshStorageStats();
            }
        });

        //  保留浏览器缓存开关
        this.modalEl.querySelector('#adv-keep-browser-cache')?.addEventListener('change', async (e) => {
            const checked = e.target.checked;
            const imageGen = this.ctx.getModule('imageGen');
            if (imageGen?.storageManager) {
                imageGen.storageManager.settings.keepBrowserCache = checked;
                await imageGen.storageManager.saveSettings();
            }
        });

        //  刷新存储统计
        this.modalEl.querySelector('#adv-storage-stats-refresh')?.addEventListener('click', () => this._refreshStorageStats());

        //  从服务器同步
        this.modalEl.querySelector('#adv-sync-from-server')?.addEventListener('click', async () => {
            const imageGen = this.ctx.getModule('imageGen');
            if (!imageGen?.storageManager) return;
            try {
                this.ctx.helpers.showToast('正在从服务器同步...', 'info');
                const result = await imageGen.storageManager.syncFromServer();
                // 重新加载缓存映射以更新内存
                if (imageGen._loadCacheMapping) await imageGen._loadCacheMapping();
                this.ctx.helpers.showToast(`同步完成！新增 ${result.synced} 条记录`, 'success');
                await this._refreshStorageStats();
                // 注意：此处已移除 _refreshCacheView() 调用，因为它现在只属于图片管理页面
            } catch (e) {
                this.ctx.helpers.showToast(`同步失败: ${e.message}`, 'error');
            }
        });

        // 迁移操作
        this.modalEl.querySelector('#adv-migrate-to-tavern')?.addEventListener('click', async () => {
            if (await this.ctx.helpers.promptConfirm('确定迁移到酒馆服务器吗？')) {
                await this._migrateStorage('tavern');
            }
        });
        this.modalEl.querySelector('#adv-migrate-to-browser')?.addEventListener('click', async () => {
            if (await this.ctx.helpers.promptConfirm('确定迁移到浏览器吗？')) {
                await this._migrateStorage('browser');
            }
        });
    }
    /**
     *  绑定图片管理页事件
     */
    _bindGalleryTabEvents() {
        // 缓存过滤器
        this.modalEl.querySelector('#adv-cache-apply-filter')?.addEventListener('click', () => {
            this._refreshCacheView(1);
        });

        // 缓存操作按钮
        this.modalEl.querySelector('#adv-cache-refresh')?.addEventListener('click', () => this._refreshCacheView());

        this.modalEl.querySelector('#adv-cache-multi-select')?.addEventListener('click', () => {
            this._toggleCacheMultiSelect();
        });
        this.modalEl.querySelector('#adv-cache-select-all')?.addEventListener('click', () => {
            this._selectAllCacheImagesOnPage();
        });
        this.modalEl.querySelector('#adv-cache-download-selected')?.addEventListener('click', async () => {
            if (this.selectedCacheImages.size === 0) {
                this.ctx.helpers.showToast('请至少选择一张图片', 'warning');
                return;
            }
            // 将 Set 转为包含 id 属性的对象数组，模拟 getCacheMetadata 的返回结构
            const selectedItems = Array.from(this.selectedCacheImages).map(id => ({ id: id }));

            // 1. 等待下载打包流程执行完毕
            await this._downloadAllCacheImages(selectedItems);

            // 2.  自动退出多选模式 (逻辑与删除一致)
            this.selectedCacheImages.clear();         // 清空选中集合
            this.isCacheMultiSelectMode = false;      // 关闭多选标记
            this._updateCacheMultiSelectButtonText(); // 恢复按钮文字状态
            this._refreshCacheView(this.cachePage);   // 刷新网格以去除选中样式
        });
        // 清空当前页
        this.modalEl.querySelector('#adv-cache-clear-page')?.addEventListener('click', async () => {
            const grid = this.modalEl?.querySelector('#adv-cache-grid');
            if (!grid) return;
            const thumbElements = grid.querySelectorAll('.tsp-cache-thumb[data-id]');
            const idsToDelete = Array.from(thumbElements).map(el => parseInt(el.dataset.id, 10));

            if (idsToDelete.length === 0) {
                this.ctx.helpers.showToast('当前页面没有图片可删除。', 'info');
                return;
            }

            const confirmed = await this.ctx.helpers.promptConfirm(
                `确定要删除当前页面显示的 ${idsToDelete.length} 张图片吗？\n此操作将同时删除服务器文件，不可恢复。`
            );

            if (!confirmed) return;

            const imageGen = this.ctx.getModule('imageGen');
            if (!imageGen) return;

            this.ctx.helpers.showToast(`正在删除 ${idsToDelete.length} 张图片...`, 'info');
            let successCount = 0;
            for (const id of idsToDelete) {
                try {
                    await imageGen.deleteCachedImage(id);
                    successCount++;
                } catch (err) {
                    console.error(err);
                }
            }
            this.ctx.helpers.showToast(`删除完成: ${successCount} 张`, 'success');
            await this._refreshCacheView(this.cachePage);
            await this._refreshStorageStats();
        });

        // 导入导出
        this.modalEl.querySelector('#adv-cache-import')?.addEventListener('click', () => {
            const input = this.modalEl.querySelector('#adv-cache-import-input');
            if (input instanceof HTMLInputElement) input.click();
        });
        this.modalEl.querySelector('#adv-cache-import-input')?.addEventListener('change', async (e) => {
            const target = /** @type {EventTarget | null} */ (e.target);
            if (target instanceof HTMLInputElement && target.files?.length) {
                await this._importAllData(target.files);
                await this._refreshCacheView();
            }
        });
        this.modalEl.querySelector('#adv-cache-export')?.addEventListener('click', () => this._exportAllData());
        this.modalEl.querySelector('#adv-cache-download-all')?.addEventListener('click', () => this._downloadAllCacheImages());
    }

    /**
     *  从服务器执行全量数据同步
     * 用于切换设备或模式时，确保本地环境与服务器一致
     */
    async _syncAllDataFromServer(imageGen) {
        try {
            const storage = imageGen.storageManager;
            if (!storage) return;

            // 1. 同步提示词预设 (Prompt Presets)
            // 优先从服务器加载，如果服务器为空则从浏览器DB回退
            const serverPresets = await storage.loadPromptPresets();

            // 只有获取到有效且非空数组时才清空旧数据并同步
            // 如果服务器返回空数组或null，保留本地数据作为后手
            if (serverPresets && Array.isArray(serverPresets) && serverPresets.length > 0) {
                await this.ctx.db.clear(StoreNames.PRESETS);
                // 使用批量写入提升性能（300+预设从300+次事务优化为1次事务）
                await this.ctx.db.putBatch(StoreNames.PRESETS, serverPresets);
                this.ctx.log('settings-panel', `同步预设完成: ${serverPresets.length} 条（批量写入）`);
            } else {
                this.ctx.log('settings-panel', '服务器预设为空或未返回有效数据，保留浏览器DB中的数据作为后手');
                // 如果服务器为空，检查本地DB是否有数据，如果有则上传到服务器
                const localPresets = await this.ctx.db.getAll(StoreNames.PRESETS) || [];
                if (localPresets.length > 0) {
                    this.ctx.log('settings-panel', `检测到本地DB有 ${localPresets.length} 条预设，上传到服务器`);
                    try {
                        await storage.savePromptPresets(localPresets);
                        this.ctx.log('settings-panel', '本地预设已上传到服务器');
                    } catch (e) {
                        this.ctx.error('settings-panel', '上传本地预设到服务器失败:', e);
                    }
                }
            }

            // 2. 同步 ComfyUI 数据 (工作流 & LoRA)
            const serverComfy = await storage.loadComfyUIData();
            if (serverComfy) {
                if (serverComfy.workflows && Array.isArray(serverComfy.workflows)) {
                    await this.ctx.db.clear(StoreNames.WORKFLOWS);
                    // 使用批量写入提升性能
                    await this.ctx.db.putBatch(StoreNames.WORKFLOWS, serverComfy.workflows);
                }
                if (serverComfy.loraPresets && Array.isArray(serverComfy.loraPresets)) {
                    await this.ctx.db.clear(StoreNames.LORA_PRESETS);
                    // 使用批量写入提升性能
                    await this.ctx.db.putBatch(StoreNames.LORA_PRESETS, serverComfy.loraPresets);
                }
                this.ctx.log('settings-panel', '同步 ComfyUI 数据完成');
            }

            // 3. 同步全局插件设置 (Settings.json)
            // 调用 loadSettings 会从服务器读取并合并到 imageGen.settings 内存中
            await imageGen.loadSettings();
            // ===  同步主题数据 ===
            const themeData = await imageGen.storageManager.loadThemeData();
            if (themeData) {
                // 保存到本地缓存
                await this.ctx.api.setValue('custom_themes_data', themeData);
                // 立即应用
                await this.loadSavedTheme();
                this.ctx.log('settings-panel', '同步主题数据完成');
            }
            // 确保触发词设置也被同步 (如果 triggerProcessor 存在)
            const triggerProcessor = this.ctx.getModule('triggerProcessor');
            const advSettings = await imageGen.storageManager.loadPluginSettings();
            if (triggerProcessor && advSettings?.advanced_settings?.trigger_processor_settings) {
                triggerProcessor.settings = {
                    ...triggerProcessor.settings,
                    ...advSettings.advanced_settings.trigger_processor_settings
                };
                triggerProcessor.saveSettings();
            }
            //  同步 prompt_optimization.json (CharacterDB + AIProcessor)
            try {
                const optData = await imageGen.storageManager.loadPromptOptimizationData();
                if (optData) {
                    this.ctx.log('settings-panel', '检测到服务器优化数据，开始恢复...');

                    // 恢复角色数据库
                    const charDB = this.ctx.getModule('characterDB');
                    if (charDB && optData.characterDB) {
                        await charDB.restoreFromSyncData(optData.characterDB);
                        this.ctx.log('settings-panel', '角色数据库已同步恢复');
                    }

                    // 恢复 AI 二次处理配置 (预设/世界书等)
                    const aiProcessor = this.ctx.getModule('aiProcessor');
                    if (aiProcessor && optData.aiProcessing) {
                        await aiProcessor.restoreFromSyncData(optData.aiProcessing);
                        this.ctx.log('settings-panel', 'AI二次处理数据已同步恢复');
                    }
                } else {
                    this.ctx.log('settings-panel', '服务器没有 prompt_optimization.json，跳过此项同步');
                }
            } catch (err) {
                this.ctx.error('settings-panel', '优化数据同步失败:', err);
            }
            // ================= 修改开始 =================
            // 4. [修复] 刷新 UI 显示 (强制覆盖模式)

            // 4.1 先载入通用和高级参数
            this._loadGeneralParams();
            await this._loadAdvancedParams();

            // 4.2 强制载入预设 (keepEditor: false 是关键)
            // 告诉加载器：当前是全新同步，不要保留浏览器里那个空的输入框，直接用数据覆盖它
            await this._loadPromptPresets({
                keepEditor: false,
                presetPositiveFallback: '',
                presetNegativeFallback: ''
            });

            // 4.3 [核心修复] 手动将 API 中的文本同步到输入框
            // imageGen.loadSettings() 刚才已经把服务器上的 text 写入了本地 API
            // 我们现在直接读出来，暴力填入 DOM，确保界面显示的不是空白
            const syncedPos = await this.ctx.api.getValue('prompt_positive_text', '');
            const syncedNeg = await this.ctx.api.getValue('prompt_negative_text', '');

            this._setValue('prompt-positive-text', syncedPos);
            this._setValue('prompt-negative-text', syncedNeg);

            // 4.4 修正下拉框选中状态
            const settings = imageGen.settings; // 这是内存中已经是最新了
            const activePrefix = settings.activePresetName || (this.promptPresets[0]?.name || '');
            this._setSelectValue('prompt-preset-prefix', activePrefix);

            // 4.5 再次保险：如果 API 里的文本真的是空的（比如用户之前清空并保存了），
            // 则尝试从当前选中的预设中填充内容，避免一片空白
            if (!syncedPos && activePrefix) {
                 this._applyPresetToEditor(activePrefix, true);
            }

            // 4.6 刷新模式面板 (SD/NAI/ComfyUI)
            const currentMode = imageGen.getMode();
            this._switchMode(currentMode);
            this._loadTriggersSettings(); // 刷新触发词 UI

            this.ctx.helpers.showToast('服务器数据全量同步成功！界面已刷新。', 'success');
            // ================= 修改结束 =================

        } catch (e) {
            console.error(e);
            this.ctx.error('settings-panel', '全量同步失败:', e);
            this.ctx.helpers.showToast(`同步遇到错误: ${e.message}`, 'error');
        }
    }
    /**
     * 刷新存储统计信息
     * 会先从服务器同步数据，然后刷新统计
     */
    async _refreshStorageStats() {
        const imageGen = this.ctx.getModule('imageGen');
        if (!imageGen) return;

        try {
            // 先从服务器同步数据（如果有角色卡）
            if (imageGen.storageManager) {
                const characterName = imageGen.storageManager._getCurrentCharacterName();
                if (characterName) {
                    this.ctx.log('settings-panel', `刷新统计前先同步角色卡 "${characterName}" 的数据...`);
                    // 清除已加载标记，强制重新从服务器加载
                    imageGen.storageManager._loadedCharacters.delete(characterName);
                    await imageGen.storageManager.syncFromServer();
                }
            }

            const stats = await imageGen.getStorageStats();
            const statsEl = this.modalEl?.querySelector('#adv-storage-stats');
            if (statsEl) {
                const getModeText = (mode) => {
                    if (mode === 'tavern') return '酒馆服务器';
                    if (mode === 'github') return 'GitHub';
                    return '浏览器';
                };
                statsEl.innerHTML = `
                    总计: <strong>${stats.total}</strong> 张图片 |
                    浏览器: <strong>${stats.browserCount}</strong> 张 (约 ${stats.browserSizeMB} MB) |
                    酒馆: <strong>${stats.tavernCount}</strong> 张 |
                    GitHub: <strong>${stats.githubCount || 0}</strong> 张 |
                    当前模式: <strong>${getModeText(stats.currentMode)}</strong>
                `;
            }

            // 更新存储模式选择框
            const modeSelect = this.modalEl?.querySelector('#adv-storage-mode');
            if (modeSelect instanceof HTMLSelectElement) {
                modeSelect.value = stats.currentMode;
            }
        } catch (e) {
            this.ctx.error('settings-panel', '刷新存储统计失败:', e);
        }
    }
    /**
     * 迁移存储
     */
    async _migrateStorage(targetMode) {
        const imageGen = this.ctx.getModule('imageGen');
        if (!imageGen) return;

        const progressContainer = this.modalEl?.querySelector('#adv-migration-progress');
        const progressFill = this.modalEl?.querySelector('.tsp-progress-fill');
        const statusEl = this.modalEl?.querySelector('#adv-migration-status');

        if (progressContainer instanceof HTMLElement) {
            progressContainer.style.display = 'block';
        }

        try {
            const result = await imageGen.migrateStorage(targetMode, (current, total) => {
                const percent = Math.round((current / total) * 100);
                if (progressFill instanceof HTMLElement) {
                    progressFill.style.width = `${percent}%`;
                }
                if (statusEl) {
                    statusEl.textContent = `正在迁移... ${current}/${total} (${percent}%)`;
                }
            });

            if (statusEl) {
                statusEl.textContent = `迁移完成！成功: ${result.success}, 失败: ${result.failed}`;
            }

            this.ctx.helpers.showToast(`迁移完成！成功: ${result.success}, 失败: ${result.failed}`, result.failed > 0 ? 'warning' : 'success');

            // 刷新统计
            await this._refreshStorageStats();

        } catch (e) {
            this.ctx.error('settings-panel', '迁移失败:', e);
            if (statusEl) {
                statusEl.textContent = `迁移失败: ${e.message}`;
            }
            this.ctx.helpers.showToast(`迁移失败: ${e.message}`, 'error');
        }

        // 3秒后隐藏进度条
        setTimeout(() => {
            if (progressContainer instanceof HTMLElement) {
                progressContainer.style.display = 'none';
            }
        }, 3000);
    }
    /**
     * 绑定触发词设置事件
     */
    _bindTriggersTabEvents() {
        // 数据源开关
        this.modalEl.querySelector('#trigger-enable-tag-supermarket')?.addEventListener('change', (e) => {
            const checked = /** @type {HTMLInputElement} */ (e.target)?.checked;
            this._updateTriggerSetting('enableTagSupermarket', checked);
        });
        this.modalEl.querySelector('#trigger-enable-json-file')?.addEventListener('change', (e) => {
            const checked = /** @type {HTMLInputElement} */ (e.target)?.checked;
            this._updateTriggerSetting('enableJsonFile', checked);
        });
        this.modalEl.querySelector('#trigger-enable-custom')?.addEventListener('change', (e) => {
            const checked = /** @type {HTMLInputElement} */ (e.target)?.checked;
            this._updateTriggerSetting('enableCustom', checked);
        });

        // JSON 导入
        this.modalEl.querySelector('#trigger-import-json')?.addEventListener('click', () => {
            const input = this.modalEl.querySelector('#trigger-import-json-input');
            if (input instanceof HTMLInputElement) {
                input.value = '';
                input.click();
            }
        });
        this.modalEl.querySelector('#trigger-import-json-input')?.addEventListener('change', async (e) => {
            const target = /** @type {HTMLInputElement} */ (e.target);
            if (target?.files?.length) {
                await this._importTriggerJson(target.files[0]);
                target.value = '';
            }
        });
        this.modalEl.querySelector('#trigger-clear-json')?.addEventListener('click', async () => {
            const triggerProcessor = this.ctx.getModule('triggerProcessor');
            if (triggerProcessor) {
                triggerProcessor.clearJsonFile();
                this._updateJsonStatus();
                this._renderCustomTriggersList();
                this.ctx.helpers.showToast('JSON 数据已清除', 'success');
            }
        });

        // 导出触发词数据
        this.modalEl.querySelector('#trigger-export-json')?.addEventListener('click', async () => {
            await this._exportTriggerJson();
        });

        // 添加/编辑自定义触发词
        this.modalEl.querySelector('#trigger-add-custom')?.addEventListener('click', () => {
            const keyRaw = this._getValue('trigger-new-key');
            const valueRaw = this._getValue('trigger-new-value');
            const key = typeof keyRaw === 'string' ? keyRaw.trim() : '';
            const value = typeof valueRaw === 'string' ? valueRaw.trim() : '';
            if (!key || !value) {
                this.ctx.helpers.showToast('请填写触发词和替换内容', 'warning');
                return;
            }
            const triggerProcessor = this.ctx.getModule('triggerProcessor');
            if (triggerProcessor) {
                // 检查是否是编辑JSON导入的触发词
                if (triggerProcessor.settings.jsonFileData && triggerProcessor.settings.jsonFileData[key]) {
                    // 从JSON数据中删除
                    delete triggerProcessor.settings.jsonFileData[key];
                    triggerProcessor.saveSettings();
                    this._updateJsonStatus();
                }
                // 添加到自定义触发词
                triggerProcessor.setCustomTrigger(key, value);
                this._setValue('trigger-new-key', '');
                this._setValue('trigger-new-value', '');
                this._renderCustomTriggersList();
                this.ctx.helpers.showToast('触发词已保存', 'success');
            }
        });

        // 保存自定义占位符
        this.modalEl.querySelector('#trigger-placeholders')?.addEventListener('change', (e) => {
            const placeholders = e.target.value;
            const triggerProcessor = this.ctx.getModule('triggerProcessor');
            if (triggerProcessor) {
                triggerProcessor.setPlaceholders(placeholders);
            }
        });

        // 删除触发词导入按钮
        this.modalEl.querySelector('#trigger-import-delete-json')?.addEventListener('click', () => {
            const input = this.modalEl.querySelector('#trigger-import-delete-json-input');
            if (input instanceof HTMLInputElement) {
                input.value = '';
                input.click();
            }
        });

        // 删除触发词文件选择
        this.modalEl.querySelector('#trigger-import-delete-json-input')?.addEventListener('change', async (e) => {
            const target = /** @type {HTMLInputElement} */ (e.target);
            if (target?.files?.length) {
                await this._importDeleteTriggerJson(target.files[0]);
                target.value = '';
            }
        });

        // 删除触发词导出按钮
        this.modalEl.querySelector('#trigger-export-delete-json')?.addEventListener('click', async () => {
            await this._exportDeleteTriggerJson();
        });

        // 删除触发词清除按钮
        this.modalEl.querySelector('#trigger-clear-delete-json')?.addEventListener('click', async () => {
            const triggerProcessor = this.ctx.getModule('triggerProcessor');
            if (triggerProcessor) {
                triggerProcessor.settings.deleteData = {};
                triggerProcessor.saveSettings();
                this._updateDeleteJsonStatus();
                this._renderDeleteCustomTriggersList();
                this.ctx.helpers.showToast('删除触发词已清除', 'success');
            }
        });

        // 添加自定义删除触发词
        this.modalEl.querySelector('#trigger-add-delete-custom')?.addEventListener('click', () => {
            const keyRaw = this._getValue('trigger-delete-new-key');
            const valueRaw = this._getValue('trigger-delete-new-value');
            const key = typeof keyRaw === 'string' ? keyRaw.trim() : '';
            const value = typeof valueRaw === 'string' ? valueRaw.trim() : '';
            if (!key || !value) {
                this.ctx.helpers.showToast('请填写触发词和删除内容', 'warning');
                return;
            }
            const triggerProcessor = this.ctx.getModule('triggerProcessor');
            if (triggerProcessor) {
                triggerProcessor.setDeleteTrigger(key, value);
                this._setValue('trigger-delete-new-key', '');
                this._setValue('trigger-delete-new-value', '');
                this._renderDeleteCustomTriggersList();
                this.ctx.helpers.showToast('删除触发词已添加', 'success');
            }
        });

        // 测试触发词
        this.modalEl.querySelector('#trigger-test-btn')?.addEventListener('click', async () => {
            const input = this._getValue('trigger-test-input') || '';
            const triggerProcessor = this.ctx.getModule('triggerProcessor');
            if (triggerProcessor && input) {
                try {
                    const result = await triggerProcessor.processTriggers(input);
                    this._setValue('trigger-test-output', result);
                } catch (e) {
                    this._setValue('trigger-test-output', `错误: ${e.message}`);
                }
            }
        });

        // 初始化触发词设置显示
        this._loadTriggersSettings();
        this._bindThemeEvents();

        this._bindUpdateEvents();
    }
    /**
     * 检测当前是否运行在 TauriTavern 客户端环境中
     * TauriTavern 是基于 Tauri 的桌面客户端，其扩展路径与浏览器版不同
     * @returns {boolean} 是否为 TauriTavern 环境
     */
    _detectTauriTavern() {
        try {
            // 方式1：检测 Tauri 全局注入对象
            if (typeof window !== 'undefined' && (window.__TAURI__ || window.__TAURI_INTERNALS__)) {
                // 进一步确认是否为 TauriTavern（检查 userAgent 或特定标识）
                const ua = navigator.userAgent || '';
                if (ua.includes('Tauri') || ua.includes('tauritavern') || ua.includes('TauriTavern')) {
                    return true;
                }
                // 如果有 Tauri 对象但 userAgent 不明确，也可能是 Tauri 环境，进一步检测路径
                // TauriTavern 会有特定的应用数据路径特征
                return true;
            }

            // 方式2：检测 window.location.protocol 是否为特殊的 tauri 协议
            if (typeof window !== 'undefined' && window.location) {
                const protocol = window.location.protocol;
                if (protocol === 'tauri:' || protocol === 'http:' && window.location.hostname === 'localhost' && navigator.userAgent.includes('Tauri')) {
                    return true;
                }
            }

            // 方式3：检测特定的 TauriTavern 全局变量或 DOM 特征
            if (typeof document !== 'undefined') {
                // 检查 welcomePanel 中是否有 TauriTavern 特有的元素
                const ttWelcomeDiscord = document.getElementById('tt-welcome-discord-link');
                if (ttWelcomeDiscord) {
                    return true;
                }
            }

            return false;
        } catch (e) {
            // 检测出错时，默认返回 false，走原有逻辑
            console.warn('[TSP/TauriTavern] 环境检测异常，默认使用非 TauriTavern 模式:', e);
            return false;
        }
    }

    /**
     *  绑定更新页按钮事件
     */
    _bindUpdateEvents() {
        this.modalEl.querySelector('#tsp-btn-check-update')?.addEventListener('click', () => {
            this._checkForUpdates(false);
        });

        this.modalEl.querySelector('#tsp-btn-do-update')?.addEventListener('click', () => {
            this._performUpdate();
        });
    }
    // [在这里插入下面两个新函数]
    /**
     * 【多角色预设】两个预设的出厂默认配置
     */
    static MULTICHAR_PRESET_FACTORY_DEFAULTS = {
        common: {
            sceneCompositionHeader: 'Scene Composition:',
            characterPromptTemplate: 'Character {n} Prompt:',
            characterUCTemplate: 'Character {n} UC:',
            negativePromptHeader: 'Negative prompt:',
            coordinateTemplate: '|centers:{coord}',
            resolutionTemplate: 'size:',
            stylePresetTemplate: 'preset:',
            maxCharacters: 4,
            resolutionEnabled: true,
            stylePresetEnabled: true
        },
        moyu: {
            sceneCompositionHeader: 'Scene:',
            characterPromptTemplate: 'Char{n}:',
            characterUCTemplate: 'Char{n} UC:',
            negativePromptHeader: 'Negative:',
            coordinateTemplate: '|centers:{coord}',
            resolutionTemplate: 'size:',
            stylePresetTemplate: 'preset:',
            maxCharacters: 4,
            resolutionEnabled: true,
            stylePresetEnabled: true
        }
    };

    /**
     * 【多角色预设】获取指定预设的出厂默认值（兜底用）
     */
    _getMulticharFactoryDefault(presetKey) {
        const all = SettingsPanel.MULTICHAR_PRESET_FACTORY_DEFAULTS;
        return all[presetKey] ? JSON.parse(JSON.stringify(all[presetKey])) : JSON.parse(JSON.stringify(all.common));
    }

    /**
     * 【多角色预设】从当前表单收集配置对象
     */
    _collectMulticharFormConfig() {
        return {
            sceneCompositionHeader: this._getValue('multichar-scene-header') || 'Scene Composition:',
            characterPromptTemplate: this._getValue('multichar-prompt-template') || 'Character {n} Prompt:',
            characterUCTemplate: this._getValue('multichar-uc-template') || 'Character {n} UC:',
            negativePromptHeader: this._getValue('multichar-negative-header') || 'Negative prompt:',
            coordinateTemplate: this._getValue('multichar-coord-template') || '|centers:{coord}',
            resolutionTemplate: this._getValue('multichar-resolution-template') || 'size:',
            stylePresetTemplate: this._getValue('multichar-style-preset-template') || 'preset:',
            maxCharacters: parseInt(this._getValue('multichar-max-characters')) || 4,
            resolutionEnabled: this.modalEl.querySelector('#multichar-resolution-enabled')?.checked ?? true,
            stylePresetEnabled: this.modalEl.querySelector('#multichar-style-preset-enabled')?.checked ?? true
        };
    }

    /**
     * 【多角色预设】把配置对象填入表单
     */
    _applyMulticharConfigToForm(config) {
        if (!config) return;
        const fields = {
            'multichar-scene-header': config.sceneCompositionHeader,
            'multichar-prompt-template': config.characterPromptTemplate,
            'multichar-uc-template': config.characterUCTemplate,
            'multichar-negative-header': config.negativePromptHeader,
            'multichar-coord-template': config.coordinateTemplate,
            'multichar-resolution-template': config.resolutionTemplate,
            'multichar-style-preset-template': config.stylePresetTemplate,
            'multichar-max-characters': String(config.maxCharacters || 4)
        };
        for (const [id, value] of Object.entries(fields)) {
            if (value != null) {
                const el = this.modalEl.querySelector(`#${id}`);
                if (el) el.value = value;
            }
        }
        const resEl = this.modalEl.querySelector('#multichar-resolution-enabled');
        if (resEl) resEl.checked = config.resolutionEnabled ?? true;
        const styleEl = this.modalEl.querySelector('#multichar-style-preset-enabled');
        if (styleEl) styleEl.checked = config.stylePresetEnabled ?? true;
        this._updateMultiCharPreview();
    }

    /**
     * 【多角色预设】加载预设容器（包含两个预设各自的用户自定义修改 + 当前选中项 + 是否首次加载）
     * 数据结构：
     * {
     *   version: 1,
     *   currentPreset: 'common' | 'moyu',
     *   firstTimeLoaded: boolean,   // 是否已执行过首次初始化
     *   presets: {
     *     common: {...用户修改过的 common 配置},
     *     moyu:   {...用户修改过的 moyu 配置}
     *   }
     * }
     */
    async _loadMulticharPresetsContainer() {
        const saved = await this.ctx.api.getValue('multichar_presets_data', null);
        if (saved && typeof saved === 'object' && saved.presets) {
            // 确保两个预设 key 都存在（兼容老数据）
            saved.presets.common = { ...this._getMulticharFactoryDefault('common'), ...(saved.presets.common || {}) };
            saved.presets.moyu = { ...this._getMulticharFactoryDefault('moyu'), ...(saved.presets.moyu || {}) };
            return saved;
        }
        // 全新容器：首次加载用户默认 currentPreset = 'moyu'（摸鱼）
        return {
            version: 1,
            currentPreset: 'moyu',
            firstTimeLoaded: false,
            presets: {
                common: this._getMulticharFactoryDefault('common'),
                moyu:   this._getMulticharFactoryDefault('moyu')
            }
        };
    }

    /**
     * 【多角色预设】保存预设容器
     */
    async _saveMulticharPresetsContainer(container) {
        await this.ctx.api.setValue('multichar_presets_data', container);
    }

    /**
     * 【多角色预设】将当前表单配置保存到容器的指定预设槽位（只更新 presetsData，不写 API）
     */
    _stashCurrentFormIntoPreset(container, presetKey) {
        if (!container || !container.presets) return;
        container.presets[presetKey] = this._collectMulticharFormConfig();
    }

    /**
     *  绑定多角色定义页事件
     */
    _bindMultiCharTabEvents() {
        const updatePreview = () => this._updateMultiCharPreview();

        this.modalEl.querySelector('#multichar-scene-header')?.addEventListener('input', updatePreview);
        this.modalEl.querySelector('#multichar-prompt-template')?.addEventListener('input', updatePreview);
        this.modalEl.querySelector('#multichar-uc-template')?.addEventListener('input', updatePreview);
        this.modalEl.querySelector('#multichar-negative-header')?.addEventListener('input', updatePreview);
        this.modalEl.querySelector('#multichar-coord-template')?.addEventListener('input', updatePreview);
        this.modalEl.querySelector('#multichar-resolution-template')?.addEventListener('input', updatePreview);
        this.modalEl.querySelector('#multichar-style-preset-template')?.addEventListener('input', updatePreview);
        this.modalEl.querySelector('#multichar-resolution-enabled')?.addEventListener('change', updatePreview);
        this.modalEl.querySelector('#multichar-style-preset-enabled')?.addEventListener('change', updatePreview);
        this.modalEl.querySelector('#multichar-max-characters')?.addEventListener('change', updatePreview);

        // 预设切换下拉框事件
        this.modalEl.querySelector('#multichar-preset-select')?.addEventListener('change', async (e) => {
            const newPreset = e.target.value;
            if (!newPreset) return;
            try {
                const container = await this._loadMulticharPresetsContainer();
                const oldPreset = container.currentPreset || 'common';
                // 切换前：先把当前表单内容保存回"旧预设"槽位，保证用户修改不丢失
                this._stashCurrentFormIntoPreset(container, oldPreset);
                // 切换选中项
                container.currentPreset = newPreset;
                await this._saveMulticharPresetsContainer(container);
                // 把"新预设"的配置填入表单（同时刷新预览）
                const targetConfig = container.presets[newPreset] || this._getMulticharFactoryDefault(newPreset);
                this._applyMulticharConfigToForm(targetConfig);
                // 同时把新预设的配置同步到 multichar_config，保证其他模块立即生效
                await this.ctx.api.setValue('multichar_config', targetConfig);
                const imageGen = this.ctx.getModule('imageGen');
                if (imageGen && typeof MultiCharacterParser !== 'undefined') {
                    MultiCharacterParser.setConfig(targetConfig);
                }
                this.ctx.helpers.showToast(`已切换到「${newPreset === 'moyu' ? '摸鱼' : '通用'}」预设`, 'info');
            } catch (err) {
                this.ctx.error('settings-panel', '切换多角色预设失败:', err);
                this.ctx.helpers.showToast('切换预设失败: ' + err.message, 'error');
            }
        });

        this.modalEl.querySelector('#multichar-reset-defaults')?.addEventListener('click', () => {
            this._resetMultiCharDefaults();
        });

        this.modalEl.querySelector('#multichar-apply')?.addEventListener('click', async () => {
            await this._saveMultiCharConfig();
        });
    }

    /**
     * 更新多角色格式预览
     */
    _updateMultiCharPreview() {
        const previewEl = this.modalEl.querySelector('#multichar-preview');
        if (!previewEl) return;

        const sceneHeader = this._getValue('multichar-scene-header') || 'Scene Composition:';
        const promptTemplate = this._getValue('multichar-prompt-template') || 'Character {n} Prompt:';
        const ucTemplate = this._getValue('multichar-uc-template') || 'Character {n} UC:';
        const negativeHeader = this._getValue('multichar-negative-header') || 'Negative prompt:';
        const coordTemplate = this._getValue('multichar-coord-template') || '|centers:{coord}';
        const resolutionTemplate = this._getValue('multichar-resolution-template') || 'size:';
        const stylePresetTemplate = this._getValue('multichar-style-preset-template') || 'preset:';
        const maxChars = parseInt(this._getValue('multichar-max-characters')) || 4;

        let preview = `<span style="color: var(--tsp-accent);">${sceneHeader}</span>场景描述内容;\n\n`;

        for (let i = 1; i <= Math.min(maxChars, 4); i++) {
            const promptHeader = promptTemplate.replace('{n}', String(i));
            const ucHeader = ucTemplate.replace('{n}', String(i));
            const coord = coordTemplate.replace('{coord}', ['C3', 'A2', 'E2', 'C4'][i - 1] || 'C3');

            preview += `<span style="color: var(--tsp-accent);">${promptHeader}</span>角色${i}描述 ${coord};\n`;
            preview += `<span style="color: var(--tsp-accent);">${ucHeader}</span>角色${i}负面词;\n\n`;
        }

        preview += `<span style="color: var(--tsp-accent);">${negativeHeader}</span>全局负面提示词;\n\n`;
        const resolutionEnabled = this.modalEl.querySelector('#multichar-resolution-enabled')?.checked ?? true;
        const stylePresetEnabled = this.modalEl.querySelector('#multichar-style-preset-enabled')?.checked ?? true;
        if (resolutionEnabled) {
            preview += `${resolutionTemplate}832x1216;\n`;
        }
        if (stylePresetEnabled) {
            preview += `${stylePresetTemplate}动漫;`;
        }

        previewEl.innerHTML = preview;
    }

    /**
     * 重置多角色定义为默认值
     * 【多角色预设改造】只重置当前选中的预设为该预设的「出厂默认值」，不影响另外一个预设
     */
    async _resetMultiCharDefaults() {
        // 先读取当前选中的预设（如果下拉框存在就用下拉框的，否则用容器里的 currentPreset 兜底）
        const selectEl = this.modalEl.querySelector('#multichar-preset-select');
        let currentPresetKey = selectEl?.value;
        if (!currentPresetKey) {
            const container = await this._loadMulticharPresetsContainer();
            currentPresetKey = container.currentPreset || 'common';
        }
        // 取当前预设的出厂默认值
        const factoryDefault = this._getMulticharFactoryDefault(currentPresetKey);
        this._applyMulticharConfigToForm(factoryDefault);
        const presetName = currentPresetKey === 'moyu' ? '摸鱼' : '通用';
        this.ctx.helpers.showToast(`已恢复「${presetName}」预设的出厂默认值`, 'info');
    }

    /**
     * 保存多角色定义配置
     * 【多角色预设改造】同时保存到：
     *   1. multichar_config（兼容老的扁平结构，其他模块直接读）
     *   2. multichar_presets_data 的当前预设槽位（每个预设独立保存用户修改）
     */
    async _saveMultiCharConfig() {
        const config = this._collectMulticharFormConfig();
        try {
            // 1. 写入兼容的扁平结构（所有现有模块继续通过此 key 读取）
            await this.ctx.api.setValue('multichar_config', config);

            // 2. 写入预设容器的当前预设槽，保证用户的修改被"记住"
            const container = await this._loadMulticharPresetsContainer();
            const presetKey = container.currentPreset || 'common';
            container.presets[presetKey] = { ...config };
            await this._saveMulticharPresetsContainer(container);

            // 3. 同步到 MultiCharacterParser，立即生效
            if (typeof MultiCharacterParser !== 'undefined') {
                MultiCharacterParser.setConfig(config);
            }
            this.ctx.helpers.showToast('多角色定义配置已保存', 'success');
        } catch (e) {
            this.ctx.error('settings-panel', '保存多角色配置失败:', e);
            this.ctx.helpers.showToast('保存失败: ' + e.message, 'error');
        }
    }

    /**
     * 加载多角色定义配置
     * 【多角色预设改造】
     *   - 首次加载的用户（firstTimeLoaded=false）：默认选中「摸鱼」预设
     *   - 老用户（有 multichar_config 但无 multichar_presets_data）：
     *     自动把老配置迁移为「通用」预设的用户自定义值
     *   - 同步设置预设下拉框的选中项，并把对应预设填入表单
     */
    async _loadMultiCharConfig() {
        try {
            const [savedFlatConfig, container] = await Promise.all([
                this.ctx.api.getValue('multichar_config', null),
                this._loadMulticharPresetsContainer()
            ]);

            const isFirstTime = container.firstTimeLoaded !== true;

            // 情况 A：首次加载用户（完全新用户）→ 默认摸鱼预设
            if (isFirstTime && !savedFlatConfig) {
                container.currentPreset = 'moyu';
            }
            // 情况 B：老用户迁移（只有老的 multichar_config，没有预设容器数据）→
            //   把老配置存到「通用」预设里，默认选中通用
            else if (isFirstTime && savedFlatConfig && !container._migrated) {
                container.presets.common = { ...container.presets.common, ...savedFlatConfig };
                container.currentPreset = 'common';
                container._migrated = true;
            }
            // 情况 C：有预设容器数据 → 完全以预设容器为准

            container.firstTimeLoaded = true;

            // 以当前预设的配置为准填入表单
            const presetKey = container.currentPreset || 'moyu';
            const presetConfig = container.presets[presetKey] || this._getMulticharFactoryDefault(presetKey);

            // 保存更新后的预设容器
            await this._saveMulticharPresetsContainer(container);

            // 同时确保 multichar_config 扁平结构与当前预设保持同步
            await this.ctx.api.setValue('multichar_config', presetConfig);
            if (typeof MultiCharacterParser !== 'undefined') {
                MultiCharacterParser.setConfig(presetConfig);
            }

            // 填入表单
            this._applyMulticharConfigToForm(presetConfig);

            // 更新下拉框显示选中的预设
            const selectEl = this.modalEl.querySelector('#multichar-preset-select');
            if (selectEl) selectEl.value = presetKey;

        } catch (e) {
            this.ctx.error('settings-panel', '加载多角色配置失败:', e);
        }
    }

    /**
     *  绑定控制台事件
     */
    _bindConsoleEvents() {
        this.modalEl.querySelector('#tsp-console-refresh')?.addEventListener('click', () => this._refreshConsoleView());
        this.modalEl.querySelector('#tsp-console-clear')?.addEventListener('click', () => {
            const consoleModule = this.ctx.getModule('debugConsole');
            if (consoleModule) {
                consoleModule.clear();
                this._refreshConsoleView();
            }
        });
        this.modalEl.querySelector('#tsp-console-export')?.addEventListener('click', () => {
            this.ctx.getModule('debugConsole')?.exportTxt();
        });
    }

    _bindChangelogEvents() {
        const changelogList = this.modalEl.querySelector('#tsp-changelog-list');
        if (!changelogList) return;

        const displayCount = 5;

        changelogList.addEventListener('click', (e) => {
            const header = e.target.closest('.tsp-changelog-header');
            if (header) {
                const item = header.closest('.tsp-changelog-item');
                const index = parseInt(item.dataset.index);
                const isExpanded = header.dataset.expanded === 'true';
                const toggle = header.querySelector('.tsp-changelog-toggle');

                if (isExpanded) {
                    header.dataset.expanded = 'false';
                    toggle.classList.remove('fa-chevron-down');
                    toggle.classList.add('fa-chevron-up');
                    const content = item.querySelector('.tsp-changelog-content');
                    if (content) content.remove();
                } else {
                    header.dataset.expanded = 'true';
                    toggle.classList.remove('fa-chevron-up');
                    toggle.classList.add('fa-chevron-down');
                    const log = changelogData[index];
                    const contentEl = document.createElement('ul');
                    contentEl.className = 'tsp-changelog-content';
                    contentEl.innerHTML = log.items.map(item => `<li>${item}</li>`).join('');
                    item.appendChild(contentEl);
                }
            }
        });

        this.modalEl.querySelector('#tsp-changelog-expand-all')?.addEventListener('click', () => {
            changelogList.querySelectorAll('.tsp-changelog-item').forEach(item => {
                const header = item.querySelector('.tsp-changelog-header');
                const index = parseInt(item.dataset.index);
                const toggle = item.querySelector('.tsp-changelog-toggle');

                if (header.dataset.expanded !== 'true') {
                    header.dataset.expanded = 'true';
                    toggle.classList.remove('fa-chevron-up');
                    toggle.classList.add('fa-chevron-down');

                    const log = changelogData[index];
                    const contentEl = document.createElement('ul');
                    contentEl.className = 'tsp-changelog-content';
                    contentEl.innerHTML = log.items.map(item => `<li>${item}</li>`).join('');
                    item.appendChild(contentEl);
                }
            });
        });

        this.modalEl.querySelector('#tsp-changelog-collapse-all')?.addEventListener('click', () => {
            changelogList.querySelectorAll('.tsp-changelog-item').forEach(item => {
                const header = item.querySelector('.tsp-changelog-header');
                const toggle = item.querySelector('.tsp-changelog-toggle');
                const content = item.querySelector('.tsp-changelog-content');

                header.dataset.expanded = 'false';
                toggle.classList.remove('fa-chevron-down');
                toggle.classList.add('fa-chevron-up');
                if (content) content.remove();
            });
        });

        const items = changelogList.querySelectorAll('.tsp-changelog-item');
        items.forEach((item, index) => {
            const header = item.querySelector('.tsp-changelog-header');
            const toggle = item.querySelector('.tsp-changelog-toggle');
            const isExpanded = header.dataset.expanded === 'true';

            // 根据 data-expanded 属性设置图标
            if (isExpanded) {
                toggle.classList.remove('fa-chevron-up');
                toggle.classList.add('fa-chevron-down');
                // 检查是否已经有内容，如果没有则添加
                if (!item.querySelector('.tsp-changelog-content')) {
                    const log = changelogData[index];
                    const contentEl = document.createElement('ul');
                    contentEl.className = 'tsp-changelog-content';
                    contentEl.innerHTML = log.items.map(item => `<li>${item}</li>`).join('');
                    item.appendChild(contentEl);
                }
            } else {
                toggle.classList.remove('fa-chevron-down');
                toggle.classList.add('fa-chevron-up');
                // 移除内容
                const content = item.querySelector('.tsp-changelog-content');
                if (content) content.remove();
            }
        });
    }

    /**
     *  刷新控制台视图
     */
    _refreshConsoleView() {
        const container = this.modalEl?.querySelector('#tsp-console-output');
        const debugConsole = this.ctx.getModule('debugConsole');
        if (container && debugConsole) {
            container.innerHTML = debugConsole.renderHTML();
            // 自动滚动到底部
            requestAnimationFrame(() => {
                container.scrollTop = container.scrollHeight;
            });
        }
    }
    /**
     * [修改] 检查更新核心逻辑 (自动处理 Local/Global 和 CSRF，兼容 TauriTavern)
     * @param {boolean} silent 是否静默检查 (不弹窗)
     */
    async _checkForUpdates(silent = false) {
        if (!silent) {
            const btn = this.modalEl?.querySelector('#tsp-btn-check-update');
            if(btn) btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> 检查中...';
        }

        const extensionName = 'chami_tavern-scene-plugin';

        // ========================================
        // TauriTavern 客户端适配分支
        // TauriTavern 使用不同的扩展路径，服务器端API无法找到正确的扩展目录
        // 因此直接读取本地 manifest.json 获取版本信息，跳过服务器端检查
        // ========================================
        if (this.isTauriTavern) {
            try {
                this.ctx.log('settings-panel', '检测到 TauriTavern 环境，使用本地版本检查模式');
                // 尝试从本地加载 manifest.json 获取当前版本
                const manifestUrl = `/scripts/extensions/third-party/${extensionName}/manifest.json`;
                const manifestResponse = await fetch(manifestUrl, {
                    method: 'GET',
                    headers: getRequestHeaders ? getRequestHeaders() : {},
                    cache: 'no-store'
                });

                let currentVersion = 'unknown';
                if (manifestResponse.ok) {
                    const manifest = await manifestResponse.json();
                    currentVersion = manifest.version || currentVersion;
                }

                // TauriTavern 环境下，标记为无需检查更新（使用客户端自己的扩展管理机制）
                this.updateState = {
                    hasUpdate: false,
                    currentHash: `v${currentVersion}`,
                    checking: false,
                    isGlobal: true,
                    // TauriTavern 专用标记，用于在 UI 中禁用更新按钮
                    isTauriTavern: true
                };

                if (!silent) {
                    this.ctx.helpers.showToast(
                        `TauriTavern 环境: 当前版本 v${currentVersion}，请通过客户端扩展管理器更新`,
                        'info'
                    );
                }

                if (this.isOpen && this.modalEl) {
                    this._refreshUpdateUI();
                }

                return;
            } catch (tauriErr) {
                // TauriTavern 分支出错时，记录日志但不弹窗报错
                console.warn('[TSP/TauriTavern] 本地版本检查失败，尝试走标准检查流程:', tauriErr);
                // 继续走下面的标准检查流程作为兜底
            }
        }

        // 辅助函数：发起检查请求
        const tryFetchVersion = async (isGlobal) => {
            const response = await fetch('/api/extensions/version', {
                method: 'POST',
                headers: getRequestHeaders(), // 解决 403 Forbidden
                body: JSON.stringify({
                    extensionName: extensionName,
                    global: isGlobal
                })
            });
            if (response.status === 404) return null; // 目录不存在
            if (!response.ok) throw new Error(response.statusText); // 其他错误
            return await response.json();
        };

        try {
            // 1. 优先尝试作为 Local 插件检查
            let data = await tryFetchVersion(true);
            let isGlobal = true;

            // 2. 如果 Local 报 404，尝试作为 Global 插件检查
            if (!data) {
                // 如果第一次是静默检查且失败了，可能只是API没准备好，不尝试 Global 避免报错干扰
                data = await tryFetchVersion(false);
                if (data) isGlobal = false;
            }

            // 3. 如果还是找不到，抛出异常
            if (!data) {
                // 静默模式下如果不通过，可能是还没登录或未准备好，忽略
                if (silent) return;
                throw new Error('未找到插件目录 (404)，请确认插件安装位置');
            }

            // data 结构: { isUpToDate: boolean, currentCommitHash: string, ... }
            const hasUpdate = data.isUpToDate === false;

            // 更新状态
            this.updateState = {
                hasUpdate: hasUpdate,
                currentHash: data.currentCommitHash,
                checking: false,
                isGlobal: isGlobal // 记住正确的位置供更新使用
            };

            // 处理 UI 反馈
            if (hasUpdate) {
                if (!silent) this.ctx.helpers.showToast('发现新版本，请点击"立即更新"！', 'success');
            } else {
                if (!silent) this.ctx.helpers.showToast('当前已是最新版本', 'info');
            }

            // 刷新界面
            if (this.isOpen && this.modalEl) {
                this._refreshUpdateUI();
            }

        } catch (e) {
            console.error('Check update failed:', e);
            // TauriTavern 环境下静默处理错误，不打扰用户
            if (this.isTauriTavern && silent) {
                return;
            }
            if (!silent) this.ctx.helpers.showToast('检查更新失败: ' + e.message, 'error');
        } finally {
            if (!silent) {
                const btn = this.modalEl?.querySelector('#tsp-btn-check-update');
                if(btn) btn.innerHTML = '<i class="fa-solid fa-rotate-right"></i> 检查更新';
            }
        }
    }

    /**
     * [修改] 执行更新逻辑 (已修复缓存和UI提示问题，兼容 TauriTavern)
     */
    async _performUpdate() {
        // ========================================
        // TauriTavern 客户端适配分支
        // TauriTavern 使用自己的扩展管理机制，不使用 SillyTavern 标准的 Git 更新 API
        // ========================================
        if (this.isTauriTavern || this.updateState.isTauriTavern) {
            this.ctx.helpers.showToast(
                'TauriTavern 环境: 请通过客户端的扩展管理器进行更新',
                'info'
            );
            // 打开仓库页面引导用户
            const confirm = await this.ctx.helpers.promptConfirm(
                'TauriTavern 客户端使用独立的扩展管理机制。\n是否打开插件仓库查看最新版本？'
            );
            if (confirm) {
                window.open('https://github.com/shaochami/chami_tavern-scene-plugin', '_blank');
            }
            return;
        }

        const confirm = await this.ctx.helpers.promptConfirm('更新将拉取最新代码并重载页面，确定继续吗？');
        if (!confirm) return;

        const btn = this.modalEl.querySelector('#tsp-btn-do-update');
        const checkBtn = this.modalEl.querySelector('#tsp-btn-check-update');

        if(btn) {
            btn.disabled = true;
            btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> 更新中...';
        }
        if (checkBtn) {
            checkBtn.disabled = true;
        }

        const extensionName = 'chami_tavern-scene-plugin';
        // 使用检查时确定的位置
        const isGlobal = this.updateState.isGlobal;

        try {
            const response = await fetch('/api/extensions/update', {
                method: 'POST',
                headers: getRequestHeaders(), // 解决 403 Forbidden
                body: JSON.stringify({
                    extensionName: extensionName,
                    global: isGlobal // 传入正确的 global 参数解决 404
                })
            });

            if (!response.ok) {
                const text = await response.text();
                throw new Error(text || response.statusText);
            }

            const data = await response.json();

            // ================== [核心修复] ==================
            // 1. 不再使用会消失的 Toast。直接修改按钮和UI，给出持久的成功提示。
            if (btn) {
                btn.classList.remove('tsp-btn-primary');
                btn.classList.add('tsp-btn-success'); // 变成绿色按钮
                btn.innerHTML = `<i class="fa-solid fa-check"></i> 更新成功! 版本: ${data.shortCommitHash}`;
            }

            // 2. 额外使用一个 Toast 辅助提示，告诉用户即将重载。
            this.ctx.helpers.showToast('更新完成，3秒后将自动刷新页面...', 'success', 3000);

            // 3. 延迟 3 秒后，执行硬重载，强制浏览器拉取新文件。
            setTimeout(() => {
                window.location.reload(true); // 使用 true 参数进行硬重载！
            }, 3000);
            // ===============================================

        } catch (e) {
            this.ctx.helpers.showToast(`更新失败: ${e.message}`, 'error');
            // 更新失败时，恢复按钮状态
            if(btn) {
                btn.disabled = false;
                btn.innerHTML = '<i class="fa-solid fa-download"></i> 立即更新';
            }
            if (checkBtn) {
                checkBtn.disabled = false;
            }
        }
    }

    /**
     *  刷新更新页面的 UI 状态
     */
    _refreshUpdateUI() {
        // 1. 如果当前没切到 update tab，只刷新小红点
        const navLink = this.modalEl.querySelector('.tsp-nav-link[data-tab="update"]');
        if (navLink && this.updateState.hasUpdate) {
            if (!navLink.querySelector('.fa-circle')) {
                navLink.innerHTML += '<i class="fa-solid fa-circle" style="font-size: 8px; color: var(--tsp-accent-red); margin-left: auto;"></i>';
            }
        }

        // 2. 如果当前在 update tab，或者需要刷新里面的按钮状态
        const container = this.modalEl.querySelector('.tsp-settings-pane[data-pane="update"]');
        if (container) {
            // 重新渲染这一块最简单，或者手动操作 DOM
            container.innerHTML = this._renderUpdateSettings();
            // 重新绑定事件因为 DOM 被替换了
            this._bindUpdateEvents();
        }

        // 3. 刷新标题
        const titleEl = this.modalEl.querySelector('.tsp-modal-title');
        if (this.updateState.hasUpdate && titleEl) {
             titleEl.innerHTML = `
                <i class="fa-solid fa-gift" style="color: var(--tsp-accent-red)"></i>
                <span>插件设置 <span class="tsp-update-status-badge">有新版本！</span></span>
            `;
        }
    }
    /**
     * 加载触发词设置
     */
    async _loadTriggersSettings() {
        const triggerProcessor = this.ctx.getModule('triggerProcessor');
        if (!triggerProcessor) return;

        const settings = triggerProcessor.settings;

        // 设置开关状态
        this._setChecked('trigger-enable-tag-supermarket', settings.enableTagSupermarket);
        this._setChecked('trigger-enable-json-file', settings.enableJsonFile);
        this._setChecked('trigger-enable-custom', settings.enableCustom);

        // 设置自定义占位符
        this._setValue('trigger-placeholders', settings.placeholders || '{x}|[x]|{n}|[n]');

        // 更新 JSON 状态
        this._updateJsonStatus();
        // 更新删除触发词状态
        this._updateDeleteJsonStatus();

        // 渲染自定义触发词列表
        this._renderCustomTriggersList();

        // 渲染自定义删除触发词列表
        this._renderDeleteCustomTriggersList();
    }

    /**
     * 更新触发词设置
     */
    _updateTriggerSetting(key, value) {
        const triggerProcessor = this.ctx.getModule('triggerProcessor');
        if (triggerProcessor) {
            triggerProcessor.settings[key] = value;
            triggerProcessor.saveSettings();
        }
    }

    /**
     * 导入触发词 JSON 文件
     */
    async _importTriggerJson(file) {
        try {
            const text = await file.text();
            const data = JSON.parse(text);

            if (typeof data !== 'object' || data === null) {
                throw new Error('JSON 格式无效');
            }

            const triggerProcessor = this.ctx.getModule('triggerProcessor');
            if (triggerProcessor) {
                let importedCount = 0;

                // 检查是否是导出格式（包含jsonFileData和customData字段）
                if (data.jsonFileData && data.customData) {
                    // 导入jsonFileData
                    for (const [key, value] of Object.entries(data.jsonFileData)) {
                        if (value) {
                            triggerProcessor.settings.jsonFileData[key] = value;
                            importedCount++;
                        }
                    }
                    // 导入customData
                    for (const [key, value] of Object.entries(data.customData)) {
                        if (value) {
                            triggerProcessor.settings.customData[key] = value;
                            importedCount++;
                        }
                    }
                    triggerProcessor.saveSettings();
                } else {
                    // 兼容旧格式，直接作为jsonFileData导入
                    const success = triggerProcessor.importJsonFile(data);
                    if (!success) {
                        this.ctx.helpers.showToast('导入失败', 'error');
                        return;
                    }
                    importedCount = Object.keys(data).length;
                }

                this._updateJsonStatus();
                this._renderCustomTriggersList();
                this.ctx.helpers.showToast(`已导入 ${importedCount} 条触发词`, 'success');
            }
        } catch (e) {
            this.ctx.helpers.showToast(`导入失败: ${e.message}`, 'error');
        }
    }

    /**
     * 导出触发词数据（合并jsonFileData和customData）
     */
    async _exportTriggerJson() {
        try {
            const triggerProcessor = this.ctx.getModule('triggerProcessor');
            if (!triggerProcessor) {
                this.ctx.helpers.showToast('触发词处理器未初始化', 'error');
                return;
            }

            const exportData = {
                jsonFileData: triggerProcessor.settings.jsonFileData || {},
                customData: triggerProcessor.settings.customData || {},
                exportTime: new Date().toISOString(),
                version: '1.0'
            };

            const jsonString = JSON.stringify(exportData, null, 2);
            const blob = new Blob([jsonString], { type: 'application/json' });
            const url = URL.createObjectURL(blob);

            const a = document.createElement('a');
            a.href = url;
            a.download = `triggers-backup-${new Date().toISOString().slice(0,10)}.json`;
            a.click();

            URL.revokeObjectURL(url);

            const totalCount = Object.keys(exportData.jsonFileData).length + Object.keys(exportData.customData).length;
            this.ctx.helpers.showToast(`已导出 ${totalCount} 条触发词`, 'success');
        } catch (e) {
            this.ctx.helpers.showToast(`导出失败: ${e.message}`, 'error');
        }
    }

    /**
     * 导入删除触发词 JSON 文件
     */
    async _importDeleteTriggerJson(file) {
        try {
            const text = await file.text();
            const data = JSON.parse(text);

            if (typeof data !== 'object' || data === null) {
                throw new Error('JSON 格式无效');
            }

            const triggerProcessor = this.ctx.getModule('triggerProcessor');
            if (triggerProcessor) {
                let importedCount = 0;

                // 检查是否是导出格式（包含deleteData字段）
                if (data.deleteData) {
                    // 导入deleteData
                    for (const [key, value] of Object.entries(data.deleteData)) {
                        if (value) {
                            triggerProcessor.settings.deleteData[key] = value;
                            importedCount++;
                        }
                    }
                    triggerProcessor.saveSettings();
                } else {
                    // 兼容旧格式，直接作为deleteData导入
                    for (const [key, value] of Object.entries(data)) {
                        if (value) {
                            triggerProcessor.settings.deleteData[key] = value;
                            importedCount++;
                        }
                    }
                    triggerProcessor.saveSettings();
                }

                this._updateDeleteJsonStatus();
                this._renderDeleteCustomTriggersList();
                this.ctx.helpers.showToast(`已导入 ${importedCount} 条删除触发词`, 'success');
            }
        } catch (e) {
            this.ctx.helpers.showToast(`导入失败: ${e.message}`, 'error');
        }
    }

    /**
     * 导出删除触发词数据
     */
    async _exportDeleteTriggerJson() {
        try {
            const triggerProcessor = this.ctx.getModule('triggerProcessor');
            if (!triggerProcessor) {
                this.ctx.helpers.showToast('触发词处理器未初始化', 'error');
                return;
            }

            const exportData = {
                deleteData: triggerProcessor.settings.deleteData || {},
                exportTime: new Date().toISOString(),
                version: '1.0'
            };

            const jsonString = JSON.stringify(exportData, null, 2);
            const blob = new Blob([jsonString], { type: 'application/json' });
            const url = URL.createObjectURL(blob);

            const a = document.createElement('a');
            a.href = url;
            a.download = `delete-triggers-backup-${new Date().toISOString().slice(0,10)}.json`;
            a.click();

            URL.revokeObjectURL(url);

            const totalCount = Object.keys(exportData.deleteData).length;
            this.ctx.helpers.showToast(`已导出 ${totalCount} 条删除触发词`, 'success');
        } catch (e) {
            this.ctx.helpers.showToast(`导出失败: ${e.message}`, 'error');
        }
    }

    /**
     * 更新删除触发词状态显示
     */
    _updateDeleteJsonStatus() {
        const triggerProcessor = this.ctx.getModule('triggerProcessor');
        const statusEl = this.modalEl?.querySelector('#trigger-delete-json-status');
        if (statusEl && triggerProcessor) {
            const count = Object.keys(triggerProcessor.settings.deleteData || {}).length;
            statusEl.textContent = count > 0 ? `已导入 ${count} 条` : '未导入';
        }
    }

    /**
     * 更新 JSON 状态显示
     */
    _updateJsonStatus() {
        const triggerProcessor = this.ctx.getModule('triggerProcessor');
        const statusEl = this.modalEl?.querySelector('#trigger-json-status');
        if (statusEl && triggerProcessor) {
            const count = Object.keys(triggerProcessor.settings.jsonFileData || {}).length;
            statusEl.textContent = count > 0 ? `已导入 ${count} 条` : '未导入';
        }
    }

    /**
     * 渲染触发词列表（包括自定义和JSON导入的）
     */
    _renderCustomTriggersList() {
        const container = this.modalEl?.querySelector('#trigger-custom-list');
        if (!container) return;

        const triggerProcessor = this.ctx.getModule('triggerProcessor');
        if (!triggerProcessor) {
            container.innerHTML = '<p class="tsp-text-muted">触发词处理器未初始化</p>';
            return;
        }

        // 获取自定义触发词和JSON导入的触发词
        const customData = triggerProcessor.getCustomTriggers();
        const jsonData = triggerProcessor.settings.jsonFileData || {};

        // 合并所有触发词，标记来源
        const allTriggers = [];

        // 添加自定义触发词
        for (const [key, value] of Object.entries(customData)) {
            allTriggers.push({ key, value, source: 'custom' });
        }

        // 添加JSON导入的触发词
        for (const [key, value] of Object.entries(jsonData)) {
            allTriggers.push({ key, value, source: 'json' });
        }

        if (allTriggers.length === 0) {
            container.innerHTML = '<p class="tsp-text-muted">暂无触发词</p>';
            return;
        }

        container.innerHTML = allTriggers.map(({ key, value, source }) => `
            <div class="tsp-trigger-item" data-key="${this._escapeHtml(key)}" data-source="${source}">
                <div class="tsp-trigger-content">
                    <span class="tsp-trigger-key">${this._escapeHtml(key)}</span>
                    <span class="tsp-trigger-arrow">→</span>
                    <span class="tsp-trigger-value">${this._escapeHtml(String(value))}</span>
                    ${source === 'json' ? '<span class="tsp-badge tsp-badge-secondary" style="margin-left:8px; font-size:10px;">JSON</span>' : ''}
                </div>
                <div class="tsp-trigger-actions">
                    <button class="tsp-btn tsp-btn-icon tsp-btn-primary tsp-trigger-edit" title="编辑">
                        <i class="fa-solid fa-edit"></i>
                    </button>
                    <button class="tsp-btn tsp-btn-icon tsp-btn-danger tsp-trigger-delete" title="删除">
                        <i class="fa-solid fa-trash"></i>
                    </button>
                </div>
            </div>
        `).join('');

        // 绑定删除事件
        container.querySelectorAll('.tsp-trigger-delete').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const target = /** @type {HTMLElement | null} */ (e.target);
                const item = /** @type {HTMLElement | null} */ (target?.closest('.tsp-trigger-item'));
                const key = item?.dataset?.key;
                const source = item?.dataset?.source;
                if (key && triggerProcessor) {
                    if (source === 'custom') {
                        triggerProcessor.deleteCustomTrigger(key);
                    } else if (source === 'json') {
                        // 从jsonFileData中删除
                        delete triggerProcessor.settings.jsonFileData[key];
                        triggerProcessor.saveSettings();
                    }
                    this._renderCustomTriggersList();
                    this._updateJsonStatus();
                    this.ctx.helpers.showToast('触发词已删除', 'success');
                }
            });
        });

        // 绑定编辑事件
        container.querySelectorAll('.tsp-trigger-edit').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const target = /** @type {HTMLElement | null} */ (e.target);
                const item = /** @type {HTMLElement | null} */ (target?.closest('.tsp-trigger-item'));
                const key = item?.dataset?.key;
                const source = item?.dataset?.source;
                if (key && triggerProcessor) {
                    const value = source === 'custom' ? customData[key] : jsonData[key];
                    // 填充到输入框
                    this._setValue('trigger-new-key', key);
                    this._setValue('trigger-new-value', value);
                    // 显示编辑模式提示
                    this.ctx.helpers.showToast('已进入编辑模式，修改后点击添加按钮保存', 'info');
                }
            });
        });
    }

    /**
     * 渲染自定义删除触发词列表
     */
    _renderDeleteCustomTriggersList() {
        const container = this.modalEl?.querySelector('#trigger-delete-custom-list');
        if (!container) return;

        const triggerProcessor = this.ctx.getModule('triggerProcessor');
        if (!triggerProcessor) {
            container.innerHTML = '<p class="tsp-text-muted">触发词处理器未初始化</p>';
            return;
        }

        const deleteData = triggerProcessor.getDeleteTriggers();
        const entries = Object.entries(deleteData);

        if (entries.length === 0) {
            container.innerHTML = '<p class="tsp-text-muted">暂无自定义删除触发词</p>';
            return;
        }

        container.innerHTML = entries.map(([key, value]) => `
            <div class="tsp-trigger-item" data-key="${this._escapeHtml(key)}">
                <div class="tsp-trigger-content">
                    <span class="tsp-trigger-key">${this._escapeHtml(key)}</span>
                    <span class="tsp-trigger-arrow">→</span>
                    <span class="tsp-trigger-value">${this._escapeHtml(String(value))}</span>
                </div>
                <button class="tsp-btn tsp-btn-icon tsp-btn-danger tsp-trigger-delete" title="删除">
                    <i class="fa-solid fa-trash"></i>
                </button>
            </div>
        `).join('');

        // 绑定删除事件
        container.querySelectorAll('.tsp-trigger-delete').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const target = /** @type {HTMLElement | null} */ (e.target);
                const item = /** @type {HTMLElement | null} */ (target?.closest('.tsp-trigger-item'));
                const key = item?.dataset?.key;
                if (key && triggerProcessor) {
                    triggerProcessor.deleteDeleteTrigger(key);
                    this._renderDeleteCustomTriggersList();
                    this.ctx.helpers.showToast('删除触发词已删除', 'success');
                }
            });
        });
    }

    /**
     * HTML 转义
     */
    _escapeHtml(str) {
        if (!str) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    /**
     * 切换标签页
     */
    _switchTab(tab) {
        // 销毁当前标签页的内容（如果是提示词页或图片管理页）
        if (this.currentTab === 'prompts') {
            // 清理预设图片观察器
            if (this.presetImageObserver) {
                this.presetImageObserver.disconnect();
                this.presetImageObserver = null;
            }
            // 释放所有 blob:URL，防止内存泄漏
            if (this._presetBlobUrls) {
                for (const url of this._presetBlobUrls) {
                    URL.revokeObjectURL(url);
                }
                this._presetBlobUrls.clear();
            }
            const promptsPane = this.modalEl.querySelector('.tsp-settings-pane[data-pane="prompts"]');
            if (promptsPane) {
                promptsPane.innerHTML = `
                    <div class="tsp-settings-loading-placeholder" style="padding: 20px; text-align: center; color: var(--tsp-text-muted);">
                        <i class="fa-solid fa-spinner fa-spin"></i> 正在加载提示词设置...
                    </div>
                `;
            }
        } else if (this.currentTab === 'gallery') {
            const galleryPane = this.modalEl.querySelector('.tsp-settings-pane[data-pane="gallery"]');
            if (galleryPane) {
                galleryPane.innerHTML = `
                    <div class="tsp-settings-loading-placeholder" style="padding: 20px; text-align: center; color: var(--tsp-text-muted);">
                        <i class="fa-solid fa-spinner fa-spin"></i> 正在加载图片管理设置...
                    </div>
                `;
            }
        } else if (this.currentTab === 'imageAnalyzer') {
            const imageAnalyzerPane = this.modalEl.querySelector('.tsp-settings-pane[data-pane="imageAnalyzer"]');
            if (imageAnalyzerPane) {
                imageAnalyzerPane.innerHTML = `
                    <div class="tsp-settings-loading-placeholder" style="padding: 20px; text-align: center; color: var(--tsp-text-muted);">
                        <i class="fa-solid fa-spinner fa-spin"></i> 正在加载图片解析器...
                    </div>
                `;
            }
            if (this.imageAnalyzer) {
                this.imageAnalyzer.clear();
            }
        }

        this.currentTab = tab;

        // 更新导航高亮
        this.modalEl.querySelectorAll('.tsp-nav-link').forEach(link => {
            const tabName = /** @type {HTMLElement} */ (link)?.dataset?.tab;
            link.classList.toggle('active', tabName === tab);
        });

        // 显示对应内容
        this.modalEl.querySelectorAll('.tsp-settings-pane').forEach(pane => {
            const paneName = /** @type {HTMLElement} */ (pane)?.dataset?.pane;
            pane.classList.toggle('active', paneName === tab);
        });

        // 核心优化：只有切换到 prompts 页时，才动态加载内容
        if (tab === 'prompts') {
            const promptsPane = this.modalEl.querySelector('.tsp-settings-pane[data-pane="prompts"]');
            if (promptsPane) {
                // 渲染提示词设置内容
                promptsPane.innerHTML = this._renderPromptsSettings();
                // 绑定提示词标签页事件
                this._bindPromptTabEvents();
                // 加载预设数据
                this._loadPromptPresets({ keepEditor: true });
            }
        } else if (tab === 'gallery') {
            const galleryPane = this.modalEl.querySelector('.tsp-settings-pane[data-pane="gallery"]');
            if (galleryPane) {
                // 渲染图片管理设置内容
                galleryPane.innerHTML = this._renderGallerySettings();
                // 绑定图片管理标签页事件
                this._bindGalleryTabEvents();
                // 刷新缓存视图
                this._refreshCacheView();
            }
        }

        if (tab === 'triggers') this._loadTriggersSettings();
        if (tab === 'multichar') this._loadMultiCharConfig();
        if (tab === 'console') this._refreshConsoleView();
        if (tab === 'update') this._bindChangelogEvents();
        if (tab === 'imageAnalyzer') {
            const imageAnalyzerPane = this.modalEl.querySelector('.tsp-settings-pane[data-pane="imageAnalyzer"]');
            if (imageAnalyzerPane) {
                imageAnalyzerPane.innerHTML = this._renderImageAnalyzerSettings();
                if (this.imageAnalyzer) {
                    const container = imageAnalyzerPane.querySelector('#tsp-image-analyzer-container');
                    if (container) {
                        this.imageAnalyzer.render(container);
                    }
                }
            }
        }
    }

    /**
     * 切换模式视图
     * @param {string} mode - 要切换到的模式
     * @param {boolean} syncToBackend - 是否同步到后端 (打开面板刷新时设为 false，手动点击下拉框时设为 true)
     */
    async _switchMode(mode, syncToBackend = false) {
        if (syncToBackend) {
            try {
                const imageGen = this.ctx?.getModule?.('imageGen');
                if (imageGen?.setMode) {
                    await imageGen.setMode(mode);
                }
            } catch (e) {
                console.error("切换模式失败", e);
            }
        }

        // 更新导航
        const modeLink = this.modalEl?.querySelector('.tsp-nav-mode');
        if (modeLink) {
            modeLink.innerHTML = `
                <i class="${this._getModeIcon(mode)}"></i>
                <span>${this._getModeName(mode)}</span>
            `;
        }

        const container = this.modalEl?.querySelector('#mode-settings-container');
        if (container) {
            const allPanes = container.querySelectorAll('.tsp-mode-settings-pane');
            allPanes.forEach(el => el.style.display = 'none');

            const targetPane = container.querySelector(`.tsp-mode-settings-pane[data-mode-pane="${mode}"]`);
            if (targetPane) {
                // [修改] 如果目标面板尚未渲染（还是占位符），立即渲染它
                if (targetPane.querySelector('.tsp-settings-loading-placeholder')) {
                    this.ctx.helpers.showToast(`初次加载 ${this._getModeName(mode)} 设置...`, 'info');
                    // 稍微延迟一帧以让 Toast 显示出来
                    await new Promise(r => requestAnimationFrame(r));
                    this._renderSingleMode(mode);
                }

                targetPane.style.display = 'block';

                // 调用刷新逻辑
                if (this.modeSettings[mode]?.refreshOptions) {
                    requestAnimationFrame(() => {
                         if (this.modeSettings[mode]._restoreCurrentValues) {
                             this.modeSettings[mode]._restoreCurrentValues();
                         }
                    });
                }
            }
        }
        this._updateGeneralUI(mode);

        // 更新下拉框的选中状态（防止状态不同步）
        const select = this.modalEl?.querySelector('#settings-mode-select');
        if (select && select.value !== mode) {
            select.value = mode;
        }
        this._loadGeneralParams();
    }


    /**
     * 加载设置
     */
    async _loadSettings() {
        // 加载通用设置
        const text2imgEnabled = await this.ctx.api.getValue('text2img_enabled', true);
        const injectButtonsEnabled = await this.ctx.api.getValue('inject_buttons_enabled', false);
        const fabVisible = await this.ctx.api.getValue('fab_visible', true);
        const quickGenVisible = await this.ctx.api.getValue('quick_gen_visible', false);
        const autoInsert = await this.ctx.api.getValue('auto_insert_image', true);
        const autoGenerate = await this.ctx.api.getValue('auto_generate', false);
        const phoneEmulatorEnabled = await this.ctx.api.getValue('phone_emulator_enabled', true);
        const defaultWidth = await this.ctx.api.getValue('default_width', 832);
        const defaultHeight = await this.ctx.api.getValue('default_height', 1216);
        const defaultSteps = await this.ctx.api.getValue('default_steps', 20);

        this._setChecked('settings-text2img-enabled', text2imgEnabled);
        this._setChecked('settings-inject-buttons-enabled', injectButtonsEnabled);
        this._setChecked('settings-fab-visible', fabVisible);
        this._setChecked('settings-quick-gen-fab-visible', quickGenVisible);
        this._setChecked('settings-auto-insert', autoInsert);
        this._setChecked('settings-auto-generate', autoGenerate);
        this._setValue('settings-default-width', defaultWidth);
        this._setValue('settings-default-height', defaultHeight);
        this._setValue('settings-default-steps', defaultSteps);

        // 加载提示词正/负面文本
        const positiveText = await this.ctx.api.getValue('prompt_positive_text', '');
        const negativeText = await this.ctx.api.getValue('prompt_negative_text', '');
        this._setValue('prompt-positive-text', positiveText);
        this._setValue('prompt-negative-text', negativeText);

        // 加载固定形象多组输入框内容（可能还未渲染 UI，先存到实例属性，渲染时再回填）
        this.savedFixedAppearanceList = await this.ctx.api.getValue('prompt_fixed_appearance_list', null);

        // 加载提示词预设（保留已加载的文本，不覆盖）
        await this._loadPromptPresets({
            keepEditor: true,
            presetPositiveFallback: positiveText,
            presetNegativeFallback: negativeText,
        });

        // 同步到 PromptBuilder（用于悬浮窗预览）
        const promptBuilderSync = this.ctx.promptBuilder;
        if (promptBuilderSync) {
            promptBuilderSync.currentPrompt.rawInput = positiveText || '';
            if (typeof negativeText === 'string' && negativeText) {
                promptBuilderSync.currentPrompt.negativeTags = negativeText.split(',').map(s => s.trim()).filter(Boolean);
            }
        }

        // 载入通用参数（宽高/步数/CFG/Scale/Seed）
        this._loadGeneralParams();

        // 载入高级参数
        await this._loadAdvancedParams();

        // 载入多角色定义配置
        await this._loadMultiCharConfig();

        // 载入模块化开关设置
        await this._loadModuleToggleSettings();
    }

    /**
     * 保存设置 (修复版：优化执行顺序，解决保存两次才生效的问题)
     */
    async _saveSettings() {
        try {
            // ================== 第 1 步：优先保存所有 UI 输入到本地 API/内存 ==================
            // 必须先执行这些，否则后续 imageGen.saveSettings() 读取到的还是旧数据

            // 1.1 保存高级参数 (高级设置页面的选项，如缓存天数、自动点击等)
            // 这是修复问题的关键，提到前面执行
            await this._saveAdvancedParams();

            // 1.2 保存通用参数到当前模式 (宽/高/步数等) 到 imageGen 内存
             // this._saveGeneralParams();

            // 1.3 获取通用设置中的最新分辨率 (用于后续缩放参考)
            const widthVal = this._getValue('settings-default-width');
            const heightVal = this._getValue('settings-default-height');
            const targetWidth = parseInt(widthVal) || 512;
            const targetHeight = parseInt(heightVal) || 768;

            // 1.4 保存通用设置开关到 API
            // AI二次处理关闭时，强制关闭依赖它的注入按钮与快捷生成悬浮球（避免未初始化报错）
            const aiProcessorOn = this._getChecked('module-aiProcessor');
            await this.ctx.api.setValue('text2img_enabled', this._getChecked('settings-text2img-enabled'));
            await this.ctx.api.setValue('inject_buttons_enabled', aiProcessorOn ? this._getChecked('settings-inject-buttons-enabled') : false);
            await this.ctx.api.setValue('fab_visible', this._getChecked('settings-fab-visible'));
            const quickGenVisible = aiProcessorOn ? this._getChecked('settings-quick-gen-fab-visible') : false;
            await this.ctx.api.setValue('quick_gen_visible', quickGenVisible);
            await this.ctx.api.setValue('fix_hashline_enabled', this._getChecked('settings-fix-hashline-enabled'));

            // 1.5 保存模块化开关设置到 API
            await this.ctx.api.setValue('module_aiProcessor', aiProcessorOn);
            await this.ctx.api.setValue('module_triggers', this._getChecked('module-triggers'));
            await this.ctx.api.setValue('module_characterDB', this._getChecked('module-characterDB'));
            await this.ctx.api.setValue('module_tagMarket', this._getChecked('module-tagMarket'));
            await this.ctx.api.setValue('module_phoneEmulator', this._getChecked('module-phoneEmulator'));
            await this.ctx.api.setValue('module_tagVisualization', this._getChecked('module-tagVisualization'));
            await this.ctx.api.setValue('module_visualNovel', this._getChecked('module-visualNovel'));

            // --- [修复点开始] 使用临时变量获取模块，避免 ReferenceError ---
            const tempImageGen = this.ctx.getModule('imageGen');
            if (tempImageGen && typeof tempImageGen.toggleQuickGenFab === 'function') {
                tempImageGen.toggleQuickGenFab(quickGenVisible);
            }
            await this.ctx.api.setValue('auto_insert_image', this._getChecked('settings-auto-insert'));
            await this.ctx.api.setValue('auto_generate', this._getChecked('settings-auto-generate'));
            await this.ctx.api.setValue('default_width', widthVal);
            await this.ctx.api.setValue('default_height', heightVal);
            await this.ctx.api.setValue('default_steps', this._getValue('settings-default-steps'));

            // 1.5 保存提示词文本到 API
            const positiveText = this._getValue('prompt-positive-text') || '';
            const negativeText = this._getValue('prompt-negative-text') || '';
            await this.ctx.api.setValue('prompt_positive_text', positiveText);
            await this.ctx.api.setValue('prompt_negative_text', negativeText);

            // 1.5.1 保存固定形象多组输入框内容到 API（与多角色配置同样的存储路径：tsp-plugin-settings.json）
            await this.ctx.api.setValue('prompt_fixed_appearance_list', this._collectAllFixedAppearanceForSave());

            // 1.6 保存提示词设置 (Builder)
            const promptBuilder = this.ctx.promptBuilder;
            if (promptBuilder) {
                const qualityRaw = this._getValue('settings-quality-prefix');
                const negativeRaw = this._getValue('settings-negative-default');

                const quality = typeof qualityRaw === 'string'
                    ? qualityRaw.split(',').map(s => s.trim()).filter(Boolean)
                    : [];
                const negative = typeof negativeRaw === 'string'
                    ? negativeRaw.split(',').map(s => s.trim()).filter(Boolean)
                    : [];

                promptBuilder.presets.defaultQuality = quality;
                promptBuilder.presets.defaultNegative = negative;

                promptBuilder.currentPrompt.rawInput = positiveText;
                if (typeof negativeText === 'string' && negativeText) {
                    promptBuilder.currentPrompt.negativeTags = negativeText.split(',').map(s => s.trim()).filter(Boolean);
                }
            }

            // 1.7 保存多角色定义配置到 API
            // 【多角色预设改造】从表单统一收集，同时保存到扁平结构和当前预设槽位
            const multicharConfig = this._collectMulticharFormConfig();
            await this.ctx.api.setValue('multichar_config', multicharConfig);
            try {
                const container = await this._loadMulticharPresetsContainer();
                const presetKey = container.currentPreset || 'common';
                container.presets[presetKey] = { ...multicharConfig };
                await this._saveMulticharPresetsContainer(container);
            } catch (e) {
                this.ctx.error('settings-panel', '保存多角色预设数据失败:', e);
            }

            // ================== 第 2 步：处理当前模式特定的设置 ==================

            // 【关键修复】在收集设置之前，先更新所有模式的 DOM 输入框
            // 确保各个模式的独立输入框（如 #nai-width、#nai-height）使用最新的通用设置值
            await this._reloadAllModesFromAPI({
                width: targetWidth,
                height: targetHeight,
                steps: parseInt(this._getValue('settings-default-steps')) || 20
            });

            // 获取当前模式设置
            const currentMode = this._getCurrentMode();
            const modeSettings = this.modeSettings[currentMode].collectSettings();

            const imageGen = this.ctx.getModule('imageGen');
            if (imageGen && modeSettings) {
                // 保留原有的 controlNetUnits (如果是 SD 模式且 UI 未返回它) - 防御性编程
                if (currentMode === 'sd' && !modeSettings.controlNetUnits && imageGen.settings.sd?.controlNetUnits) {
                    modeSettings.controlNetUnits = imageGen.settings.sd.controlNetUnits;
                }

                // ControlNet 尺寸适配逻辑
                if (currentMode === 'sd' && modeSettings.controlNetUnits?.length > 0) {
                    // 检查是否有人开启了 ControlNet 并且有图片
                    const needsResize = modeSettings.controlNetUnits.some(u => u.enabled && u.image);

                    if (needsResize) {
                        // 并行处理缩放
                        const resizePromises = modeSettings.controlNetUnits.map(async (unit) => {
                            if (unit.image) {
                                // 调用辅助方法进行缩放，结果仍为 Base64
                                unit.image = await this._resizeImageToDimensions(unit.image, targetWidth, targetHeight);
                            }
                            return unit;
                        });

                        await Promise.all(resizePromises);
                    }
                }

                // 将面板收集到的配置应用到内存中
                imageGen.settings[currentMode] = {
                    ...imageGen.settings[currentMode],
                    ...modeSettings,
                };
                this._saveGeneralParams();
                imageGen.settings.insertIntoChat = this._getChecked('settings-auto-insert');

                // 预设选择 - 优先使用内存中的值，只有在提示词页面时才从 DOM 读取
                let prefix;
                if (this.currentTab === 'prompts') {
                    prefix = this._getSelectValue('prompt-preset-prefix');
                } else {
                    prefix = imageGen.settings.activePresetName || '';
                }
                imageGen.settings.activePresetName = prefix || '';

                // ================== 第 3 步：执行核心保存 (文件上传与同步) ==================
                // 此时所有的 API 值和内存值都已经是最新状态，执行保存就不会是旧数据了

                // 3.1 引用图片分离存储
                if (imageGen.storageManager) {
                     this.ctx.log('settings-panel', '正在同步引用图片到独立文件...');
                     await imageGen.storageManager.syncReferenceFiles(imageGen.settings);
                }

                // 3.2 保存配置到 ImageGen (本地 + 服务器 tsp-plugin-settings.json)
                // 这个函数内部会调用 _collectAdvancedSettings() 读取第 1 步写入的 API 值
                await imageGen.saveSettings();

                // 3.3 特殊处理 ComfyUI：如果有同步方法，强制再次同步工作流数据到服务器
                if (currentMode === 'comfyui' && this.modeSettings.comfyui && typeof this.modeSettings.comfyui._syncDataToServer === 'function') {
                    // 更新一下数据库里对应工作流的状态
                    if(modeSettings.activeWorkflow && this.ctx.db) {
                       try {
                           const workflows = await this.ctx.db.getAll('workflows') || [];
                           for(const wf of workflows) {
                               if(wf.name === modeSettings.activeWorkflow) {
                                   if(wf.status !== 1 && wf.status !== 3) { wf.status = 1; await this.ctx.db.put('workflows', wf); }
                               } else if (wf.status === 1) {
                                   wf.status = 0; await this.ctx.db.put('workflows', wf);
                               }
                           }
                       } catch(e) { console.warn('更新工作流状态失败', e); }
                    }

                    await this.modeSettings.comfyui._syncDataToServer();
                }
            }

            // ================== 第 4 步：收尾工作 ==================

            // 4.1 ComfyUI 同步防漏 (再次确保同步)
            if (this.modeSettings.comfyui && typeof this.modeSettings.comfyui._syncDataToServer === 'function') {
                await this.modeSettings.comfyui._syncDataToServer();
            }

            // 4.2 保存主题和背景 (custom_themes_data)
            await this._persistThemes();

            // 4.3 【关键修复】重新加载设置到 DOM 和内存
            // 解决修改分辨率等参数后，需要刷新页面才能生效的问题
            await this._loadSettings();

            // 4.4 【新增】从API重新加载所有模式的通用参数
            // 确保修改通用设置后，所有模式（nai、sd、comfyui）的内存和DOM都更新
            // 传入刚保存的值，避免异步读取 API 导致的时序问题
            await this._reloadAllModesFromAPI({
                width: targetWidth,
                height: targetHeight,
                steps: parseInt(this._getValue('settings-default-steps')) || 20
            });

            // 同步多角色定义配置到解析器（使用步骤1.7保存的配置）
            if (multicharConfig) {
                const { MultiCharacterParser } = await import('./multi-character-parser.js');
                MultiCharacterParser.setConfig(multicharConfig);
                this.ctx.log('settings-panel', '已同步多角色定义配置到解析器');
            }

            this.ctx.helpers.showToast('设置已保存', 'success');
            this.ctx.events.emit(EventTypes.SETTINGS_SAVED);

            this.close();

        } catch (e) {
            this.ctx.error('settings-panel', '保存设置失败:', e);
            this.ctx.helpers.showToast(`保存失败: ${e.message}`, 'error');
        }
    }

    /**
     * 【新增】辅助方法：强制调整图片尺寸
     * 用于在保存时同步 ControlNet 图片的分辨率
     */
    _resizeImageToDimensions(base64Str, targetW, targetH) {
        return new Promise((resolve) => {
            if (!base64Str) return resolve(null);

            const img = new Image();
            img.onload = () => {
                // 如果尺寸已一致，跳过
                if (img.naturalWidth === targetW && img.naturalHeight === targetH) {
                    resolve(base64Str);
                    return;
                }

                const canvas = document.createElement('canvas');
                canvas.width = targetW;
                canvas.height = targetH;
                const ctx = canvas.getContext('2d');

                // 使用高质量拉伸
                ctx.imageSmoothingEnabled = true;
                ctx.imageSmoothingQuality = 'high';
                ctx.drawImage(img, 0, 0, targetW, targetH);

                resolve(canvas.toDataURL('image/png'));
            };
            img.onerror = () => resolve(base64Str); // 失败返原图
            img.src = base64Str;
        });
    }
    /**
     * 重置当前标签页
     */
    _resetCurrentTab() {
        this.ctx.helpers.showToast('重置功能开发中...', 'info');
    }

    /**
     * 清除图像缓存
     */
    async _clearCache() {
        try {
            await this.ctx.db.clear(StoreNames.IMAGE_CACHE);
            this.ctx.helpers.showToast('图像缓存已清除', 'success');
        } catch (e) {
            this.ctx.helpers.showToast(`清除失败: ${e.message}`, 'error');
        }
    }

    /**
     * 导出生图主设置（直接导出 tsp-plugin-settings.json 完整内容）
     */
    async _exportMainSettings() {
        try {
            const imageGen = this.ctx.getModule('imageGen');
            const fileName = 'tsp-plugin-settings.json';
            let fileContent = null;

            // 优先直接从服务器获取原始文件内容
            try {
                if (typeof getRequestHeaders === 'function') {
                    const response = await fetch(`/user/files/${fileName}`, {
                        method: 'GET',
                        headers: getRequestHeaders(),
                    });
                    if (response.ok) {
                        fileContent = await response.text();
                    }
                }
            } catch (e) {
                // 获取失败时降级为从内存组装
                this.ctx.warn('settings-panel', '直接获取文件失败，降级为内存组装:', e);
            }

            // 如果直接获取失败，通过 storageManager 重新构建完整内容
            if (!fileContent && imageGen?.storageManager) {
                const settingsData = await imageGen.storageManager.loadPluginSettings();
                const storageSettings = imageGen.storageManager.settings;
                const advancedSettings = await imageGen._collectAdvancedSettings?.() || {};
                const data = {
                    version: '1.0.0',
                    updatedAt: new Date().toISOString(),
                    settings: {
                        image_gen_settings: imageGen.settings || {},
                        image_storage_settings: storageSettings || {},
                        advanced_settings: advancedSettings,
                    },
                };
                fileContent = JSON.stringify(data, null, 2);
            }

            if (!fileContent) {
                throw new Error('无法获取设置数据');
            }

            const blob = new Blob([fileContent], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = fileName;
            a.click();
            URL.revokeObjectURL(url);
            this.ctx.helpers.showToast('生图主设置已导出，如果想分享记得删除apikey字段内容', 'success');
        } catch (e) {
            this.ctx.error('settings-panel', '导出生图主设置失败:', e);
            this.ctx.helpers.showToast(`导出失败: ${e.message}`, 'error');
        }
    }

    /**
     * 导入生图主设置（直接写入 tsp-plugin-settings.json，并重新加载）
     */
    async _importMainSettings(files) {
        if (!files || files.length === 0) return;

        const file = files[0];
        try {
            const text = await file.text();
            const data = JSON.parse(text);

            // 验证格式：支持直接的 settings 对象，或带 version/updatedAt/settings 的完整文件
            let settingsToSave = null;
            if (data && data.settings && typeof data.settings === 'object') {
                // tsp-plugin-settings.json 完整格式
                settingsToSave = data.settings;
            } else if (data && (data.image_gen_settings || data.image_storage_settings || data.advanced_settings)) {
                // settings 对象本身
                settingsToSave = data;
            } else {
                throw new Error('文件格式不正确，请选择正确的 tsp-plugin-settings.json 文件');
            }

            const imageGen = this.ctx.getModule('imageGen');
            if (!imageGen?.storageManager) {
                throw new Error('存储管理器未初始化');
            }

            // 1. 保存到服务器 tsp-plugin-settings.json
            const ok = await imageGen.storageManager.savePluginSettings(settingsToSave);
            if (!ok) {
                throw new Error('保存到服务器失败');
            }

            // 2. 刷新页面，让浏览器自行从服务器加载新数据
            //    手动同步内存 + IndexedDB + DOM 控件太多且易遗漏，直接刷新最可靠
            this.ctx.helpers.showToast('生图主设置导入成功，即将刷新页面以应用新配置', 'success');
            setTimeout(() => location.reload(), 800);
        } catch (e) {
            this.ctx.error('settings-panel', '导入生图主设置失败:', e);
            this.ctx.helpers.showToast(`导入失败: ${e.message}`, 'error');
        }
    }

    /**
     * 清空生图主设置（保存空对象到 tsp-plugin-settings.json，并重置本地设置）
     */
    async _clearMainSettings() {
        try {
            const imageGen = this.ctx.getModule('imageGen');
            if (!imageGen?.storageManager) {
                throw new Error('存储管理器未初始化');
            }

            // 1. 保存空设置到服务器 tsp-plugin-settings.json
            const emptySettings = {};
            await imageGen.storageManager.savePluginSettings(emptySettings);

            // 2. 同步清空本地 extension_settings 存储
            await this.ctx.api.setValue('image_gen_settings', {});

            // 3. 提示用户刷新页面以完全重置为默认设置
            //    清空后必须刷新页面，因为 imageGen.settings 内存值和高级设置 extension_settings
            //    无法在不重新初始化模块的情况下完全重置；不刷新的话点击"保存关闭"会把旧内存值再次写回服务器
            this.ctx.helpers.showToast('生图主设置已清空，即将刷新页面以应用默认设置', 'success');
            setTimeout(() => location.reload(), 800);
        } catch (e) {
            this.ctx.error('settings-panel', '清空生图主设置失败:', e);
            this.ctx.helpers.showToast(`清空失败: ${e.message}`, 'error');
        }
    }

    /**
     * 导出二次处理数据（prompt_optimization.json）
     * 导出前弹窗询问是否携带角色数据库内容（characterDB 字段）
     */
    async _exportPromptOptimization() {
        try {
            const fileName = 'prompt_optimization.json';
            let fileContent = null;

            // 直接从服务器获取原始文件内容
            try {
                if (typeof getRequestHeaders === 'function') {
                    const response = await fetch(`/user/files/${fileName}`, {
                        method: 'GET',
                        headers: getRequestHeaders(),
                    });
                    if (response.ok) {
                        fileContent = await response.text();
                    }
                }
            } catch (e) {
                this.ctx.warn('settings-panel', '获取二次处理数据失败:', e);
            }

            if (!fileContent) {
                throw new Error('无法获取二次处理数据，文件可能不存在');
            }

            const data = JSON.parse(fileContent);

            // 弹窗询问是否携带角色数据库内容
            const includeCharDB = await this.ctx.helpers.promptConfirm(
                '是否携带角色数据库内容（characterDB）？\n点击"确定"导出完整数据，点击"取消"剔除角色数据库内容。'
            );

            if (!includeCharDB && data.characterDB !== undefined) {
                delete data.characterDB;
            }

            const exportContent = JSON.stringify(data, null, 2);
            const blob = new Blob([exportContent], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = fileName;
            a.click();
            URL.revokeObjectURL(url);
            this.ctx.helpers.showToast(
                includeCharDB ? '二次处理数据已导出（含角色数据库），如果想分享请删除apikey字段内容' : '二次处理数据已导出（不含角色数据库），如果想分享请删除apikey字段内容',
                'success'
            );
        } catch (e) {
            this.ctx.error('settings-panel', '导出二次处理数据失败:', e);
            this.ctx.helpers.showToast(`导出失败: ${e.message}`, 'error');
        }
    }

    /**
     * 导入二次处理数据（直接写入 prompt_optimization.json，完全替换）
     */
    async _importPromptOptimization(files) {
        if (!files || files.length === 0) return;

        const file = files[0];
        try {
            const text = await file.text();
            const data = JSON.parse(text);

            // 直接上传到服务器，完全替换文件内容
            const ok = await this._uploadFileToServer('prompt_optimization.json', data);
            if (!ok) throw new Error('上传失败');

            // 刷新页面，让浏览器自行从服务器加载新数据
            this.ctx.helpers.showToast('二次处理数据导入成功，即将刷新页面以应用新配置', 'success');
            setTimeout(() => location.reload(), 800);
        } catch (e) {
            this.ctx.error('settings-panel', '导入二次处理数据失败:', e);
            this.ctx.helpers.showToast(`导入失败: ${e.message}`, 'error');
        }
    }

    /**
     * 清空二次处理数据（保存空对象到 prompt_optimization.json，并清空浏览器 IndexedDB 对应 store）
     */
    async _clearPromptOptimization() {
        try {
            // 1. 保存空对象到服务器，完全替换文件内容
            const emptyData = { version: '1.0.0', updatedAt: new Date().toISOString() };
            const ok = await this._uploadFileToServer('prompt_optimization.json', emptyData);
            if (!ok) throw new Error('上传失败');

            // 2. 清空浏览器 IndexedDB 中对应的 store
            //    否则刷新后页面会从 IndexedDB 加载旧数据，又同步回服务器
            //    characterDB 字段对应 characters + classifications
            //    aiProcessing.presets 字段对应 ai_presets store
            //    aiProcessing.regexRules 字段对应 regex_rules store
            //    aiProcessing.worldBooks 字段对应 world_books store
            //    aiProcessing.tagRefs 字段对应 tag_references store
            const storesToClear = [
                StoreNames.CHARACTERS,       // 角色数据库 (characterDB.roles)
                StoreNames.CLASSIFICATIONS,   // 角色分类 (characterDB.classifications)
                StoreNames.AI_PRESETS,        // AI 预设 (aiProcessing.presets)
                StoreNames.REGEX_RULES,       // 正则规则 (aiProcessing.regexRules)
                StoreNames.WORLD_BOOKS,       // 世界书 (aiProcessing.worldBooks)
                StoreNames.TAG_REFERENCES,    // 标签引用 (aiProcessing.tagRefs)
            ];
            for (const storeName of storesToClear) {
                try {
                    await this.ctx.db.clear(storeName);
                } catch (err) {
                    this.ctx.warn('settings-panel', `清空 IndexedDB store "${storeName}" 失败:`, err);
                }
            }

            // 3. 清空 extension_settings 中的 ai_processor_settings
            //    chatInsertionTemplates 等字段存在这里（不在 IndexedDB），不清空的话刷新后会从本地恢复
            try {
                await this.ctx.api.setValue('ai_processor_settings', {});
            } catch (err) {
                this.ctx.warn('settings-panel', '清空 ai_processor_settings 失败:', err);
            }

            // 4. 刷新页面，让浏览器自行从服务器加载清空后的数据
            this.ctx.helpers.showToast('二次处理数据已清空，即将刷新页面', 'success');
            setTimeout(() => location.reload(), 800);
        } catch (e) {
            this.ctx.error('settings-panel', '清空二次处理数据失败:', e);
            this.ctx.helpers.showToast(`清空失败: ${e.message}`, 'error');
        }
    }

    /**
     * 上传 JSON 数据到服务器文件（完全替换）
     * @param {string} fileName - 服务器文件名
     * @param {Object} data - 要上传的 JSON 对象
     * @returns {Promise<boolean>} 是否成功
     */
    async _uploadFileToServer(fileName, data) {
        const jsonStr = JSON.stringify(data, null, 2);
        const encoder = new TextEncoder();
        const uint8Array = encoder.encode(jsonStr);
        let binary = '';
        for (let i = 0; i < uint8Array.length; i++) {
            binary += String.fromCharCode(uint8Array[i]);
        }
        const base64Data = btoa(binary);

        const response = await fetch('/api/files/upload', {
            method: 'POST',
            headers: getRequestHeaders(),
            body: JSON.stringify({
                name: fileName,
                data: base64Data,
            }),
        });
        return response.ok;
    }

    /**
     * 导出所有数据（保留：高级页缓存导出使用）
     */
    async _exportAllData() {
        try {
            const data = await this.ctx.db.exportAll();
            const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `tavern-scene-backup-${new Date().toISOString().slice(0, 10)}.json`;
            a.click();
            URL.revokeObjectURL(url);
            this.ctx.helpers.showToast('数据已导出', 'success');
        } catch (e) {
            this.ctx.helpers.showToast(`导出失败: ${e.message}`, 'error');
        }
    }

    /**
     * 导入数据（保留：高级页缓存导入使用）
     */
    async _importAllData(files) {
        if (!files || files.length === 0) return;

        const file = files[0];
            try {
                const text = await file.text();
                const data = JSON.parse(text);
                const stats = await this.ctx.db.importAll(data);
                this.ctx.helpers.showToast(
                    `导入完成！成功: ${stats.imported}, 跳过: ${stats.skipped}, 错误: ${stats.errors}`,
                    stats.errors > 0 ? 'warning' : 'success'
                );
            } catch (e) {
                this.ctx.helpers.showToast(`导入失败: ${e.message}`, 'error');
            }
    }

    // ==================== 提示词页逻辑 ====================

    /**
     * 加载提示词预设 (优化版：初始化时不渲染重型DOM)
     */
    async _loadPromptPresets(options = {}) {
        const {
            keepEditor = false,
            presetPositiveFallback = '',
            presetNegativeFallback = '',
            activePrefixOverride = null,
            activeSuffixOverride = null,
            targetToSelect = null
        } = options;

        try {
            // 只加载元数据（排除 referenceImage 和 thumbnail 图片数据）
            // 图片数据将在卡片进入视窗时从DB按需加载
            let presets = await this.ctx.db.getAllLight(StoreNames.PRESETS, ['referenceImage', 'thumbnail']) || [];

            if (presets.length === 0) {
                presets.push({ name: '默认', positivePrompt: '', negativePrompt: '', sequence: 0 });
                await this.ctx.db.put(StoreNames.PRESETS, presets[0]);
            }

            if (presets.some(p => typeof p.sequence === 'undefined')) {
                presets = presets.map((p, idx) => ({ ...p, sequence: idx }));
            }
            presets.sort((a, b) => (a.sequence || 0) - (b.sequence || 0));

            this.promptPresets = presets;

            // 获取应该选中的值
            const imageGen = this.ctx.getModule('imageGen');
            let prefix = activePrefixOverride !== null ? activePrefixOverride : (imageGen?.settings?.activePresetName);
            if (prefix === undefined || prefix === null) prefix = presets[0]?.name || '';

            let suffix = activeSuffixOverride !== null ? activeSuffixOverride : (imageGen?.settings?.activePresetAfter);
            if (suffix === undefined || suffix === null) suffix = '';

            let targetForEdit = targetToSelect;
            if (!targetForEdit) targetForEdit = (prefix !== '') ? prefix : (presets[0]?.name || '');

            // ================== 核心优化开始 ==================

            // 1. 初始化下拉框为"轻量模式"（只包含当前选中的那一个选项）
            // 这样几百个预设加载时只需要创建 3 个 DOM 节点，而不是 300 * 3 个
            this._initLiteSelect('prompt-preset-prefix', prefix);
            this._initLiteSelect('prompt-preset-suffix', suffix);
            this._initLiteSelect('prompt-preset-edit-target', targetForEdit, false); // false 表示不需要 "无" 选项

            // 2. 只有当前就在提示词页面时，才立即渲染网格
            // 否则等用户切过去(_switchTab)再渲染
            if (this.currentTab === 'prompts') {
                this._renderPresetGrid(this.currentPresetPage);
            }

            // ================== 核心优化结束 ==================

            // 重新将选中预设的内容加载到输入框
            if (keepEditor) {
                // 如果需要保留编辑器，这里可以不操作，或者按需加载
                // 仅当当前 tab 是 prompts 时才去刷新编辑器数据，节省性能
                 this._applyPresetToEditor(targetForEdit, true);
            } else {
                 this._applyPresetToEditor(targetForEdit, true);
            }

            if (presetPositiveFallback && !this._getValue('prompt-positive-text')) {
                this._setValue('prompt-positive-text', presetPositiveFallback);
            }
        } catch (e) {
            this.ctx.error('settings-panel', '加载预设失败', e);
            this.ctx.helpers.showToast('预设加载失败', 'error');
        }
    }
    /**
     *  初始化轻量级下拉框 (懒加载)
     * 只渲染当前选中的值，点击后才展开完整列表
     */
    _initLiteSelect(id, currentValue, allowEmpty = true) {
        const sel = this.modalEl?.querySelector(`#${id}`);
        if (!(sel instanceof HTMLSelectElement)) return;

        // 标记：如果尚未填充过，则进行初始化
        // 如果已经是完整列表了（className含loaded），则只更新值
        if (sel.classList.contains('tsp-lazy-loaded')) {
            sel.value = currentValue;
            return;
        }

        // 清空并只创建一个选项 (当前的 value)
        sel.innerHTML = '';

        // 只有当前值不为空时才创建这个占位符，或者如果允许空且当前值为空，则创建“无”
        if (currentValue) {
            const opt = document.createElement('option');
            opt.value = currentValue;
            opt.textContent = currentValue; // 临时显示，数据加载后会正常
            opt.selected = true;
            sel.appendChild(opt);
        } else if (allowEmpty) {
            const opt = document.createElement('option');
            opt.value = "";
            opt.textContent = "-- 无 --";
            opt.selected = true;
            sel.appendChild(opt);
        }
    }

    /**
     *  填充下拉框的所有选项 (触发懒加载后调用)
     */
    _fillLazySelectOptions(selectEl, allowEmpty = true) {
        if (!selectEl || selectEl.classList.contains('tsp-lazy-loaded')) return;

        const currentValue = selectEl.value; // 记住当前选的值

        // 使用 Fragment 批量插入，性能最高
        const frag = document.createDocumentFragment();

        if (allowEmpty) {
            const opt = document.createElement('option');
            opt.value = "";
            opt.textContent = "-- 无 --";
            frag.appendChild(opt);
        }

        this.promptPresets.forEach(p => {
            const opt = document.createElement('option');
            opt.value = p.name;
            opt.textContent = p.name;
            frag.appendChild(opt);
        });

        selectEl.innerHTML = ''; // 清空临时的单选项
        selectEl.appendChild(frag);

        // 恢复选中值
        selectEl.value = currentValue;

        // 标记为已加载，下次点击不再重复渲染
        selectEl.classList.add('tsp-lazy-loaded');
    }
    // 替换原有的 _renderPresetGrid 方法
    async _renderPresetGrid(page = 1) {
        this.currentPresetPage = page;
        const grid = this.modalEl?.querySelector('#prompt-preset-grid');
        const pagination = this.modalEl?.querySelector('#prompt-preset-pagination');
        if (!(grid instanceof HTMLElement)) return;

        if (!this.promptPresets.length) {
            grid.innerHTML = '<p class="tsp-text-muted">暂无预设</p>';
            if(pagination) pagination.innerHTML = '';
            return;
        }

        // 获取当前激活状态
        const imageGen = this.ctx.getModule('imageGen');
        const activePrefix = imageGen?.settings?.activePresetName || '';
        const activeSuffix = imageGen?.settings?.activePresetAfter || '';

        // 计算分页
        const totalItems = this.promptPresets.length;
        const totalPages = Math.ceil(totalItems / this.presetItemsPerPage);
        if (page > totalPages) page = totalPages;
        const startIndex = (page - 1) * this.presetItemsPerPage;
        const endIndex = Math.min(startIndex + this.presetItemsPerPage, totalItems);

        // 切片获取当前页数据（只有元数据，不含图片数据）
        const pagePresets = this.promptPresets.slice(startIndex, endIndex);

        // 构建预设卡片 HTML（不含图片数据，图片将通过 IntersectionObserver 从DB按需加载）
        grid.innerHTML = pagePresets.map(p => {
            let statusClass = '';
            const isPrefix = p.name === activePrefix;
            const isSuffix = p.name === activeSuffix;
            if (isPrefix && isSuffix) statusClass = 'status-both';
            else if (isPrefix) statusClass = 'status-prefix';
            else if (isSuffix) statusClass = 'status-suffix';

            const isMultiSelected = this.isPresetMultiSelectMode && this.selectedPresets.has(p.name);
            const multiSelectClass = isMultiSelected ? 'multi-selected' : '';
            const checkMark = this.isPresetMultiSelectMode && isMultiSelected ?
                `<div class="tsp-preset-check"><i class="fa-solid fa-check"></i></div>` : '';

            // 使用 loading="lazy" 浏览器原生懒加载
            // data-preset-name 用于 IntersectionObserver 回调中从 DB 按需加载图片
            // 初始使用透明占位图，进入视窗时从 DB 加载真实图片
            const imgContent = `<img class="tsp-preset-preview-img"
                                       loading="lazy"
                                       src="${this.emptyImage}"
                                       data-preset-name="${p.name}"
                                       alt="${p.name}"
                                       style="object-fit:cover;width:100%;height:100%;">`;

            const renameIcon = p.name !== '默认'
                ? `<i class="fa-solid fa-pencil tsp-preset-rename" title="重命名"></i>`
                : '';

            return `
                <div class="tsp-preset-card ${statusClass} ${multiSelectClass}" data-name="${p.name}">
                    ${checkMark}
                    <div class="tsp-preset-header-wrapper">
                        <span class="tsp-preset-title" title="${p.name}">${p.name}</span>
                        ${renameIcon}
                    </div>
                    <div class="tsp-preset-img-container">
                        ${imgContent}
                    </div>
                </div>
            `;
        }).join('');

        // 初始化预设图片按需加载观察器
        this._initPresetImageObserver(grid);

        // 绑定长按查看原图事件
        grid.querySelectorAll('.tsp-preset-img-container').forEach(container => {
            let pressTimer = null;
            const img = container.querySelector('img');
            if (!img) return;

            const startPress = (e) => {
                if (this.isPresetMultiSelectMode) return;
                pressTimer = setTimeout(async () => {
                    const presetName = img.dataset.presetName;
                    if (!presetName) return;
                    // 从 DB 加载完整图片数据用于灯箱预览
                    const preset = await this.ctx.db.get(StoreNames.PRESETS, presetName);
                    if (preset) {
                        const originalSrc = preset.referenceImage || preset.thumbnail;
                        if (originalSrc) {
                            const src = this._base64ToBlobUrl(originalSrc);
                            this._showFullImageOverlay(null, [], src);
                        }
                    }
                }, 600);
            };

            const cancelPress = () => {
                if (pressTimer) {
                    clearTimeout(pressTimer);
                    pressTimer = null;
                }
            };

            container.addEventListener('mousedown', (e) => {
                if (e.button === 0) startPress(e);
            });
            container.addEventListener('mouseup', (e) => {
                cancelPress();
                e.stopPropagation();
            });
            container.addEventListener('mouseleave', cancelPress);
            container.addEventListener('touchstart', (e) => {
                startPress(e);
            }, { passive: true });
            container.addEventListener('touchend', (e) => {
                cancelPress();
            });
            container.addEventListener('touchmove', cancelPress);
        });

        // 渲染分页控件
        if (pagination) {
            pagination.innerHTML = this._renderPresetPagination(page, totalPages);
            pagination.querySelectorAll('button').forEach(btn => {
                btn.addEventListener('click', () => {
                    const targetPage = parseInt(btn.dataset.page);
                    if (targetPage && targetPage !== page) {
                        this._renderPresetGrid(targetPage);
                    }
                });
            });
        }
    }

    /**
     * 初始化预设图片按需加载观察器
     * 当预设卡片进入视窗时，从 DB 单条加载图片数据并渲染
     */
    _initPresetImageObserver(grid) {
        if (!grid) return;

        // 先断开旧的观察器（如果存在），避免重复观察
        if (this.presetImageObserver) {
            this.presetImageObserver.disconnect();
            this.presetImageObserver = null;
        }

        const root = this.modalEl ? this.modalEl.querySelector('.tsp-modal-body') : null;

        this.presetImageObserver = new IntersectionObserver(async (entries) => {
            for (const entry of entries) {
                if (!entry.isIntersecting) continue;
                const img = entry.target;
                const presetName = img.dataset.presetName;
                if (!presetName || img.dataset.imageLoaded === 'true') continue;

                // 标记为加载中，防止重复加载
                img.dataset.imageLoaded = 'loading';
                this.presetImageObserver.unobserve(img);

                try {
                    const preset = await this.ctx.db.get(StoreNames.PRESETS, presetName);
                    // 安全检查：如果元素已被移除（如用户切换了标签页），跳过
                    if (!document.body.contains(img)) {
                        if (preset?.referenceImage instanceof Blob) URL.revokeObjectURL(img.src);
                        continue;
                    }
                    if (!preset) {
                        img.dataset.imageLoaded = 'error';
                        continue;
                    }

                    const previewMode = await this.ctx.api.getValue('preset_preview_mode', 'thumbnail');
                    let displaySrc;
                    if (previewMode === 'original') {
                        displaySrc = preset.referenceImage || preset.thumbnail;
                    } else {
                        displaySrc = preset.thumbnail || preset.referenceImage;
                    }

                    if (displaySrc) {
                        const src = this._base64ToBlobUrl(displaySrc);
                        // 如果是 blob:URL，加入管理以便 cleanup 时释放
                        if (src.startsWith('blob:')) {
                            this._presetBlobUrls.add(src);
                        }
                        img.src = src;
                        img.style.display = '';
                        img.dataset.imageLoaded = 'true';
                    } else {
                        // 无图片数据，显示占位
                        const container = img.closest('.tsp-preset-img-container');
                        if (container) {
                            container.innerHTML = '<div class="tsp-preset-placeholder">无预览图</div>';
                        }
                        img.dataset.imageLoaded = 'none';
                    }
                } catch (e) {
                    console.error('加载预设图片失败:', e);
                    img.dataset.imageLoaded = 'error';
                }
            }
        }, {
            root: root,
            rootMargin: '200px',
            threshold: 0.01
        });

        // 观察所有预设图片
        grid.querySelectorAll('.tsp-preset-preview-img').forEach(img => {
            this.presetImageObserver.observe(img);
        });
    }

    _renderPresetPagination(currentPage, totalPages) {
        if (totalPages <= 1) return '';

        return `
            <button class="tsp-btn tsp-btn-sm" ${currentPage === 1 ? 'disabled' : ''} data-page="${currentPage - 1}">上一页</button>
            <span class="tsp-page-info">第 ${currentPage} / ${totalPages} 页</span>
            <button class="tsp-btn tsp-btn-sm" ${currentPage === totalPages ? 'disabled' : ''} data-page="${currentPage + 1}">下一页</button>
        `;
    }
    // --- 新增：交互逻辑 ---

    /**
     * 处理预设卡片的交互 (单击/双击/多选)
     */
    async _handlePresetInteraction(name) {
        // 1. 多选模式逻辑
        if (this.isPresetMultiSelectMode) {
            if (name === '默认') return; // 禁止选中默认
            if (this.selectedPresets.has(name)) {
                this.selectedPresets.delete(name);
            } else {
                this.selectedPresets.add(name);
            }
            // 重新渲染当前页以更新状态
            this._renderPresetGrid(this.currentPresetPage);
            // 更新多选按钮文本 (可选)
            const btn = this.modalEl.querySelector('#prompt-multi-btn');
            if (btn) btn.innerHTML = `<i class="fa-solid fa-check-square"></i> 删除选中 (${this.selectedPresets.size})`;
            return;
        }

        // 单击事件：设置为当前使用的预设并显示到编辑器
        await this._setPresetAs(name, 'prefix');

        // 更新预设选择下拉框
        this._initLiteSelect('prompt-preset-prefix', name, true);
        // 将预设内容加载到编辑器
        this._applyPresetToEditor(name);
    }

    async _setPresetAs(name, type) {
        const imageGen = this.ctx.getModule('imageGen');
        if (!imageGen) return;

        imageGen.settings.activePresetName = name;
        // 同步绑定后置预设到当前选中的预设
        imageGen.settings.activePresetAfter = name;
        this._initLiteSelect('prompt-preset-prefix', name, true);
        this.ctx.helpers.showToast(`已选择预设: ${name}`, 'success');

        // 保存设置并重新渲染网格(更新颜色)
        await imageGen.saveSettings();
        this._renderPresetGrid(this.currentPresetPage);
    }

    /**
     * 切换多选模式
     */
    _togglePresetMultiSelect() {
        // 如果当前已经在多选模式，并且有选中的项目，则该按钮的功能是"执行删除"
        if (this.isPresetMultiSelectMode && this.selectedPresets.size > 0 && arguments.length === 0) {
            this._deleteSelectedPresets();
            return; // 这里的 return 至关重要，防止代码继续向下执行导致数据被清空
        }

        // 正常的切换逻辑 (进入多选，或在未选中任何项时退出多选)
        this.isPresetMultiSelectMode = !this.isPresetMultiSelectMode;

        // 获取所有需要控制显隐的按钮
        const exportMultiBtn = this.modalEl.querySelector('#prompt-export-multi');
        const importBtn = this.modalEl.querySelector('#prompt-import-btn');
        const sortBtn = this.modalEl.querySelector('#prompt-sort-btn');
        const uploadImageBtn = this.modalEl.querySelector('#prompt-upload-image');
        const cancelBtn = this.modalEl.querySelector('#prompt-cancel-btn');
        const selectAllBtn = this.modalEl.querySelector('#prompt-select-all-btn');
        const btn = this.modalEl.querySelector('#prompt-multi-btn');

        if (this.isPresetMultiSelectMode) {
            // 进入多选
            // 显示导出选中、取消、全选按钮
            if (exportMultiBtn) exportMultiBtn.style.display = 'inline-flex';
            if (cancelBtn) cancelBtn.style.display = 'inline-flex';
            if (selectAllBtn) selectAllBtn.style.display = 'inline-flex';
            // 隐藏导入、排序、上传效果图按钮
            if (importBtn) importBtn.style.display = 'none';
            if (sortBtn) sortBtn.style.display = 'none';
            if (uploadImageBtn) uploadImageBtn.style.display = 'none';
            // 修改多选按钮样式
            if (btn) {
                btn.classList.add('tsp-btn-danger');
                btn.innerHTML = `<i class="fa-solid fa-trash"></i> 删除选中 (0)`;
            }
            this.ctx.helpers.showToast('进入多选模式，点击预设选中，再次点击此按钮执行删除');
        } else {
            // 退出多选
            // 隐藏导出选中、取消、全选按钮
            if (exportMultiBtn) exportMultiBtn.style.display = 'none';
            if (cancelBtn) cancelBtn.style.display = 'none';
            if (selectAllBtn) selectAllBtn.style.display = 'none';
            // 显示导入、排序、上传效果图按钮
            if (importBtn) importBtn.style.display = 'inline-flex';
            if (sortBtn) sortBtn.style.display = 'inline-flex';
            if (uploadImageBtn) uploadImageBtn.style.display = 'inline-flex';
            // 修改多选按钮样式
            if (btn) {
                btn.classList.remove('tsp-btn-danger');
                btn.innerHTML = `<i class="fa-solid fa-check-square"></i> 多选`;
            }
            // 只有在安全退出时才清空
            this.selectedPresets.clear();
        }
        this._renderPresetGrid(this.currentPresetPage);
    }

    /**
     * 全选当前页面的预设（排除默认预设）
     */
    _selectAllPresets() {
        if (!this.isPresetMultiSelectMode) return;

        // 计算当前页的预设索引范围
        const startIndex = (this.currentPresetPage - 1) * this.presetItemsPerPage;
        const endIndex = Math.min(startIndex + this.presetItemsPerPage, this.promptPresets.length);

        // 获取当前页的预设，排除默认预设
        const pagePresets = this.promptPresets.slice(startIndex, endIndex);
        const nonDefaultPresets = pagePresets.filter(p => p.name !== '默认');

        // 将非默认预设添加到选中集合
        nonDefaultPresets.forEach(p => {
            this.selectedPresets.add(p.name);
        });

        // 更新多选按钮文本
        const btn = this.modalEl.querySelector('#prompt-multi-btn');
        if (btn) {
            btn.innerHTML = `<i class="fa-solid fa-trash"></i> 删除选中 (${this.selectedPresets.size})`;
        }

        // 重新渲染网格以更新选中状态
        this._renderPresetGrid(this.currentPresetPage);

        this.ctx.helpers.showToast(`已选中 ${nonDefaultPresets.length} 个预设（默认预设除外）`);
    }

    /**
     *  生成参考图片（支持多组固定形象），弹出选择框让用户选择一张覆盖预设
     */
    async _handleGenerateReferenceImage() {
        const targetName = this._getSelectValue('prompt-preset-prefix');
        if (!targetName) {
            this.ctx.helpers.showToast('请先选择预设', 'warning');
            return;
        }

        // 收集所有有内容的固定形象 tag
        const fixedAppearanceList = this._getFixedAppearanceValues();
        if (fixedAppearanceList.length === 0) {
            this.ctx.helpers.showToast('请至少在一组固定形象输入框中填写内容', 'warning');
            return;
        }

        const presetName = this._getSelectValue('prompt-preset-prefix');
        // 获取预设内容，拼接前置+固定形象+后置
        const preset = this.promptPresets.find(p => p.name === presetName);

        // 前置提示词
        const prePrompt = preset?.positivePrompt || '';
        const preNegative = preset?.negativePrompt || '';

        // 后置提示词（使用新字段，支持旧格式兼容）
        const sufPrompt = preset?.chamipositivePrompt || preset?.positivePrompt || '';
        const sufNegative = preset?.chaminegativePrompt || preset?.negativePrompt || '';
        const finalNegative = [preNegative, sufNegative].filter(Boolean).join(', ');

        const total = fixedAppearanceList.length;
        this.ctx.helpers.showToast(`正在生成 ${total} 张参考图片...`, 'info');
        const btn = this.modalEl.querySelector('#prompt-generate-ref-btn');
        if (btn) btn.disabled = true;

        const results = []; // {success, imageUrl, prompt}

        try {
            const imageGen = this.ctx.getModule('imageGen');
            // 依次生成每张图（避免并发导致的服务端压力）
            for (let i = 0; i < fixedAppearanceList.length; i++) {
                const fa = fixedAppearanceList[i];
                const finalPrompt = [prePrompt, fa, sufPrompt].filter(Boolean).join(', ');
                try {
                    this.ctx.helpers.showToast(`正在生成第 ${i + 1}/${total} 张...`, 'info');
                    const result = await imageGen.generateFromPrompt(finalPrompt, finalNegative, {
                        skipInsertToChat: true,
                        skipAiProcessing: true,
                        skipPresets: true
                    });
                    if (result.success && result.imageUrl) {
                        results.push({
                            success: true,
                            imageUrl: result.imageUrl,
                            prompt: fa
                        });
                    } else {
                        results.push({ success: false, imageUrl: '', prompt: fa });
                    }
                } catch (err) {
                    console.warn(`生成第 ${i + 1} 张失败:`, err);
                    results.push({ success: false, imageUrl: '', prompt: fa, error: err });
                }
            }

            const validResults = results.filter(r => r.success && r.imageUrl);
            if (validResults.length === 0) {
                this.ctx.helpers.showToast('所有参考图均生成失败，请查看控制台或重试', 'error');
                return;
            }

            // 弹出选择弹窗，用户选择一张或取消
            const selected = await this._showReferenceImageSelectionModal(validResults);
            if (!selected) {
                this.ctx.helpers.showToast('已取消，未替换参考图', 'info');
                return;
            }

            // 保存选择的图片到预设
            const thumbData = await imageGen.storageManager._generateThumbnail(selected.imageUrl);
            const presetDb = await this.ctx.db.get(StoreNames.PRESETS, targetName);
            if (presetDb) {
                presetDb.referenceImage = selected.imageUrl;
                presetDb.thumbnail = thumbData;
                await this.ctx.db.put(StoreNames.PRESETS, presetDb);
                this.ctx.helpers.showToast('参考图已更新', 'success');
                this._renderPresetGrid(this.currentPresetPage);
            }
        } catch (e) {
            this.ctx.helpers.showToast(`生成失败: ${e.message}`, 'error');
        } finally {
            if (btn) btn.disabled = false;
        }
    }

    /**
     * 显示参考图片选择弹窗
     * @param {Array<{imageUrl:string, prompt:string}>} images 图片列表
     * @returns {Promise<{imageUrl:string, prompt:string}|null>} 用户选择的图片，取消返回 null
     */
    _showReferenceImageSelectionModal(images) {
        return new Promise((resolve) => {
            const overlay = document.createElement('div');
            overlay.className = 'tsp-modal-overlay tsp-refimg-overlay';
            overlay.style.zIndex = '100005'; // 高于设置面板
            overlay.innerHTML = `
                <div class="tsp-modal tsp-refimg-modal" style="width:min(1440px,96vw);">
                    <div class="tsp-modal-header">
                        <div class="tsp-modal-title"><i class="fa-solid fa-images"></i> 选择参考图片</div>
                        <div style="color:var(--tsp-text-secondary); font-size:0.85em;">点击图片进行选中，确认后才会替换当前预设的参考图</div>
                    </div>
                    <div class="tsp-modal-body tsp-refimg-body" style="padding:24px 20px;">
                        <div class="tsp-refimg-grid"></div>
                    </div>
                    <div class="tsp-modal-footer">
                        <button class="tsp-btn tsp-refimg-cancel"><i class="fa-solid fa-xmark"></i> 取消</button>
                        <button class="tsp-btn tsp-btn-primary tsp-refimg-confirm" disabled><i class="fa-solid fa-check"></i> 确定使用选中</button>
                    </div>
                </div>
            `;
            document.body.appendChild(overlay);
            // 淡入
            requestAnimationFrame(() => overlay.classList.add('visible'));

            const grid = overlay.querySelector('.tsp-refimg-grid');
            const confirmBtn = overlay.querySelector('.tsp-refimg-confirm');
            const cancelBtn = overlay.querySelector('.tsp-refimg-cancel');
            const modalEl = overlay.querySelector('.tsp-modal');

            // 网格样式：同排排列（PC端三图合占内容区 90%，居中放大细节）
            const count = images.length;
            const gapPx = 20; // 卡片之间的间距略微放大，和放大后的比例匹配
            grid.style.cssText = `
                display:flex;
                flex-direction:row;
                justify-content:center;
                align-items:stretch;
                gap:${gapPx}px;
                flex-wrap:nowrap;
                overflow-x:auto;
                padding:8px 4px;
            `;

            // PC 端：各卡片按张数计算，使三张合起来 ≈ 内容区 90% 宽度（居中留白各 5%）
            const totalCards = count;
            const totalGap = (totalCards - 1) * gapPx;
            // basisPerCard：单张 flex-basis，使三张并起来占内容容器的 90%
            const basisPerCard = totalCards === 1
                ? '90%'
                : `calc((90% - ${totalGap}px) / ${totalCards})`;

            let selectedIndex = -1;
            const thumbStyle = `
                flex: 0 0 ${basisPerCard};
                max-width: ${totalCards === 1 ? '90%' : `calc((100% - ${totalGap}px) / ${totalCards})`};
                aspect-ratio: 3 / 4;
                border: 2px solid transparent;
                border-radius: var(--tsp-radius-md,8px);
                cursor: pointer;
                overflow: hidden;
                background: var(--tsp-bg-input);
                display:flex;
                flex-direction:column;
                transition: all 0.15s ease;
                box-shadow: 0 2px 10px rgba(0,0,0,0.2);
            `;

            images.forEach((img, idx) => {
                const card = document.createElement('div');
                card.className = 'tsp-refimg-card';
                card.dataset.index = String(idx);
                card.style.cssText = thumbStyle;
                card.innerHTML = `
                    <div style="flex:1; min-height:0; background:#000; display:flex; align-items:center; justify-content:center; overflow:hidden;">
                        <img src="${img.imageUrl}" style="width:100%; height:100%; object-fit:contain; pointer-events:none;" draggable="false"/>
                    </div>
                    <div style="padding:6px 8px; font-size:0.75em; color:var(--tsp-text-secondary); background:var(--tsp-bg-secondary); border-top:1px solid var(--tsp-border); line-height:1.3; max-height:58px; overflow:hidden; text-overflow:ellipsis;">
                        图 ${idx + 1}：${img.prompt.slice(0, 60)}${img.prompt.length > 60 ? '…' : ''}
                    </div>
                `;
                card.addEventListener('click', () => {
                    selectedIndex = idx;
                    grid.querySelectorAll('.tsp-refimg-card').forEach((c, i) => {
                        if (i === idx) {
                            c.style.borderColor = 'var(--tsp-accent-primary, #6ea8fe)';
                            c.style.boxShadow = '0 0 0 3px rgba(110,168,254,0.35), 0 2px 10px rgba(0,0,0,0.2)';
                            c.style.transform = 'translateY(-2px)';
                        } else {
                            c.style.borderColor = 'transparent';
                            c.style.boxShadow = '0 2px 10px rgba(0,0,0,0.2)';
                            c.style.transform = 'translateY(0)';
                        }
                    });
                    confirmBtn.disabled = false;
                });
                grid.appendChild(card);
            });

            // 键盘支持：Esc 取消，Enter 确定
            const onKey = (e) => {
                if (e.key === 'Escape') doCancel();
                if (e.key === 'Enter' && !confirmBtn.disabled) doConfirm();
            };
            document.addEventListener('keydown', onKey);

            const closeFn = () => {
                document.removeEventListener('keydown', onKey);
                overlay.classList.remove('visible');
                setTimeout(() => overlay.remove(), 180);
            };

            const doCancel = () => { closeFn(); resolve(null); };
            const doConfirm = () => {
                if (selectedIndex < 0) return;
                closeFn();
                resolve(images[selectedIndex]);
            };

            cancelBtn.addEventListener('click', doCancel);
            confirmBtn.addEventListener('click', doConfirm);
            // 点击遮罩空白处取消
            overlay.addEventListener('click', (e) => {
                if (e.target === overlay) doCancel();
            });
            // 阻止 modal 内部点击冒泡到 overlay
            modalEl.addEventListener('click', (e) => e.stopPropagation());
        });
    }

    /**
     * [修复] 处理预览图上传
     * - 浏览器模式：存为 Blob
     * - 酒馆模式：上传并存为 Path
     */
    async _handleUploadPresetImage(file) {
        const targetName = this._getSelectValue('prompt-preset-prefix');
        if (!targetName) {
            this.ctx.helpers.showToast('请先选择预设', 'warning');
            return;
        }

        const imageGen = this.ctx.getModule('imageGen');
        if (!imageGen || !imageGen.storageManager) {
            this.ctx.helpers.showToast('存储模块未初始化', 'error');
            return;
        }

        this.ctx.helpers.showToast('正在处理图片...', 'info');

        try {
            // 1. 生成缩略图 (Blob)
            // _generateThumbnail 现在返回 Promise<Blob>
            let thumbBlob = await imageGen.storageManager._generateThumbnail(file);
            // 如果生成失败，降级使用原图 (虽然大一点但保证能用)
            if (!thumbBlob) thumbBlob = file;

            // 从 DB 加载完整数据（包含旧图片），再添加新图片后保存
            const preset = await this.ctx.db.get(StoreNames.PRESETS, targetName);
            if (!preset) {
                this.ctx.helpers.showToast('未找到对应预设', 'error');
                return;
            }

            // 2. 根据存储模式决定保存方式
            const mode = imageGen.getStorageMode(); // 'browser' or 'tavern'

            if (mode === 'tavern') {
                this.ctx.helpers.showToast('正在上传至酒馆服务器...', 'info');

                // === 酒馆模式：上传文件并保存路径 ===

                // 辅助：文件转Base64 (用于上传API)
                const fileToBase64 = (blob) => new Promise((resolve, reject) => {
                    const reader = new FileReader();
                    reader.onload = () => resolve(reader.result);
                    reader.onerror = reject;
                    reader.readAsDataURL(blob);
                });

                // A. 上传原图
                const mainBase64 = await fileToBase64(file);
                // 复用 image-storage 中的上传逻辑
                const mainPath = await imageGen.storageManager._uploadPresetImage(preset.name, mainBase64);

                // B. 上传缩略图
                const thumbBase64 = await fileToBase64(thumbBlob);
                // 构造一个带后缀的名称来区分缩略图
                // 注意：_uploadPresetImage 内部会自动处理文件名净化
                const thumbPath = await imageGen.storageManager._uploadPresetImage(preset.name + '_thumb', thumbBase64);

                if (mainPath) {
                    // 添加时间戳防止缓存
                    const ts = Date.now();
                    preset.referenceImage = `${mainPath}?v=${ts}`;
                    preset.thumbnail = thumbPath ? `${thumbPath}?v=${ts}` : preset.referenceImage;

                    this.ctx.helpers.showToast(`已上传并更新: ${targetName}`, 'success');
                } else {
                    throw new Error('服务器上传失败，请检查网络或日志');
                }

            } else {
                // === 浏览器模式：直接保存 Blob ===

                preset.referenceImage = file;       // 存 Blob
                preset.thumbnail = thumbBlob;       // 存 Blob
                this.ctx.helpers.showToast(`已更新本地预览图: ${targetName}`, 'success');
            }

            // 3. 更新数据库
            await this.ctx.db.put(StoreNames.PRESETS, preset);

            // 4. 刷新网格显示
            this._renderPresetGrid(this.currentPresetPage);

        } catch (e) {
            console.error(e);
            this.ctx.helpers.showToast(`上传/处理失败: ${e.message}`, 'error');
        }
    }

    /**
     * 重命名预设
     */
    async _renamePreset(oldName) {
        const newName = await this.ctx.helpers.promptInput('重命名预设', '新名称', oldName);
        if (!newName || !newName.trim() || newName === oldName) return;

        const trimmed = newName.trim();
        // 检查重名
        if (this.promptPresets.some(p => p.name === trimmed)) {
            this.ctx.helpers.showToast('名称已存在', 'error');
            return;
        }

        // 从 DB 加载完整数据（包含图片），避免丢失
        const preset = await this.ctx.db.get(StoreNames.PRESETS, oldName);
        if (preset) {
            // 创建新对象，删除旧对象（保留完整数据包括图片）
            const newPreset = { ...preset, name: trimmed };
            await this.ctx.db.put(StoreNames.PRESETS, newPreset);
            await this.ctx.db.delete(StoreNames.PRESETS, oldName);

            // 更新引用 (如果当前激活的是旧名称)
            const imageGen = this.ctx.getModule('imageGen');
            if (imageGen.settings.activePresetName === oldName) imageGen.settings.activePresetName = trimmed;
            if (imageGen.settings.activePresetAfter === oldName) imageGen.settings.activePresetAfter = trimmed;
            await imageGen.saveSettings();

            this.ctx.helpers.showToast('重命名成功', 'success');
            await this._loadPromptPresets(); // 刷新
        }
    }

    /**
     * [优化] 打开排序模态框 (支持移动端触摸 + 鼠标)
     */
    _openPresetSorterModal() {
        const overlay = document.createElement('div');
        overlay.className = 'tsp-modal-overlay';

        // [修改重点]：
        // 1. 添加了类名 tsp-sorter-modal
        // 2. 删除了 style="max-width: 400px; height: 80vh;" (移到CSS中控制)
        overlay.innerHTML = `
            <div class="tsp-modal tsp-sorter-modal">
                <div class="tsp-modal-header">
                    <div class="tsp-modal-title"><i class="fa-solid fa-sort"></i> 预设排序 (长按拖拽)</div>
                    <button class="tsp-sorter-close" title="关闭">×</button>
                </div>
                <div class="tsp-modal-body">
                    <div id="tsp-sorter-list" class="tsp-sorter-list">
                        ${this.promptPresets.map(p => `
                            <div class="tsp-sorter-item ${p.name === '默认' ? 'disabled' : ''}"
                                 data-name="${p.name}">
                                <i class="fa-solid fa-bars" style="margin-right:12px; opacity:0.7;"></i>
                                <span style="font-weight:500;">${p.name}</span>
                            </div>
                        `).join('')}
                    </div>
                </div>
                <div class="tsp-modal-footer">
                    <button class="tsp-btn tsp-btn-primary tsp-sorter-save" style="width:100%">
                        <i class="fa-solid fa-check"></i> 保存顺序
                    </button>
                </div>
            </div>
        `;
        document.body.appendChild(overlay);
        requestAnimationFrame(() => overlay.classList.add('visible'));

        const list = overlay.querySelector('#tsp-sorter-list');

        // --- 核心排序逻辑 (兼容 Touch 和 Mouse) ---
        let draggedItem = null;
        let placeholder = null;
        let isDragging = false;
        let startY = 0;

        // 获取所有可排序项
        const getSortables = () => [...list.querySelectorAll('.tsp-sorter-item:not(.disabled)')];

        const onPointerDown = (e) => {
            const item = e.target.closest('.tsp-sorter-item');
            if (!item || item.classList.contains('disabled')) return;

            // 防止默认事件（如文本选择）
            e.preventDefault();

            draggedItem = item;
            isDragging = false; // 先不标记为拖拽，防止误触点击
            startY = e.pageY;

            // 绑定全局移动和释放事件
            document.addEventListener('pointermove', onPointerMove);
            document.addEventListener('pointerup', onPointerUp);
            // 捕获指针，这对触摸很重要
            item.setPointerCapture(e.pointerId);
        };

        const onPointerMove = (e) => {
            if (!draggedItem) return;

            // 增加一点阈值，防止手指抖动误触发拖拽
            if (!isDragging && Math.abs(e.pageY - startY) > 5) {
                isDragging = true;
                draggedItem.classList.add('dragging');
            }

            if (!isDragging) return;
            e.preventDefault();

            // 简单的 DOM 交换逻辑 (比复杂的坐标计算更流畅、性能更好)
            const sortables = getSortables();
            // 找到当前指针 Y 轴位置对应的元素
            // 注意：Pointer Events 在移动端可能需要使用 clientY
            const clientY = e.clientY;

            // 找出鼠标下方最近的列表项
            const afterElement = sortables.reduce((closest, child) => {
                if (child === draggedItem) return closest;
                const box = child.getBoundingClientRect();
                const offset = clientY - box.top - box.height / 2;
                if (offset < 0 && offset > closest.offset) {
                    return { offset: offset, element: child };
                } else {
                    return closest;
                }
            }, { offset: Number.NEGATIVE_INFINITY }).element;

            // 执行 DOM 移动
            if (afterElement == null) {
                list.appendChild(draggedItem);
            } else {
                list.insertBefore(draggedItem, afterElement);
            }

            // 自动滚动容器
            // 如果拖到了容器顶部/底部，让父级容器滚动
            const container = overlay.querySelector('.tsp-modal-body');
            const containerRect = container.getBoundingClientRect();
            if (clientY < containerRect.top + 50) {
                container.scrollTop -= 10;
            } else if (clientY > containerRect.bottom - 50) {
                container.scrollTop += 10;
            }
        };

        const onPointerUp = (e) => {
            if (draggedItem) {
                draggedItem.classList.remove('dragging');
                draggedItem.releasePointerCapture(e.pointerId);
            }
            draggedItem = null;
            isDragging = false;

            // 解绑全局事件
            document.removeEventListener('pointermove', onPointerMove);
            document.removeEventListener('pointerup', onPointerUp);
        };

        // 将事件绑定到列表容器（委托）
        list.addEventListener('pointerdown', onPointerDown);

        // ------------------------------------------

        // 保存逻辑
        overlay.querySelector('.tsp-sorter-save').addEventListener('click', async () => {
            const items = list.querySelectorAll('.tsp-sorter-item');
            const newOrderNames = Array.from(items).map(el => el.dataset.name);

            // 更新数据库中的序号
            try {
                // 1. 获取所有预设
                const allPresets = [...this.promptPresets];

                // 2. 更新内存对象 sequence
                newOrderNames.forEach((name, index) => {
                    const p = allPresets.find(x => x.name === name);
                    if (p) p.sequence = index;
                });

                // 3. 只更新 sequence 字段，保留图片数据（使用 partialUpdate 避免覆盖 Blob）
                for (const p of allPresets) {
                    await this.ctx.db.partialUpdate(StoreNames.PRESETS, p.name, { sequence: p.sequence });
                }

                // 4. 同步到服务器 (JSON)
                const imageGen = this.ctx.getModule('imageGen');
                if (imageGen?.storageManager) {
                    // 不需要 await，后台运行即可
                    imageGen.storageManager.savePromptPresets(allPresets).catch(() => {});
                }

                this.ctx.helpers.showToast('排序已保存', 'success');
                await this._loadPromptPresets(); // 刷新主界面
                close();
            } catch (err) {
                console.error(err);
                this.ctx.helpers.showToast('保存失败: ' + err.message, 'error');
            }
        });

        // 关闭逻辑
        const close = () => {
            overlay.classList.remove('visible');
            setTimeout(() => overlay.remove(), 200);
        };
        overlay.querySelector('.tsp-sorter-close').addEventListener('click', close);
    }

    _renderPresetSelects() {
        const fillSelect = (id, allowEmpty = true) => {
            const sel = this.modalEl?.querySelector(`#${id}`);
            if (!(sel instanceof HTMLSelectElement)) return;
            const opts = [];
            if (allowEmpty) opts.push('<option value="">-- 无 --</option>');
            this.promptPresets.forEach(p => {
                opts.push(`<option value="${p.name}">${p.name}</option>`);
            });
            sel.innerHTML = opts.join('');
        };

        fillSelect('prompt-preset-prefix', true);

        // 默认选第一个
        const first = this.promptPresets[0]?.name || '';
        this._setSelectValue('prompt-preset-prefix', first);
        this._applyPresetToEditor(first);
    }
    _applyPresetToEditor(name, overwriteNegative = true) {
        const preset = this.promptPresets.find(p => p.name === name);

        // 如果预设不存在（选了"无"），则使用空字符串
        let pos = '';
        let neg = '';

        if (preset) {
            if (this.currentPromptMode === 'prefix') {
                pos = preset.positivePrompt || '';
                neg = preset.negativePrompt || '';
            } else {
                pos = preset.chamipositivePrompt || '';
                neg = preset.chaminegativePrompt || '';
            }
        }

        this._setValue('prompt-positive-text', pos);
        if (overwriteNegative) this._setValue('prompt-negative-text', neg);
    }

    /**
     * 切换提示词编辑模式（前置/后置）
     */
    _switchPromptMode(mode) {
        this.currentPromptMode = mode;

        // 更新按钮状态
        const prefixBtn = this.modalEl?.querySelector('#prompt-switch-prefix');
        const suffixBtn = this.modalEl?.querySelector('#prompt-switch-suffix');

        if (prefixBtn && suffixBtn) {
            if (mode === 'prefix') {
                prefixBtn.classList.add('tsp-btn-primary');
                suffixBtn.classList.remove('tsp-btn-primary');
            } else {
                prefixBtn.classList.remove('tsp-btn-primary');
                suffixBtn.classList.add('tsp-btn-primary');
            }
        }

        // 重新加载当前选中预设的对应内容
        const currentPreset = this._getSelectValue('prompt-preset-prefix');
        if (currentPreset) {
            this._applyPresetToEditor(currentPreset);
        }
    }

    async _updatePreset() {
        const target = this._getSelectValue('prompt-preset-prefix');
        if (!target) {
            this.ctx.helpers.showToast('请选择要更新的预设', 'warning');
            return;
        }

        // 1. 从 DB 加载完整预设对象（包含图片数据），避免丢失
        const existingPreset = await this.ctx.db.get(StoreNames.PRESETS, target);
        if (!existingPreset) {
            this.ctx.helpers.showToast('未找到原预设数据', 'error');
            return;
        }

        const positive = this._getValue('prompt-positive-text') || '';
        const negative = this._getValue('prompt-negative-text') || '';

        // 2. 构造新的 payload，保留两组字段，只更新当前模式对应的字段
        const payload = {
            ...existingPreset,
            positivePrompt: this.currentPromptMode === 'prefix' ? positive : (existingPreset.positivePrompt || ''),
            negativePrompt: this.currentPromptMode === 'prefix' ? negative : (existingPreset.negativePrompt || ''),
            chamipositivePrompt: this.currentPromptMode === 'suffix' ? positive : (existingPreset.chamipositivePrompt || ''),
            chaminegativePrompt: this.currentPromptMode === 'suffix' ? negative : (existingPreset.chaminegativePrompt || '')
        };

        // 3. 保存回数据库
        await this.ctx.db.put(StoreNames.PRESETS, payload);

        //  尝试同步更新服务器端文件 (如果不更新，下次刷新会被服务器覆盖)
        const imageGen = this.ctx.getModule('imageGen');
        if (imageGen?.storageManager) {
            // 这里我们异步触发保存，不阻塞UI。读取最新的全部预设进行保存。
            this.ctx.db.getAll(StoreNames.PRESETS).then(allPresets => {
                imageGen.storageManager.savePromptPresets(allPresets).catch(() => {});
            });
        }

        // [关键修复]
        // 获取当前UI上选中的预设
        const currentSelection = this._getSelectValue('prompt-preset-prefix');

        // 更新 imageGen 内存中的设置 - 前后置都绑定当前预设
        if (imageGen && imageGen.settings) {
            imageGen.settings.activePresetName = currentSelection;
            imageGen.settings.activePresetAfter = currentSelection;
            await imageGen.saveSettings();
        }

        // 防傻操作：更新后重置修改状态
        this.isPresetModified = false;

        this.ctx.helpers.showToast(`预设已更新: ${target}`, 'success');

        // 3. 重新加载列表，并传入参数强制保持当前选中状态
        await this._loadPromptPresets({
            activePrefixOverride: currentSelection,
            targetToSelect: target // 强制编辑器保留在当前编辑的预设上
        });
    }

    async _savePresetAs() {
        const name = await this.ctx.helpers.promptInput?.('输入新预设名称');
        if (!name) return;
        const exists = this.promptPresets.some(p => p.name === name);
        if (exists) {
            this.ctx.helpers.showToast('名称已存在', 'error');
            return;
        }

        const positive = this._getValue('prompt-positive-text') || '';
        const negative = this._getValue('prompt-negative-text') || '';

        // 计算新的序号 (放在最后)
        const maxSeq = this.promptPresets.reduce((max, p) => Math.max(max, p.sequence || 0), 0);

        // 根据当前模式保存到对应的字段
        const presetData = {
            name,
            sequence: maxSeq + 1
        };

        if (this.currentPromptMode === 'prefix') {
            presetData.positivePrompt = positive;
            presetData.negativePrompt = negative;
        } else {
            presetData.chamipositivePrompt = positive;
            presetData.chaminegativePrompt = negative;
        }

        await this.ctx.db.put(StoreNames.PRESETS, presetData);

        // 同步到服务器
        const imageGen = this.ctx.getModule('imageGen');
        if (imageGen?.storageManager) {
            this.ctx.db.getAll(StoreNames.PRESETS).then(allPresets => {
                imageGen.storageManager.savePromptPresets(allPresets).catch(() => {});
            });
        }

        this.ctx.helpers.showToast(`已保存新预设: ${name}`, 'success');

        // [修复] 强制清除下拉框的懒加载标记，确保点击时能重新拉取最新列表
        if (this.modalEl) {
            this.modalEl.querySelectorAll('select.tsp-lazy-loaded').forEach(el => el.classList.remove('tsp-lazy-loaded'));
        }

        // [修复] 保持当前的 Select 状态，并将编辑目标切换到新创建的预设
        const currentSelection = this._getSelectValue('prompt-preset-prefix');

        await this._loadPromptPresets({
            activePrefixOverride: currentSelection,
            targetToSelect: name // 选中新创建的预设
        });
    }

    /**
     * 单个删除预设
     */
    async _deletePreset() {
        const target = this._getSelectValue('prompt-preset-prefix');
        if (!target) {
            this.ctx.helpers.showToast('请选择要删除的预设', 'warning');
            return;
        }
        // 保护：不允许删除默认
        if (target === '默认') {
            this.ctx.helpers.showToast('默认预设不可删除', 'warning');
            return;
        }

        const confirmed = await this.ctx.helpers.promptConfirm(`确定删除预设「${target}」吗？\n服务器上的对应文件也将被删除。`);
        if (!confirmed) return;

        // 1. 先获取预设对象（在删除前获取，因为删除后就拿不到了）
        const preset = await this.ctx.db.get(StoreNames.PRESETS, target);

        // 2. 尝试删除服务器图片（使用预设对象获取实际路径）
        const imageGen = this.ctx.getModule('imageGen');
        if (imageGen?.storageManager) {
            imageGen.storageManager.deletePresetImage(preset || target).catch(() => {});
        }

        // 3. 删除本地 DB 数据
        await this.ctx.db.delete(StoreNames.PRESETS, target);

        // 3. 获取剩余数据并更新 JSON 配置文件
        // 这一步很重要，我们需要知道剩下什么，以便回退
        let remainingPresets = [];
        try {
            remainingPresets = await this.ctx.db.getAll(StoreNames.PRESETS) || [];
            // 确保按顺序排列
            remainingPresets.sort((a, b) => (a.sequence || 0) - (b.sequence || 0));

            if (imageGen?.storageManager) {
                await imageGen.storageManager.savePromptPresets(remainingPresets);
            }
        } catch (e) {
            console.warn('获取剩余预设失败', e);
        }

        this.ctx.helpers.showToast('已删除', 'success');

        // ================= 【修复开始：刷新下拉框逻辑】 =================

        // 1. 强制清除所有下拉框的懒加载标记，这会迫使下拉框下次点击时重新渲染完整列表
        if (this.modalEl) {
            this.modalEl.querySelectorAll('select.tsp-lazy-loaded').forEach(el => el.classList.remove('tsp-lazy-loaded'));
        }

        // 2. 计算回退值：如果删除了当前正在使用的 Active，需要切换到其他值
        // 获取当前内存中的设置
        let currentPrefix = imageGen.settings.activePresetName;
        let currentSuffix = imageGen.settings.activePresetAfter;
        let settingsChanged = false;

        // 寻找一个安全的 fallback 预设 (通常是列表第一个，比如 "默认")
        const fallbackName = remainingPresets.length > 0 ? remainingPresets[0].name : '';

        // 如果"前置预设"正好是被删除的那个，回退到 fallback
        if (currentPrefix === target) {
            currentPrefix = fallbackName;
            imageGen.settings.activePresetName = currentPrefix;
            settingsChanged = true;
        }

        // 如果"后置预设"正好是被删除的那个，回退到 fallback（和前置保持一致）
        if (currentSuffix === target) {
            currentSuffix = fallbackName;
            imageGen.settings.activePresetAfter = currentSuffix;
            settingsChanged = true;
        }

        // 如果我们在内存中修改了当前选中项，最好保存一下 settings，避免刷新页面后报错
        if (settingsChanged) {
            await imageGen.saveSettings();
        }

        // 3. 带参数调用 _loadPromptPresets
        // 这会强制三个下拉框（前置、后置、编辑目标）都更新为有效的值，不再显示已删除的项
        await this._loadPromptPresets({
            activePrefixOverride: currentPrefix,
            activeSuffixOverride: currentSuffix,
            targetToSelect: currentPrefix // 既然刚才删除了，那就让"编辑目标"选中当前的 activePrefix (即 fallback)
        });

        // ================= 【修复结束】 =================
    }

    /**
     * 批量删除预设 (多选模式) - 修复刷新逻辑版
     */
    async _deleteSelectedPresets() {
        const count = this.selectedPresets.size;
        if (count === 0) return;

        const confirmed = await this.ctx.helpers.promptConfirm(`确定删除选中的 ${count} 个预设吗？`);
        if (!confirmed) return;

        const imageGen = this.ctx.getModule('imageGen');

        // 1. 先获取所有预设数据（在删除前获取，因为删除后就拿不到了）
        const allPresets = await this.ctx.db.getAll(StoreNames.PRESETS) || [];

        // 2. 批量删除本地数据和服务器图片
        for (const name of this.selectedPresets) {
            // 这里加个保护：一般不允许删除"默认"（如果你没有这个需求可以去掉）
            if (name === '默认') continue;

            // 获取预设对象，以便获取实际的图片路径
            const preset = allPresets.find(p => p.name === name);

            // 删除服务器图片（使用预设对象获取实际路径）
            if (imageGen?.storageManager) {
                imageGen.storageManager.deletePresetImage(preset || name).catch(() => {});
            }

            // 删除本地数据
            await this.ctx.db.delete(StoreNames.PRESETS, name);
        }

        // 2. 获取剩余数据并更新 JSON 配置文件
        let remainingPresets = [];
        try {
            remainingPresets = await this.ctx.db.getAll(StoreNames.PRESETS) || [];
            // 排序，确保拿到正确的 fallback
            remainingPresets.sort((a, b) => (a.sequence || 0) - (b.sequence || 0));

            if (imageGen?.storageManager) {
                await imageGen.storageManager.savePromptPresets(remainingPresets);
            }
        } catch (e) {
            console.warn('保存剩余预设失败', e);
        }

        this.ctx.helpers.showToast(`已执行批量删除`, 'success');

        // ================= 【修复开始：计算回退值 & 刷新 UI】 =================

        // A. 强制清除下拉框懒加载标记
        if (this.modalEl) {
            this.modalEl.querySelectorAll('select.tsp-lazy-loaded').forEach(el => el.classList.remove('tsp-lazy-loaded'));
        }

        // B. 检查当前激活的预设是否在本次删除名单中
        // 寻找一个安全的 fallback 预设 (通常是剩下的第一个)
        const fallbackName = remainingPresets.length > 0 ? remainingPresets[0].name : '';

        let currentPrefix = imageGen.settings.activePresetName;
        let currentSuffix = imageGen.settings.activePresetAfter;
        let settingsChanged = false;

        // 检测前置：如果当前用的前置在这个删除集合里 -> 回退
        if (this.selectedPresets.has(currentPrefix)) {
            currentPrefix = fallbackName;
            imageGen.settings.activePresetName = currentPrefix;
            settingsChanged = true;
        }

        // 检测后置：如果当前用的后置在这个删除集合里 -> 清空
        if (this.selectedPresets.has(currentSuffix)) {
            currentSuffix = '';
            imageGen.settings.activePresetAfter = currentSuffix;
            settingsChanged = true;
        }

        if (settingsChanged) {
            await imageGen.saveSettings();
        }

        // C. 清理多选状态并恢复按钮显隐
        this.selectedPresets.clear();
        this.isPresetMultiSelectMode = false;

        // 获取所有需要控制显隐的按钮
        const exportMultiBtn = this.modalEl.querySelector('#prompt-export-multi');
        const importBtn = this.modalEl.querySelector('#prompt-import-btn');
        const sortBtn = this.modalEl.querySelector('#prompt-sort-btn');
        const uploadImageBtn = this.modalEl.querySelector('#prompt-upload-image');
        const cancelBtn = this.modalEl.querySelector('#prompt-cancel-btn');
        const selectAllBtn = this.modalEl.querySelector('#prompt-select-all-btn');
        const btn = this.modalEl.querySelector('#prompt-multi-btn');

        // 退出多选模式：恢复按钮显隐状态
        // 隐藏导出选中、取消、全选按钮
        if (exportMultiBtn) exportMultiBtn.style.display = 'none';
        if (cancelBtn) cancelBtn.style.display = 'none';
        if (selectAllBtn) selectAllBtn.style.display = 'none';
        // 显示导入、排序、上传效果图按钮
        if (importBtn) importBtn.style.display = 'inline-flex';
        if (sortBtn) sortBtn.style.display = 'inline-flex';
        if (uploadImageBtn) uploadImageBtn.style.display = 'inline-flex';

        // 重置多选按钮样式
        if (btn) {
            btn.classList.remove('tsp-btn-danger');
            btn.innerHTML = `<i class="fa-solid fa-check-square"></i> 多选`;
        }

        // D. 带参数刷新，重置三个下拉框
        await this._loadPromptPresets({
            activePrefixOverride: currentPrefix,
            activeSuffixOverride: currentSuffix,
            targetToSelect: currentPrefix // 编辑目标也切回安全的预设
        });

        // ================= 【修复结束】 =================
    }
    /**
     *  弹出导出选项对话框
     * @returns {Promise<'original'|'thumbnail'|'both'|null>}
     */
    _promptExportOptions() {
        return new Promise((resolve) => {
            const overlay = document.createElement('div');
            overlay.className = 'tsp-modal-overlay visible';
            overlay.style.zIndex = '99999'; // 确保在最上层

            overlay.innerHTML = `
                <div class="tsp-modal" style="max-width: 400px;">
                    <div class="tsp-modal-header">
                        <div class="tsp-modal-title"><i class="fa-solid fa-file-export"></i> 选择导出内容</div>
                    </div>
                    <div class="tsp-modal-body" style="text-align: center;">
                        <p class="tsp-text-muted" style="margin-bottom: 20px;">
                            选择要包含在导出文件中的图片类型。
                            <br>如果预设没有缩略图，插件将尝试自动生成。
                        </p>
                        <div class="tsp-btn-group" style="justify-content: center; flex-direction: column; gap: 10px;">
                            <button class="tsp-btn tsp-btn-primary" data-type="both">
                                <i class="fa-solid fa-images"></i> 导出原图 + 缩略图 (推荐)
                            </button>
                            <button class="tsp-btn" data-type="original">
                                <i class="fa-solid fa-image"></i> 仅导出原图
                            </button>
                            <button class="tsp-btn" data-type="thumbnail">
                                <i class="fa-regular fa-image"></i> 仅导出缩略图 (文件更小)
                            </button>
                        </div>
                    </div>
                    <div class="tsp-modal-footer">
                        <button class="tsp-btn" id="export-cancel-btn">取消</button>
                    </div>
                </div>
            `;

            const close = (result) => {
                overlay.remove();
                resolve(result);
            };

            overlay.querySelectorAll('.tsp-btn-group button').forEach(btn => {
                btn.addEventListener('click', () => close(btn.dataset.type));
            });

            overlay.querySelector('#export-cancel-btn').addEventListener('click', () => close(null));
            overlay.addEventListener('click', (e) => {
                if (e.target === overlay) close(null);
            });

            document.body.appendChild(overlay);
        });
    }
    /**
     *  分批处理预设导入，防止浏览器卡死
     * @param {Array} presetsArray - 完整的预设数组
     * @param {number} startIndex - 当前批次开始的索引
     * @param {number} batchSize - 每批处理的数量
     */
    async _processPresetBatch(presetsArray, startIndex, batchSize) {
        const imageGen = this.ctx.getModule('imageGen');
        if (!imageGen) return;

        const total = presetsArray.length;
        const endIndex = Math.min(startIndex + batchSize, total);

        // 显示当前进度
        this.ctx.helpers.showToast(`正在导入预设: ${endIndex} / ${total}...`, 'info');

        // 获取当前批次的预设
        const batch = presetsArray.slice(startIndex, endIndex);

        // 异步处理这一小批数据
        for (const p of batch) {
            if (p?.name) {
                try {
                    const newPreset = {
                        name: p.name,
                        positivePrompt: p.positivePrompt || '',
                        negativePrompt: p.negativePrompt || '',
                        chamipositivePrompt: p.chamipositivePrompt || '',
                        chaminegativePrompt: p.chaminegativePrompt || '',
                        referenceImage: p.referenceImage || null,
                        thumbnail: p.thumbnail || null,
                        sequence: p.sequence || 0
                    };

                    if (newPreset.referenceImage && typeof newPreset.referenceImage === 'string') {
                        if (newPreset.referenceImage.startsWith('data:')) {
                            newPreset.referenceImage = imageGen._dataURLtoBlob(newPreset.referenceImage);
                        }
                    }
                    if (newPreset.thumbnail && typeof newPreset.thumbnail === 'string') {
                        if (newPreset.thumbnail.startsWith('data:')) {
                            newPreset.thumbnail = imageGen._dataURLtoBlob(newPreset.thumbnail);
                        }
                    }

                    // 写入数据库
                    await this.ctx.db.put(StoreNames.PRESETS, newPreset);
                } catch (e) {
                    this.ctx.error('settings-panel', `导入预设 "${p.name}" 失败:`, e);
                    // 单个失败不中断整个流程
                }
            }
        }

        // 如果还有剩余的预设，安排下一个批次
        if (endIndex < total) {
            // 使用 setTimeout 让出主线程，避免 UI 卡死
            setTimeout(() => {
                this._processPresetBatch(presetsArray, endIndex, batchSize);
            }, 10); // 10毫秒的延迟足够让浏览器响应
        } else {
            // 所有批次处理完成，开始后台上传图片到服务器
            // 使用 duration=0 让提示一直显示，直到上传完成
            this.ctx.helpers.showToast(`导入完成，正在后台上传图片，请勿关闭页面...`, 'info', 0);

            // 后台上传图片到服务器（不阻塞UI）
            const imageGen = this.ctx.getModule('imageGen');
            if (imageGen?.storageManager) {
                const allPresets = await this.ctx.db.getAll(StoreNames.PRESETS) || [];
                imageGen.storageManager.savePromptPresets(allPresets).then(async (updatedPresets) => {
                    // 清除之前的"正在上传"提示
                    if (typeof toastr !== 'undefined') {
                        toastr.clear();
                    }
                    // 将更新后的预设写回数据库（特别是 referenceImage 和 thumbnail 路径）
                    if (updatedPresets && Array.isArray(updatedPresets)) {
                        for (const p of updatedPresets) {
                            await this.ctx.db.put(StoreNames.PRESETS, p);
                        }
                    }
                    // 上传完成后显示成功提示
                    this.ctx.helpers.showToast(`导入完成，共处理 ${total} 条预设！`, 'success');
                }).catch((e) => {
                    this.ctx.error('settings-panel', '预设图片上传失败:', e);
                    // 清除之前的"正在上传"提示
                    if (typeof toastr !== 'undefined') {
                        toastr.clear();
                    }
                    // 上传失败后显示警告提示
                    this.ctx.helpers.showToast(`导入完成，共处理 ${total} 条预设！（部分图片上传失败）`, 'warning');
                });
            } else {
                if (typeof toastr !== 'undefined') {
                    toastr.clear();
                }
                this.ctx.helpers.showToast(`导入完成，共处理 ${total} 条预设！`, 'success');
            }

            await this._loadPromptPresets(); // 全部完成后再统一刷新列表
        }
    }
    async _importPresets(files) {
        if (!files || files.length === 0) return;

        try {
            const file = files[0];

            // 步骤 1: 仍然需要一次性读取和解析文件，这是不可避免的瓶颈
            // 但后续的处理将被分批，从而解决崩溃问题。
            this.ctx.helpers.showToast('正在读取文件，请稍候...', 'info');
            const text = await file.text();
            const data = JSON.parse(text);
            if (!Array.isArray(data)) throw new Error('文件格式需为预设数组');

            // 步骤 2: 定义批次大小
            const batchSize = 15; // 每次处理 15 个预设

            // 步骤 3: 启动分批处理，从索引 0 开始
            await this._processPresetBatch(data, 0, batchSize);

        } catch (e) {
            this.ctx.helpers.showToast(`导入失败: ${e.message}`, 'error');
            console.error('导入预设失败:', e);
        }
    }

    /**
     * [修复] 将预设列表中的服务器路径或 Blob 转换为 Base64 以便导出
     */
    async _convertPresetPathsToBase64(presets, exportType) {
        this.ctx.helpers.showToast('正在处理图片数据，准备导出...', 'info');

        const imageGen = this.ctx.getModule('imageGen');
        if (!imageGen) {
            this.ctx.helpers.showToast('图片模块不可用', 'error');
            return [];
        }

        const exportList = [];

        for (const p of presets) {
            const newItem = { ...p };

            // 清空图片字段，稍后根据 exportType 填充
            newItem.referenceImage = null;
            newItem.thumbnail = null;

            // 辅助转换函数：将 Blob 或服务器路径转为 Base64
            const convertToB64 = async (data) => {
                if (!data) return null;
                if (data instanceof Blob) {
                    return await this._blobToDataUrlForExport(data);
                }
                if (typeof data === 'string' && !data.startsWith('data:')) {
                    try {
                        const cleanPath = data.split('?')[0];
                        const fetchPath = cleanPath.startsWith('/') ? cleanPath : '/' + cleanPath;
                        const resp = await fetch(fetchPath);
                        if (resp.ok) {
                            const blob = await resp.blob();
                            return await this._blobToDataUrlForExport(blob);
                        }
                    } catch (e) {
                        console.warn(`[导出] 图片下载失败: ${data}`, e);
                    }
                }
                return data; // 如果已经是 Base64 或其他，直接返回
            };

            // 获取原图的 Blob/路径 (用于生成缩略图)
            const originalImageDataSource = p.referenceImage;
            let originalImageBlob = null;

            if (originalImageDataSource) {
                 if (originalImageDataSource instanceof Blob) {
                    originalImageBlob = originalImageDataSource;
                 } else if (typeof originalImageDataSource === 'string') {
                    // 如果是路径，下载它
                    try {
                        const resp = await fetch(originalImageDataSource.split('?')[0]);
                        if(resp.ok) originalImageBlob = await resp.blob();
                    } catch(e) { /* ignore */ }
                 }
            }

            // --- 动态生成缩略图 ---
            let thumbnailDataSource = p.thumbnail;
            if (!thumbnailDataSource && originalImageBlob && (exportType === 'thumbnail' || exportType === 'both')) {
                this.ctx.helpers.showToast(`正在为 "${p.name}" 生成缩略图...`, 'info', 1500);
                // 使用 imageGen 模块中的方法生成
                thumbnailDataSource = await imageGen.storageManager._generateThumbnail(originalImageBlob);
            }

            // --- 根据导出类型填充数据 ---
            if (exportType === 'original' || exportType === 'both') {
                newItem.referenceImage = await convertToB64(originalImageDataSource);
            }
            if (exportType === 'thumbnail' || exportType === 'both') {
                newItem.thumbnail = await convertToB64(thumbnailDataSource);
            }

            exportList.push(newItem);
        }

        return exportList;
    }

    /**
     *  Blob 转 DataURL 辅助函数
     */
    _blobToDataUrlForExport(blob) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = reject;
            reader.readAsDataURL(blob);
        });
    }

    /**
     *  导出选中的预设
     */
    async _exportSelectedPresets() {
        if (this.selectedPresets.size === 0) {
            this.ctx.helpers.showToast('请至少选择一个预设', 'warning');
            return;
        }

        // ==================== [修改开始] ====================
        const exportType = await this._promptExportOptions();
        if (!exportType) {
            this.ctx.helpers.showToast('导出已取消', 'info');
            return; // 用户取消
        }

        // 从 DB 加载完整数据（含图片）
        const selectedNames = [...this.selectedPresets];
        const targets = [];
        for (const name of selectedNames) {
            const fullPreset = await this.ctx.db.get(StoreNames.PRESETS, name);
            if (fullPreset) targets.push(fullPreset);
        }

        // 转换路径为 Base64，并传入导出类型
        const exportData = await this._convertPresetPathsToBase64(targets, exportType);

        const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `presets-selected-${new Date().toISOString().slice(0, 10)}.json`;
        a.click();
        URL.revokeObjectURL(url);

        this.ctx.helpers.showToast(`已导出 ${exportData.length} 个预设`, 'success');

        // 导出后自动退出多选模式？(可选，这里保留模式以便用户继续操作)
        // this._togglePresetMultiSelect();
    }

    // [修改] 原有的 _exportCurrentPreset
    async _exportCurrentPreset() {
        const target = this._getSelectValue('prompt-preset-edit-target');
        if (!target) {
            this.ctx.helpers.showToast('请选择要导出的预设', 'warning');
            return;
        }
        // 从 DB 加载完整数据（含图片）
        const preset = await this.ctx.db.get(StoreNames.PRESETS, target);
        if (!preset) return;

        // ==================== [修改开始] ====================
        const exportType = await this._promptExportOptions();
        if (!exportType) {
            this.ctx.helpers.showToast('导出已取消', 'info');
            return; // 用户取消
        }

        // [修改] 转换为 Base64
        const exportList = await this._convertPresetPathsToBase64([preset], exportType);

        const blob = new Blob([JSON.stringify(exportList, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `preset-${target}.json`;
        a.click();
        URL.revokeObjectURL(url);
        this.ctx.helpers.showToast('已导出当前预设', 'success');
    }

    // [修改] 原有的 _exportAllPresets
    async _exportAllPresets() {
        if (!this.promptPresets.length) {
            this.ctx.helpers.showToast('没有可导出的预设', 'warning');
            return;
        }

        // ==================== [修改开始] ====================
        const exportType = await this._promptExportOptions();
        if (!exportType) {
            this.ctx.helpers.showToast('导出已取消', 'info');
            return; // 用户取消
        }

        // [修改] 转换为 Base64 —— 从 DB 加载完整数据
        const allPresets = await this.ctx.db.getAll(StoreNames.PRESETS);
        const exportData = await this._convertPresetPathsToBase64(allPresets, exportType);
        const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `prompt-presets-${new Date().toISOString().slice(0, 10)}.json`;
        a.click();
        URL.revokeObjectURL(url);
        this.ctx.helpers.showToast('已导出全部预设', 'success');
    }

    _truncateText(text = '', len = 48) {
        if (!text) return '';
        return text.length > len ? `${text.slice(0, len)}...` : text;
    }
    /**
     *  Danbooru 远程搜索，使用 CORS 代理
     */
    async _fetchDanbooru(query) {
        const PROXY_URL = 'https://cors.eu.org/';
        const url = `https://danbooru.donmai.us/autocomplete.json?search[query]=${encodeURIComponent(query)}&search[type]=tag_query&version=1&limit=50`;
        const proxiedUrl = PROXY_URL + url;

        this.ctx.log('settings-panel', `[Danbooru] 使用代理请求: ${proxiedUrl}`);

        try {
            const response = await fetch(proxiedUrl);
            if (!response.ok) throw new Error(`代理请求失败: HTTP ${response.status}`);

            const text = await response.text();
            if (this._isCloudflare(text)) {
                this._renderCfBlock(); // 调用Cloudflare错误处理
                return []; // 返回空数组
            }

            return JSON.parse(text);
        } catch (error) {
            console.error(`Danbooru 代理请求失败: ${proxiedUrl}`, error);
            // 抛出错误，让调用者处理UI
            throw error;
        }
    }

    /**
     * [修改] 重写标签搜索功能
     */
    async _searchTags(query) {
        const resultsEl = this.modalEl?.querySelector('#prompt-tag-results');
        if (!(resultsEl instanceof HTMLElement)) return;

        if (!query || query.trim().length === 0) {
            resultsEl.innerHTML = '<p class="tsp-text-muted">请输入关键词</p>';
            return;
        }

        resultsEl.innerHTML = '<p class="tsp-text-muted">正在搜索 Danbooru...</p>';

        try {
            // 直接调用新的 fetch 方法
            const results = await this._fetchDanbooru(query);

            if (results.length > 0) {
                this.promptSelectedTags = []; // 清空已选
                this._renderTagResults(results, true); // 使用远程模式渲染
            } else {
                resultsEl.innerHTML = '<p class="tsp-text-muted">未找到匹配标签</p>';
            }
        } catch (e) {
            // 如果 fetch 内部没有处理 CF 页面，在这里处理
            if (!resultsEl.innerHTML.includes('Danbooru 需要人机验证')) {
                 resultsEl.innerHTML = `<p class="tsp-text-danger">搜索失败: ${e.message}</p>`;
            }
        }
    }

    _renderTagResults(list, isRemote = false) {
        const resultsEl = this.modalEl?.querySelector('#prompt-tag-results');
        if (!(resultsEl instanceof HTMLElement)) return;
        if (!list.length) {
            resultsEl.innerHTML = '<p class="tsp-text-muted">未找到匹配标签</p>';
            return;
        }
        resultsEl.innerHTML = `
            <div class="tsp-tag-result-list">
                ${list.map(tag => `
                    ${this._renderTagChip(tag, isRemote)}
                `).join('')}
            </div>
        `;

        resultsEl.querySelectorAll('.tsp-tag-result').forEach(el => {
            const tagEl = /** @type {HTMLElement} */ (el);
            tagEl.addEventListener('click', () => {
                const val = tagEl.dataset.tag;
                if (!val) return;
                if (tagEl.classList.contains('active')) {
                    tagEl.classList.remove('active');
                    this.promptSelectedTags = this.promptSelectedTags.filter(t => t !== val);
                } else {
                    tagEl.classList.add('active');
                    this.promptSelectedTags.push(val);
                }
            });
        });
    }

    _renderTagChip(tag, isRemote) {
        const en = tag.en || tag.value || '';
        const cn = tag.cn || this._resolveCnForEn(en) || '';
        const text = cn ? `${cn} → ${en}` : (tag.label || en);
        const count = isRemote && tag.post_count ? `<span class="tsp-tag-count">${tag.post_count}</span>` : '';
        return `
            <span class="tsp-tag-chip tsp-tag-result" data-tag="${en}" title="${text}">
                ${text} ${count}
            </span>
        `;
    }

    _resolveCnForEn(en) {
        if (!en) return '';
        const tagData = this.ctx.getModule('tagDataSource');
        const checkMap = (map) => {
            for (const sub of Object.values(map || {})) {
                if (!sub || typeof sub !== 'object') continue;
                for (const [cn, enVal] of Object.entries(sub)) {
                    if (String(enVal).toLowerCase() === String(en).toLowerCase()) {
                        return cn;
                    }
                }
            }
            return '';
        };
        // staticData 格式: { 分类: { 子分类: { cn: en } } }
        const staticData = tagData?.staticData || {};
        for (const subCat of Object.values(staticData)) {
            const found = checkMap(subCat);
            if (found) return found;
        }
        // customData 格式: { 子分类: { cn: en } }
        const customData = tagData?.customData || {};
        const foundCustom = checkMap(customData);
        if (foundCustom) return foundCustom;
        return '';
    }

    async _copySelectedTags() {
        if (!this.promptSelectedTags.length) {
            this.ctx.helpers.showToast('请先选择标签', 'warning');
            return;
        }
        const text = this.promptSelectedTags.join(', ');
        await navigator.clipboard.writeText(text);
        this.ctx.helpers.showToast('已复制标签', 'success');
    }

    _fillSelectedTags() {
        if (!this.promptSelectedTags.length) {
            this.ctx.helpers.showToast('请先选择标签', 'warning');
            return;
        }
        const textarea = this.modalEl?.querySelector('#prompt-positive-text');
        if (textarea instanceof HTMLTextAreaElement) {
            const existing = textarea.value ? `${textarea.value}, ` : '';
            textarea.value = existing + this.promptSelectedTags.join(', ');
        }
    }

    /**
     * Danbooru 远程搜索 (HTML 解析版)
     */
    async _searchDanbooruTags(query) {
        const url = `https://danbooru.donmai.us/autocomplete?search%5Bquery%5D=${encodeURIComponent(query)}&search%5Btype%5D=tag_query&version=1&limit=20`;
        try {
            const resp = await fetch(url, {
                method: 'GET',
                headers: {
                    'User-Agent': 'Mozilla/5.0',
                    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
                    'Referer': 'https://danbooru.donmai.us/',
                },
            });
            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
            const text = await resp.text();

            if (this._isCloudflare(text)) {
                this._renderCfBlock(text);
                return [];
            }

            const parser = new DOMParser();
            const doc = parser.parseFromString(text, 'text/html');
            const items = doc.querySelectorAll('li[data-autocomplete-value]');
            const arr = [];
            items.forEach(li => {
                const label = li.querySelector('a')?.textContent?.trim() || '';
                const value = li.getAttribute('data-autocomplete-value') || '';
                const count = li.querySelector('.post-count')?.textContent?.trim()?.replace(/,/g, '') || '0';
                if (value) arr.push({ value, label, en: value, post_count: parseInt(count, 10) || 0 });
            });
            return arr;
        } catch (e) {
            this.ctx.warn('settings-panel', 'Danbooru 请求失败', e);
            return [];
        }
    }

    _isCloudflare(htmlText) {
        return /Just a moment\.\.\.|cloudflare/i.test(htmlText);
    }

    _renderCfBlock(rawHtml) {
        const resultsEl = this.modalEl?.querySelector('#prompt-tag-results');
        if (!(resultsEl instanceof HTMLElement)) return;
        resultsEl.innerHTML = `
            <div class="tsp-card" style="text-align:center;">
                <h4>⚠️ Danbooru 需要人机验证</h4>
                <p>请打开 Danbooru 完成人机验证后重试。</p>
                <button class="tsp-btn tsp-btn-primary" id="prompt-tag-retry">重试</button>
                <button class="tsp-btn" id="prompt-tag-open">打开 Danbooru</button>
            </div>
        `;
        resultsEl.querySelector('#prompt-tag-retry')?.addEventListener('click', () => {
            const q = this._getValue('prompt-tag-search');
            this._searchTags(q || '');
        });
        resultsEl.querySelector('#prompt-tag-open')?.addEventListener('click', () => {
            const q = encodeURIComponent(this._getValue('prompt-tag-search') || '');
            window.open(`https://danbooru.donmai.us/posts?tags=${q}`, '_blank');
        });
    }

    // ==================== 辅助方法 ====================

    _setValue(id, value) {
        const el = this.modalEl?.querySelector(`#${id}`);
        if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) {
            el.value = value ?? '';
        }
    }

    _getValue(id) {
        const el = this.modalEl?.querySelector(`#${id}`);
        if (!el) return null;
        if (el instanceof HTMLInputElement || el instanceof HTMLSelectElement) {
            if (el.type === 'number') return parseFloat(el.value) || 0;
            return el.value;
        }
        if (el instanceof HTMLTextAreaElement) {
            return el.value;
        }
        return null;
    }

    _setChecked(id, checked) {
        const el = this.modalEl?.querySelector(`#${id}`);
        if (el instanceof HTMLInputElement) {
            el.checked = !!checked;
        }
    }

    _getChecked(id) {
        const el = this.modalEl?.querySelector(`#${id}`);
        return el instanceof HTMLInputElement ? el.checked : false;
    }

    _getSelectValue(id) {
        const el = this.modalEl?.querySelector(`#${id}`);
        if (el instanceof HTMLSelectElement) return el.value;
        return '';
    }

    _setSelectValue(id, value) {
        const el = this.modalEl?.querySelector(`#${id}`);
        if (el instanceof HTMLSelectElement) {
            el.value = value ?? '';
        }
    }

    // ==================== 固定形象多组输入管理 ====================
    static MAX_FIXED_APPEARANCE = 3;

    _initFixedAppearanceInputs() {
        const list = this.modalEl?.querySelector('#prompt-fixed-appearance-list');
        if (!list) return;
        list.innerHTML = '';

        const DEFAULT_TEXT = '1girl, solo, black hair, red eyes, ponytail, long hair, black dress, strapless dress, jewelry, necklace, night, starry sky, balcony, railing, moonlight, soft lighting, depth of field, looking at viewer, cowboy shot';

        // 优先使用服务器同步回来的值（由 _loadSettings 在 this.savedFixedAppearanceList 中缓存）
        const saved = this.savedFixedAppearanceList;
        if (Array.isArray(saved) && saved.length > 0) {
            // 截断到最多 3 组，非字符串值兜底为空串
            const items = saved
                .slice(0, SettingsPanel.MAX_FIXED_APPEARANCE)
                .map(v => typeof v === 'string' ? v : '');
            // 保证至少有一组
            const finalItems = items.length > 0 ? items : [''];
            finalItems.forEach((val) => this._addFixedAppearanceInput(val));
            return;
        }

        // 无历史保存：走原来的硬编码示例，仅一组
        this._addFixedAppearanceInput(DEFAULT_TEXT);
    }

    _addFixedAppearanceInput(defaultValue = '') {
        const list = this.modalEl?.querySelector('#prompt-fixed-appearance-list');
        const addBtn = this.modalEl?.querySelector('#prompt-fixed-appearance-add');
        if (!list) return;
        const currentCount = list.querySelectorAll('.tsp-fixed-appearance-item').length;
        if (currentCount >= SettingsPanel.MAX_FIXED_APPEARANCE) {
            this.ctx.helpers.showToast(`最多只能添加 ${SettingsPanel.MAX_FIXED_APPEARANCE} 组`, 'warning');
            return;
        }
        const index = currentCount + 1;
        const item = document.createElement('div');
        item.className = 'tsp-fixed-appearance-item';
        item.style.cssText = 'display:flex; gap:6px; align-items:flex-start; margin-bottom:6px;';
        item.innerHTML = `
            <textarea class="tsp-input tsp-fixed-appearance-text" rows="3" placeholder="第 ${index} 组固定形象 tag，留空则跳过低生成本组" style="flex:1;">${defaultValue}</textarea>
            <button class="tsp-btn tsp-btn-sm tsp-btn-danger tsp-fixed-appearance-remove" title="移除此组" style="margin-top:2px; display:none;">
                <i class="fa-solid fa-minus"></i>
            </button>
        `;
        list.appendChild(item);
        this._refreshFixedAppearanceUI();
        // 绑定删除按钮
        item.querySelector('.tsp-fixed-appearance-remove')?.addEventListener('click', () => {
            item.remove();
            this._refreshFixedAppearanceUI();
        });
    }

    _refreshFixedAppearanceUI() {
        const list = this.modalEl?.querySelector('#prompt-fixed-appearance-list');
        const addBtn = this.modalEl?.querySelector('#prompt-fixed-appearance-add');
        if (!list) return;
        const items = list.querySelectorAll('.tsp-fixed-appearance-item');
        const count = items.length;
        // 控制 + 按钮显示
        if (addBtn) {
            addBtn.style.display = count >= SettingsPanel.MAX_FIXED_APPEARANCE ? 'none' : 'inline-flex';
        }
        // 控制每组的 - 按钮显示（只有 >1 组时才显示删除）
        items.forEach((el) => {
            const delBtn = el.querySelector('.tsp-fixed-appearance-remove');
            if (delBtn) delBtn.style.display = count > 1 ? 'inline-flex' : 'none';
        });
        // 刷新占位文字序号
        items.forEach((el, i) => {
            const ta = el.querySelector('.tsp-fixed-appearance-text');
            if (ta instanceof HTMLTextAreaElement && !ta.value) {
                ta.placeholder = `第 ${i + 1} 组固定形象 tag，留空则跳过低生成本组`;
            }
        });
    }

    _getFixedAppearanceValues() {
        const list = this.modalEl?.querySelector('#prompt-fixed-appearance-list');
        if (!list) return [];
        const values = [];
        list.querySelectorAll('.tsp-fixed-appearance-text').forEach((el) => {
            if (el instanceof HTMLTextAreaElement) {
                const v = el.value.trim();
                if (v) values.push(v);
            }
        });
        return values;
    }

    /**
     * 收集所有固定形象输入框的原始值（包括空串）用于服务器保存。
     * - 保留空串：下次打开时能还原「用户创建了 3 组、其中部分为空」的状态
     * - 上限 3 组：与 MAX_FIXED_APPEARANCE 一致
     */
    _collectAllFixedAppearanceForSave() {
        const list = this.modalEl?.querySelector('#prompt-fixed-appearance-list');
        if (!list) return [];
        const values = [];
        list.querySelectorAll('.tsp-fixed-appearance-text').forEach((el) => {
            if (el instanceof HTMLTextAreaElement) {
                values.push(el.value);  // 不 trim，保留用户原始输入
            }
        });
        return values.slice(0, SettingsPanel.MAX_FIXED_APPEARANCE);
    }

    /**
     * 根据模式加载通用参数到 UI
     */
    async _loadGeneralParams() {
        const imageGen = this.ctx.getModule('imageGen');
        if (!imageGen) return;
        const mode = this._getCurrentMode();
        const settings = imageGen.settings?.[mode] || {};

        // 获取宽和高
        const width = parseInt(settings.width ?? settings.sd?.width ?? 0);
        const height = parseInt(settings.height ?? settings.sd?.height ?? 0);

        this._setValue('settings-default-width', width || '');
        this._setValue('settings-default-height', height || '');
        this._setValue('settings-default-steps', settings.steps ?? settings.sd?.steps ?? '');

        // [修复逻辑开始]：根据宽高数值反向匹配下拉框预设
        const selectEl = this.modalEl?.querySelector('#general-size');
        if (selectEl && width && height) {
            let matched = false;
            // 定义尺寸映射表，包含所有可能的预设值
            const sizeMap = [
                { w: 832, h: 1216, vals: ['竖图', '832x1216'] },
                { w: 1216, h: 832, vals: ['横图', '1216x832'] },
                { w: 1024, h: 1024, vals: ['方图', '1024x1024'] },
                { w: 768, h: 1344, vals: ['768x1344'] },
                { w: 1344, h: 768, vals: ['1344x768'] },
                { w: 896, h: 1152, vals: ['896x1152'] },
                { w: 1152, h: 896, vals: ['1152x896'] },
                { w: 640, h: 640, vals: ['640x640'] }
            ];

            // 遍历当前下拉框里实际存在的选项
            for (const option of selectEl.options) {
                const val = option.value;
                if (val === 'Custom') continue;

                // 查找该选项值对应的尺寸
                const def = sizeMap.find(m => m.vals.includes(val));

                // 如果尺寸一致，则选中它
                if (def && def.w === width && def.h === height) {
                    selectEl.value = val;
                    matched = true;
                    break;
                }
            }

            // 如果没匹配到任何预设，选中 Custom
            if (!matched) {
                selectEl.value = 'Custom';
            }
        }
        // [修复逻辑结束]

        if (mode === 'nai') {
            this._setValue('general-cfg', settings.scale ?? 5);
            this._setValue('general-scale', settings.cfgRescale ?? 0);
        } else {
            this._setValue('general-cfg', settings.cfgScale ?? 7);
            this._setValue('general-scale', '');
        }

        // SD、ComfyUI 和 NAI 都支持种子设置
        if (mode === 'sd' || mode === 'comfyui' || mode === 'nai') {
            this._setValue('general-seed', settings.seed ?? -1);
        }

        // 加载收纳盒悬浮球设置
        const floatingBallShelterEnabled = await this.ctx.api.getValue('floating-ball-shelter-enabled', false);
        const shelterSwitch = this.modalEl?.querySelector('#settings-floating-ball-shelter-enabled');
        if (shelterSwitch) {
            shelterSwitch.checked = floatingBallShelterEnabled;
        }

        // 加载并发请求设置
        const concurrentRequestsEnabled = await this.ctx.api.getValue('concurrent_requests_enabled', false);
        const concurrentSwitch = this.modalEl?.querySelector('#settings-concurrent-requests-enabled');
        if (concurrentSwitch) {
            concurrentSwitch.checked = concurrentRequestsEnabled;
        }

        // 加载修复###换行设置
        const fixHashlineEnabled = await this.ctx.api.getValue('fix_hashline_enabled', false);
        const fixHashlineSwitch = this.modalEl?.querySelector('#settings-fix-hashline-enabled');
        if (fixHashlineSwitch) {
            fixHashlineSwitch.checked = fixHashlineEnabled;
        }
    }

    /**
     * 从 UI 保存通用参数到 imageGen 当前模式
     */
    _saveGeneralParams() {
        const imageGen = this.ctx.getModule('imageGen');
        if (!imageGen) return;
        const mode = this._getCurrentMode();
        const mset = imageGen.settings?.[mode] || {};

        // 辅助函数：安全获取数值，允许 0，忽略空字符串
        const getNum = (id, defaultVal) => {
            const el = this.modalEl?.querySelector(`#${id}`);
            if (el && el.value.trim() !== '') {
                const num = Number(el.value);
                return isNaN(num) ? defaultVal : num;
            }
            return defaultVal;
        };

        // 宽高步数
        mset.width = getNum('settings-default-width', mset.width || 0);
        mset.height = getNum('settings-default-height', mset.height || 0);
        mset.steps = getNum('settings-default-steps', mset.steps || 0);

        if (mode === 'nai') {
            // NAI 模式下:
            // general-cfg 对应 scale (默认5)
            // general-scale 对应 cfgRescale (默认0)
            mset.scale = getNum('general-cfg', mset.scale ?? 5);
            mset.cfgRescale = getNum('general-scale', mset.cfgRescale ?? 0);
        } else {
            // 其他模式下:
            // general-cfg 对应 cfgScale (默认7)
            mset.cfgScale = getNum('general-cfg', mset.cfgScale ?? 7);
        }

        // SD、ComfyUI 和 NAI 都支持种子设置
        if (mode === 'sd' || mode === 'comfyui' || mode === 'nai') {
            // 种子特殊处理：允许输入 -1 或 0
            mset.seed = getNum('general-seed', -1);
        }

        imageGen.settings[mode] = mset;

        // 保存收纳盒悬浮球设置
        const shelterSwitch = this.modalEl?.querySelector('#settings-floating-ball-shelter-enabled');
        if (shelterSwitch) {
            this.ctx.api.setValue('floating-ball-shelter-enabled', shelterSwitch.checked);
        }

        // 保存并发请求设置
        const concurrentSwitch = this.modalEl?.querySelector('#settings-concurrent-requests-enabled');
        if (concurrentSwitch) {
            this.ctx.api.setValue('concurrent_requests_enabled', concurrentSwitch.checked);
        }
    }

    /**
     * 从API重新加载所有模式的通用参数到内存和DOM
     * 用于解决修改通用设置后，其他模式参数未更新的问题
     * @param {Object} params - 可选参数，如果不提供则从 API 读取
     * @param {number} params.width - 宽度
     * @param {number} params.height - 高度
     * @param {number} params.steps - 步数
     */
    async _reloadAllModesFromAPI(params = {}) {
        const imageGen = this.ctx.getModule('imageGen');
        if (!imageGen) return;

        // 1. 获取基础参数 (优先使用 params, 其次 API, 再次 Default)
        const defaultWidth = params.width ?? await this.ctx.api.getValue('default_width', 832);
        const defaultHeight = params.height ?? await this.ctx.api.getValue('default_height', 1216);
        const defaultSteps = params.steps ?? await this.ctx.api.getValue('default_steps', 20);

        // 2. [新增] 获取 CFG 和 Rescale 参数
        // 逻辑：优先检测 params -> 其次读取当前通用设置面板上的输入框 (因为用户刚修改还没保存到内存) -> 最后默认为7/0
        // #general-cfg 在 SD/ComfyUI 代表 cfgScale，在 NAI 代表 scale (guidance)
        const currentGeneralCfg = params.cfgScale ?? (parseFloat(this._getValue('general-cfg')) || 7);
        // #general-scale 仅在 NAI 模式下可见，代表 cfgRescale
        const currentGeneralScale = params.cfgRescale ?? (parseFloat(this._getValue('general-scale')) || 0);
        const seedVal = this._getValue('general-seed');
        const currentGeneralSeed = (seedVal !== null && seedVal !== '') ? parseInt(seedVal) : -1;
        // 3. 遍历所有模式，更新内存数据
        const allModes = ['sd', 'nai', 'comfyui', 'other'];

        for (const mode of allModes) {
            // 获取或初始化该模式的设置对象
            const mset = imageGen.settings?.[mode] || {};

            // A. 更新尺寸/步数
            mset.width = defaultWidth;
            mset.height = defaultHeight;
            mset.steps = defaultSteps;

            // B. [新增] 更新 CFG / Scale (根据模式映射字段)
            if (mode === 'nai') {
                // NAI 模式：字段名为 scale 和 cfgRescale
                mset.scale = currentGeneralCfg;
                mset.cfgRescale = currentGeneralScale;
            } else {
                // SD / ComfyUI / Other 模式：字段名为 cfgScale
                mset.cfgScale = currentGeneralCfg;
                // 注意：ComfyUI 也是读取 cfgScale，不需要 rescale
            }
            if (mode === 'sd' || mode === 'comfyui') {
                mset.seed = currentGeneralSeed;
            }
            // 确保设置对象存在于主配置中
            if (!imageGen.settings[mode]) {
                imageGen.settings[mode] = {};
            }
            imageGen.settings[mode] = mset;
        }

        // 4. 更新通用设置 DOM (回填显示，确保一致性)
        this._setValue('settings-default-width', defaultWidth);
        this._setValue('settings-default-height', defaultHeight);
        this._setValue('settings-default-steps', defaultSteps);
        // 如果参数是通过 params 传入的（非DOM读取），刷新通用面板显示
        if (params.cfgScale !== undefined) this._setValue('general-cfg', params.cfgScale);
        if (params.cfgRescale !== undefined) this._setValue('general-scale', params.cfgRescale);

        // 5. 更新各模式专属面板的 DOM 输入框
        // 即使当前这些面板被隐藏，更新它们可以保证切换模式时数据是最新的
        const modeInputIds = {
            'nai': {
                width: 'nai-width', height: 'nai-height', steps: 'nai-steps',
                cfg: 'nai-scale', rescale: 'nai-cfg-rescale'
            },
            'sd': {
                width: 'sd-width', height: 'sd-height', steps: 'sd-steps',
                cfg: 'sd-cfg',
                seed: 'sd-seed' // >>>>> [3/3] 添加：映射 SD 专属面板的 Seed 输入框 ID <<<<<
            },
            'other': {
                width: 'other-width', height: 'other-height', steps: 'other-timeout',
                cfg: 'other-cfg'
            }
        };

        for (const mode of allModes) {
            const inputIds = modeInputIds[mode];
            if (!inputIds) continue;

            // 更新宽高步数
            const widthInput = this.modalEl?.querySelector(`#${inputIds.width}`);
            const heightInput = this.modalEl?.querySelector(`#${inputIds.height}`);
            const stepsInput = this.modalEl?.querySelector(`#${inputIds.steps}`);

            if (widthInput) widthInput.value = defaultWidth;
            if (heightInput) heightInput.value = defaultHeight;

            // Other模式的 steps 对应 timeout，不应被覆盖，其他模式正常覆盖
            if (mode !== 'other' && stepsInput) {
                stepsInput.value = defaultSteps;
            }

            // [新增] 更新模式专属的 CFG/Scale 输入框
            if (inputIds.cfg) {
                this._setValue(inputIds.cfg, currentGeneralCfg);
            }
            if (inputIds.rescale) {
                this._setValue(inputIds.rescale, currentGeneralScale);
            }
            if (inputIds.seed) {
                this._setValue(inputIds.seed, currentGeneralSeed);
            }
        }
    }

    /**
     * 应用预设尺寸
     */
    _applySizePreset(val) {
        let width = '';
        let height = '';
        switch (val) {
            case '竖图':
            case '832x1216':
                width = '832'; height = '1216'; break;
            case '横图':
            case '1216x832':
                width = '1216'; height = '832'; break;
            case '方图':
            case '1024x1024':
                width = '1024'; height = '1024'; break;
            case '768x1344':
                width = '768'; height = '1344'; break;
            case '1344x768':
                width = '1344'; height = '768'; break;
            case '896x1152':
                width = '896'; height = '1152'; break;
            case '1152x896':
                width = '1152'; height = '896'; break;
            case '640x640':
                width = '640'; height = '640'; break;
            default:
                return; // Custom 或未知，保持现值
        }
        this._setValue('settings-default-width', width);
        this._setValue('settings-default-height', height);
    }

    /**
     * 加载高级参数到 UI
     */
    async _loadAdvancedParams() {
        const startTag = await this.ctx.api.getValue('chami_analysis_begins', 'image###');
        const endTag = await this.ctx.api.getValue('chami_analysis_completed', '###');
        this._setValue('adv-start-tag', startTag);
        this._setValue('adv-end-tag', endTag);

        this._setSelectValue('adv-auto-generate', String(await this.ctx.api.getValue('auto_generate_click', true)));
        this._setValue('adv-max-auto-clicks', await this.ctx.api.getValue('max_auto_clicks', 3));
        this._setSelectValue('adv-streaming', String(await this.ctx.api.getValue('chami_streaming_mode', false)));
        this._setSelectValue('adv-preset-quality', await this.ctx.api.getValue('preset_preview_mode', 'thumbnail'));
        this._setValue('adv-show-count', await this.ctx.api.getValue('chami_max_button', 20));
        this._setSelectValue('adv-double-click', String(await this.ctx.api.getValue('use_double_click_regen', false)));
        this._setSelectValue('adv-display-mode', await this.ctx.api.getValue('display_mode', '默认'));
        this._setSelectValue('adv-cache-days', String(await this.ctx.api.getValue('cache_days', 7)));
        this._setSelectValue('adv-privacy-mode', String(await this.ctx.api.getValue('chami_privacy_mode', false)));
        const useDoubleClick = await this.ctx.api.getValue('use_double_click_regen', false);
        this._setSelectValue('adv-double-click', String(useDoubleClick));
        document.body.classList.toggle('tsp-mode-double-click', useDoubleClick);

        const zoomVal = await this.ctx.api.getValue('chami_image_zoom_ratio', 100);
        this._setValue('adv-zoom', zoomVal);
        const zoomLabel = this.modalEl?.querySelector('#adv-zoom-value');
        if (zoomLabel) zoomLabel.textContent = `${zoomVal}%`;
        // 加载存储设置
        const imageGen = this.ctx.getModule('imageGen');
        if (imageGen) {
            const storageMode = imageGen.getStorageMode();
            this._setSelectValue('adv-storage-mode', storageMode);
            if (imageGen.storageManager) {
                this._setChecked('adv-keep-browser-cache', imageGen.storageManager.settings.keepBrowserCache);
                // 加载 GitHub 存储相关设置
                this._setValue('adv-github-repo', imageGen.storageManager.settings.githubRepo);
                this._setValue('adv-github-token', imageGen.storageManager.settings.githubToken);
            }

            // 根据当前存储模式显示或隐藏 GitHub 存储设置
            const githubSettings = this.modalEl.querySelector('#adv-github-storage-settings');
            if (githubSettings) {
                githubSettings.style.display = storageMode === 'github' ? 'flex' : 'none';
            }
        }
        // 刷新存储统计
        await this._refreshStorageStats();
    }

    /**
     * 保存高级参数
     */
    async _saveAdvancedParams() {
        await this.ctx.api.setValue('chami_analysis_begins', this._getValue('adv-start-tag'));
        await this.ctx.api.setValue('chami_analysis_completed', this._getValue('adv-end-tag'));
        await this.ctx.api.setValue('auto_generate_click', this._getSelectValue('adv-auto-generate') === 'true');
        await this.ctx.api.setValue('max_auto_clicks', Number(this._getValue('adv-max-auto-clicks')) || 3);
        await this.ctx.api.setValue('chami_streaming_mode', this._getSelectValue('adv-streaming') === 'true');
        await this.ctx.api.setValue('chami_max_button', Number(this._getValue('adv-show-count')) || 0);
        await this.ctx.api.setValue('use_double_click_regen', this._getSelectValue('adv-double-click') === 'true');
        await this.ctx.api.setValue('preset_preview_mode', this._getSelectValue('adv-preset-quality') || 'thumbnail');
        await this.ctx.api.setValue('display_mode', this._getSelectValue('adv-display-mode') || '默认');
        const useDoubleClickVal = this._getSelectValue('adv-double-click') === 'true';
        await this.ctx.api.setValue('use_double_click_regen', useDoubleClickVal);
        document.body.classList.toggle('tsp-mode-double-click', useDoubleClickVal);
        await this.ctx.api.setValue('cache_days', Number(this._getSelectValue('adv-cache-days')) || 0);
        await this.ctx.api.setValue('chami_privacy_mode', this._getSelectValue('adv-privacy-mode') === 'true');

        const zoom = Number(this._getValue('adv-zoom')) || 100;
        await this.ctx.api.setValue('chami_image_zoom_ratio', zoom);

        const imageGen = this.ctx.getModule('imageGen');
        if (imageGen) {
            if (typeof imageGen.setZoomRatio === 'function') {
                imageGen.setZoomRatio(zoom);
            }

            // 保存 GitHub 存储相关设置
            if (imageGen.storageManager) {
                imageGen.storageManager.settings.githubRepo = this._getValue('adv-github-repo');
                imageGen.storageManager.settings.githubToken = this._getValue('adv-github-token');
                // 保存设置到服务器或本地
                await imageGen.storageManager.saveSettings();
            }
        }
    }


    /**
     * [修改] 显示全功能的全屏大图查看器（支持全局导航）
     * @param {number} clickedId - 被点击的图片ID
     * @param {number[]} allIds - 当前筛选条件下的所有图片ID列表
     * @param {string} initialUrl - 初始图片的DataURL，避免二次加载
     */
    _showFullImageOverlay(clickedId, allIds, initialUrl) {
        // [修改] 兼容单张图片预览模式 (用于预设长按)
        if (!allIds || allIds.length === 0) {
            allIds = [clickedId || 'preview'];
            if (!clickedId) clickedId = 'preview';
        }
        const overlay = document.createElement('div');
        overlay.className = 'tsp-simple-lightbox'; // 复用基础灯箱样式
        //
        // ==================== HTML 结构修改 ====================
        //
        overlay.innerHTML = `
            <div class="tsp-main-image-viewer" style="width:100%; height:100%;">
            </div>

            <div class="tsp-lightbox-controls">
                <button class="tsp-btn tsp-lightbox-save-btn"><i class="fa-solid fa-download"></i></button>
                <button class="tsp-lightbox-close-btn" title="关闭 (Esc)">×</button>
            </div>

            <button class="tsp-lightbox-nav prev" title="上一张 (←)">❮</button>
            <button class="tsp-lightbox-nav next" title="下一张 (→)">❯</button>

            <div id="tsp-lightbox-info" style="position:absolute; top:10px; left:50%; transform:translateX(-50%); color:white; background:rgba(0,0,0,0.5); padding: 4px 10px; border-radius:8px; font-size: 14px; z-index:15;"></div>
        `;

        const mainContainer = overlay.querySelector('.tsp-main-image-viewer');
        //  获取关闭按钮的引用
        const closeBtn = overlay.querySelector('.tsp-lightbox-close-btn');
        const prevBtn = overlay.querySelector('.tsp-lightbox-nav.prev');
        const nextBtn = overlay.querySelector('.tsp-lightbox-nav.next');
        const saveBtn = overlay.querySelector('.tsp-lightbox-save-btn');
        const infoEl = overlay.querySelector('#tsp-lightbox-info');

        /*  1. 定义 activeObjectUrls 用于存储临时 Blob URL */
        const activeObjectUrls = new Set();

        let currentIndex = allIds.findIndex(id => id == clickedId);
        let currentItem = { id: clickedId, imageData: initialUrl };
        const imageGen = this.ctx.getModule('imageGen');

        const close = () => {
            /*  2. 关闭时释放内存 */
            activeObjectUrls.forEach(url => URL.revokeObjectURL(url));
            activeObjectUrls.clear();

            overlay.classList.remove('visible');
            document.removeEventListener('keydown', keydownHandler);
            setTimeout(() => overlay.remove(), 200);
        };

        const isVideoType = (url) => {
            // [修改] 增加针对 Blob 的检测
            if (url instanceof Blob) return url.type.startsWith('video/');
            return typeof url === 'string' && (url.startsWith('data:video/') || url.endsWith('.mp4')); // 简单判断
        };
        const updateNavButtons = () => {
            prevBtn.disabled = currentIndex <= 0;
            nextBtn.disabled = currentIndex >= allIds.length - 1;
        };

        const updateMainDisplay = (itemData) => {
            if (!itemData) return;
            currentItem = itemData;
            mainContainer.innerHTML = '';
            infoEl.textContent = `图片 #${itemData.id} (${currentIndex + 1} / ${allIds.length})`;

            // ================= [修复开始] =================
            // 确定有效的显示源：
            // 1. 如果 itemData.imageData 存在（Blob对象 或 初始传入的 dataURL/Base64），优先使用。
            // 2. 否则，回退使用 itemData.serverPath（酒馆模式下的服务器路径）。
            const validSource = itemData.imageData || itemData.serverPath;

            if (!validSource) {
                infoEl.textContent = `图片数据丢失 (ID: ${itemData.id})`;
                return;
            }

            let mediaEl;
            // 判断类型时使用 validSource
            if (isVideoType(validSource)) {
                mediaEl = document.createElement('video');
                mediaEl.autoplay = true;
                mediaEl.loop = true;
                mediaEl.controls = true;
            } else {
                mediaEl = document.createElement('img');
                mediaEl.draggable = false;
            }
            mediaEl.style.userSelect = 'none';
            // mediaEl.style.pointerEvents = 'none'; // 建议注释掉这行，否则没法右键另存为，且挡住了video的控件交互

            // 处理 Blob URL 或 字符串路径
            if (validSource instanceof Blob) {
                const blobUrl = URL.createObjectURL(validSource);
                mediaEl.src = blobUrl;
                activeObjectUrls.add(blobUrl); // 加入清理队列
            } else {
                mediaEl.src = validSource; // 兼容 Base64 或服务器路径
            }

            mainContainer.appendChild(mediaEl);
        };

        const navigateTo = async (newIndex) => {
            if (newIndex < 0 || newIndex >= allIds.length || !imageGen) return;

            currentIndex = newIndex;
            const nextId = allIds[currentIndex];
            infoEl.textContent = '加载中...';
            updateNavButtons();

            try {
                // 按需加载
                const newItemData = await imageGen.getCachedImage(nextId);
                if (newItemData) {
                    updateMainDisplay(newItemData);
                } else {
                    infoEl.textContent = `加载失败: #${nextId}`;
                }
            } catch(e) {
                infoEl.textContent = `错误: ${e.message}`;
            }
        };

        // 事件绑定
        closeBtn.addEventListener('click', (e) => { e.stopPropagation(); close(); });
        prevBtn.addEventListener('click', (e) => { e.stopPropagation(); navigateTo(currentIndex - 1); });
        nextBtn.addEventListener('click', (e) => { e.stopPropagation(); navigateTo(currentIndex + 1); });

        saveBtn.addEventListener('click', (e) => {
            e.stopPropagation();

            // ================= [修复开始] =================
            // 获取有效源：imageData 或 serverPath
            const validSource = currentItem?.imageData || currentItem?.serverPath;
            if (!validSource) return;

            const a = document.createElement('a');

            // 如果是 Blob，需要创建下载链接
            if (validSource instanceof Blob) {
                a.href = URL.createObjectURL(validSource);
                // 记得稍后释放这个临时的 URL，或者让系统自动回收
                setTimeout(() => URL.revokeObjectURL(a.href), 10000);
            } else {
                a.href = validSource;
            }

            const ext = isVideoType(validSource) ? 'mp4' : 'png';
            a.download = `tsp-cache-${currentItem.id}.${ext}`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            this.ctx.helpers.showToast('已开始下载...', 'success');
            // ================= [修复结束] =================
        });

        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) close();
        });

        const keydownHandler = (e) => {
            if (e.key === 'Escape') close();
            if (e.key === 'ArrowLeft') prevBtn.click();
            if (e.key === 'ArrowRight') nextBtn.click();
        };
        document.addEventListener('keydown', keydownHandler);

        let touchStartX = 0;
        mainContainer.addEventListener('touchstart', (e) => {
             e.stopPropagation();
             touchStartX = e.touches[0].clientX;
        }, { passive: true });
        mainContainer.addEventListener('touchend', (e) => {
            e.stopPropagation();
            const deltaX = e.changedTouches[0].clientX - touchStartX;
            if (Math.abs(deltaX) > 50) {
                if (deltaX > 0) prevBtn.click(); else nextBtn.click();
            }
        }, { passive: true });

        // 初始加载
        document.body.appendChild(overlay);
        requestAnimationFrame(() => {
            overlay.classList.add('visible');
            updateMainDisplay({ id: clickedId, imageData: initialUrl });
            updateNavButtons();
        });
    }
    /**
     * 生成 WebP 缩略图
     */
    async _createWebPThumbnail(dataUrl, maxDim = 200) {
        return new Promise((resolve) => {
            const img = new Image();
            img.onload = () => {
                const canvas = document.createElement('canvas');
                let w = img.width;
                let h = img.height;

                // 计算缩放比例
                if (w > h) {
                    if (w > maxDim) { h *= maxDim / w; w = maxDim; }
                } else {
                    if (h > maxDim) { w *= maxDim / h; h = maxDim; }
                }

                canvas.width = w;
                canvas.height = h;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, w, h);

                // 转换为 WebP，质量 0.6
                resolve(canvas.toDataURL('image/webp', 0.6));
            };
            img.onerror = () => resolve(null);
            img.src = dataUrl;
        });
    }
    /**
     * [修改] 刷新缓存缩略视图 (包含分页和交互修复，支持筛选)
     * - 修复 BUG-1: 旧图片（无缩略图字段）在酒馆模式下不显示的问题。
     * - 修复 BUG-2: 长按编辑和单击查看大图时错误地使用了缩略图而不是原图的问题。
     * - 优化加载逻辑：优先使用预先生成的缩略图（thumbnailPath 或 thumbnailData）。
     * - 兼容旧数据：如果图片记录中没有缩略图，则回退到加载原图并实时生成临时缩略图。
     * @param {number} page 指定页码，不传则使用当前状态
     */
    // 计算对象内存占用的辅助函数
    _calculateObjectSize(obj) {
        if (obj === null || obj === undefined) return 0;

        let size = 0;
        const seen = new WeakSet();

        function calculate(obj) {
            if (obj === null || obj === undefined) return 0;
            if (typeof obj !== 'object') {
                if (typeof obj === 'string') {
                    return obj.length * 2;
                } else if (typeof obj === 'number' || typeof obj === 'boolean') {
                    return 8;
                } else {
                    return 0;
                }
            }

            if (seen.has(obj)) return 0;
            seen.add(obj);

            let objSize = 0;
            if (Array.isArray(obj)) {
                for (let i = 0; i < obj.length; i++) {
                    objSize += calculate(obj[i]);
                }
            } else {
                for (let key in obj) {
                    if (obj.hasOwnProperty(key)) {
                        objSize += key.length * 2;
                        objSize += calculate(obj[key]);
                    }
                }
            }
            return objSize;
        }

        size = calculate(obj);
        return size;
    }

    // 格式化字节大小的辅助函数
    _formatBytes(bytes, decimals = 2) {
        if (bytes === 0) return '0 Bytes';

        const k = 1024;
        const dm = decimals < 0 ? 0 : decimals;
        const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];

        const i = Math.floor(Math.log(bytes) / Math.log(k));

        return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
    }

    async _refreshCacheView(page) {
        // 获取所有相关的UI元素
        const infoEl = this.modalEl?.querySelector('#adv-cache-info');
        const grid = this.modalEl?.querySelector('#adv-cache-grid');

        // 获取筛选条件
        const filterMode = this.modalEl?.querySelector('#adv-cache-filter-mode')?.value || '';
        const filterDateStart = this.modalEl?.querySelector('#adv-cache-filter-start')?.value || '';
        const filterDateEnd = this.modalEl?.querySelector('#adv-cache-filter-end')?.value || '';

        // 确保UI元素存在
        if (!(infoEl instanceof HTMLElement) || !(grid instanceof HTMLElement)) {
            return;
        }

        // 获取核心的图像生成器模块
        const imageGen = this.ctx.getModule('imageGen');
        if (!imageGen?.getCacheMetadata) {
            infoEl.textContent = '缓存模块不可用';
            return;
        }

        // 如果传入了页码，则更新当前页状态
        if (page) {
            this.cachePage = page;
        }
        grid.innerHTML = '<p class="tsp-muted">正在加载缩略图...</p>';

        // 从 image-gen 获取经过筛选和分页的元数据
        const meta = await imageGen.getCacheMetadata({
            pageSize: this.cachePageSize,
            page: this.cachePage,
            filterMode,
            filterDateStart,
            filterDateEnd
        });

        const totalPages = Math.ceil(meta.total / this.cachePageSize);

        // 计算内存占用统计
        let totalMemory = 0;
        let metadataCount = 0;

        // 1. [优化] 统计当前角色卡加载的元数据（仅 id+hash 映射）
        const storageManager = imageGen.storageManager;
        if (storageManager && storageManager._characterMetadataCache) {
            for (const [characterName, characterMetadata] of Object.entries(storageManager._characterMetadataCache)) {
                // 只统计 id 和 locationHash，忽略其他字段
                for (const item of characterMetadata) {
                    totalMemory += 16; // id (number) 约 8 字节
                    if (item.locationHash) {
                        totalMemory += item.locationHash.length * 2; // 字符串每个字符 2 字节
                    }
                    metadataCount++;
                }
            }
        }

        // 2. [优化] 统计本地数据库中的轻量级记录（仅 id+hash）
        try {
            // 使用新的 getImageCacheLight 方法只获取 id 和 locationHash
            const lightRecords = await this.ctx.db.getImageCacheLight() || [];
            for (const item of lightRecords) {
                totalMemory += 16; // id (number) 约 8 字节
                if (item.locationHash) {
                    totalMemory += item.locationHash.length * 2; // 字符串每个字符 2 字节
                }
                metadataCount++;
            }
        } catch (e) {
            // 忽略数据库错误
        }

        // 3. 统计内存映射表的占用
        if (imageGen._locationToImageIdMap) {
            // 统计 Map 的键值对占用
            for (const [key, value] of Object.entries(imageGen._locationToImageIdMap)) {
                totalMemory += key.length * 2; // 键（locationHash）的占用
                totalMemory += 8; // 值（id）的占用
            }
        }

        const averageMemory = metadataCount > 0 ? totalMemory / metadataCount : 0;

        // 更新UI显示统计结果
        infoEl.textContent = `共 ${meta.total} 张图片，第 ${meta.page} / ${totalPages || 1} 页` +
                             (filterMode !== 'all' ? ` (筛选: ${filterMode})` : '') +
                             ` | 内存占用: ${this._formatBytes(totalMemory)} (${metadataCount}条轻量级映射，平均每条 ${this._formatBytes(averageMemory)})`;


        // 清空网格准备渲染
        grid.innerHTML = '';
        if (!meta.items.length) {
            grid.innerHTML = '<p class="tsp-text-muted">暂无符合条件的缓存数据</p>';
            return;
        }

        // 创建内部容器，并根据多选模式添加样式
        const innerGrid = document.createElement('div');
        innerGrid.className = 'tsp-cache-grid-inner';
        if (this.isCacheMultiSelectMode) {
            innerGrid.classList.add('selection-mode');
        }
        grid.appendChild(innerGrid);

        // 获取当前筛选条件下的所有图片ID，用于灯箱的全屏左右导航
        const allFilteredIds = await imageGen.getCacheMetadata({
            pageSize: 99999, // 获取所有
            page: 1,
            filterMode,
            filterDateStart,
            filterDateEnd
        }).then(res => res.items.map(it => it.id));

        // 遍历当前页的每一项并渲染
        for (const item of meta.items) {

            // ================================================================
            // [核心修复-1] 缩略图显示逻辑修正
            // ================================================================
            let displayUrl = null;
            let usingPrecomputedThumbnail = false;

            // 1. 优先使用预计算的缩略图 (路径或Base64)
            if (item.thumbnailData) {
                // [修改] 将 Base64 转换为 Blob URL
                displayUrl = this._base64ToBlobUrl(item.thumbnailData);
                usingPrecomputedThumbnail = true;
            } else if (item.thumbnailPath) {
                displayUrl = item.thumbnailPath; // 服务器 URL
                usingPrecomputedThumbnail = true;
            }

            // 2. 如果没有缩略图（兼容旧数据），则必须加载完整记录
            let originalDataRecord = null;
            if (!usingPrecomputedThumbnail) {
                originalDataRecord = await imageGen.getCachedImage(item.id);
                // 使用原图的 imageData 或 serverPath 作为回退的显示源
                const rawData = originalDataRecord?.imageData || originalDataRecord?.serverPath;

                // [修改] 调用更新后的辅助函数，它现在能正确处理 Blob 了
                displayUrl = this._base64ToBlobUrl(rawData);
            }

            // 如果最终还是没有可显示的URL，则跳过此项
            if (!displayUrl) {
                continue;
            }

            // —————————— 后续逻辑不变，但交互时会重新获取原图 ——————————

            let modeLabelHtml = '';
            if (item.mode) {
                let mode_string = '';
                if (typeof item.mode === 'string') {
                    mode_string = item.mode;
                } else if (typeof item.mode === 'object' && item.mode !== null && item.mode.mode) {
                    mode_string = item.mode.mode;
                }
                if (mode_string) {
                    const mode_lower = mode_string.toLowerCase();
                    const mode_upper = mode_string.toUpperCase();
                    modeLabelHtml = `<div class="tsp-cache-thumb-mode" data-mode="${mode_lower}">${mode_upper}</div>`;
                }
            }

            const isVideo = displayUrl.startsWith('data:video/');
            const thumbDiv = document.createElement('div');
            thumbDiv.className = 'tsp-cache-thumb';
            thumbDiv.dataset.id = item.id;
            if (this.selectedCacheImages.has(item.id)) {
                thumbDiv.classList.add('selected');
            }

            thumbDiv.innerHTML = `
                ${modeLabelHtml}
                <div class="tsp-cache-media-placeholder"></div>
                <div class="tsp-cache-id">#${item.id}</div>
                <div class="tsp-cache-actions">
                    <button class="tsp-cache-btn danger delete-img" title="删除"><i class="fa-solid fa-trash"></i></button>
                </div>
                <div class="tsp-cache-checkbox"><i class="fa-solid fa-check"></i></div>
            `;

            const mediaContainer = thumbDiv.querySelector('.tsp-cache-media-placeholder');

            // 构建懒加载图片/视频对象
            let mediaEl;

            if (isVideo) {
                // 视频处理：视频本身用 poster 做封面，点击播放比较好，但在缩略图模式
                // 我们可以用 video 标签，但也应用懒加载逻辑
                const video = document.createElement('video');
                // 视频比较特殊，可以用 preload="none" 配合观察器
                video.dataset.src = displayUrl;
                video.src = ""; // 初始不加载
                video.muted = true;
                video.loop = true;
                video.classList.add('tsp-lazy-img'); // 标记
                video.style.width = '100%';
                video.style.height = '100%';
                video.style.objectFit = 'cover';

                // 给视频特殊的加载逻辑：进入视窗才赋值 src
                // 注意：上面的通用 _initLazyObserver 主要针对 img，我们需要微调或在这里手动处理
                // 为了简单，我们对视频也用类似 img 的逻辑：

                mediaEl = video;
            } else {
                // 图片处理
                const img = document.createElement('img');
                img.classList.add('tsp-lazy-img');

                // 1. 设置透明占位图
                img.src = this.emptyImage;

                // 2. 将真实数据放入 data-src
                // 无论是 Base64 还是 服务器路径，都放这里
                img.dataset.src = displayUrl;

                img.alt = `cache-${item.id}`;
                img.style.width = '100%';
                img.style.height = '100%';
                img.style.objectFit = 'cover';
                img.style.transition = 'opacity 0.3s ease'; // 增加渐变效果

                mediaEl = img;
            }

            mediaContainer.replaceWith(mediaEl);

            //  立即加入观察列表
            if (this.lazyObserver) {
                this.lazyObserver.observe(mediaEl);
            }

            let pressTimer = null;
            let isLongPress = false;
            let startX = 0, startY = 0;
            const LONG_PRESS_MS = 600;
            const MOVE_THRESHOLD = 10;

            const handleStart = (x, y) => {
                startX = x; startY = y; isLongPress = false;
                thumbDiv.classList.add('active-press');
                pressTimer = setTimeout(async () => {
                    isLongPress = true;
                    thumbDiv.classList.remove('active-press');

                    // ================================================================
                    // [核心修复-2] 长按编辑时，强制获取原图
                    // ================================================================
                    this.ctx.helpers.showToast('正在加载原图进行编辑...', 'info');
                    const record = await imageGen.getCachedImage(item.id);
                    const validSource = record?.imageData || record?.serverPath;

                    if (!validSource) {
                        this.ctx.helpers.showToast('无法加载原图数据进行编辑', 'error');
                        return;
                    }

                    this.ctx.helpers.showToast('进入编辑模式...', 'info');
                    if (imageGen.interactionManager) {
                        const tempImg = document.createElement('img');

                        //  将 Blob 或 Base64 转换为可用的 URL
                        const displaySrc = this._base64ToBlobUrl(validSource);

                        // [修改] 使用转换后的 URL
                        tempImg.src = displaySrc;
                        tempImg.dataset.imageId = String(item.id);
                        tempImg.dataset.locationHash = item.locationHash;
                        imageGen.interactionManager.openEditPromptModal(tempImg);
                    }
                }, LONG_PRESS_MS);
            };

            const handleEnd = (x, y) => {
                clearTimeout(pressTimer);
                thumbDiv.classList.remove('active-press');
                if (this.isCacheMultiSelectMode) {
                    const id = item.id;
                    if (this.selectedCacheImages.has(id)) {
                        this.selectedCacheImages.delete(id);
                        thumbDiv.classList.remove('selected');
                    } else {
                        this.selectedCacheImages.add(id);
                        thumbDiv.classList.add('selected');
                    }
                    this._updateCacheMultiSelectButtonText();
                    return;
                }
                const dist = Math.hypot(x - startX, y - startY);
                if (dist < MOVE_THRESHOLD && !isLongPress) {
                    // ================================================================
                    // [核心修复-2] 单击查看大图时，也强制获取原图
                    // ================================================================
                    imageGen.getCachedImage(item.id).then(record => {
                        // [修复] 增加对 record.serverPath 的检查
                        const src = record?.imageData || record?.serverPath;

                        if (record && src) {
                            this._showFullImageOverlay(item.id, allFilteredIds, src);
                        } else {
                            this.ctx.helpers.showToast('无法加载原图', 'error');
                        }
                    });
                }
            };

            const delBtn = thumbDiv.querySelector('.delete-img');
            delBtn.addEventListener('click', async (e) => {
                e.stopPropagation();
                e.preventDefault();
                clearTimeout(pressTimer);
                if (await this.ctx.helpers.promptConfirm(`确定删除图片 #${item.id}?\n\n此操作将同时删除服务器文件和记录，不可恢复。`)) {
                    try {
                        const imageGenModule = this.ctx.getModule('imageGen');
                        if (imageGenModule) {
                            await imageGenModule.deleteCachedImage(item.id);
                            thumbDiv.remove();
                            this.ctx.helpers.showToast('图片已成功删除', 'success');
                            this._refreshStorageStats();
                        } else {
                            throw new Error('找不到图像管理器模块');
                        }
                    } catch (err) {
                        this.ctx.helpers.showToast(`删除失败: ${err.message}`, 'error');
                        console.error('删除图片失败:', err);
                    }
                }
            });

            thumbDiv.addEventListener('mousedown', (e) => {
                if (e.button !== 0 || e.target.closest('.delete-img')) return;
                handleStart(e.clientX, e.clientY);
                const onUp = (ev) => {
                    handleEnd(ev.clientX, ev.clientY);
                    document.removeEventListener('mouseup', onUp);
                };
                document.addEventListener('mouseup', onUp);
            });
            thumbDiv.addEventListener('touchstart', (e) => {
                if (e.target.closest('.delete-img')) return;
                e.preventDefault();
                handleStart(e.touches[0].clientX, e.touches[0].clientY);
            }, { passive: false });
            thumbDiv.addEventListener('touchend', (e) => {
                handleEnd(e.changedTouches[0].clientX, e.changedTouches[0].clientY);
            });

            innerGrid.appendChild(thumbDiv);

            if (isVideo) {
                const video = document.createElement('video');
                video.src = displayUrl;
                video.muted = true;
                video.loop = true;
                video.style.width = '100%';
                video.style.height = '100%';
                video.style.objectFit = 'cover';
                video.onmouseenter = () => video.play().catch(()=>{});
                video.onmouseleave = () => video.pause();
                mediaContainer.replaceWith(video);
            } else {
                if (usingPrecomputedThumbnail) {
                    // 【新路径 - 快速】已经有了缩略图，直接使用。
                    const img = document.createElement('img');
                    img.src = displayUrl; // 可能是路径或Base64，浏览器都能处理
                    img.alt = `cache-${item.id}`;
                    img.loading = "lazy";
                    img.style.width = '100%';
                    img.style.height = '100%';
                    img.style.objectFit = 'cover';
                    mediaContainer.replaceWith(img);
                } else {
                    // 【旧路径 - 兼容】没有预计算的缩略图，现场制作一个临时的。
                    // 此时的 displayUrl 是原图的 imageData 或 serverPath。
                    if (displayUrl.startsWith('data:')) {
                        // 如果是 Base64，通过 canvas 压缩
                        this._createWebPThumbnail(displayUrl).then(webpUrl => {
                            if (webpUrl) {
                                const img = document.createElement('img');
                                img.src = webpUrl;
                                img.alt = `cache-${item.id}`;
                                img.loading = "lazy";
                                img.style.width = '100%';
                                img.style.height = '100%';
                                img.style.objectFit = 'cover';
                                mediaContainer.replaceWith(img);
                            }
                        });
                    } else {
                        // 如果是服务器路径，直接用它作为 src，让浏览器自己加载。
                        // 这是最简单的兼容方式，虽然会加载大图，但保证了显示。
                        const img = document.createElement('img');
                        img.src = displayUrl;
                        img.alt = `cache-${item.id}`;
                        img.loading = "lazy";
                        img.style.width = '100%';
                        img.style.height = '100%';
                        img.style.objectFit = 'cover';
                        mediaContainer.replaceWith(img);
                    }
                }
            }
        } // 循环结束

        // 渲染分页控件
        if (totalPages > 1) {
            const paginationDiv = document.createElement('div');
            paginationDiv.className = 'tsp-pagination';

            const pagerHtml = this._generatePagerHtml(this.cachePage, totalPages);
            paginationDiv.innerHTML = pagerHtml;

            // 绑定分页点击事件
            paginationDiv.addEventListener('click', (e) => {
                const target = e.target;
                const pageItem = target.closest('.tsp-pager-item');
                if (!pageItem) return;

                const pageNum = parseInt(pageItem.dataset.page);
                const action = pageItem.dataset.action;

                if (action === 'quickprev') {
                    // 快速向前翻页：跳转到当前显示范围的起始位置
                    let targetPage = Math.max(1, this.cachePage - 6);
                    this._refreshCacheView(targetPage);
                } else if (action === 'quicknext') {
                    // 快速向后翻页：跳转到当前显示范围的结束位置
                    let targetPage = Math.min(totalPages, this.cachePage + 6);
                    this._refreshCacheView(targetPage);
                } else if (!isNaN(pageNum) && pageNum !== this.cachePage) {
                    this._refreshCacheView(pageNum);
                }
            });

            grid.appendChild(paginationDiv);
        }
    }

    /**
     *  切换缓存多选模式
     */
    _toggleCacheMultiSelect() {
        // 如果有选中项，点击按钮执行删除
        if (this.isCacheMultiSelectMode && this.selectedCacheImages.size > 0) {
            this._deleteSelectedCacheImages();
            return;
        }

        this.isCacheMultiSelectMode = !this.isCacheMultiSelectMode;

        // 更新按钮外观
        this._updateCacheMultiSelectButtonText();

        if (!this.isCacheMultiSelectMode) {
            // 退出模式时清空选中
            this.selectedCacheImages.clear();
        } else {
            this.ctx.helpers.showToast('进入多选模式，点击图片进行选择');
        }

        // 刷新视图应用样式
        this._refreshCacheView(this.cachePage);
    }

    /**
     *  更新多选按钮的文字和样式
     */
    _updateCacheMultiSelectButtonText() {
        const btn = this.modalEl.querySelector('#adv-cache-multi-select');
        //  获取下载按钮
        const downloadBtn = this.modalEl.querySelector('#adv-cache-download-selected');
        // 获取全选按钮
        const selectAllBtn = this.modalEl.querySelector('#adv-cache-select-all');
        // 获取其他需要隐藏的按钮
        const exportBtn = this.modalEl.querySelector('#adv-cache-export');
        const importBtn = this.modalEl.querySelector('#adv-cache-import');
        const downloadAllBtn = this.modalEl.querySelector('#adv-cache-download-all');

        if (!btn) return;

        if (this.isCacheMultiSelectMode) {
            // 显示下载按钮和全选按钮
            if (downloadBtn) downloadBtn.style.display = 'inline-flex';
            if (selectAllBtn) selectAllBtn.style.display = 'inline-flex';
            // 隐藏导出/导入/下载全部按钮
            if (exportBtn) exportBtn.style.display = 'none';
            if (importBtn) importBtn.style.display = 'none';
            if (downloadAllBtn) downloadAllBtn.style.display = 'none';

            const count = this.selectedCacheImages.size;
            if (count > 0) {
                btn.classList.add('tsp-btn-danger');
                btn.innerHTML = `<i class="fa-solid fa-trash"></i> <span class="tsp-btn-text">删除 (${count})</span>`;

                //  更新下载按钮文字
                if (downloadBtn) {
                    downloadBtn.innerHTML = `<i class="fa-solid fa-download"></i> <span class="tsp-btn-text">下载 (${count})</span>`;
                    downloadBtn.disabled = false;
                }
            } else {
                btn.classList.remove('tsp-btn-danger'); // 没选中时不是红色
                btn.innerHTML = `<i class="fa-solid fa-check-square"></i> <span class="tsp-btn-text">退出多选</span>`;

                //  没选中时禁用下载按钮
                if (downloadBtn) {
                    downloadBtn.innerHTML = `<i class="fa-solid fa-download"></i> <span class="tsp-btn-text">下载选中</span>`;
                    downloadBtn.disabled = true;
                }
            }
        } else {
            //  退出多选模式时隐藏下载按钮和全选按钮
            if (downloadBtn) downloadBtn.style.display = 'none';
            if (selectAllBtn) selectAllBtn.style.display = 'none';
            // 显示导出/导入/下载全部按钮
            if (exportBtn) exportBtn.style.display = 'inline-flex';
            if (importBtn) importBtn.style.display = 'inline-flex';
            if (downloadAllBtn) downloadAllBtn.style.display = 'inline-flex';

            btn.classList.remove('tsp-btn-danger');
            btn.innerHTML = `<i class="fa-solid fa-check-square"></i> <span class="tsp-btn-text">多选</span>`;
        }
    }

    /**
     *  全选当前页的所有缓存图片
     */
    _selectAllCacheImagesOnPage() {
        const grid = this.modalEl?.querySelector('#adv-cache-grid');
        if (!grid) return;

        const thumbElements = grid.querySelectorAll('.tsp-cache-thumb[data-id]');
        if (thumbElements.length === 0) {
            this.ctx.helpers.showToast('当前页面没有可选择的图片', 'info');
            return;
        }

        // 检查是否所有图片都已选中
        const allSelected = Array.from(thumbElements).every(el =>
            this.selectedCacheImages.has(parseInt(el.dataset.id, 10))
        );

        if (allSelected) {
            // 如果全部选中，则取消全选
            thumbElements.forEach(el => {
                const id = parseInt(el.dataset.id, 10);
                this.selectedCacheImages.delete(id);
            });
            this.ctx.helpers.showToast('已取消全选', 'info');
        } else {
            // 否则全选
            thumbElements.forEach(el => {
                const id = parseInt(el.dataset.id, 10);
                this.selectedCacheImages.add(id);
            });
            this.ctx.helpers.showToast(`已选中 ${thumbElements.length} 张图片`, 'success');
        }

        // 更新按钮文本和样式
        this._updateCacheMultiSelectButtonText();
        // 刷新视图以显示选中状态
        this._refreshCacheView(this.cachePage);
    }

    /**
     *  批量删除选中的缓存图片 (修复元数据残留版)
     */
    async _deleteSelectedCacheImages() {
        const count = this.selectedCacheImages.size;
        if (count === 0) return;

        const confirmed = await this.ctx.helpers.promptConfirm(
            `确定要删除选中的 ${count} 张图片吗？\n此操作将同时删除服务器文件和元数据记录，不可恢复。`
        );

        if (!confirmed) return;

        const imageGen = this.ctx.getModule('imageGen');
        if (!imageGen) return;

        this.ctx.helpers.showToast(`正在清理 ${count} 张图片及其元数据...`, 'info');

        const ids = Array.from(this.selectedCacheImages);

        try {
            // [修改点] 调用 imageGen 新增的批量接口
            // 这里的 await 会一直等到服务器 JSON 更新完毕才会继续执行
            await imageGen.deleteCachedImages(ids);

            this.ctx.helpers.showToast(`批量删除成功`, 'success');
        } catch (e) {
            this.ctx.error('settings-panel', '批量删除失败', e);
            this.ctx.helpers.showToast(`删除过程出现错误: ${e.message}`, 'error');
        }

        // 清空状态
        this.selectedCacheImages.clear();
        this.isCacheMultiSelectMode = false;
        this._updateCacheMultiSelectButtonText();

        // 刷新列表和统计
        // 此时去 syncFromServer，服务器返回的已经是删减后的干净数据了
        await this._refreshCacheView(this.cachePage);
        await this._refreshStorageStats();
    }


    /**
     * 生成类似 Element UI 的分页器 HTML
     * 显示6个可点击的页码，支持快速翻页
     * @param {number} currentPage - 当前页码
     * @param {number} totalPages - 总页数
     * @returns {string} 分页器 HTML
     */
    _generatePagerHtml(currentPage, totalPages) {
        const pagerItems = [];

        // 始终显示第一页
        if (currentPage > 3) {
            pagerItems.push(`<li class="tsp-pager-item number" data-page="1">1</li>`);

            // 如果当前页距离第一页较远，显示快速向前翻页按钮
            if (currentPage > 5) {
                pagerItems.push(`<li class="tsp-pager-item more btn-quickprev" data-action="quickprev"><i class="fa-solid fa-ellipsis"></i></li>`);
            }
        }

        // 计算要显示的页码范围（最多6个）
        let startPage = Math.max(1, currentPage - 2);
        let endPage = Math.min(totalPages, startPage + 5);

        // 如果末尾不够6个，向前调整
        if (endPage - startPage < 5) {
            startPage = Math.max(1, endPage - 5);
        }

        // 生成中间的页码
        for (let i = startPage; i <= endPage; i++) {
            const isActive = i === currentPage ? 'active' : '';
            pagerItems.push(`<li class="tsp-pager-item number ${isActive}" data-page="${i}">${i}</li>`);
        }

        // 显示最后一页和快速向后翻页按钮
        if (endPage < totalPages) {
            if (endPage < totalPages - 1) {
                pagerItems.push(`<li class="tsp-pager-item more btn-quicknext" data-action="quicknext"><i class="fa-solid fa-ellipsis"></i></li>`);
            }
            pagerItems.push(`<li class="tsp-pager-item number" data-page="${totalPages}">${totalPages}</li>`);
        }

        return `<ul class="tsp-pager">${pagerItems.join('')}</ul>`;
    }

    /**
     * 下载全部缓存图片（智能打包）
     * 1张直接下载，多张打包为ZIP，防止浏览器崩溃
     * [修改] 增加 specificList 参数兼容多选下载
     * @param {Array<{id: number}> | null} specificList - 指定要下载的图片列表，若为 null 则下载全部
     */
    async _downloadAllCacheImages(specificList = null) {
        const imageGen = this.ctx.getModule('imageGen');
        if (!imageGen?.getCacheMetadata) {
            this.ctx.helpers.showToast('缓存模块不可用', 'warning');
            return;
        }

        let metaItems = [];

        // 判断是下载选中列表还是下载全部
        if (Array.isArray(specificList) && specificList.length > 0) {
            // 模式 A: 下载选中的图片
            metaItems = specificList;
        } else {
            // 模式 B: 下载全部 (获取元数据，pageSize设大以获取所有)
            const meta = await imageGen.getCacheMetadata({ pageSize: 100000, page: 1 });
            metaItems = meta.items;
        }

        if (!metaItems || metaItems.length === 0) {
            this.ctx.helpers.showToast('没有可下载的图片', 'info');
            return;
        }

        // === 情况1：只有一张图片，直接下载 ===
        if (metaItems.length === 1) {
            const item = metaItems[0];
            const data = await imageGen.getCachedImage(item.id);

            let downloadHref = null;

            // 优先检查 imageData (Blob/Base64)
            if (data?.imageData) {
                if (data.imageData instanceof Blob) {
                    downloadHref = URL.createObjectURL(data.imageData);
                } else {
                    downloadHref = data.imageData;
                }
            }
            // 其次检查 serverPath (服务器文件)
            else if (data?.serverPath) {
                downloadHref = data.serverPath;
            }

            if (downloadHref) {
                const a = document.createElement('a');
                a.href = downloadHref;

                // 尝试推断扩展名
                let ext = 'png';
                if (typeof downloadHref === 'string') {
                    if (downloadHref.includes('.jpg') || downloadHref.includes('.jpeg')) ext = 'jpg';
                    else if (downloadHref.includes('.webp')) ext = 'webp';
                    else if (downloadHref.includes('.mp4')) ext = 'mp4';
                } else if (data.imageData instanceof Blob) {
                     if (data.imageData.type === 'image/jpeg') ext = 'jpg';
                     else if (data.imageData.type === 'image/webp') ext = 'webp';
                     else if (data.imageData.type === 'video/mp4') ext = 'mp4';
                }

                a.download = `tsp-img-${item.id}.${ext}`;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);

                // 如果是 Blob URL，延时释放
                if (typeof downloadHref === 'string' && downloadHref.startsWith('blob:')) {
                    setTimeout(() => URL.revokeObjectURL(downloadHref), 10000);
                }

                this.ctx.helpers.showToast('已下载图片', 'success');
            } else {
                this.ctx.helpers.showToast('图片数据丢失，无法下载', 'error');
            }
            return;
        }

        // === 情况2：多张图片，打包 ZIP ===
        try {
            this.ctx.helpers.showToast(`准备打包 ${metaItems.length} 张图片，正在从服务器获取数据...`, 'info');

            // 动态加载 JSZip (利用 ST 内置库)
            if (!window.JSZip) {
                await import('../../../../../lib/jszip.min.js');
            }
            // @ts-ignore
            const zip = new JSZip();
            const folder = zip.folder("tsp_images");

            let processedCount = 0;
            // 注意：这里已经不再依赖 meta.items，而是使用通用的 metaItems
            const total = metaItems.length;

            // 逐张处理，防止内存溢出和UI卡死
            for (const item of metaItems) {
                try {
                    const data = await imageGen.getCachedImage(item.id);
                    if (!data) continue;

                    let fileContent = null;
                    let ext = 'png'; // 默认后缀

                    // 1. 尝试从 imageData 获取 (Blob 或 Base64)
                    if (data.imageData) {
                        if (data.imageData instanceof Blob) {
                            fileContent = data.imageData;
                            // 从 Blob type 推断后缀
                            if (data.imageData.type === 'image/jpeg') ext = 'jpg';
                            else if (data.imageData.type === 'image/webp') ext = 'webp';
                            else if (data.imageData.type === 'video/mp4') ext = 'mp4';
                        } else if (typeof data.imageData === 'string') {
                            // Base64 字符串
                            const parts = data.imageData.split(',');
                            // 如果包含前缀，提取纯 Base64，否则直接使用
                            fileContent = parts.length > 1 ? parts[1] : data.imageData;

                            // 从前缀推断后缀
                            if (data.imageData.startsWith('data:image/jpeg')) ext = 'jpg';
                            else if (data.imageData.startsWith('data:image/webp')) ext = 'webp';
                            else if (data.imageData.startsWith('data:video/mp4')) ext = 'mp4';
                        }
                    }
                    // 2. 尝试从 serverPath 下载 (酒馆模式)
                    else if (data.serverPath) {
                        try {
                            // 确保路径正确
                            const fetchPath = data.serverPath.startsWith('/') ? data.serverPath : '/' + data.serverPath;
                            const resp = await fetch(fetchPath);
                            if (resp.ok) {
                                fileContent = await resp.blob(); //以此获取 Blob

                                // 从 Blob Type 推断后缀
                                const mime = fileContent.type;
                                if (mime === 'image/jpeg') ext = 'jpg';
                                else if (mime === 'image/webp') ext = 'webp';
                                else if (mime === 'video/mp4') ext = 'mp4';
                                else if (data.serverPath.endsWith('.jpg')) ext = 'jpg';
                                else if (data.serverPath.endsWith('.webp')) ext = 'webp';
                            } else {
                                console.warn(`下载服务器图片失败 [${item.id}]: ${resp.status}`);
                            }
                        } catch (err) {
                            console.warn(`请求服务器图片出错 [${item.id}]:`, err);
                        }
                    }

                    // 3. 添加到 ZIP
                    if (fileContent) {
                        // 如果是 Base64 字符串 (且不含头)
                        if (typeof fileContent === 'string') {
                             folder.file(`img-${item.id}.${ext}`, fileContent, { base64: true });
                        }
                        // 如果是 Blob (来自 fetch 或 imageData)
                        else if (fileContent instanceof Blob) {
                             folder.file(`img-${item.id}.${ext}`, fileContent);
                        }
                    }

                } catch (err) {
                    console.warn(`处理图片 ID ${item.id} 时发生错误`, err);
                }

                processedCount++;

                // 每处理 5 张，让出 CPU 时间，防止手机浏览器假死
                if (processedCount % 5 === 0) {
                    await new Promise(r => setTimeout(r, 10)); // 让出 10ms
                }
            }

            this.ctx.helpers.showToast('图片处理完成，正在生成压缩包...', 'info');

            // 生成 ZIP Blob
            const content = await zip.generateAsync({ type: "blob" });

            // 触发下载
            const url = URL.createObjectURL(content);
            const a = document.createElement('a');
            a.href = url;

            // 自动命名：如果是选中下载，文件名加 selected 标识
            const dateStr = new Date().toISOString().slice(0, 10);
            const filenamePrefix = specificList ? 'tsp-images-selected' : 'tsp-images-backup';
            a.download = `${filenamePrefix}-${dateStr}.zip`;

            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);

            // 延迟释放内存
            setTimeout(() => URL.revokeObjectURL(url), 10000);

            this.ctx.helpers.showToast('下载已开始', 'success');

        } catch (e) {
            this.ctx.error('settings-panel', '打包下载失败', e);
            this.ctx.helpers.showToast(`打包失败: ${e.message}`, 'error');
        }
    }

}
