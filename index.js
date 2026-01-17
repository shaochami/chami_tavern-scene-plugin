'use strict';



import { pluginContext } from './core/plugin-context.js';
import { EventTypes } from './core/event-bus.js';
import { StoreNames } from './core/db-manager.js';
import { PromptBuilder } from './core/prompt-builder.js';


import { TagDataSource } from './modules/tag-data-source.js';
import { CharacterDB } from './modules/character-db.js';
import { TagMarketUI } from './modules/tag-market-ui.js';
import { ImageGenerator } from './modules/image-gen.js';
import { ImageInteractionManager } from './modules/image-interaction.js';
import { patchImageGeneratorWithInteraction } from './modules/image-gen-interaction-patch.js';
import { IframeInteractionHandler } from './modules/iframe-interaction-handler.js';
import { SettingsPanel } from './modules/settings-panel.js';
import { FloatingButton } from './ui/floating-button.js';
import { AIProcessor } from './modules/ai-processor.js';
import { TriggerProcessor } from './modules/trigger-processor.js';
import { ExternalAPIHandler } from './modules/external-api.js';
import { DebugConsole } from './modules/debug-console.js'; //  引入
const EXTENSION_NAME = 'chami_tavern-scene-plugin';
const VERSION = '1.0.9';


// 添加延迟辅助函数 - 增加更智能的延迟策略
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// 根据设备性能调整延迟时间
const getDelayTime = (baseMs = 100) => {
    // 在移动设备上增加延迟
    const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
    return isMobile ? Math.max(baseMs * 2, 200) : baseMs;
};

async function initPlugin() {
    pluginContext.log(EXTENSION_NAME, `初始化开始 v${VERSION}`);

    try {
        // 1. 初始化核心上下文
        await pluginContext.init();
        const debugConsole = new DebugConsole(pluginContext);
        await debugConsole.init();
        pluginContext.registerModule('debugConsole', debugConsole);
        await delay(getDelayTime(50)); // 给浏览器喘息时间
        
        // 2. 按依赖顺序分批初始化模块，加入适当延迟避免阻塞
        // 第一批次：关键核心模块
        const tagData = new TagDataSource(pluginContext);
        await tagData.init();
        pluginContext.registerModule('tagData', tagData);
        await delay(getDelayTime(150)); // 给浏览器喘息时间

        const characterDB = new CharacterDB(pluginContext);
        await characterDB.init();
        pluginContext.registerModule('characterDB', characterDB);
        await delay(getDelayTime(150));

        const promptBuilder = new PromptBuilder(pluginContext);
        await promptBuilder.init();
        pluginContext.registerModule('promptBuilder', promptBuilder);
        await delay(getDelayTime(100));

        // 第二批次：UI相关模块
        const tagUI = new TagMarketUI(pluginContext);
        await tagUI.init();
        pluginContext.registerModule('tagUI', tagUI);
        await delay(getDelayTime(200));

        const aiProcessor = new AIProcessor(pluginContext);
        await aiProcessor.init();
        pluginContext.registerModule('aiProcessor', aiProcessor);
        await delay(getDelayTime(150));

        const triggerProcessor = new TriggerProcessor(pluginContext);
        await triggerProcessor.init();
        pluginContext.registerModule('triggerProcessor', triggerProcessor);
        await delay(getDelayTime(150));

        // 第三批次：图片生成相关模块
        patchImageGeneratorWithInteraction(ImageGenerator, ImageInteractionManager);
        
        const imageGen = new ImageGenerator(pluginContext);
        await imageGen.init();
        pluginContext.registerModule('imageGen', imageGen);
        await delay(getDelayTime(200));

        const externalApi = new ExternalAPIHandler(pluginContext);
        await externalApi.init();
        pluginContext.registerModule('externalApi', externalApi);
        await delay(getDelayTime(150));

        promptBuilder.setTargetGenerator(imageGen);

        const iframeInteraction = new IframeInteractionHandler(pluginContext);
        await iframeInteraction.init();
        pluginContext.registerModule('iframeInteraction', iframeInteraction);
        await delay(getDelayTime(150));

        // 第四批次：设置和UI交互模块
        const settingsPanel = new SettingsPanel(pluginContext);
        await settingsPanel.init();
        pluginContext.registerModule('settingsPanel', settingsPanel);
        await delay(getDelayTime(200));

        const floatingButton = new FloatingButton(pluginContext);
        await floatingButton.init();
        pluginContext.registerModule('floatingButton', floatingButton);
        
        // 检查悬浮球是否应该显示
        const fabVisible = await pluginContext.api.getValue('fab_visible', true);
        if (!fabVisible && floatingButton.container) {
            floatingButton.container.style.display = 'none';
        }
        await delay(getDelayTime(150));

        // 3. 暴露便捷入口到全局
        const win = /** @type {any} */ (window);
        win.TavernScenePlugin = {
            ...pluginContext,
            // 快捷方法
            openTagUI: () => pluginContext.events.emit(EventTypes.TAG_UI_OPEN),
            openCharacterDB: () => pluginContext.events.emit(EventTypes.CHARACTER_DB_OPEN),
            // 版本信息
            version: VERSION,
            name: EXTENSION_NAME,
        };

        // 4. 兼容层：为旧代码提供 ChatomiPlugins 接口
        setupCompatibilityLayer();
        await delay(getDelayTime(150));

        // 5. 挂载到 ST 扩展设置面板
        await mountToExtensionsSettings();

        pluginContext.log(EXTENSION_NAME, '初始化完成');
        pluginContext.helpers.showToast(`酒馆场景插件 v${VERSION} 已加载`, 'success');

    } catch (error) {
        pluginContext.error(EXTENSION_NAME, '初始化失败:', error);
        pluginContext.helpers.showToast(`插件初始化失败: ${error.message}`, 'error');
    }
}

/**
 * 设置兼容层 - 为旧代码提供 ChatomiPlugins 接口
 */
function setupCompatibilityLayer() {
    const win = /** @type {any} */ (window);
    const compat = win.ChatomiPlugins || {};

    // 标记主插件已初始化
    compat.isMainPluginInitialized = true;

    // 辅助工具
    compat.helpers = pluginContext.helpers;

    // 标签超市数据访问
    Object.defineProperty(compat, 'tagSupermarketData', {
        get: () => {
            const tagData = pluginContext.getModule('tagData');
            return tagData?.getStaticData() || {};
        }
    });

    // 标签超市UI
    compat.TagSupermarket = {
        openTagsSupermarketModal: () => pluginContext.events.emit(EventTypes.TAG_UI_OPEN),
    };

    // 角色数据库
    compat.CharacterDB = {
        openCharacterDatabaseModal: () => pluginContext.events.emit(EventTypes.CHARACTER_DB_OPEN),
        getAllRoles: async () => {
            const charDB = pluginContext.getModule('characterDB');
            return charDB?.getAllRoles() || [];
        },
        getRoleById: async (id) => {
            const charDB = pluginContext.getModule('characterDB');
            return charDB?.getRoleById(id);
        },
        getEnabledSimpleModeCharactersData: async () => {
            const charDB = pluginContext.getModule('characterDB');
            return charDB?.getEnabledSimpleModeCharactersData() || '';
        },
        getMatchingSimpleModeCharactersData: async (prompt) => {
            const charDB = pluginContext.getModule('characterDB');
            return charDB?.getMatchingSimpleModeCharactersData(prompt) || '';
        },
    };

    // AI 后处理器
    compat.AIPostProcessor = {
        openAIPostProcessingModal: async () => {
            // 动态加载 AI 设置模态框
            try {
                const { AISettingsModal } = await import('./ui/ai-settings-modal.js');
                const modal = new AISettingsModal(pluginContext);
                await modal.open();
            } catch (e) {
                pluginContext.error(EXTENSION_NAME, '打开 AI 设置失败:', e);
                pluginContext.helpers.showToast('打开 AI 设置失败', 'error');
            }
        },
        processPromptWithAI: async (userInput) => {
            const aiProcessor = pluginContext.getModule('aiProcessor');
            if (aiProcessor) {
                return aiProcessor.processPromptWithAI(userInput);
            }
            return userInput;
        },
        processCharacterGeneration: async (userInput) => {
            const aiProcessor = pluginContext.getModule('aiProcessor');
            if (aiProcessor) {
                return aiProcessor.processCharacterGeneration(userInput);
            }
            throw new Error('AI 处理器未初始化');
        },
        isBatchingEnabled: async () => {
            const aiProcessor = pluginContext.getModule('aiProcessor');
            return aiProcessor ? await aiProcessor.isBatchingEnabled() : false;
        },
        handleAutoClickBatch: async (buttons) => {
            const aiProcessor = pluginContext.getModule('aiProcessor');
            if (aiProcessor) {
                await aiProcessor.handleBatchTasks(buttons);
            }
        },
        flushBatchQueue: async (force = false) => {
            const aiProcessor = pluginContext.getModule('aiProcessor');
            if (aiProcessor) {
                await aiProcessor.flushBatchQueue(force);
            }
        },
    };

    // 主生成器管理
    compat.Main = {
        GeneratorManager: {
            generate: async (buttonEl, isModalCall = false) => {
                const imageGen = pluginContext.getModule('imageGen');
                if (imageGen) {
                    return imageGen.generate(buttonEl, isModalCall);
                }
                throw new Error('ImageGenerator module not initialized');
            }
        }
    };

    win.ChatomiPlugins = compat;
    pluginContext.log(EXTENSION_NAME, '兼容层设置完成');
}

/**
 * 挂载到 SillyTavern 扩展设置面板
 */
async function mountToExtensionsSettings() {
    const win = /** @type {any} */ (window);
    const $ = win.jQuery;
    if (!$) {
        pluginContext.log(EXTENSION_NAME, 'jQuery 不可用，跳过面板挂载');
        return;
    }

    // 等待 DOM 就绪
    await new Promise(resolve => {
        if (document.readyState === 'complete') {
            resolve();
        } else {
            $(document).ready(resolve);
        }
    });

    const $container = $('#extensions_settings');
    if ($container.length === 0) {
        pluginContext.log(EXTENSION_NAME, '#extensions_settings 未找到');
        return;
    }

    // 防止重复挂载
    if ($container.find('#tsp-ext-container').length > 0) {
        return;
    }

    // 尝试使用官方模板
    const renderTemplate = win.renderExtensionTemplateAsync;
    if (typeof renderTemplate === 'function') {
        try {
            const template = await renderTemplate(EXTENSION_NAME, 'window', {});
            const $html = $(template);
            bindPanelEvents($html);
            $container.append($html);
            pluginContext.log(EXTENSION_NAME, '已通过模板挂载到设置面板');
            return;
        } catch (e) {
            pluginContext.log(EXTENSION_NAME, '模板加载失败，使用回退方案');
        }
    }

    // 回退方案：手动创建 DOM
    const $wrapper = $(`
        <div id="tsp-ext-container">
            <div class="inline-drawer">
                <div class="inline-drawer-toggle inline-drawer-header">
                    <b>酒馆场景插件 <small style="opacity: 0.6;">v${VERSION}</small></b>
                    <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
                </div>
                <div class="inline-drawer-content">
                    <div class="flex-container flexFlowColumn" style="gap: 8px; padding: 8px 0;">
                        <small class="notes">标签超市 / 角色数据库 / AI处理 / 文生图</small>
                        <div class="flex-container" style="gap: 8px; flex-wrap: wrap;">
                            <div id="tsp-open-tag" class="menu_button menu_button_icon" title="打开标签超市">
                                <i class="fa-solid fa-tags"></i>
                                <span>标签超市</span>
                            </div>
                            <div id="tsp-open-char" class="menu_button menu_button_icon" title="打开角色数据库">
                                <i class="fa-solid fa-users"></i>
                                <span>角色数据库</span>
                            </div>
                            <div id="tsp-open-ai" class="menu_button menu_button_icon" title="AI后处理设置">
                                <i class="fa-solid fa-robot"></i>
                                <span>AI处理</span>
                            </div>
                            <div id="tsp-open-settings" class="menu_button menu_button_icon" title="插件设置">
                                <i class="fa-solid fa-gear"></i>
                                <span>设置</span>
                            </div>
                        </div>
                        <hr>
                        <div class="flex-container" style="gap: 8px;">
                            <div id="tsp-export-data" class="menu_button menu_button_icon" title="导出所有数据">
                                <i class="fa-solid fa-download"></i>
                                <span>导出数据</span>
                            </div>
                            <div id="tsp-import-data" class="menu_button menu_button_icon" title="导入数据">
                                <i class="fa-solid fa-upload"></i>
                                <span>导入数据</span>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    `);

    bindPanelEvents($wrapper);
    $container.append($wrapper);
    pluginContext.log(EXTENSION_NAME, '已通过回退方案挂载到设置面板');
}

/**
 * 绑定面板事件
 */
function bindPanelEvents($panel) {
    $panel.find('#tsp-open-tag').on('click', () => {
        pluginContext.events.emit(EventTypes.TAG_UI_OPEN);
    });

    $panel.find('#tsp-open-char').on('click', () => {
        pluginContext.events.emit(EventTypes.CHARACTER_DB_OPEN);
    });

    $panel.find('#tsp-open-ai').on('click', async () => {
        // 打开 AI 后处理器专用设置面板
        try {
            const { AISettingsModal } = await import('./ui/ai-settings-modal.js');
            const modal = new AISettingsModal(pluginContext);
            await modal.open();
        } catch (e) {
            pluginContext.error(EXTENSION_NAME, '打开 AI 设置失败:', e);
            pluginContext.helpers.showToast('打开 AI 设置失败', 'error');
        }
    });

    $panel.find('#tsp-open-settings').on('click', () => {

        const settingsPanel = pluginContext.getModule('settingsPanel');
        if (settingsPanel) {
            settingsPanel.open();
        } else {
            pluginContext.helpers.showToast('设置面板未初始化', 'error');
        }
    });

    $panel.find('#tsp-export-data').on('click', async () => {
        try {
            const data = await pluginContext.db.exportAll();
            const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `tavern-scene-backup-${new Date().toISOString().slice(0,10)}.json`;
            a.click();
            URL.revokeObjectURL(url);
            pluginContext.helpers.showToast('数据导出成功！', 'success');
        } catch (e) {
            pluginContext.helpers.showToast(`导出失败: ${e.message}`, 'error');
        }
    });

    $panel.find('#tsp-import-data').on('click', () => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.json';
        input.onchange = async (e) => {
            const target = /** @type {HTMLInputElement} */ (e.target);
            const file = target.files?.[0];
            if (!file) return;

            try {
                const text = await file.text();
                const data = JSON.parse(text);
                const stats = await pluginContext.db.importAll(data);
                pluginContext.helpers.showToast(
                    `导入完成！成功: ${stats.imported}, 跳过: ${stats.skipped}, 错误: ${stats.errors}`,
                    stats.errors > 0 ? 'warning' : 'success'
                );
            } catch (e) {
                pluginContext.helpers.showToast(`导入失败: ${e.message}`, 'error');
            }
        };
        input.click();
    });
}

/**
 * 卸载清理
 */
async function unloadPlugin() {
    pluginContext.log(EXTENSION_NAME, '开始卸载...');

    try {
        await pluginContext.cleanup();

        // 移除 DOM
        const container = document.getElementById('tsp-ext-container');
        if (container) container.remove();

        // 清理全局引用
        const win = /** @type {any} */ (window);
        delete win.TavernScenePlugin;

        pluginContext.log(EXTENSION_NAME, '卸载完成');
    } catch (e) {
        pluginContext.error(EXTENSION_NAME, '卸载出错:', e);
    }
}

// ==================== 启动 ====================

// 自动初始化
(async function bootstrap() {
    // 等待 ST 环境就绪
    if (typeof SillyTavern === 'undefined') {
        // 不在 ST 环境中，延迟重试
        setTimeout(bootstrap, 500);
        return;
    }

    // 获取 ST 的事件系统
    const win = /** @type {any} */ (window);
    const eventSource = win.eventSource;
    const event_types = win.event_types;

    // 检查 extension_settings 是否已经加载
    const extension_settings = win.extension_settings;
    const isSettingsLoaded = extension_settings && Object.keys(extension_settings).length > 0;

    if (isSettingsLoaded) {
        // 设置已加载，直接初始化
        pluginContext.log(EXTENSION_NAME, 'extension_settings 已加载，开始初始化');
        await initPlugin();
    } else if (eventSource && event_types) {
        // 等待 EXTENSION_SETTINGS_LOADED 事件
        pluginContext.log(EXTENSION_NAME, '等待 extension_settings 加载...');
        eventSource.once(event_types.EXTENSION_SETTINGS_LOADED, async () => {
            pluginContext.log(EXTENSION_NAME, 'extension_settings 加载完成，开始初始化');
            await initPlugin();
        });

        // 设置超时，防止事件永远不触发
        setTimeout(async () => {
            if (!win.TavernScenePlugin) {
                pluginContext.log(EXTENSION_NAME, '等待超时，强制初始化');
                await initPlugin();
            }
        }, 5000);
    } else {
        // 回退：直接初始化
        pluginContext.log(EXTENSION_NAME, '无法获取事件系统，直接初始化');
        await initPlugin();
    }
})();

// 暴露卸载方法供 ST 调用
/** @type {any} */ (window).TavernScenePluginUnload = unloadPlugin;