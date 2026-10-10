'use strict';
import { world_names, loadWorldInfo, saveWorldInfo, createWorldInfoEntry, checkWorldInfo, getSortedEntries } from '../../../../world-info.js';

import { getTokenCountAsync } from '../../../../tokenizers.js';
import { chat ,getRequestHeaders, saveChat} from '../../../../../script.js';
import { getRegexedString, regex_placement } from '../../../../extensions/regex/engine.js';


export class AISettingsModal {
    constructor(context) {
        this.ctx = context;
        this.modalEl = null;
        this.isOpen = false;
        this.currentPreset = null;
        this.worldBookPreviewVisible = false;
        this._tempOriginalFeatures = '';


        this.elements = {};
    }

    /**
     * 等待数据同步完成
     * 解决无痕浏览模式下数据还未从服务器同步完成就打开面板的问题
     */
    async _waitForDataSync() {
        const maxWaitTime = 10000; // 最多等待10秒
        const checkInterval = 200; // 检查间隔
        const startTime = Date.now();

        return new Promise((resolve) => {
            const check = () => {
                // 检查是否有数据（预设列表不为空即为同步完成）
                const presets = this.aiProcessor.settings?.presets || [];

                if (presets.length > 0) {
                    this.ctx.log('ai-settings', '数据同步已完成，预设数量:', presets.length);
                    resolve();
                    return;
                }

                // 超时检查
                if (Date.now() - startTime >= maxWaitTime) {
                    this.ctx.log('ai-settings', '数据同步等待超时，继续打开面板');
                    resolve();
                    return;
                }

                // 继续等待
                setTimeout(check, checkInterval);
            };

            check();
        });
    }

    async open() {
        if (this.isOpen) return;
        this.isOpen = true;

        this.aiProcessor = this.ctx.getModule('aiProcessor');
        if (!this.aiProcessor) {
            this.ctx.helpers.showToast('AI 处理器未初始化', 'error');
            this.isOpen = false;
            return;
        }

        try {
            // 等待数据同步完成（最多等待10秒）
            await this._waitForDataSync();

            // 获取最新预设列表
            this.allPresets = await this.aiProcessor.getAllPresets() || [];

            // ▼▼▼ 核心修复：优先通过【开关状态】判断谁是当前预设 ▼▼▼

            // 1. 寻找事实上的激活预设 (无论是"主启用"还是"聊天插入启用")
            const activeByFlag = this.allPresets.find(p => p.isEnabled === true || p.enableForChatInsertion === true);

            // 2. 寻找历史记录的名称 (作为兜底)
            const activeByName = this.aiProcessor.settings.activePresetName
                ? this.allPresets.find(p => p.name === this.aiProcessor.settings.activePresetName)
                : null;

            if (activeByFlag) {
                // 如果找到了开了开关的预设，它就是王道 (解决您的问题)
                this.currentPreset = activeByFlag;
                // 同时修正 settings 里的记录，保持同步
                if (this.aiProcessor.settings.activePresetName !== activeByFlag.name) {
                    this.aiProcessor.settings.activePresetName = activeByFlag.name;
                    // 不需要 await save，只更新内存即可，下次保存时会自动同步
                }
            } else if (activeByName) {
                // 如果都没开开关，但有历史记录，选历史记录
                this.currentPreset = activeByName;
            } else if (this.allPresets.length > 0) {
                // 啥都没有，默认选第一个
                this.currentPreset = this.allPresets[0];
            } else {
                // 列表为空，创建默认
                const defaultPreset = {
                    name: '默认预设',
                    isEnabled: false,
                    enableForChatInsertion: false,
                    apiUrl: '',
                    apiKey: '',
                    model: 'gpt-4o-mini',
                    temperature: 0.45,
                    maxTokens: 8192,
                    stream: false,
                    systemPrompt: '',
                    userPrompt: '',
                    targetFeatures: '',
                    useWorldBook: false,
                    worldBookNames: [],
                };
                await this.aiProcessor.addOrUpdatePreset(defaultPreset);
                this.allPresets = [defaultPreset];
                this.currentPreset = defaultPreset;
            }
            // ▲▲▲ 修复结束 ▲▲▲

            // 渲染 UI
            this.render();
            this.bindEvents();

            // 确保下拉框的值与计算出的 currentPreset 一致
            if (this.elements.presetSelect && this.currentPreset) {
                this.elements.presetSelect.value = this.currentPreset.name;
            }

            // 加载数据到面板
            await this.loadPresetToUI(this.currentPreset);

            // 显示模态框
            requestAnimationFrame(() => {
                if (this.modalEl) {
                    this.modalEl.classList.add('visible');
                }
            });
        } catch (e) {
            this.ctx.error('ai-settings', '打开 AI 设置失败:', e);
            this.ctx.helpers.showToast('打开 AI 设置失败: ' + e.message, 'error');
            this.isOpen = false;
        }
    }


    close() {
        if (!this.isOpen) return;
        this.isOpen = false;

        if (this.modalEl) {
            this.modalEl.classList.remove('visible');
            setTimeout(() => {
                if (this.modalEl) {
                    this.modalEl.remove();
                    this.modalEl = null;
                }
            }, 200);
        }
    }


    render() {
        const overlay = document.createElement('div');
        overlay.className = 'tsp-modal-overlay';
        overlay.id = 'ai-settings-modal-overlay';

        overlay.innerHTML = `
            <div class="tsp-modal tsp-modal-large">
                <div class="tsp-modal-header">
                    <div class="tsp-modal-title">
                        <i class="fa-solid fa-robot"></i>
                        AI 提示词后处理设置
                    </div>
                    <button class="tsp-btn tsp-btn-icon" id="ai-settings-close" title="关闭">
                        <i class="fa-solid fa-times"></i>
                    </button>
                </div>

                <div class="tsp-modal-body">
                    <div class="ai-settings-layout">
                        <!-- 左侧导航 -->
                        <nav class="ai-settings-nav">
                            <ul>
                                <li class="active" data-panel="preset">
                                    <i class="fa-solid fa-sliders"></i>
                                    <span>预设配置</span>
                                </li>
                                <li data-panel="worldbook">
                                    <i class="fa-solid fa-book"></i>
                                    <span>世界书</span>
                                </li>
                                <li data-panel="tokenstats">
                                    <i class="fa-solid fa-chart-pie"></i>
                                    <span>Token 统计</span>
                                </li>

                                <li data-panel="tagref">
                                    <i class="fa-solid fa-images"></i>
                                    <span>Tag 参考</span>
                                </li>
                                <!--  聊天插入入口 -->
                                <li data-panel="chatinsertion">
                                    <i class="fa-solid fa-comments"></i>
                                    <span>聊天插入</span>
                                </li>
                                <!--  漫画模式入口 -->
                                <li data-panel="comicmode">
                                    <i class="fa-solid fa-book-open"></i>
                                    <span>漫画模式</span>
                                </li>
                                <!--  实时数据入口 -->
                                <li data-panel="realtime">
                                    <i class="fa-solid fa-database"></i>
                                    <span>实时数据</span>
                                </li>
                                <li data-panel="regex">
                                    <i class="fa-solid fa-code"></i>
                                    <span>正则规则</span>
                                </li>
                                <li data-panel="advanced">
                                    <i class="fa-solid fa-cog"></i>
                                    <span>高级选项</span>
                                </li>
                                <li data-panel="helpnav" id="ai-helpnav-tab">
                                    <i class="fa-solid fa-circle-question"></i>
                                    <span>帮助导航</span>
                                    <span class="ai-tab-badge" id="ai-helpnav-badge" style="display:none;">!</span>
                                </li>
                            </ul>
                        </nav>

                        <!-- 右侧内容区 -->
                        <div class="ai-settings-content">
                            <!-- 预设配置面板 -->
                            <div class="ai-content-panel active" data-panel="preset">
                                ${this._renderPresetPanel()}
                            </div>

                            <!-- 世界书面板 -->
                            <div class="ai-content-panel" data-panel="worldbook">
                                ${this._renderWorldBookPanel()}
                            </div>

                            <!-- Token 统计面板 -->
                            <div class="ai-content-panel" data-panel="tokenstats">
                                ${this._renderTokenStatsPanel()}
                            </div>


                            <!-- Tag 参考面板 -->
                            <div class="ai-content-panel" data-panel="tagref">
                                ${this._renderTagRefPanel()}
                            </div>

                            <!--  聊天插入面板 -->
                            <div class="ai-content-panel" data-panel="chatinsertion">
                                ${this._renderChatInsertionPanel()}
                            </div>

                            <!--  漫画模式面板 -->
                            <div class="ai-content-panel" data-panel="comicmode">
                                ${this._renderComicModePanel()}
                            </div>

                            <!--  实时数据面板 -->
                            <div class="ai-content-panel" data-panel="realtime">
                                ${this._renderRealtimeDataPanel()}
                            </div>

                            <!-- 正则规则面板 -->
                            <div class="ai-content-panel" data-panel="regex">
                                ${this._renderRegexPanel()}
                            </div>

                            <!-- 高级选项面板 -->
                            <div class="ai-content-panel" data-panel="advanced">
                                ${this._renderAdvancedPanel()}
                            </div>
                            <!-- 帮助导航面板 -->
                            <div class="ai-content-panel" data-panel="helpnav">
                                ${this._renderHelpNavPanel()}
                            </div>
                        </div>
                    </div>
                </div>

                <div class="tsp-modal-footer">
                    <button class="tsp-btn" id="ai-settings-test">
                        <i class="fa-solid fa-plug"></i> 测试连接
                    </button>
                    <button class="tsp-btn tsp-btn-primary" id="ai-settings-save">
                        <i class="fa-solid fa-save"></i> 保存配置
                    </button>
                </div>
            </div>
        `;

        document.body.appendChild(overlay);
        this.modalEl = overlay;

        // 缓存元素引用
        this._cacheElements();
    }

    /**
     * 渲染预设配置面板
     */
    _renderPresetPanel() {
        return `
            <div class="ai-settings-section">
                <div class="ai-preset-header">
                    <div class="tsp-form-group" style="flex: 1;">
                        <label>当前预设</label>
                        <select class="tsp-input" id="ai-preset-select">
                            ${this.allPresets.map(p =>
                                `<option value="${p.name}" ${p.isEnabled ? 'selected' : ''}>${p.name}</option>`
                            ).join('')}
                        </select>
                    </div>
                    <div class="ai-preset-actions">
                        <button class="tsp-btn tsp-btn-sm" id="ai-preset-new" title="新建预设">
                            <i class="fa-solid fa-plus"></i>
                        </button>
                        <button class="tsp-btn tsp-btn-sm" id="ai-preset-delete" title="删除预设">
                            <i class="fa-solid fa-trash"></i>
                        </button>
                        <button class="tsp-btn tsp-btn-sm" id="ai-preset-export" title="导出预设">
                            <i class="fa-solid fa-download"></i>
                        </button>
                        <button class="tsp-btn tsp-btn-sm" id="ai-preset-import" title="导入预设">
                            <i class="fa-solid fa-upload"></i>
                        </button>
                    </div>
                </div>

                <div class="tsp-form-group">
                    <label>
                        <input type="checkbox" id="ai-enabled">
                        <span>启用此预设</span>
                    </label>
                </div>
                <div class="tsp-form-group">
                    <label>
                        <input type="checkbox" id="ai-enable-for-tag-supermarket">
                        <span>标签超市预设</span>
                    </label>
                    <div class="tsp-form-hint">勾选后，标签超市的“生成图片”按钮将使用此预设进行AI二次处理。</div>
                </div>

                <!-- ▼▼▼ 新增代码 ▼▼▼ -->
                <div class="tsp-form-group">
                    <label>
                        <input type="checkbox" id="ai-enable-for-chat-insertion">
                        <span>聊天插入预设</span>
                    </label>
                    <div class="tsp-form-hint">勾选后，消息旁的“AI魔棒”按钮将使用此预设进行内容生成。</div>
                </div>
                <div class="tsp-form-group">
                    <label>
                        <input type="checkbox" id="ai-chat-insertion-use-tavern-proxy">
                        <span>使用酒馆代理</span>
                    </label>
                    <div class="tsp-form-hint">开启后聊天插入请求直接走酒馆后端代理（/api/backends/chat-completions/generate）；关闭时使用浏览器直连，失败不回退。默认开启。</div>
                </div>
                <!-- ▲▲▲ 新增代码结束 ▲▲▲ -->
            </div>

            <div class="ai-settings-section">
                <h4>API 配置</h4>
                <div class="tsp-form-group">
                    <label>API 地址</label>
                    <input type="text" class="tsp-input" id="ai-api-url"
                           placeholder="http://localhost:1234/v1">
                </div>
                <div class="tsp-form-group">
                    <label>API Key (可选)</label>
                    <input type="password" class="tsp-input" id="ai-api-key"
                           placeholder="sk-...">
                </div>
                <div class="tsp-form-group">
                    <label>模型</label>
                    <div class="tsp-input-group">
                        <input type="text" class="tsp-input" id="ai-model"
                               placeholder="gpt-3.5-turbo">
                        <button class="tsp-btn" id="ai-fetch-models" title="获取模型列表">
                            <i class="fa-solid fa-refresh"></i>
                        </button>
                    </div>
                </div>
                <div class="tsp-form-row">
                    <div class="tsp-form-group">
                        <label>温度 (Temperature)</label>
                        <input type="number" class="tsp-input" id="ai-temperature"
                               min="0" max="2" step="0.01" value="0.45">
                    </div>
                    <div class="tsp-form-group">
                        <label>Token 上限 (Max Tokens)</label>
                        <input type="number" class="tsp-input" id="ai-max-tokens"
                               min="1" step="1" value="8192">
                    </div>
                    <div class="tsp-form-group">
                        <label>流式输出 (Stream)</label>
                        <div style="display: flex; align-items: center; height: 38px;">
                            <input type="checkbox" class="tsp-switch" id="ai-stream" style="margin: 0;">
                            <span id="ai-stream-label" style="margin-left: 10px; font-size: 0.9em; color: var(--tsp-text-muted);">关闭</span>
                        </div>
                    </div>
                </div>
            </div>

            <div class="ai-settings-section">
                <h4>提示词模板</h4>
                <div class="tsp-form-group">
                    <label>System Prompt</label>
                    <textarea class="tsp-input tsp-textarea-lg" id="ai-system-prompt" rows="8"
                              placeholder="系统提示词..."></textarea>
                    <div class="tsp-form-hint">
                        可用变量: {story_context}, {character_data}, {原始提示}, {character_prompt}, {target_features}
                    </div>
                </div>
                <div class="tsp-form-group">
                    <label>角色提示词 (User Prompt)</label>
                    <textarea class="tsp-input" id="ai-user-prompt" rows="3"
                              placeholder="角色特征标签..."></textarea>
                </div>
                <div class="tsp-form-group">
                    <label>
                        目标功能 / 世界书内容
                        <button class="tsp-btn tsp-btn-sm" id="ai-toggle-worldbook-preview" style="margin-left: 8px;">
                            <i class="fa-solid fa-eye"></i> 预览世界书
                        </button>
                    </label>
                    <textarea class="tsp-input tsp-textarea-lg" id="ai-target-features" rows="6"
                              placeholder="功能描述或世界书内容..."></textarea>
                </div>
            </div>
        `;
    }


    _renderWorldBookPanel() {
        return `
            <div class="ai-settings-section">
                <div class="ai-worldbook-header">
                    <h4>世界书管理</h4>
                    <div class="ai-worldbook-actions">
                        <button class="tsp-btn tsp-btn-sm tsp-btn-primary" id="ai-worldbook-import" title="导入新的世界书">
                            <i class="fa-solid fa-file-import"></i> 导入
                        </button>
                    </div>
                </div>
                <div class="tsp-form-group" style="background: var(--tsp-bg-input); padding: 10px; border-radius: 4px; margin-bottom: 15px; border: 1px solid var(--tsp-border);">
                    <label>从 ST 原生系统克隆世界书</label>
                    <div class="tsp-input-group">
                        <select class="tsp-input" id="ai-clone-native-wi-select">
                            <option value="">加载中...</option>
                        </select>
                        <button class="tsp-btn tsp-btn-success" id="ai-clone-native-btn" title="克隆并保存到插件数据库">
                            <i class="fa-solid fa-plus"></i> 克隆到插件
                        </button>
                    </div>
                    <div class="tsp-form-hint">选择左侧列表，点击 "+" 将 ST 原生世界书的全部内容复制一份存入插件，使其可以被 AI 独立调用。</div>
                </div>
                <div class="tsp-form-group">
                    <label class="tsp-switch-label">
                        <input type="checkbox" class="tsp-switch" id="ai-use-worldbook">
                        <span class="tsp-switch-slider"></span>
                        <span>启用世界书模式</span>
                    </label>
                    <div class="tsp-form-hint">启用后，下方的世界书组合将作为内容填入到 {target_features}。</div>
                </div>

                <div class="tsp-form-group">
                    <label>当前预设使用的世界书组合 (点击 "x" 移除)</label>
                    <div id="ai-worldbook-selected" class="ai-worldbook-selected-container">
                        <!-- JS 动态填充已选择的书籍 -->
                    </div>
                </div>

                <div class="tsp-form-group">
                    <label>所有可用的世界书 (点击添加到上方组合)</label>
                    <div id="ai-worldbook-list" class="ai-worldbook-list">
                        <!-- JS 动态填充所有世界书列表 -->
                    </div>
                </div>
            </div>

            <!--  傻瓜模式数据预览区 -->
            <div class="ai-settings-section" style="margin-top: 16px;">
                <h4><i class="fa-solid fa-robot"></i> 傻瓜模式数据预览</h4>
                <div class="tsp-form-hint">当前所有已启用“傻瓜模式”的角色数据将显示在此处，供AI参考。</div>
                <pre id="ai-simple-mode-preview" class="tsp-code-block"></pre>
            </div>
        `;
    }
    /**
     * [新增] 渲染 Token 统计面板的 HTML 结构
     */
    _renderTokenStatsPanel() {
        return `
            <div class="ai-settings-section">
                <div class="ai-worldbook-header">
                    <h4><i class="fa-solid fa-chart-simple"></i> Token 使用统计</h4>
                    <div class="ai-worldbook-actions">
                        <button class="tsp-btn tsp-btn-sm" id="ai-tokenstats-refresh" title="刷新统计">
                            <i class="fa-solid fa-sync"></i> 刷新
                        </button>
                    </div>
                </div>
                <div class="tsp-form-hint" style="margin-bottom: 15px;">
                    此处统计仅为估算值，用于评估当前配置的开销。
                </div>

                <!-- 区域 1：插件聊天插入统计 -->
                <div style="background: rgba(122, 162, 247, 0.05); border: 1px solid var(--tsp-accent-primary); border-radius: 6px; padding: 10px; margin-bottom: 15px;">
                    <h5 style="margin: 0 0 10px 0; color: var(--tsp-accent-primary); font-size: 14px; border-bottom: 1px solid rgba(122, 162, 247, 0.2); padding-bottom: 5px;">
                        📊 区域一：插件世界书 (聊天插入模式)
                    </h5>
                    <div id="ai-stats-plugin-container">
                        <div class="tsp-form-hint">正在计算插件环境下的 Token 开销...</div>
                    </div>
                </div>

                <!-- 区域 2：原生聊天统计 -->
                <div style="background: rgba(158, 206, 106, 0.05); border: 1px solid var(--tsp-accent-green); border-radius: 6px; padding: 10px;">
                    <h5 style="margin: 0 0 10px 0; color: var(--tsp-accent-green); font-size: 14px; border-bottom: 1px solid rgba(158, 206, 106, 0.2); padding-bottom: 5px;">
                        📊 区域二：原生世界书 (当前聊天环境)
                    </h5>
                    <!-- 2.1 聊天记录统计 -->
                    <div id="ai-stats-chat-container" style="margin-bottom: 10px; padding-bottom: 10px; border-bottom: 1px dashed rgba(158, 206, 106, 0.2);">
                        <div class="tsp-form-hint"><i class="fa-solid fa-comments"></i> 正在分析聊天记录...</div>
                    </div>
                    <!-- 2.2 世界书统计 -->
                    <div id="ai-stats-native-container">
                        <div class="tsp-form-hint"><i class="fa-solid fa-book"></i> 正在扫描原生世界书触发情况...</div>
                    </div>
                </div>
            </div>
        `;
    }

    /**
     * [新增] 执行 Token 统计的核心逻辑
     */
    async _updateTokenStats() {
        // 绑定刷新按钮事件（防止重复绑定，先解绑）
        const refreshBtn = this.modalEl.querySelector('#ai-tokenstats-refresh');
        if (refreshBtn) {
            refreshBtn.replaceWith(refreshBtn.cloneNode(true)); // 快速清除所有监听器
            this.modalEl.querySelector('#ai-tokenstats-refresh').addEventListener('click', () => this._updateTokenStats());
        }

        const pluginContainer = this.modalEl.querySelector('#ai-stats-plugin-container');
        const chatContainer = this.modalEl.querySelector('#ai-stats-chat-container');
        const nativeContainer = this.modalEl.querySelector('#ai-stats-native-container');

        const loadingHtml = '<div class="tsp-form-hint"><i class="fa-solid fa-spinner fa-spin"></i> 计算中...</div>';
        pluginContainer.innerHTML = loadingHtml;
        chatContainer.innerHTML = loadingHtml;
        nativeContainer.innerHTML = loadingHtml;

        // ==========================
        // 区域一：插件世界书统计
        // ==========================
        try {
            // [关键修改] 1. 临时应用 UI 上的“聊天插入深度”设置，以便实时预览
            const originalDepth = this.aiProcessor.settings.chatInsertionDepth; // 备份原设置
            const uiDepth = parseInt(this.elements.chatInsertionDepth.value) || 5; // 获取UI当前值
            this.aiProcessor.settings.chatInsertionDepth = uiDepth; // 临时覆盖

            // 2. 获取聊天插入的上下文（直接使用 chat 数组，不依赖 DOM）
            let historyText = "";
            let currentText = "";
            let currentTextRaw = "";
            let consistencyText = "";

            if (chat && chat.length > 0) {
                const lastMesIndex = chat.length - 1;
                const lastMesEl = document.querySelector(`#chat .mes[mesid="${lastMesIndex}"]`);

                if (lastMesEl) {
                    const contextObj = this.aiProcessor.getChatInsertionContext(lastMesEl);
                    historyText = contextObj.history || "";
                    currentText = contextObj.current || "";
                    currentTextRaw = contextObj.currentRaw || contextObj.current || "";
                    consistencyText = contextObj.consistency || "";
                }
            }

            // 3. 恢复设置
            this.aiProcessor.settings.chatInsertionDepth = originalDepth;

            if (historyText || currentText) {
                // 4. 计算文本 Token (历史记录通常由 AIProcessor 预处理完成，直接算即可)
                let historyTokens = await getTokenCountAsync(historyText);
                const currentTokensProc = await getTokenCountAsync(currentText);
                const currentTokensRaw = await getTokenCountAsync(currentTextRaw);

                // 5. 检查一致性设置并计算一致性内容的token
                const useConsistency = this.aiProcessor.settings.chatInsertionConsistency;
                let consistencyTokens = 0;
                if (useConsistency && consistencyText && consistencyText !== '无') {
                    consistencyTokens = await getTokenCountAsync(consistencyText);
                    historyTokens += consistencyTokens; // 将一致性内容的token添加到历史上下文统计中
                }

                // 5. 获取插件当前预设的世界书状态
                // [关键修改] 读取 UI 上的世界书开关，而不是预设里的旧值
                const useWorldBookUI = this.elements.useWorldBook.checked;
                const activePreset = this.currentPreset;

                let pluginWbHtml = `
                    <div style="display: flex; gap: 10px; margin-bottom: 10px; font-size: 12px;">
                        <div style="background: var(--tsp-bg-input); padding: 5px 10px; border-radius: 4px; flex: 1; border: 1px solid var(--tsp-border);">
                            <div title="包含发送给AI的所有历史上下问">历史上下文 (${uiDepth}层):</div>
                            <div><strong style="color: var(--tsp-text-primary); font-size: 1.1em;">${historyTokens}</strong> T</div>
                        </div>
                        <div style="background: var(--tsp-bg-input); padding: 5px 10px; border-radius: 4px; flex: 1; border: 1px solid var(--tsp-border);">
                            <div>当前正文 (Raw ➔ Reg):</div>
                            <div><span style="opacity:0.7">${currentTokensRaw}</span> ➔ <strong style="color: var(--tsp-text-primary); font-size: 1.1em;">${currentTokensProc}</strong> T</div>
                        </div>
                    </div>
                `;

                if (activePreset && useWorldBookUI && activePreset.worldBookNames?.length > 0) {
                    const combinedText = historyText + "\n" + currentText; // 使用处理后的文本进行触发词检测
                    let totalWbTokens = 0;
                    let totalEntries = 0; // 总计开启的条目
                    let triggeredEntries = 0; // 实际生效的条目
                    let detailsHtml = '';

                    // 遍历所有选中的世界书
                    for (const bookName of activePreset.worldBookNames) {
                        const wb = await this.aiProcessor.getWorldBookByName(bookName);
                        if (!wb || !wb.data || !wb.data.entries) continue;

                        const entries = Object.values(wb.data.entries);

                        // 筛选激活条目
                        const activeEntries = [];
                        for (const entry of entries) {
                            if (entry.disable) continue;

                            totalEntries++; // 只要没禁用，就算作"开启"的条目

                            let isActivated = false;
                            if (entry.constant) {
                                isActivated = true;
                            } else if (entry.key && entry.key.length > 0) {
                                // 复用 AIProcessor 的逻辑：只要 combinedText 中包含 key 就算触发
                                if (entry.key.some(k => combinedText.includes(k))) {
                                    isActivated = true;
                                }
                            }

                            if (isActivated) {
                                const tokens = await getTokenCountAsync(entry.content || "");
                                activeEntries.push({
                                    comment: entry.comment || '未命名',
                                    tokens: tokens,
                                    type: entry.constant ? '🔵' : '🟢'
                                });
                                totalWbTokens += tokens;
                                triggeredEntries++;
                            }
                        }

                        // 生成该书的详情
                        if (activeEntries.length > 0) {
                            detailsHtml += `
                                <div style="margin-top: 5px; font-size: 12px; border-top: 1px dashed var(--tsp-border); padding-top: 5px;">
                                    <div style="color: var(--tsp-accent-primary);">📖 ${bookName} (触发 ${activeEntries.length} 条)</div>
                                    ${activeEntries.map(e => `
                                        <div style="display: flex; justify-content: space-between; padding-left: 10px; color: var(--tsp-text-secondary);">
                                            <span>${e.type} ${e.comment}</span>
                                            <span>${e.tokens} T</span>
                                        </div>
                                    `).join('')}
                                </div>
                            `;
                        }
                    }

                    pluginWbHtml += `
                        <div style="margin-bottom: 5px; font-size: 13px; color: var(--tsp-text-primary);">
                            <strong>插件世界书统计:</strong>
                            <span style="display:inline-block; margin-left:5px;">总开启: <span style="color: var(--tsp-text-primary); font-weight:bold;">${totalEntries}</span></span>
                            <span style="display:inline-block; margin-left:10px;">已生效: <span style="color: var(--tsp-accent-red); font-weight:bold;">${triggeredEntries}</span></span>
                            <span style="display:inline-block; margin-left:10px;">占用: <span style="color: var(--tsp-accent-red); font-weight:bold;">${totalWbTokens}</span> T</span>
                        </div>
                        <div style="max-height: 150px; overflow-y: auto; background: var(--tsp-bg-tertiary); border-radius: 4px; padding: 5px; border: 1px solid var(--tsp-border);">
                            ${detailsHtml || '<div style="text-align:center; color: var(--tsp-text-muted);">无条目触发</div>'}
                        </div>
                    `;
                } else {
                    const statusText = !useWorldBookUI ? "世界书模式未启用 (请在【预设配置】开启)" : "未选择世界书";
                    pluginWbHtml += `<div class="tsp-form-hint">${statusText}</div>`;
                }
                pluginContainer.innerHTML = pluginWbHtml;
            }
        } catch (e) {
            console.error(e);
            pluginContainer.innerHTML = `<div class="tsp-form-hint" style="color: var(--tsp-accent-red);">计算出错: ${e.message}</div>`;
        }

        // ==========================
        // 区域二：原生聊天与世界书统计
        // ==========================
        try {
            // --- Part A: 聊天记录统计 (Raw vs Regexed) ---
            if (chat && Array.isArray(chat)) {
                let userMsgCount = 0;
                let userTokenRaw = 0;
                let userTokenProc = 0;

                let charMsgCount = 0;
                let charTokenRaw = 0;
                let charTokenProc = 0;

                // 并行计算以提高速度
                // 注意：为了正则计算的准确性，我们需要知道消息的深度 (depth)
                // chat 数组：index 0 是最早的消息，index length-1 是最新的
                // 正则 script 中的 depth 通常指的是距离最新的距离 (0 based)
                const totalMsgs = chat.length;

                await Promise.all(chat.map(async (msg, index) => {
                    if (msg.is_system) return; // 忽略系统消息

                    const rawContent = msg.mes || "";
                    if (!rawContent) return;

                    // 1. 计算原始 Tokens
                    const countRaw = await getTokenCountAsync(rawContent);

                    // 2. 计算正则后 Tokens
                    // 确定正则应用的 Placement
                    let placement = regex_placement.AI_OUTPUT; // 默认 AI
                    if (msg.is_user) {
                        placement = regex_placement.USER_INPUT;
                    } else if (msg.extra?.type === 'narrator') {
                        // ST 旁白通常按 Slash Command 或 AI Output 处理，视配置而定，这里取AI
                        placement = regex_placement.SLASH_COMMAND;
                    }

                    // 计算相对深度 (最新的消息 depth = 0)
                    const relativeDepth = totalMsgs - 1 - index;

                    // 应用正则获取处理后的文本
                    // isPrompt: true 表示这是用于发送给模型的文本，需要应用 promptOnly 的正则
                    const processedContent = getRegexedString(rawContent, placement, { isPrompt: true, depth: relativeDepth });
                    const countProc = await getTokenCountAsync(processedContent);

                    if (msg.is_user) {
                        userMsgCount++;
                        userTokenRaw += countRaw;
                        userTokenProc += countProc;
                    } else {
                        // 默认为角色消息
                        charMsgCount++;
                        charTokenRaw += countRaw;
                        charTokenProc += countProc;
                    }
                }));

                // 渲染 HTML，显示 Raw -> Proc
                chatContainer.innerHTML = `
                    <div style="display: flex; gap: 10px; font-size: 12px;">
                        <div style="background: var(--tsp-bg-input); padding: 5px 10px; border-radius: 4px; flex: 1; border: 1px solid var(--tsp-border);">
                            <div style="color: var(--tsp-text-muted);">👤 User 消息</div>
                            <div style="margin-top:2px;">
                                <strong>${userMsgCount}</strong> 条 /
                                <span title="原始: ${userTokenRaw}">${userTokenRaw}</span> ➔
                                <span title="正则处理后: ${userTokenProc}" style="color: var(--tsp-text-primary); font-weight:bold;">${userTokenProc}</span> T
                            </div>
                        </div>
                        <div style="background: var(--tsp-bg-input); padding: 5px 10px; border-radius: 4px; flex: 1; border: 1px solid var(--tsp-border);">
                            <div style="color: var(--tsp-text-muted);">🤖 Character 消息</div>
                            <div style="margin-top:2px;">
                                <strong>${charMsgCount}</strong> 条 /
                                <span title="原始: ${charTokenRaw}">${charTokenRaw}</span> ➔
                                <span title="正则处理后: ${charTokenProc}" style="color: var(--tsp-text-primary); font-weight:bold;">${charTokenProc}</span> T
                            </div>
                        </div>
                    </div>
                    <div style="margin-top: 5px; font-size: 12px; text-align: right; color: var(--tsp-text-muted);">
                        聊天记录(正则后)总计: <span style="color: var(--tsp-text-primary); font-weight:bold;">${userTokenProc + charTokenProc}</span> Tokens
                        <br><span style="font-size: 0.9em; opacity: 0.7;">(原始总计: ${userTokenRaw + charTokenRaw})</span>
                    </div>
                `;
            } else {
                chatContainer.innerHTML = `<div class="tsp-form-hint">无法读取聊天记录</div>`;
            }

            // --- Part B: 原生世界书统计 ---

            // 1. 获取“总开启条目”：需要调用 getSortedEntries 获取所有可能会被扫描的条目
            let totalNativeEntries = 0;
            try {
                // 这个函数返回当前聊天所有启用的世界书（Global + Chat + Char）的条目列表
                const allPotentialEntries = await getSortedEntries();
                if (allPotentialEntries && Array.isArray(allPotentialEntries)) {
                    totalNativeEntries = allPotentialEntries.length;
                }
            } catch (err) {
                console.warn("无法获取总世界书条目:", err);
            }

            // 2. 执行 Dry Run 获取“实际生效条目”
            const contextLimit = 32768; // 假设值

            // 必须传入反转的 chat 数组 (最新的在前面) - 这是 ST checkWorldInfo 的要求
            // 过滤掉系统消息
            const contextChat = chat.filter(x => !x.is_system).map(x => x.mes).reverse();

            // 构造全局扫描数据
            const globalScanData = {
                trigger: 'normal',
                personaDescription: '',
                characterDescription: '',
            };

            const result = await checkWorldInfo(contextChat, contextLimit, true, globalScanData); // true = isDryRun

            let nativeWbHtml = '';

            // 计算 Activated Tokens
            const entries = Array.from(result.allActivatedEntries);
            let totalNativeTokens = 0;
            let entriesDetailsHtml = '';

            // 并行计算所有条目的 Token (注意：ST返回的 entry.content 已经是最终处理过的)
            await Promise.all(entries.map(async (entry) => {
                const tokenCount = await getTokenCountAsync(entry.content || "");
                entry._tokenCount = tokenCount;
                totalNativeTokens += tokenCount;
            }));

            // 排序：Token 多的在前
            entries.sort((a, b) => b._tokenCount - a._tokenCount);

            if (entries.length > 0) {
                entriesDetailsHtml = entries.map(e => `
                    <div style="display: flex; justify-content: space-between; padding: 2px 0; border-bottom: 1px solid rgba(255,255,255,0.05); font-size: 12px; color: var(--tsp-text-secondary);">
                        <span title="${e.content ? e.content.substring(0, 50) + '...' : ''}" style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 70%;">
                            ${e.constant ? '🔵' : '🟢'} ${e.comment || e.uid || '未命名'} (${e.world || '未知来源'})
                        </span>
                        <span>${e._tokenCount} T</span>
                    </div>
                `).join('');
            }

            nativeWbHtml = `
                <div style="margin-bottom: 10px; font-size: 13px; color: var(--tsp-text-primary);">
                    <strong>原生世界书统计:</strong>
                    <span style="display:inline-block; margin-left:5px;">总开启: <span style="color: var(--tsp-text-primary); font-weight:bold;">${totalNativeEntries}</span></span>
                    <span style="display:inline-block; margin-left:10px;">已生效: <span style="color: var(--tsp-accent-red); font-weight:bold;">${entries.length}</span></span>
                    <span style="display:inline-block; margin-left:10px;">占用: <span style="color: var(--tsp-accent-red); font-weight:bold;">${totalNativeTokens}</span> T</span>
                </div>
                <div style="max-height: 200px; overflow-y: auto; background: var(--tsp-bg-tertiary); border-radius: 4px; padding: 5px; border: 1px solid var(--tsp-border);">
                    ${entriesDetailsHtml || '<div style="text-align:center; color: var(--tsp-text-muted);">无条目触发</div>'}
                </div>
                <div class="tsp-form-hint" style="margin-top: 5px;">* 包含角色书、聊天绑定的 Lorebook 及全局 Lorebook</div>
            `;

            nativeContainer.innerHTML = nativeWbHtml;

        } catch (e) {
            console.error(e);
            nativeContainer.innerHTML = `<div class="tsp-form-hint" style="color: var(--tsp-accent-red);">原生统计出错: ${e.message}</div>`;
        }
    }

    _renderTagRefPanel() {
        return `
            <div class="ai-settings-section">
                <h4>Tag 参考设置</h4>

                <div class="tsp-form-group">
                    <label>
                        <input type="checkbox" id="ai-enable-tag-ref">
                        <span>启用图片 Tag 参考</span>
                    </label>
                    <div class="tsp-form-hint">从缓存图片中提取 tag 作为参考</div>
                </div>

                <div class="tsp-form-group">
                    <label>
                        <input type="checkbox" id="ai-enable-taglib-ref">
                        <span>启用 Tag 库参考</span>
                    </label>
                    <div class="tsp-form-hint">从标签库中匹配可用标签</div>
                </div>
            </div>

            <div class="ai-settings-section">
                <h4>Tag 参考文件夹</h4>
                <div class="ai-tagref-folders" id="ai-tagref-folders">
                    <!-- 动态填充 -->
                </div>
                <button class="tsp-btn tsp-btn-block" id="ai-tagref-add-folder">
                    <i class="fa-solid fa-folder-plus"></i> 添加文件夹
                </button>
            </div>
        `;
    }

    // [修改] 渲染聊天插入面板
    _renderChatInsertionPanel() {
        return `
            <div class="ai-settings-section">
                <h4>聊天内容插入设置</h4>
                <div class="tsp-form-group">
                    <label>读取上下文楼层数量</label>
                    <input type="number" class="tsp-input" id="ai-chat-insertion-depth"
                           min="1" max="50" value="5" placeholder="默认为 5">
                    <div class="tsp-form-hint">向前读取历史记录的深度。</div>
                </div>

                <div class="tsp-form-group">
                    <label>
                        <input type="checkbox" id="ai-chat-insertion-ignore-user">
                        <span>不读取user消息</span>
                    </label>
                    <div class="tsp-form-hint">启用后，收集上下文时只收集角色消息，不收集用户消息。</div>
                </div>

                <div class="tsp-form-group">
                    <label>
                        <input type="checkbox" id="ai-chat-insertion-consistency">
                        <span>一致性</span>
                    </label>
                    <div class="tsp-form-hint">启用后，收集上下文时优先提取<image>标签内容作为生图一致性参考。</div>
                </div>

                <div class="tsp-form-group">
                    <label>
                        <input type="checkbox" id="ai-chat-insertion-worldbook-strict">
                        <span>世界书严谨触发</span>
                    </label>
                    <div class="tsp-form-hint">启用后，世界书仅使用最新楼层的内容来检测绿灯触发词，而不是整个上下文。</div>
                </div>

                <div class="tsp-form-group">
                    <label>
                        <input type="checkbox" id="ai-chat-insertion-use-regex">
                        <span>应用正则处理</span>
                    </label>
                </div>

                <!-- [新增] 内容替换词配置 -->
                <div class="tsp-form-group">
                    <label>
                        <input type="checkbox" id="ai-chat-insertion-sanitize-enabled">
                        <span>内容替换词清理</span>
                    </label>
                    <div class="tsp-form-hint">开启后，发送给AI前会对所有内容（世界书、上下文、历史等）进行替换词清理，用于规避敏感词。规则配置见「正则替换规则」面板下方的「内容替换词规则」。</div>
                </div>

                <div class="tsp-form-group">
                    <label>开始标签</label>
                    <input type="text" class="tsp-input" id="ai-chat-insertion-start-tag"
                           placeholder="例如：<图片>">
                    <div class="tsp-form-hint">AI内容将替换此标签和结束标签之间的内容。</div>
                </div>

                <div class="tsp-form-group">
                    <label>结束标签</label>
                    <input type="text" class="tsp-input" id="ai-chat-insertion-end-tag"
                           placeholder="例如：</图片>">
                    <div class="tsp-form-hint">与开始标签配对使用。</div>
                </div>

                <!-- ▼▼▼ 新增代码开始 ▼▼▼ -->
                <div class="tsp-form-group">
                    <label>
                        <input type="checkbox" id="ai-chat-insertion-auto-mode">
                        <span>启用自动剧情定位模式</span>
                    </label>
                    <div class="tsp-form-hint">开启后，AI将自动寻找剧情锚点并将图片插入到对应的段落之后 (仅配合"智能剧情插入"模版生效)。</div>
                </div>
                <!-- ▲▲▲ 修改结束 ▲▲▲ -->

                <!-- ▼▼▼ 新增代码开始：均匀插入模式 ▼▼▼ -->
                <div class="tsp-form-group">
                    <label>
                        <input type="checkbox" id="ai-chat-insertion-uniform-mode">
                        <span>启用算法插入模式</span>
                    </label>
                    <div class="tsp-form-hint">开启后，将忽略AI返回的定位锚点，插件接管插入逻辑。确保图片单独一行，不会修改原文文字内容。</div>
                </div>
                <!-- ▲▲▲ 新增代码结束 ▲▲▲ -->

                <!-- ▼▼▼ 新增代码开始：自动点击开关 ▼▼▼ -->
                <div class="tsp-form-group">
                    <label>
                        <input type="checkbox" id="ai-chat-insertion-auto-click">
                        <span>生成结束后自动点击 AI 插入</span>
                    </label>
                    <div class="tsp-form-hint" style="color: var(--tsp-accent-primary);">⚠️ 监听系统回复事件。当 AI 回复完全结束时，自动触发最新一条消息的 AI 魔法棒按钮。</div>
                </div>
                <div class="tsp-form-group">
                    <label>
                        <input type="checkbox" id="ai-chat-insertion-skip-image-check">
                        <span>图片检测跳过</span>
                    </label>
                    <div class="tsp-form-hint">开启后，自动点击前先检查该楼层是否已有&lt;image&gt;标签，有则跳过自动点击。</div>
                </div>
                <div class="tsp-form-group">
                    <label>
                        <input type="checkbox" id="ai-chat-insertion-random-base64">
                        <span>随机base64注入</span>
                    </label>
                    <div class="tsp-form-hint">开启后，每次聊天插入请求都会在提示词模板末尾追加一条 user 消息</div>
                </div>
                <!-- ▲▲▲ 新增代码结束 ▲▲▲ -->
            </div>

            <!-- 模板编辑器（默认收缩，点击标题展开，避免模板条目过多影响查看） -->
            <div class="ai-settings-section">
                <div class="ai-regex-header">
                    <h4 id="ai-chat-tmpl-header" style="cursor: pointer; user-select: none; display: flex; align-items: center; gap: 8px; margin: 0; border-bottom: none; padding-bottom: 0; flex: 1;">
                        <span><i class="fa-solid fa-file-lines"></i> 提示词模板 (Template)</span>
                        <i class="fa-solid fa-chevron-right" id="ai-chat-tmpl-icon" style="font-size: 0.8em; color: var(--tsp-text-muted); transition: transform 0.2s;"></i>
                    </h4>
                    <div class="ai-regex-actions">
                         <button class="tsp-btn tsp-btn-sm tsp-btn-danger" id="ai-chat-tmpl-delete" title="删除当前模板">
                            <i class="fa-solid fa-trash"></i>
                        </button>
                        <button class="tsp-btn tsp-btn-sm tsp-btn-primary" id="ai-chat-tmpl-export" title="导出当前模板">
                            <i class="fa-solid fa-download"></i>
                        </button>
                        <button class="tsp-btn tsp-btn-sm tsp-btn-primary" id="ai-chat-tmpl-import" title="导入新模板">
                            <i class="fa-solid fa-upload"></i>
                        </button>
                         <button class="tsp-btn tsp-btn-sm tsp-btn-primary" id="ai-chat-tmpl-save-as" title="另存为新模板">
                            <i class="fa-solid fa-save"></i> 另存为
                        </button>
                    </div>
                </div>

                <div id="ai-chat-tmpl-body" style="display: none;">
                    <div class="tsp-form-group">
                        <label>当前选择模板</label>
                        <select class="tsp-input" id="ai-chat-template-select">
                            <!-- 动态填充 -->
                        </select>
                    </div>

                    <div class="tsp-form-hint">
                        可用占位符：
                        <br><code>{{historyContext}}</code> : 历史上下文 (Role: System)
                        <br><code>{{currentPlot}}</code> : 当前要修改的正文 (Role: System)
                        <br><code>{{worldInfo}}</code> : 世界书/CharacterData/TagLib 注入点
                    </div>

                    <div class="ai-regex-actions" style="margin-top: 5px; margin-bottom: 5px;">
                         <button class="tsp-btn tsp-btn-sm tsp-btn-success" id="ai-chat-msg-add">
                            <i class="fa-solid fa-plus"></i> 添加一行
                        </button>
                        <button class="tsp-btn tsp-btn-sm" id="ai-chat-msg-reset">
                            <i class="fa-solid fa-undo"></i> 恢复默认结构
                        </button>
                    </div>

                    <div id="ai-chat-msg-list" class="tsp-list" style="max-height: 500px; overflow-y: auto; padding: 5px; border: 1px solid var(--tsp-border); border-radius: 4px;">
                        <!-- JS 动态填充消息列表 -->
                    </div>
                </div>
            </div>

            <!-- 自定义 Tool 工具配置（开启后聊天插入请求注入 function tools，默认收缩） -->
            <div class="ai-settings-section">
                <div class="ai-regex-header">
                    <h4 id="ai-chat-tool-header" style="cursor: pointer; user-select: none; display: flex; align-items: center; gap: 8px; margin: 0; border-bottom: none; padding-bottom: 0; flex: 1;">
                        <span><i class="fa-solid fa-wrench"></i> 自定义 Tool 工具配置 (Function Call)</span>
                        <i class="fa-solid fa-chevron-right" id="ai-chat-tool-icon" style="font-size: 0.8em; color: var(--tsp-text-muted); transition: transform 0.2s;"></i>
                    </h4>
                    <div class="ai-regex-actions">
                        <button class="tsp-btn tsp-btn-sm" id="ai-chat-tool-restore" title="恢复默认配置">
                            <i class="fa-solid fa-rotate-left"></i>
                        </button>
                        <button class="tsp-btn tsp-btn-sm tsp-btn-primary" id="ai-chat-tool-export" title="导出工具配置">
                            <i class="fa-solid fa-download"></i>
                        </button>
                        <button class="tsp-btn tsp-btn-sm tsp-btn-primary" id="ai-chat-tool-import" title="导入工具配置">
                            <i class="fa-solid fa-upload"></i>
                        </button>
                    </div>
                </div>

                <div id="ai-chat-tool-body" style="display: none;">
                    <div class="tsp-form-group">
                        <label>
                            <input type="checkbox" id="ai-chat-tool-enabled">
                            <span>启用自定义 Tool 工具</span>
                        </label>
                        <div class="tsp-form-hint">开启后，聊天插入请求（直连与酒馆代理回退）会注入一个 function 工具，并把模型返回的 tool_calls 参数按字段顺序组装为正文（可用于强制模型走工具调用输出）。要求所用接口支持 OpenAI function-calling 协议。</div>
                    </div>

                    <div id="ai-chat-tool-details">
                        <div class="tsp-form-row">
                            <div class="tsp-form-group">
                                <label>工具命名方式</label>
                                <select class="tsp-input" id="ai-chat-tool-name-mode">
                                    <option value="dynamic">动态随机生成 (前缀 + 随机值，防缓存)</option>
                                    <option value="fixed">固定工具名称</option>
                                </select>
                            </div>
                            <div class="tsp-form-group" id="ai-chat-tool-fixed-name-row">
                                <label>固定工具名</label>
                                <input type="text" class="tsp-input" id="ai-chat-tool-fixed-name" placeholder="例如: chami_emit_data">
                            </div>
                        </div>

                        <div class="tsp-form-row">
                            <div class="tsp-form-group">
                                <label>动态名称前缀</label>
                                <input type="text" class="tsp-input" id="ai-chat-tool-prefix" placeholder="chami_emit_">
                                <div class="tsp-form-hint">动态命名时使用的前缀，随机后缀会自动拼接。</div>
                            </div>
                            <div class="tsp-form-group">
                                <label>tool_choice</label>
                                <select class="tsp-input" id="ai-chat-tool-choice">
                                    <option value="auto">auto (模型自行决定是否调用)</option>
                                    <option value="required">required (强制必须调用工具)</option>
                                </select>
                            </div>
                        </div>

                        <div class="tsp-form-group">
                            <label>工具用途描述 (description)</label>
                            <textarea class="tsp-input" id="ai-chat-tool-desc" rows="3" style="width: 100%; font-family: monospace; font-size: 13px;" placeholder="引导模型何时以及如何调用该工具"></textarea>
                        </div>

                        <div class="ai-regex-actions" style="margin-top: 5px; margin-bottom: 5px;">
                            <button class="tsp-btn tsp-btn-sm tsp-btn-success" id="ai-chat-tool-field-add">
                                <i class="fa-solid fa-plus"></i> 添加参数字段
                            </button>
                        </div>
                        <div class="tsp-form-hint">
                            模型调用工具后，将按下列字段顺序提取参数并组装为正文。包裹标签不为空时（如 <code>thinking</code>），该字段会被 <code>&lt;标签&gt;…&lt;/标签&gt;</code> 包裹。
                        </div>
                        <div id="ai-chat-tool-field-list" class="tsp-list" style="max-height: 400px; overflow-y: auto; padding: 5px; margin-top: 5px; border: 1px solid var(--tsp-border); border-radius: 4px;">
                            <!-- JS 动态填充工具参数字段列表 -->
                        </div>
                    </div>
                </div>
            </div>
        `;
    }
    /**
     *  渲染聊天插入的消息列表编辑器
     * @param {Array} messages 消息数组
     */
    _renderChatInsertionMessageList(messages) {
        this._renderMessageEditor('#ai-chat-msg-list', messages, [
            { token: '{{historyContext}}', label: '历史记录插槽', color: 'var(--tsp-accent-blue)', bg: 'rgba(0,0,255,0.1)', icon: 'fa-clock-rotate-left' },
            { token: '{{currentPlot}}', label: '当前正文插槽', color: 'var(--tsp-accent-primary)', bg: 'rgba(255,0,0,0.1)', icon: 'fa-pen-nib' },
            { token: '{{worldInfo}}', label: '世界书/Character注入', color: 'var(--tsp-accent-green)', bg: 'rgba(0,255,0,0.1)', icon: 'fa-globe' },
        ]);
    }

    /**
     * [新增] 渲染绘图角色数据收集模板的消息列表编辑器
     * @param {Array} messages 消息数组
     */
    _renderDrawingMessageList(messages) {
        this._renderMessageEditor('#ai-drawing-msg-list', messages, [
            { token: '{{currentPlot}}', label: '当前正文插槽', color: 'var(--tsp-accent-primary)', bg: 'rgba(255,0,0,0.1)', icon: 'fa-pen-nib' },
            { token: '{{current_label}}', label: '本轮tag/一致性插槽', color: 'var(--tsp-accent-blue)', bg: 'rgba(0,0,255,0.1)', icon: 'fa-tags' },
            { token: '{{Character_Record}}', label: '历史记录插槽', color: 'var(--tsp-accent-green)', bg: 'rgba(0,255,0,0.1)', icon: 'fa-clock-rotate-left' },
        ]);
    }

    /**
     * [新增] 通用消息列表编辑器渲染（供聊天插入模板与绘图角色数据模板共用）
     * @param {string} containerSelector 容器选择器
     * @param {Array} messages 消息数组（引用直接指向 settings 对象里的数组）
     * @param {Array<{token:string,label:string,color:string,bg:string,icon:string}>} hintDefs 占位符视觉提示定义
     */
    _renderMessageEditor(containerSelector, messages, hintDefs) {
        const container = this.modalEl.querySelector(containerSelector);
        if (!container) return;

        container.innerHTML = '';

        messages.forEach((msg, index) => {
            const row = document.createElement('div');
            row.className = 'ai-chat-msg-item';
            row.style.cssText = 'border: 1px solid var(--tsp-border); padding: 10px; margin-bottom: 8px; border-radius: 6px; background: var(--tsp-bg-tertiary);';

            const roleSelectHtml = `
                <select class="tsp-input msg-role" style="width: auto; display: inline-block; margin-bottom: 5px;">
                    <option value="system" ${msg.role === 'system' ? 'selected' : ''}>System</option>
                    <option value="user" ${msg.role === 'user' ? 'selected' : ''}>User</option>
                    <option value="assistant" ${msg.role === 'assistant' ? 'selected' : ''}>Assistant</option>
                </select>
            `;

            // 增强的视觉提示：按传入的占位符定义匹配
            let hintHtml = '';
            for (const def of hintDefs) {
                if (msg.content && msg.content.includes(def.token)) {
                    hintHtml += `<span style="color: ${def.color}; font-size: 0.8em; margin-left: 8px; background: ${def.bg}; padding: 2px 4px; border-radius: 4px;"><i class="fa-solid ${def.icon}"></i> ${def.label}</span>`;
                }
            }

            row.innerHTML = `
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 5px;">
                    <div>
                        <span style="font-weight: bold; margin-right: 5px;">#${index + 1}</span>
                        ${roleSelectHtml}
                        ${hintHtml}
                    </div>
                    <div>
                        <button class="tsp-btn tsp-btn-xs" data-action="move-up" ${index === 0 ? 'disabled' : ''}><i class="fa-solid fa-arrow-up"></i></button>
                        <button class="tsp-btn tsp-btn-xs" data-action="move-down" ${index === messages.length - 1 ? 'disabled' : ''}><i class="fa-solid fa-arrow-down"></i></button>
                        <button class="tsp-btn tsp-btn-xs tsp-btn-danger" data-action="delete"><i class="fa-solid fa-trash"></i></button>
                    </div>
                </div>
                <textarea class="tsp-input msg-content" rows="3" style="width: 100%; font-family: monospace; font-size: 13px;">${this._escapeHtml(msg.content)}</textarea>
            `;

            // 绑定事件
            const deleteBtn = row.querySelector('[data-action="delete"]');
            const upBtn = row.querySelector('[data-action="move-up"]');
            const downBtn = row.querySelector('[data-action="move-down"]');

            // 删除
            deleteBtn.addEventListener('click', () => {
                messages.splice(index, 1);
                this._renderMessageEditor(containerSelector, messages, hintDefs);
            });

            // 移动
            upBtn.addEventListener('click', () => {
                if (index > 0) {
                    [messages[index], messages[index - 1]] = [messages[index - 1], messages[index]];
                    this._renderMessageEditor(containerSelector, messages, hintDefs);
                }
            });
            downBtn.addEventListener('click', () => {
                if (index < messages.length - 1) {
                    [messages[index], messages[index + 1]] = [messages[index + 1], messages[index]];
                    this._renderMessageEditor(containerSelector, messages, hintDefs);
                }
            });

            // 内容实时更新到内存对象
            const contentArea = row.querySelector('.msg-content');
            contentArea.addEventListener('input', (e) => {
                msg.content = e.target.value;
            });

            const roleSel = row.querySelector('.msg-role');
            roleSel.addEventListener('change', (e) => {
                msg.role = e.target.value;
            });

            container.appendChild(row);
        });
    }

    // ==================== 自定义 Tool 工具配置（聊天插入 chat / 绘图数据收集 drawing 双变体共用） ====================

    /**
     * [新增] 工具配置变体元信息：配置键、草稿键、默认配置工厂、导入导出类型与提示文案
     * @param {'chat'|'drawing'} variant 配置变体
     */
    _getToolVariantMeta(variant) {
        if (variant === 'drawing') {
            return {
                configKey: 'drawingToolConfig',
                draftKey: '_drawingToolConfigDraft',
                getDefault: () => this.aiProcessor._getDefaultDrawingToolConfig(),
                exportType: 'chami_drawing_character_tool_config',
                exportFilePrefix: 'drawing_character_tool_config_',
                restoreConfirm: '这将用默认配置覆盖当前的绘图角色数据收集 Tool 工具配置，并立即保存生效，确定继续吗？',
                restoredToast: '已恢复默认绘图数据收集 Tool 工具配置并立即生效',
                exportEmptyToast: '没有可导出的参数字段',
                exportedToast: '绘图数据收集 Tool 工具配置已导出',
                importedToast: (n) => `已导入绘图数据收集 Tool 工具配置（${n} 个参数字段，已立即生效）`,
                errPrefix: '绘图数据收集 Tool 工具配置'
            };
        }
        return {
            configKey: 'chatInsertionToolConfig',
            draftKey: '_chatToolConfigDraft',
            getDefault: () => this.aiProcessor._getDefaultChatInsertionToolConfig(),
            exportType: 'chami_chat_insertion_tool_config',
            exportFilePrefix: 'chat_insertion_tool_config_',
            restoreConfirm: '这将用默认配置覆盖当前的自定义 Tool 工具配置，并立即保存生效，确定继续吗？',
            restoredToast: '已恢复默认 Tool 工具配置并立即生效',
            exportEmptyToast: '没有可导出的参数字段',
            exportedToast: 'Tool 工具配置已导出',
            importedToast: (n) => `已导入 Tool 工具配置（${n} 个参数字段，已立即生效）`,
            errPrefix: '自定义 Tool 工具配置'
        };
    }

    /**
     * [新增] 获取某变体对应的 UI 元素集合
     * @param {'chat'|'drawing'} variant 配置变体
     */
    _getToolEls(variant) {
        const e = this.elements;
        if (variant === 'drawing') {
            return {
                enabled: e.drawingToolEnabled,
                details: e.drawingToolDetails,
                nameMode: e.drawingToolNameMode,
                fixedNameRow: e.drawingToolFixedNameRow,
                fixedName: e.drawingToolFixedName,
                prefix: e.drawingToolPrefix,
                choice: e.drawingToolChoice,
                desc: e.drawingToolDesc,
                fieldList: e.drawingToolFieldList,
                fieldAdd: e.drawingToolFieldAdd,
                restore: e.drawingToolRestore,
                export: e.drawingToolExport,
                import: e.drawingToolImport
            };
        }
        return {
            enabled: e.chatToolEnabled,
            details: e.chatToolDetails,
            nameMode: e.chatToolNameMode,
            fixedNameRow: e.chatToolFixedNameRow,
            fixedName: e.chatToolFixedName,
            prefix: e.chatToolPrefix,
            choice: e.chatToolChoice,
            desc: e.chatToolDesc,
            fieldList: e.chatToolFieldList,
            fieldAdd: e.chatToolFieldAdd,
            restore: e.chatToolRestore,
            export: e.chatToolExport,
            import: e.chatToolImport
        };
    }

    /**
     * 获取当前编辑中的工具配置草稿对象
     * @param {'chat'|'drawing'} variant 配置变体
     */
    _ensureToolDraft(variant) {
        const meta = this._getToolVariantMeta(variant);
        if (this[meta.draftKey]) return this[meta.draftKey];
        const config = this.aiProcessor.config || this.aiProcessor.settings;
        if (!config[meta.configKey] || typeof config[meta.configKey] !== 'object') {
            config[meta.configKey] = meta.getDefault();
        }
        this[meta.draftKey] = config[meta.configKey];
        return this[meta.draftKey];
    }

    /**
     * 获取当前编辑中的工具配置草稿对象（引用 config.chatInsertionToolConfig）
     */
    _ensureChatToolDraft() {
        return this._ensureToolDraft('chat');
    }

    /**
     * 从 UI 收集参数字段列表（空字段名的行自动丢弃）
     * @param {'chat'|'drawing'} variant 配置变体
     * @returns {Array<{name:string,description:string,required:boolean,wrapTag:string}>}
     */
    _collectToolFieldsFromUI(variant) {
        const list = this._getToolEls(variant).fieldList;
        if (!list) return [];
        const fields = [];
        list.querySelectorAll('.ai-chat-tool-field-item').forEach(row => {
            const name = (row.querySelector('.tool-field-name')?.value || '').trim();
            if (!name) return;
            fields.push({
                name,
                description: (row.querySelector('.tool-field-desc')?.value || '').trim(),
                required: !!row.querySelector('.tool-field-required')?.checked,
                wrapTag: (row.querySelector('.tool-field-wraptag')?.value || '').trim()
            });
        });
        return fields;
    }

    /**
     * 从 UI 收集参数字段列表（空字段名的行自动丢弃）— 聊天插入变体
     */
    _collectChatToolFieldsFromUI() {
        return this._collectToolFieldsFromUI('chat');
    }

    /**
     * 渲染工具参数字段列表（卡片风格，方便追加条目与查看修改）
     * @param {'chat'|'drawing'} variant 配置变体
     * @param {Array} fields 字段数组
     */
    _renderToolFields(variant, fields) {
        const container = this._getToolEls(variant).fieldList;
        if (!container) return;
        container.innerHTML = '';

        if (!Array.isArray(fields) || fields.length === 0) {
            container.innerHTML = `
                <div class="ai-empty-state">
                    <i class="fa-solid fa-wrench"></i>
                    <p>暂无参数字段，点击下方按钮添加</p>
                </div>
            `;
            return;
        }

        fields.forEach((field, index) => {
            const row = document.createElement('div');
            row.className = 'ai-chat-tool-field-item';
            row.style.cssText = 'border: 1px solid var(--tsp-border); padding: 10px; margin-bottom: 8px; border-radius: 6px; background: var(--tsp-bg-tertiary);';

            row.innerHTML = `
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 5px;">
                    <div>
                        <span style="font-weight: bold; margin-right: 8px;">#${index + 1}</span>
                        <label style="display: inline-flex; align-items: center; gap: 4px; margin: 0;">
                            <input type="checkbox" class="tool-field-required" ${field.required !== false ? 'checked' : ''}>
                            <span>必填 (required)</span>
                        </label>
                    </div>
                    <div>
                        <button class="tsp-btn tsp-btn-xs" data-action="move-up" ${index === 0 ? 'disabled' : ''} title="上移"><i class="fa-solid fa-arrow-up"></i></button>
                        <button class="tsp-btn tsp-btn-xs" data-action="move-down" ${index === fields.length - 1 ? 'disabled' : ''} title="下移"><i class="fa-solid fa-arrow-down"></i></button>
                        <button class="tsp-btn tsp-btn-xs tsp-btn-danger" data-action="delete" title="删除字段"><i class="fa-solid fa-trash"></i></button>
                    </div>
                </div>
                <div class="tsp-form-group" style="margin-bottom: 6px;">
                    <label>字段名 (Key)</label>
                    <input type="text" class="tsp-input tool-field-name" value="${this._escapeHtml(field.name || '')}" placeholder="例如: content">
                </div>
                <div class="tsp-form-group" style="margin-bottom: 6px;">
                    <label>字段描述 (Description)</label>
                    <input type="text" class="tsp-input tool-field-desc" value="${this._escapeHtml(field.description || '')}" placeholder="该参数的用途说明，会写入工具 schema">
                </div>
                <div class="tsp-form-group" style="margin-bottom: 0;">
                    <label>包裹标签 (Wrap Tag)</label>
                    <input type="text" class="tsp-input tool-field-wraptag" value="${this._escapeHtml(field.wrapTag || '')}" placeholder="如: thinking（留空则该字段直接输出，不加标签）">
                </div>
            `;

            row.querySelector('[data-action="delete"]').addEventListener('click', () => {
                const current = this._collectToolFieldsFromUI(variant);
                current.splice(index, 1);
                const draft = this._ensureToolDraft(variant);
                draft.fields = current;
                this._renderToolFields(variant, current);
            });
            row.querySelector('[data-action="move-up"]').addEventListener('click', () => {
                if (index === 0) return;
                const current = this._collectToolFieldsFromUI(variant);
                [current[index], current[index - 1]] = [current[index - 1], current[index]];
                const draft = this._ensureToolDraft(variant);
                draft.fields = current;
                this._renderToolFields(variant, current);
            });
            row.querySelector('[data-action="move-down"]').addEventListener('click', () => {
                const current = this._collectToolFieldsFromUI(variant);
                if (index >= current.length - 1) return;
                [current[index], current[index + 1]] = [current[index + 1], current[index]];
                const draft = this._ensureToolDraft(variant);
                draft.fields = current;
                this._renderToolFields(variant, current);
            });

            container.appendChild(row);
        });
    }

    /**
     * 渲染工具参数字段列表 — 聊天插入变体包装
     * @param {Array} fields 字段数组
     */
    _renderChatToolFields(fields) {
        this._renderToolFields('chat', fields);
    }

    /**
     * 开关 / 命名方式联动显示
     * @param {'chat'|'drawing'} variant 配置变体
     */
    _updateToolVisibility(variant) {
        const els = this._getToolEls(variant);
        if (!els.enabled) return;
        const enabled = els.enabled.checked;
        if (els.details) {
            els.details.style.display = enabled ? '' : 'none';
        }
        const isFixed = els.nameMode?.value === 'fixed';
        if (els.fixedNameRow) {
            els.fixedNameRow.style.display = isFixed ? '' : 'none';
        }
    }

    /**
     * 开关 / 命名方式联动显示 — 聊天插入变体包装
     */
    _updateChatToolVisibility() {
        this._updateToolVisibility('chat');
    }

    /**
     * 将工具配置回填到设置面板
     * @param {'chat'|'drawing'} variant 配置变体
     * @param {Object} config aiProcessor 配置对象
     */
    _loadToolConfigToUI(variant, config) {
        const els = this._getToolEls(variant);
        const meta = this._getToolVariantMeta(variant);
        if (!els.enabled) return;

        let cfg = config[meta.configKey];
        if (!cfg || typeof cfg !== 'object' || !Array.isArray(cfg.fields)) {
            cfg = meta.getDefault();
            config[meta.configKey] = cfg;
        }
        this[meta.draftKey] = cfg;

        els.enabled.checked = cfg.enabled === true;
        if (els.nameMode) {
            els.nameMode.value = cfg.nameMode === 'fixed' ? 'fixed' : 'dynamic';
        }
        if (els.fixedName) {
            els.fixedName.value = cfg.fixedName || '';
        }
        if (els.prefix) {
            els.prefix.value = cfg.prefix || 'chami_emit_';
        }
        if (els.choice) {
            els.choice.value = cfg.toolChoice === 'required' ? 'required' : 'auto';
        }
        if (els.desc) {
            els.desc.value = cfg.desc || '';
        }

        this._renderToolFields(variant, Array.isArray(cfg.fields) ? cfg.fields : []);
        this._updateToolVisibility(variant);
    }

    /**
     * 将工具配置回填到设置面板 — 聊天插入变体包装
     * @param {Object} config aiProcessor 配置对象
     */
    _loadChatToolConfigToUI(config) {
        this._loadToolConfigToUI('chat', config);
    }

    /**
     * 从设置面板收集完整工具配置（保存/导出时使用）
     * @param {'chat'|'drawing'} variant 配置变体
     * @returns {Object} 标准化后的工具配置
     */
    _collectToolConfigFromUI(variant) {
        const els = this._getToolEls(variant);
        const draft = this._ensureToolDraft(variant);
        draft.enabled = !!els.enabled?.checked;
        draft.nameMode = els.nameMode?.value === 'fixed' ? 'fixed' : 'dynamic';
        draft.fixedName = (els.fixedName?.value || '').trim();
        draft.prefix = (els.prefix?.value || '').trim() || 'chami_emit_';
        draft.toolChoice = els.choice?.value === 'required' ? 'required' : 'auto';
        draft.desc = els.desc?.value || '';
        draft.fields = this._collectToolFieldsFromUI(variant);
        return draft;
    }

    /**
     * 从设置面板收集完整工具配置 — 聊天插入变体包装
     * @returns {Object} 标准化后的工具配置
     */
    _collectChatToolConfigFromUI() {
        return this._collectToolConfigFromUI('chat');
    }

    /**
     * 恢复默认 Tool 工具配置（立即保存生效）
     * @param {'chat'|'drawing'} variant 配置变体
     */
    async _restoreToolConfig(variant) {
        const meta = this._getToolVariantMeta(variant);
        const confirmed = await this.ctx.helpers.promptConfirm(meta.restoreConfirm);
        if (!confirmed) return;

        try {
            const config = this.aiProcessor.config || this.aiProcessor.settings;
            // [修复] 保留当前 enabled 状态，不被默认值（false）覆盖
            const currentEnabled = config[meta.configKey]?.enabled === true;
            const newCfg = JSON.parse(JSON.stringify(meta.getDefault()));
            newCfg.enabled = currentEnabled;
            config[meta.configKey] = newCfg;
            this[meta.draftKey] = config[meta.configKey];
            this._loadToolConfigToUI(variant, config);
            await this.aiProcessor.saveConfig();
            this.ctx.helpers.showToast(meta.restoredToast, 'success');
        } catch (err) {
            this.ctx.error('ai-settings', `${meta.errPrefix}恢复失败:`, err);
            this.ctx.helpers.showToast(`恢复失败: ${err.message}`, 'error');
        }
    }

    /**
     * 恢复默认 Tool 工具配置（立即保存生效）— 聊天插入变体包装
     */
    async _restoreChatToolConfig() {
        return this._restoreToolConfig('chat');
    }

    /**
     * 导出 Tool 工具配置为 JSON 文件
     * @param {'chat'|'drawing'} variant 配置变体
     */
    _exportToolConfig(variant) {
        const meta = this._getToolVariantMeta(variant);
        const data = this._collectToolConfigFromUI(variant);
        if (!Array.isArray(data.fields) || data.fields.length === 0) {
            this.ctx.helpers.showToast(meta.exportEmptyToast, 'warning');
            return;
        }

        const exportData = {
            type: meta.exportType,
            version: 1,
            exportedAt: new Date().toISOString(),
            data
        };
        const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${meta.exportFilePrefix}${new Date().toISOString().slice(0, 10)}.json`;
        a.click();
        URL.revokeObjectURL(url);
        this.ctx.helpers.showToast(meta.exportedToast, 'success');
    }

    /**
     * 导出 Tool 工具配置为 JSON 文件 — 聊天插入变体包装
     */
    _exportChatToolConfig() {
        this._exportToolConfig('chat');
    }

    /**
     * 从 JSON 文件导入 Tool 工具配置（兼容 {data:{...}} 包装格式与裸配置格式）
     * @param {'chat'|'drawing'} variant 配置变体
     */
    _importToolConfig(variant) {
        const meta = this._getToolVariantMeta(variant);
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.json';
        input.onchange = async (e) => {
            const target = e.target;
            const file = target instanceof HTMLInputElement ? target.files?.[0] : null;
            if (!file) return;

            try {
                const parsed = JSON.parse(await file.text());
                const rawData = parsed && typeof parsed === 'object' && parsed.data && typeof parsed.data === 'object'
                    ? parsed.data
                    : parsed;

                if (!rawData || typeof rawData !== 'object' || !Array.isArray(rawData.fields)) {
                    throw new Error('文件格式不正确，缺少 fields 字段列表');
                }

                const validFields = rawData.fields
                    .filter(f => f && typeof f === 'object' && String(f.name || '').trim())
                    .map(f => ({
                        name: String(f.name).trim(),
                        description: String(f.description || ''),
                        required: f.required !== false,
                        wrapTag: String(f.wrapTag || '').trim()
                    }));

                if (validFields.length === 0) {
                    throw new Error('文件中未找到有效的参数字段（字段名不能为空）');
                }

                const normalized = {
                    enabled: rawData.enabled === true,
                    nameMode: rawData.nameMode === 'fixed' ? 'fixed' : 'dynamic',
                    fixedName: String(rawData.fixedName || '').trim(),
                    prefix: String(rawData.prefix || '').trim() || 'chami_emit_',
                    toolChoice: rawData.toolChoice === 'required' ? 'required' : 'auto',
                    desc: String(rawData.desc || ''),
                    fields: validFields
                };

                const config = this.aiProcessor.config || this.aiProcessor.settings;
                config[meta.configKey] = normalized;
                this[meta.draftKey] = normalized;
                this._loadToolConfigToUI(variant, config);
                await this.aiProcessor.saveConfig();
                this.ctx.helpers.showToast(meta.importedToast(validFields.length), 'success');
            } catch (err) {
                this.ctx.error('ai-settings', `${meta.errPrefix}导入失败:`, err);
                this.ctx.helpers.showToast(`导入失败: ${err.message}`, 'error');
            }
        };
        input.click();
    }

    /**
     * 从 JSON 文件导入 Tool 工具配置 — 聊天插入变体包装
     */
    _importChatToolConfig() {
        this._importToolConfig('chat');
    }

    /**
     * 渲染漫画模式面板
     * 提示词内容维护在 ai-processor.js 的「[漫画模式] 提示词配置」区域（占位符格式，用户可粘贴真实内容覆盖）
     */
    _renderComicModePanel() {
        const s = this.aiProcessor?.settings || {};
        const radio = (name, value, checked) => `
            <label style="display:inline-flex;align-items:center;gap:6px;margin-right:16px;cursor:pointer;">
                <input type="radio" name="${name}" value="${value}" ${checked ? 'checked' : ''}>
                <span>${value}</span>
            </label>`;
        const colorVal = s.comicModeColor || '黑白';
        const storyboardVal = s.comicModeStoryboard || '经典四格';
        const blankVal = s.comicModeBlankSpace || '天地出血';
        const langVal = s.comicModeDialogueLanguage || '简体中文';
        const styleVal = s.comicModeStylePreset || '黑白';
        const pageCountModeVal = s.comicModePageCountMode || '手动';
        const pageCountNVal = Math.min(20, Math.max(1, parseInt(s.comicModePageCountN, 10) || 6));

        return `
            <div class="ai-settings-section">
                <h4>漫画模式</h4>
                <div class="tsp-form-group">
                    <label>
                        <input type="checkbox" id="ai-comic-mode-enabled">
                        <span>启用漫画模式</span>
                    </label>
                    <div class="tsp-form-hint">开启后，聊天插入预设中的 {{worldInfo}} 将替换为下方选项组合生成的漫画专用提示词，不再使用挂载的世界书内容。</div>
                    <div class="tsp-form-hint">本功能预设参考原项目 <a href="https://github.com/xiagaogaozi/sillytavern-nai-manga-preset" target="_blank" rel="noopener noreferrer">xiagaogaozi/sillytavern-nai-manga-preset</a>，已获取原作者修改授权。</div>
                </div>

                <div class="tsp-form-group" id="ai-comic-color-group">
                    <label>色彩</label>
                    <div>
                        ${radio('comic-color', '彩色', colorVal === '彩色')}
                        ${radio('comic-color', '黑白', colorVal === '黑白')}
                    </div>
                </div>

                <div class="tsp-form-group" id="ai-comic-page-count-group">
                    <label>图片数量</label>
                    <div style="display:flex;align-items:center;flex-wrap:wrap;gap:6px 0;">
                        <label style="display:inline-flex;align-items:center;gap:6px;cursor:pointer;">
                            <input type="radio" name="comic-page-count" value="手动" ${pageCountModeVal === '手动' ? 'checked' : ''}>
                            <span>手动</span>
                        </label>
                        <input type="number" class="tsp-input" id="ai-comic-page-count-n" min="1" max="20" step="1" value="${pageCountNVal}" title="手动模式固定页数，建议最多6页" style="width:64px;padding:2px 6px;margin:0 16px 0 6px;font-style:normal;">
                        ${radio('comic-page-count', '动态', pageCountModeVal === '动态')}
                    </div>
                    <div class="tsp-form-hint">手动：固定页数（输入框可随时修改，建议最多6页）；动态：由AI按本轮台本的事件数量、文字量及画格容量自行决定页数。</div>
                </div>

                <div class="tsp-form-group" id="ai-comic-storyboard-group">
                    <label>分镜</label>
                    <div>
                        ${radio('comic-storyboard', '经典四格', storyboardVal === '经典四格')}
                        ${radio('comic-storyboard', '少年热血', storyboardVal === '少年热血')}
                        ${radio('comic-storyboard', '悬疑推理', storyboardVal === '悬疑推理')}
                        ${radio('comic-storyboard', '本子肉感', storyboardVal === '本子肉感')}
                        ${radio('comic-storyboard', 'yo恋爱少女', storyboardVal === 'yo恋爱少女')}
                        ${radio('comic-storyboard', 'yo轻松日常', storyboardVal === 'yo轻松日常')}
                        ${radio('comic-storyboard', 'yo喜剧日常', storyboardVal === 'yo喜剧日常')}
                    </div>
                </div>

                <div class="tsp-form-group" id="ai-comic-blank-group">
                    <label>留白</label>
                    <div>
                        ${radio('comic-blank-space', '天地出血', blankVal === '天地出血')}
                        ${radio('comic-blank-space', '全封闭内枠', blankVal === '全封闭内枠')}
                        ${radio('comic-blank-space', '沉浸全出血', blankVal === '沉浸全出血')}
                        ${radio('comic-blank-space', '纯黑线无白边', blankVal === '纯黑线无白边')}
                    </div>
                </div>

                <div class="tsp-form-group" id="ai-comic-language-group">
                    <label>对白语言</label>
                    <div>
                        ${radio('comic-dialogue-language', '简体中文', langVal === '简体中文')}
                        ${radio('comic-dialogue-language', '日文', langVal === '日文')}
                    </div>
                </div>

                <div class="tsp-form-group" id="ai-comic-style-group">
                    <label>画风预设</label>
                    <div>
                        ${radio('comic-style-preset', '黑白', styleVal === '黑白')}
                        ${radio('comic-style-preset', '柔光圆润', styleVal === '柔光圆润')}
                    </div>
                    <div class="tsp-form-hint">开启漫画模式后，生成图片时将所选画风的正面/负面提示词前置到「前置正面」与「前置负面」内（与提示词预设的添加方式一致）。提</div>
                </div>
            </div>
        `;
    }

    /**
     * [漫画模式] 设置单选组的选中项
     */
    _setComicRadioGroup(groupEl, value) {
        if (!groupEl) return;
        groupEl.querySelectorAll('input[type="radio"]').forEach(r => {
            r.checked = r.value === value;
        });
    }

    /**
     * [漫画模式] 读取单选组的选中值
     */
    _getComicRadioValue(groupEl) {
        if (!groupEl) return '';
        const checked = groupEl.querySelector('input[type="radio"]:checked');
        return checked ? checked.value : '';
    }

    _renderRealtimeDataPanel() {
        return `
            <div class="ai-settings-section">
                <h4>实时数据收集设置</h4>
                <div class="tsp-form-group">
                    <label>
                        <input type="checkbox" id="ai-realtime-data-enabled">
                        <span>实时数据开启</span>
                    </label>
                    <div class="tsp-form-hint">开启后，当“聊天插入”返回内容时，将自动发起绘图角色数据收集请求，并把结果保存到最新楼层的 <code>TSP_Drawing_CharacterData</code> 字段（不会保存在用户消息中）。默认关闭。</div>
                </div>
            </div>

            <div class="ai-settings-section">
                <h4>绘图角色数据查看与编辑</h4>
                <div class="tsp-form-group">
                    <div class="tsp-realtime-toolbar">
                        <button type="button" id="ai-realtime-data-refresh" class="tsp-btn"><i class="fa-solid fa-rotate"></i> 刷新数据</button>
                        <span class="tsp-form-hint">展示当前最新楼层中的 <code>TSP_Drawing_CharacterData</code> 数据。点击“编辑”可修改对应角色，保存后仅更新该角色，其余角色数据保持不变。</span>
                    </div>
                    <div id="ai-realtime-data-view" class="tsp-realtime-data-view"></div>
                </div>
            </div>

            <div class="ai-settings-section">
                <div class="ai-regex-header">
                    <h4 id="ai-drawing-tmpl-header" style="cursor: pointer; user-select: none; display: flex; align-items: center; gap: 8px; margin: 0; border-bottom: none; padding-bottom: 0; flex: 1;">
                        <span><i class="fa-solid fa-palette"></i> 绘图角色数据收集模板 (预设)</span>
                        <i class="fa-solid fa-chevron-right" id="ai-drawing-tmpl-icon" style="font-size: 0.8em; color: var(--tsp-text-muted); transition: transform 0.2s;"></i>
                    </h4>
                    <div class="ai-regex-actions">
                        <button class="tsp-btn tsp-btn-sm tsp-btn-danger" id="ai-drawing-tmpl-delete" title="删除当前预设">
                            <i class="fa-solid fa-trash"></i>
                        </button>
                        <button class="tsp-btn tsp-btn-sm tsp-btn-primary" id="ai-drawing-tmpl-export" title="导出当前预设">
                            <i class="fa-solid fa-download"></i>
                        </button>
                        <button class="tsp-btn tsp-btn-sm tsp-btn-primary" id="ai-drawing-tmpl-import" title="导入新预设">
                            <i class="fa-solid fa-upload"></i>
                        </button>
                        <button class="tsp-btn tsp-btn-sm tsp-btn-primary" id="ai-drawing-tmpl-save-as" title="另存为新预设">
                            <i class="fa-solid fa-save"></i> 另存为
                        </button>
                    </div>
                </div>

                <div id="ai-drawing-tmpl-body" style="display: none;">
                    <div class="tsp-form-group">
                        <label>当前选择模板</label>
                        <select class="tsp-input" id="ai-drawing-tmpl-select">
                            <!-- 动态填充 -->
                        </select>
                        <div class="tsp-form-hint">实时数据收集将使用当前选中的模板。可用占位符：
                            <br><code>{{currentPlot}}</code> : 最新楼层正文
                            <br><code>{{current_label}}</code> : 最新楼层一致性标签
                            <br><code>{{Character_Record}}</code> : 历史角色数据记录
                        </div>
                    </div>

                    <div class="ai-regex-actions" style="margin-top: 5px; margin-bottom: 5px;">
                        <button class="tsp-btn tsp-btn-sm tsp-btn-success" id="ai-drawing-msg-add">
                            <i class="fa-solid fa-plus"></i> 添加一行
                        </button>
                        <button class="tsp-btn tsp-btn-sm" id="ai-drawing-msg-reset">
                            <i class="fa-solid fa-undo"></i> 恢复默认
                        </button>
                    </div>

                    <div id="ai-drawing-msg-list" class="tsp-list" style="max-height: 500px; overflow-y: auto; padding: 5px; border: 1px solid var(--tsp-border); border-radius: 4px;">
                        <!-- JS 动态填充消息列表 -->
                    </div>
                </div>
            </div>

            <!-- 绘图角色数据收集 自定义 Tool 工具配置（开启后实时数据收集请求注入 function tools，默认收缩） -->
            <div class="ai-settings-section">
                <div class="ai-regex-header">
                    <h4 id="ai-drawing-tool-header" style="cursor: pointer; user-select: none; display: flex; align-items: center; gap: 8px; margin: 0; border-bottom: none; padding-bottom: 0; flex: 1;">
                        <span><i class="fa-solid fa-wrench"></i> 绘图数据收集 Tool 工具配置 (Function Call)</span>
                        <i class="fa-solid fa-chevron-right" id="ai-drawing-tool-icon" style="font-size: 0.8em; color: var(--tsp-text-muted); transition: transform 0.2s;"></i>
                    </h4>
                    <div class="ai-regex-actions">
                        <button class="tsp-btn tsp-btn-sm" id="ai-drawing-tool-restore" title="恢复默认配置">
                            <i class="fa-solid fa-rotate-left"></i>
                        </button>
                        <button class="tsp-btn tsp-btn-sm tsp-btn-primary" id="ai-drawing-tool-export" title="导出工具配置">
                            <i class="fa-solid fa-download"></i>
                        </button>
                        <button class="tsp-btn tsp-btn-sm tsp-btn-primary" id="ai-drawing-tool-import" title="导入工具配置">
                            <i class="fa-solid fa-upload"></i>
                        </button>
                    </div>
                </div>

                <div id="ai-drawing-tool-body" style="display: none;">
                    <div class="tsp-form-group">
                        <label>
                            <input type="checkbox" id="ai-drawing-tool-enabled">
                            <span>启用自定义 Tool 工具</span>
                        </label>
                        <div class="tsp-form-hint">开启后，绘图角色数据收集请求（直连与酒馆代理回退）会注入一个 function 工具，并把模型返回的 tool_calls 参数按字段顺序组装为正文（可用于强制模型走工具调用输出结构化角色 JSON）。要求所用接口支持 OpenAI function-calling 协议。</div>
                    </div>

                    <div id="ai-drawing-tool-details">
                        <div class="tsp-form-row">
                            <div class="tsp-form-group">
                                <label>工具命名方式</label>
                                <select class="tsp-input" id="ai-drawing-tool-name-mode">
                                    <option value="dynamic">动态随机生成 (前缀 + 随机值，防缓存)</option>
                                    <option value="fixed">固定工具名称</option>
                                </select>
                            </div>
                            <div class="tsp-form-group" id="ai-drawing-tool-fixed-name-row">
                                <label>固定工具名</label>
                                <input type="text" class="tsp-input" id="ai-drawing-tool-fixed-name" placeholder="例如: chami_emit_data">
                            </div>
                        </div>

                        <div class="tsp-form-row">
                            <div class="tsp-form-group">
                                <label>动态名称前缀</label>
                                <input type="text" class="tsp-input" id="ai-drawing-tool-prefix" placeholder="chami_emit_">
                                <div class="tsp-form-hint">动态命名时使用的前缀，随机后缀会自动拼接。</div>
                            </div>
                            <div class="tsp-form-group">
                                <label>tool_choice</label>
                                <select class="tsp-input" id="ai-drawing-tool-choice">
                                    <option value="auto">auto (模型自行决定是否调用)</option>
                                    <option value="required">required (强制必须调用工具)</option>
                                </select>
                            </div>
                        </div>

                        <div class="tsp-form-group">
                            <label>工具用途描述 (description)</label>
                            <textarea class="tsp-input" id="ai-drawing-tool-desc" rows="3" style="width: 100%; font-family: monospace; font-size: 13px;" placeholder="引导模型何时以及如何调用该工具"></textarea>
                        </div>

                        <div class="ai-regex-actions" style="margin-top: 5px; margin-bottom: 5px;">
                            <button class="tsp-btn tsp-btn-sm tsp-btn-success" id="ai-drawing-tool-field-add">
                                <i class="fa-solid fa-plus"></i> 添加参数字段
                            </button>
                        </div>
                        <div class="tsp-form-hint">
                            模型调用工具后，将按下列字段顺序提取参数并组装为正文。包裹标签不为空时（如 <code>thinking</code>），该字段会被 <code>&lt;标签&gt;…&lt;/标签&gt;</code> 包裹。
                        </div>
                        <div id="ai-drawing-tool-field-list" class="tsp-list" style="max-height: 400px; overflow-y: auto; padding: 5px; margin-top: 5px; border: 1px solid var(--tsp-border); border-radius: 4px;">
                            <!-- JS 动态填充工具参数字段列表 -->
                        </div>
                    </div>
                </div>
            </div>
        `;
    }

    /**
     * [新增] 找到绘图角色数据的保存目标与最新数据
     * targetMessage 为最新的一条 AI 楼层（非用户消息），编辑保存将写入该楼层。
     * latestData 为 chat 中最新的 TSP_Drawing_CharacterData（用于展示与作为合并底子）。
     */
    _findDrawingDataTarget() {
        if (!chat || !Array.isArray(chat) || chat.length === 0) {
            return { targetMessage: null, latestData: {} };
        }
        // 1. 最新 AI 楼层（跳过用户消息）
        let targetMessage = null;
        for (let i = chat.length - 1; i >= 0; i--) {
            const msg = chat[i];
            if (msg && !msg.is_user) {
                targetMessage = msg;
                break;
            }
        }
        // 2. 最新存在的绘图角色数据
        let latestData = {};
        if (targetMessage && targetMessage.TSP_Drawing_CharacterData && typeof targetMessage.TSP_Drawing_CharacterData === 'object') {
            latestData = targetMessage.TSP_Drawing_CharacterData;
        } else {
            for (let i = chat.length - 1; i >= 0; i--) {
                const msg = chat[i];
                if (!msg || msg.is_user) continue;
                if (msg.TSP_Drawing_CharacterData && typeof msg.TSP_Drawing_CharacterData === 'object') {
                    latestData = msg.TSP_Drawing_CharacterData;
                    break;
                }
            }
        }
        return { targetMessage, latestData };
    }

    /**
     * [新增] 渲染绘图角色数据查看面板
     */
    _renderRealtimeDataView() {
        const viewEl = this.modalEl.querySelector('#ai-realtime-data-view');
        if (!viewEl) return;
        const { latestData } = this._findDrawingDataTarget();
        const names = Object.keys(latestData || {});
        if (names.length === 0) {
            viewEl.innerHTML = '<div class="tsp-form-hint">当前最新楼层暂无绘图角色数据。开启“实时数据”并在聊天插入返回内容后会自动收集，或点击“刷新数据”。</div>';
            return;
        }
        let html = '';
        for (const name of names) {
            const fields = latestData[name] && typeof latestData[name] === 'object' ? latestData[name] : {};
            const entries = Object.entries(fields);
            html += `
                <div class="tsp-realtime-char">
                    <div class="tsp-realtime-char-header">
                        <strong>${this._escapeHtml(name)}</strong>
                        <div class="tsp-realtime-char-actions">
                            <button type="button" class="tsp-btn tsp-btn-primary" data-action="edit" data-name="${this._escapeHtml(name)}"><i class="fa-solid fa-pen"></i> 编辑</button>
                            <button type="button" class="tsp-btn tsp-btn-sm" data-action="delete" data-name="${this._escapeHtml(name)}" title="删除此角色数据" style="color:var(--tsp-accent-danger, #e74c3c);"><i class="fa-solid fa-trash"></i></button>
                        </div>
                    </div>
                    <div class="tsp-realtime-char-body">
                        ${entries.length === 0
                            ? '<span class="tsp-form-hint">（无字段）</span>'
                            : entries.map(([k, v]) => `
                                <div class="tsp-realtime-field"><span class="tsp-realtime-field-key">${this._escapeHtml(k)}</span><span class="tsp-realtime-field-val">${this._escapeHtml(String(v))}</span></div>
                            `).join('')}
                    </div>
                </div>
            `;
        }
        viewEl.innerHTML = html;
    }

    /**
     * [新增] 进入某个角色的编辑模式
     */
    _enterEditMode(name) {
        const viewEl = this.modalEl.querySelector('#ai-realtime-data-view');
        if (!viewEl) return;
        const { latestData } = this._findDrawingDataTarget();
        const fields = latestData[name] && typeof latestData[name] === 'object' ? latestData[name] : {};
        let html = `
            <div class="tsp-realtime-char tsp-realtime-editing" data-name="${this._escapeHtml(name)}">
                <div class="tsp-realtime-char-header">
                    <strong>编辑角色</strong>
                </div>
                <div class="tsp-realtime-edit-row">
                    <label>角色名</label>
                    <input type="text" data-charname value="${this._escapeHtml(name)}">
                </div>
                <div class="tsp-realtime-edit-fields">
        `;
        for (const [k, v] of Object.entries(fields)) {
            html += this._editFieldRowHtml(k, v);
        }
        html += `
                </div>
                <div class="tsp-btn-group" style="flex:1; align-self: flex-end; justify-content: flex-end;">
                    <button type="button" class="tsp-btn" data-action="add-field"><i class="fa-solid fa-plus"></i> 添加字段</button>
                    <button type="button" class="tsp-btn tsp-btn-primary" data-action="save-edit"><i class="fa-solid fa-save"></i> 保存</button>
                    <button type="button" class="tsp-btn tsp-btn-danger" data-action="cancel-edit"><i class="fa-solid fa-times"></i> 取消</button>
                </div>
            </div>
        `;
        viewEl.innerHTML = html;
    }

    /**
     * [新增] 生成一个字段编辑行
     */
    _editFieldRowHtml(k, v) {
        return `
            <div class="tsp-realtime-field-row">
                <input type="text" data-fieldname placeholder="字段名" value="${this._escapeHtml(k)}">
                <input type="text" data-fieldvalue placeholder="值" value="${this._escapeHtml(String(v ?? ''))}">
                <button type="button" class="tsp-realtime-row-del" data-action="remove-field" title="删除字段">✕</button>
            </div>
        `;
    }

    /**
     * [新增] 在编辑表单中添加一个空白字段行
     */
    _addEditField() {
        const fieldsEl = this.modalEl.querySelector('.tsp-realtime-edit-fields');
        if (fieldsEl) {
            fieldsEl.insertAdjacentHTML('beforeend', this._editFieldRowHtml('', ''));
        }
    }

    /**
     * [新增] 删除一个字段行
     */
    _removeEditField(btn) {
        const row = btn.closest('.tsp-realtime-field-row');
        if (row) row.remove();
    }

    /**
     * [新增] 保存编辑后的角色数据到最新楼层
     * 合并规则（参考 phone-minutes 的追加/复制逻辑）：
     * 以最新楼层数据为底子，仅覆盖/追加当前编辑的角色；未编辑的其他角色数据原样保留。
     */
    async _saveEditedCharacter() {
        const form = this.modalEl.querySelector('#ai-realtime-data-view .tsp-realtime-editing');
        if (!form) return;
        const oldName = form.dataset.name;
        const newNameInput = form.querySelector('[data-charname]');
        const newName = (newNameInput ? newNameInput.value.trim() : '') || oldName;

        // 收集字段（跳过空的字段名）
        const fields = {};
        form.querySelectorAll('.tsp-realtime-field-row').forEach(row => {
            const fname = row.querySelector('[data-fieldname]')?.value.trim();
            const fvalue = row.querySelector('[data-fieldvalue]')?.value ?? '';
            if (fname) fields[fname] = fvalue;
        });

        const { targetMessage, latestData } = this._findDrawingDataTarget();
        if (!targetMessage) {
            this.ctx.helpers.showToast('未找到可保存的楼层', 'warning');
            return;
        }

        // 以最新数据为底子，仅更新/追加当前角色；其余角色保留
        const merged = { ...latestData };
        delete merged[oldName];
        merged[newName] = fields;

        targetMessage.TSP_Drawing_CharacterData = merged;
        if (typeof saveChat === 'function') {
            await saveChat();
        }
        this.ctx.helpers.showToast(`绘图角色数据已保存到最新楼层（角色: ${newName}）`, 'success');
        this._renderRealtimeDataView();
    }

    /**
     * [新增] HTML 转义，防止注入
     */
    _escapeHtml(str) {
        return String(str ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    _renderRegexPanel() {
        return `
            <div class="ai-settings-section">
                <div class="ai-regex-header">
                    <h4>正则替换规则</h4>
                    <div class="ai-regex-actions">
                        <!-- 确保这里的 ID 正确 -->
                        <button class="tsp-btn tsp-btn-sm" id="ai-regex-export" title="导出规则">
                            <i class="fa-solid fa-download"></i>
                        </button>
                        <button class="tsp-btn tsp-btn-sm" id="ai-regex-import" title="导入规则">
                            <i class="fa-solid fa-upload"></i>
                        </button>
                        <button class="tsp-btn tsp-btn-sm tsp-btn-primary" id="ai-regex-add">
                            <i class="fa-solid fa-plus"></i> 添加规则
                        </button>
                    </div>
                </div>
                <div class="tsp-form-hint">
                    在 AI 返回结果后应用正则替换规则 (点击箭头展开/折叠详情)
                </div>

                <div class="ai-regex-list" id="ai-regex-list">
                    <!-- 动态填充 -->
                </div>
            </div>

            <!-- [新增] 内容替换词规则区块（发送给AI前清理） -->
            <div class="ai-settings-section">
                <div class="ai-regex-header ai-word-replacements-header">
                    <h4>内容替换词规则 <span class="tsp-form-hint" style="font-weight:normal;font-size:12px;">(发送给AI前清理)</span></h4>
                    <div class="ai-regex-actions">
                        <button class="tsp-btn tsp-btn-sm" id="ai-replacement-restore-defaults" title="恢复默认规则">
                            <i class="fa-solid fa-rotate-left"></i> 恢复默认
                        </button>
                        <button class="tsp-btn tsp-btn-sm" id="ai-replacement-export" title="导出规则">
                            <i class="fa-solid fa-download"></i>
                        </button>
                        <button class="tsp-btn tsp-btn-sm" id="ai-replacement-import" title="导入规则">
                            <i class="fa-solid fa-upload"></i>
                        </button>
                        <button class="tsp-btn tsp-btn-sm tsp-btn-primary" id="ai-chat-insertion-add-replacement">
                            <i class="fa-solid fa-plus"></i> 添加规则
                        </button>
                    </div>
                </div>
                <div class="tsp-form-hint">
                    发送给AI前对所有内容（世界书、上下文、历史等）进行替换词清理。支持用 <code>|</code> 分隔多个词共用同一替换目标，或勾选「正则」使用正则模式。
                </div>
                <div id="ai-chat-insertion-sanitize-container">
                    <div id="ai-chat-insertion-word-replacements" class="ai-regex-list"></div>
                </div>
            </div>
        `;
    }

    /**
     * [新增] 渲染帮助导航面板
     */
    _renderHelpNavPanel() {
        const chatVer = this.aiProcessor.constructor.CHAT_TEMPLATES_VERSION;
        const drawingVer = this.aiProcessor.constructor.DRAWING_TEMPLATES_VERSION;
        return `
            <div class="ai-settings-section">
                <h3><i class="fa-solid fa-circle-question"></i> 帮助导航 — 设置向导</h3>
                <div class="tsp-form-hint" style="margin-bottom: 16px;">
                    本向导将引导你完成插件的核心配置，包括预设导入、工具开关、插入模式、历史楼层和世界书挂载。<br>
                    点击下方"开始导航"按钮即可启动多步骤设置向导。
                </div>
                <div style="display:flex; gap:12px; flex-wrap:wrap; margin-bottom: 16px;">
                    <button class="tsp-btn tsp-btn-primary tsp-btn-lg" id="ai-helpnav-start">
                        <i class="fa-solid fa-play"></i> 开始导航
                    </button>
                    <button class="tsp-btn tsp-btn-lg" id="ai-helpnav-sync">
                        <i class="fa-solid fa-rotate"></i> 同步更新
                    </button>
                </div>
                <div class="tsp-form-group" style="background: var(--tsp-bg-input); padding: 12px; border-radius: 6px; border: 1px solid var(--tsp-border);">
                    <div style="font-weight:600; margin-bottom:8px;">版本信息</div>
                    <div class="tsp-form-hint">
                        聊天插入模板版本: <code>${chatVer}</code> ｜ 绘图角色数据模板版本: <code>${drawingVer}</code><br>
                        当模板版本更新时，导航按钮上会出现 <span style="color:var(--tsp-accent-danger, #e74c3c); font-weight:bold;">!</span> 标记提醒你重新执行向导。
                    </div>
                </div>
            </div>
        `;
    }

    /**
     * [新增] 检查帮助导航版本是否需要更新（显示感叹号）
     */
    _checkHelpNavVersion() {
        const badge = this.modalEl?.querySelector('#ai-helpnav-badge');
        if (!badge) return;
        const config = this.aiProcessor.config || this.aiProcessor.settings;
        const chatChanged = config.helpNavSeenChatVersion !== this.aiProcessor.constructor.CHAT_TEMPLATES_VERSION;
        const drawingChanged = config.helpNavSeenDrawingVersion !== this.aiProcessor.constructor.DRAWING_TEMPLATES_VERSION;
        badge.style.display = (chatChanged || drawingChanged) ? '' : 'none';
    }

    /**
     * [新增] 标记帮助导航已完成（更新 seen 版本号）
     */
    async _markHelpNavComplete() {
        const config = this.aiProcessor.config || this.aiProcessor.settings;
        config.helpNavSeenChatVersion = this.aiProcessor.constructor.CHAT_TEMPLATES_VERSION;
        config.helpNavSeenDrawingVersion = this.aiProcessor.constructor.DRAWING_TEMPLATES_VERSION;
        // [修复] 持久化版本号到配置文件，否则下次加载时被默认值 '0' 覆盖，导致每次都显示感叹号
        await this.aiProcessor.saveSettings();
        this._checkHelpNavVersion();
    }

    /**
     * [新增] 多步骤向导弹窗
     */
    async _showHelpWizard() {
        let currentStep = 0;
        const totalSteps = 7;
        const wizardState = {
            useTools: true,
            useBase64: true,
            insertionMode: 'auto',        // 'auto' | 'uniform' | 'none'
            historyDepth: 1,
            readUserMessages: false,       // true=读取user消息, false=不读取
            autoClick: false,              // 自动触发聊天插入
            selectedWorldBook: null
        };

        const dialog = document.createElement('div');
        dialog.className = 'tsp-modal-overlay visible';
        dialog.style.zIndex = '100002';
        document.body.appendChild(dialog);

        const renderStep = (step) => {
            const titles = [
                '第 1 步：初始化',
                '第 2 步：自定义 Tool 工具',
                '第 3 步：末尾干扰注意力',
                '第 4 步：插入方式',
                '第 5 步：历史楼层与用户消息',
                '第 6 步：自动触发',
                '第 7 步：挂载世界书'
            ];

            let bodyHtml = '';

            if (step === 0) {
                bodyHtml = `
                    <p>本步骤将执行以下操作：</p>
                    <ul style="margin:12px 0; padding-left:20px; line-height:1.8;">
                        <li><b>导入/更新默认预设</b>：导入系统内置的默认预设模板（覆盖同名预设）</li>
                        <li><b>恢复默认消息结构</b>：将聊天插入的消息模板重置为系统默认结构</li>
                    </ul>
                    <p class="tsp-form-hint" style="color: var(--tsp-accent-warning, #f39c12);">⚠ 执行后会覆盖当前的同名预设和消息模板，请确认无重要自定义内容。</p>
                `;
            } else if (step === 1) {
                bodyHtml = `
                    <p>是否启用自定义 Tool 工具？</p>
                    <p class="tsp-form-hint">启用后，AI请求会注入 function tools，强制模型通过工具调用输出结构化数据（推荐启用）。</p>
                    <div style="display:flex; gap:12px; margin-top:16px;">
                        <label style="cursor:pointer;"><input type="radio" name="wizard-tools" value="yes" ${wizardState.useTools ? 'checked' : ''}> <span>是，启用</span></label>
                        <label style="cursor:pointer;"><input type="radio" name="wizard-tools" value="no" ${!wizardState.useTools ? 'checked' : ''}> <span>否，不启用</span></label>
                    </div>
                `;
            } else if (step === 2) {
                bodyHtml = `
                    <p>是否使用末尾干扰注意力（随机base64注入）？</p>
                    <p class="tsp-form-hint">启用后，在提示词模板末尾追加一条固定文本的user消息，用于干扰AI注意力防止思维链泄漏。</p>
                    <div style="display:flex; gap:12px; margin-top:16px;">
                        <label style="cursor:pointer;"><input type="radio" name="wizard-base64" value="yes" ${wizardState.useBase64 ? 'checked' : ''}> <span>是，启用</span></label>
                        <label style="cursor:pointer;"><input type="radio" name="wizard-base64" value="no" ${!wizardState.useBase64 ? 'checked' : ''}> <span>否，不启用</span></label>
                    </div>
                `;
            } else if (step === 3) {
                bodyHtml = `
                    <p>选择聊天插入的方式：</p>
                    <div style="display:flex; flex-direction:column; gap:12px; margin-top:16px;">
                        <label style="cursor:pointer; padding:8px; border:1px solid var(--tsp-border); border-radius:4px;">
                            <input type="radio" name="wizard-insertion" value="auto" ${wizardState.insertionMode === 'auto' ? 'checked' : ''}>
                            <b>智能插入模式</b> <span class="tsp-form-hint">基于剧情锚点自动定位插入位置</span>
                        </label>
                        <label style="cursor:pointer; padding:8px; border:1px solid var(--tsp-border); border-radius:4px;">
                            <input type="radio" name="wizard-insertion" value="uniform" ${wizardState.insertionMode === 'uniform' ? 'checked' : ''}>
                            <b>均匀插入模式</b> <span class="tsp-form-hint">在文本中均匀分布图片</span>
                        </label>
                        <label style="cursor:pointer; padding:8px; border:1px solid var(--tsp-border); border-radius:4px;">
                            <input type="radio" name="wizard-insertion" value="none" ${wizardState.insertionMode === 'none' ? 'checked' : ''}>
                            <b>不启用</b> <span class="tsp-form-hint">手动追加模式</span>
                        </label>
                    </div>
                `;
            } else if (step === 4) {
                bodyHtml = `
                    <p>设置读取历史楼层数与是否读取 user 消息：</p>
                    <div class="tsp-form-group" style="margin-top:16px;">
                        <label>历史楼层层数（推荐 1）</label>
                        <input type="number" class="tsp-input" id="wizard-history-depth" min="1" max="50" value="${wizardState.historyDepth}" style="width:100px;">
                        <div class="tsp-form-hint">设置从当前楼层往前读取多少层的消息内容作为上下文。</div>
                    </div>
                    <div class="tsp-form-group" style="margin-top:12px;">
                        <label style="cursor:pointer;">
                            <input type="checkbox" id="wizard-read-user" ${wizardState.readUserMessages ? 'checked' : ''}>
                            <span>读取 user 用户消息</span>
                        </label>
                        <div class="tsp-form-hint">勾选后，AI会读取用户消息作为参考；不勾选则只收集角色消息。</div>
                    </div>
                `;
            } else if (step === 5) {
                bodyHtml = `
                    <p>是否启用自动触发聊天插入？</p>
                    <p class="tsp-form-hint">启用后，AI 输出完成时会自动点击"插入"按钮，无需手动操作。</p>
                    <div style="display:flex; gap:12px; margin-top:16px;">
                        <label style="cursor:pointer;"><input type="radio" name="wizard-autoclick" value="yes" ${wizardState.autoClick ? 'checked' : ''}> <span>是，自动触发</span></label>
                        <label style="cursor:pointer;"><input type="radio" name="wizard-autoclick" value="no" ${!wizardState.autoClick ? 'checked' : ''}> <span>否，手动触发</span></label>
                    </div>
                `;
            } else if (step === 6) {
                bodyHtml = `
                    <p>选择要挂载的世界书：</p>
                    <p class="tsp-form-hint">从下方列表中选择一个世界书，选择后将清掉已有挂载。</p>
                    <div style="margin:12px 0;">
                        <div style="font-weight:600; margin-bottom:6px;"><i class="fa-solid fa-database"></i> 已导入的世界书</div>
                        <div id="wizard-worldbook-list" style="max-height:140px; overflow-y:auto; border:1px solid var(--tsp-border); border-radius:4px; padding:4px;">
                            <p class="tsp-form-hint" style="text-align:center;">加载中...</p>
                        </div>
                    </div>
                    <div style="margin:12px 0;">
                        <div style="font-weight:600; margin-bottom:6px;"><i class="fa-solid fa-folder-open"></i> 内置世界书 (data/TheWorldBook)</div>
                        <div id="wizard-builtin-worldbook-list" style="max-height:140px; overflow-y:auto; border:1px solid var(--tsp-border); border-radius:4px; padding:4px;">
                            <p class="tsp-form-hint" style="text-align:center;">加载中...</p>
                        </div>
                    </div>
                    <div id="wizard-worldbook-selected" style="margin-top:8px; min-height:24px;"></div>
                `;
            }

            const isLast = step === totalSteps - 1;
            const isFirst = step === 0;

            dialog.innerHTML = `
                <div class="tsp-modal" style="max-width:560px;">
                    <div class="tsp-modal-header">
                        <div class="tsp-modal-title">${titles[step]} (${step + 1}/${totalSteps})</div>
                    </div>
                    <div class="tsp-modal-body">${bodyHtml}</div>
                    <div class="tsp-modal-footer">
                        ${!isFirst ? '<button class="tsp-btn ai-wizard-prev"><i class="fa-solid fa-arrow-left"></i> 上一步</button>' : ''}
                        <button class="tsp-btn ai-wizard-cancel">取消</button>
                        ${isLast
                            ? '<button class="tsp-btn tsp-btn-primary ai-wizard-finish"><i class="fa-solid fa-check"></i> 完成</button>'
                            : '<button class="tsp-btn tsp-btn-primary ai-wizard-next">下一步 <i class="fa-solid fa-arrow-right"></i></button>'}
                    </div>
                </div>
            `;

        };

        // [修复] 在离开当前步骤前收集用户输入（原放在 renderStep 内时机错误：
        //   渲染新步骤后 DOM 已被覆盖，用户在上一页的选择无法收集到）
        const collectStepInput = () => {
            if (currentStep === 1) {
                const val = dialog.querySelector('input[name="wizard-tools"]:checked');
                if (val) wizardState.useTools = val.value === 'yes';
            } else if (currentStep === 2) {
                const val = dialog.querySelector('input[name="wizard-base64"]:checked');
                if (val) wizardState.useBase64 = val.value === 'yes';
            } else if (currentStep === 3) {
                const val = dialog.querySelector('input[name="wizard-insertion"]:checked');
                if (val) wizardState.insertionMode = val.value;
            } else if (currentStep === 4) {
                const depthInput = dialog.querySelector('#wizard-history-depth');
                if (depthInput) wizardState.historyDepth = Math.max(1, Math.min(50, parseInt(depthInput.value) || 1));
                const readUser = dialog.querySelector('#wizard-read-user');
                if (readUser) wizardState.readUserMessages = readUser.checked;
            } else if (currentStep === 5) {
                const val = dialog.querySelector('input[name="wizard-autoclick"]:checked');
                if (val) wizardState.autoClick = val.value === 'yes';
            }
        };

        // 选中某个世界书（已导入或内置），更新 wizardState 和 UI
        const selectWorldBook = (name, itemEl, containerSelector) => {
            // 清除两个列表中所有项的高亮
            dialog.querySelectorAll('.ai-wizard-wb-item').forEach(i => {
                i.style.background = '';
                const chk = i.querySelector('.ai-wb-check');
                if (chk) chk.style.display = 'none';
            });
            itemEl.style.background = 'var(--tsp-bg-hover, rgba(0,0,0,0.05))';
            const chk = itemEl.querySelector('.ai-wb-check');
            if (chk) chk.style.display = '';
            wizardState.selectedWorldBook = name;
            const selDiv = dialog.querySelector('#wizard-worldbook-selected');
            if (selDiv) selDiv.innerHTML = `已选择: <b>${this._escapeHtml(name)}</b>`;
        };

        // 加载已导入的世界书列表
        const loadWorldBookList = async () => {
            const container = dialog.querySelector('#wizard-worldbook-list');
            if (!container) return;
            try {
                const allBooks = await this.aiProcessor.getAllWorldBooks() || [];
                if (allBooks.length === 0) {
                    container.innerHTML = '<p class="tsp-form-hint" style="text-align:center;">暂无已导入的世界书</p>';
                    return;
                }
                container.innerHTML = allBooks.map(wb => `
                    <div class="ai-wizard-wb-item" data-name="${this._escapeHtml(wb.name)}" style="padding:6px 8px; cursor:pointer; border-radius:4px; display:flex; justify-content:space-between; align-items:center;">
                        <span><i class="fa-solid fa-book" style="margin-right:6px;"></i>${this._escapeHtml(wb.name)}</span>
                        <i class="fa-solid fa-check ai-wb-check" style="display:none; color:var(--tsp-accent-success, #27ae60);"></i>
                    </div>
                `).join('');
                container.querySelectorAll('.ai-wizard-wb-item').forEach(item => {
                    item.addEventListener('click', () => selectWorldBook(item.dataset.name, item));
                });
            } catch (e) {
                container.innerHTML = `<p class="tsp-form-hint" style="color:red;">加载失败: ${e.message}</p>`;
            }
        };

        // 加载 data/TheWorldBook 目录下的内置世界书
        const loadBuiltinWorldBooks = async () => {
            const container = dialog.querySelector('#wizard-builtin-worldbook-list');
            if (!container) return;
            try {
                // 参考 tag-data-source.js 的路径检测机制获取插件根目录
                let basePath = '';
                if (typeof import.meta !== 'undefined' && import.meta.url) {
                    try {
                        const moduleUrl = new URL(import.meta.url);
                        basePath = moduleUrl.pathname.replace(/\/[^/]+\.js$/, '');
                    } catch (_) {}
                }
                if (!basePath) {
                    const scripts = document.querySelectorAll('script[src*="chami_tavern-scene-plugin"]');
                    for (const script of Array.from(scripts)) {
                        try {
                            const src = script.getAttribute('src') || '';
                            if (src) {
                                const scriptUrl = new URL(src, window.location.href);
                                basePath = scriptUrl.pathname.replace(/\/[^/]+\.js$/, '');
                                break;
                            }
                        } catch (_) { continue; }
                    }
                }

                // 构建可能的插件根路径 URL
                const possibleBaseUrls = [
                    '/scripts/extensions/third-party/chami_tavern-scene-plugin',
                    basePath && basePath.includes('chami_tavern-scene-plugin')
                        ? basePath.replace(/\/modules$/, '').replace(/\/ui$/, '')
                        : null,
                    basePath ? basePath.replace(/\/modules$/, '').replace(/\/ui$/, '') : null,
                ].filter(Boolean);

                // 先尝试读取 manifest.json 清单文件
                const manifestUrls = possibleBaseUrls.map(b => `${b}/data/TheWorldBook/manifest.json`);
                let fileNames = null;
                let dirBaseUrl = null;

                for (const manifestUrl of manifestUrls) {
                    try {
                        this.ctx.log('ai-settings', `[向导] 尝试加载清单: ${manifestUrl}`);
                        const resp = await fetch(manifestUrl);
                        if (!resp.ok) continue;
                        const manifest = await resp.json();
                        if (Array.isArray(manifest) && manifest.length > 0) {
                            fileNames = manifest.map(f => typeof f === 'string' ? f : f.name).filter(Boolean);
                            dirBaseUrl = manifestUrl.replace(/\/manifest\.json$/, '/');
                            this.ctx.log('ai-settings', `[向导] 清单加载成功，共 ${fileNames.length} 个文件`);
                            break;
                        }
                    } catch (e) {
                        this.ctx.log('ai-settings', `[向导] 清单加载失败 (${manifestUrl}): ${e.message}`);
                    }
                }

                // 如果清单不存在，尝试目录列表（部分服务器可能开启）
                if (!fileNames) {
                    for (const baseUrl of possibleBaseUrls) {
                        const dirUrl = `${baseUrl}/data/TheWorldBook/`;
                        try {
                            this.ctx.log('ai-settings', `[向导] 尝试列目录: ${dirUrl}`);
                            const resp = await fetch(dirUrl);
                            if (!resp.ok) continue;
                            const html = await resp.text();
                            const matches = [];
                            const linkRegex = /href="([^"]+\.json)"/gi;
                            let m;
                            while ((m = linkRegex.exec(html)) !== null) {
                                let fn = m[1];
                                try { fn = decodeURIComponent(fn); } catch (_) {}
                                fn = fn.split('/').pop();
                                if (fn && fn !== 'manifest.json' && !matches.includes(fn)) {
                                    matches.push(fn);
                                }
                            }
                            if (matches.length > 0) {
                                fileNames = matches;
                                dirBaseUrl = dirUrl;
                                this.ctx.log('ai-settings', `[向导] 列目录成功，共 ${matches.length} 个文件`);
                                break;
                            }
                        } catch (_) {}
                    }
                }

                if (!fileNames || fileNames.length === 0) {
                    container.innerHTML = '<p class="tsp-form-hint" style="text-align:center;">未找到内置世界书。<br>请在 <code>data/TheWorldBook/manifest.json</code> 中列出文件名。</p>';
                    return;
                }

                // 构建文件 URL
                if (!dirBaseUrl) dirBaseUrl = possibleBaseUrls[0] + '/data/TheWorldBook/';
                const fileList = fileNames.map(name => ({
                    name,
                    url: dirBaseUrl + encodeURIComponent(name)
                }));

                // 获取已导入的世界书名称列表，用于标记
                const existingBooks = await this.aiProcessor.getAllWorldBooks() || [];
                const importedNames = new Set(existingBooks.map(b => b.name));

                container.innerHTML = fileList.map(f => {
                    const fileName = f.name.replace(/\.(json|js)$/, '');
                    const isImported = importedNames.has(fileName);
                    return `
                    <div class="ai-wizard-wb-item ai-wizard-builtin-wb" data-name="${this._escapeHtml(f.name)}" data-url="${this._escapeHtml(f.url)}" data-imported="${isImported}" style="padding:6px 8px; cursor:pointer; border-radius:4px; display:flex; justify-content:space-between; align-items:center;">
                        <span><i class="fa-solid ${isImported ? 'fa-check-circle' : 'fa-file-arrow-up'}" style="margin-right:6px; ${isImported ? 'color:var(--tsp-accent-success, #27ae60);' : ''}"></i>${this._escapeHtml(f.name)}</span>
                        <span class="tsp-form-hint" style="font-size:11px; ${isImported ? 'color:var(--tsp-accent-success, #27ae60); font-weight:600;' : ''}">${isImported ? '已导入' : '点击导入'}</span>
                    </div>
                    `;
                }).join('');
                container.querySelectorAll('.ai-wizard-builtin-wb').forEach(item => {
                    item.addEventListener('click', async () => {
                        const name = item.dataset.name;
                        const url = item.dataset.url;
                        if (!name || !url) return;
                        const fileName = name.replace(/\.(json|js)$/, '');
                        const isAlreadyImported = item.dataset.imported === 'true';

                        // 已导入的文件：询问是直接使用还是重新导入覆盖
                        if (isAlreadyImported) {
                            const choice = await this.ctx.helpers.promptConfirm(
                                `世界书 "${fileName}" 已导入。\n点击"确定"重新导入（覆盖现有数据），\n点击"取消"直接使用已导入的版本。`
                            );
                            if (!choice) {
                                // 用户选择取消 = 直接使用已导入的版本
                                selectWorldBook(fileName, item);
                                return;
                            }
                            // 用户选择确定 = 继续执行导入（覆盖）
                        }

                        // 导入文件
                        item.style.opacity = '0.5';
                        item.style.pointerEvents = 'none';
                        try {
                            const resp = await fetch(url);
                            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
                            let content = await resp.text();
                            if (name.endsWith('.js')) {
                                const match = content.match(/\{[\s\S]*\}/);
                                if (match) content = match[0];
                            }
                            let parsedData = JSON.parse(content);
                            if (typeof parsedData.entries !== 'object' || parsedData.entries === null) {
                                throw new Error("文件缺少 'entries' 对象");
                            }
                            parsedData = this._sanitizeWorldBookData(parsedData);
                            await this.aiProcessor.addOrUpdateWorldBook({ name: fileName, data: parsedData, enabled: true });
                            this.ctx.helpers.showToast(`世界书 "${fileName}" ${isAlreadyImported ? '已重新导入' : '导入成功'}`, 'success');
                            // 刷新已导入列表和内置列表标记
                            await loadWorldBookList();
                            await loadBuiltinWorldBooks();
                            // 选中刚导入的（在已导入列表中）
                            const newItem = dialog.querySelector(`#wizard-worldbook-list .ai-wizard-wb-item[data-name="${this._escapeHtml(fileName)}"]`);
                            if (newItem) {
                                selectWorldBook(fileName, newItem);
                            } else {
                                selectWorldBook(fileName, item);
                            }
                        } catch (err) {
                            this.ctx.helpers.showToast(`导入失败: ${err.message}`, 'error');
                            item.style.opacity = '';
                            item.style.pointerEvents = '';
                        }
                    });
                });
            } catch (e) {
                container.innerHTML = `<p class="tsp-form-hint" style="color:red;">加载内置世界书失败: ${e.message}</p>`;
            }
        };

        return new Promise((resolve) => {
            const goToStep = async (step) => {
                if (step < 0) { dialog.remove(); resolve(false); return; }
                if (step >= totalSteps) { dialog.remove(); resolve(true); return; }
                currentStep = step;
                renderStep(step);

                // 步骤7：加载已导入列表 + 内置世界书列表
                if (step === 6) {
                    await loadWorldBookList();
                    await loadBuiltinWorldBooks();
                }

                // 绑定按钮
                dialog.querySelector('.ai-wizard-cancel')?.addEventListener('click', () => { dialog.remove(); resolve(false); });
                dialog.querySelector('.ai-wizard-prev')?.addEventListener('click', () => { collectStepInput(); goToStep(currentStep - 1); });
                dialog.querySelector('.ai-wizard-next')?.addEventListener('click', async () => {
                    // [修复] 离开当前步骤前收集用户输入，否则 DOM 被覆盖后选择丢失
                    collectStepInput();
                    // 第1步点击下一步时执行初始化操作
                    if (currentStep === 0) {
                        const btn = dialog.querySelector('.ai-wizard-next');
                        if (btn) { btn.disabled = true; btn.textContent = '正在初始化...'; }
                        try {
                            // 触发"导入/更新默认预设"
                            await this.aiProcessor.importDefaultPresets();
                            this.allPresets = await this.aiProcessor.getAllPresets();
                            if (this.currentPreset) {
                                const updated = this.allPresets.find(p => p.name === this.currentPreset.name);
                                if (updated) {
                                    this.currentPreset = updated;
                                    await this.loadPresetToUI(this.currentPreset);
                                }
                            }
                            this._updatePresetSelect();

                            // 触发"恢复默认结构"（ai-chat-msg-reset 逻辑）
                            const config = this.aiProcessor.config || this.aiProcessor.settings;
                            const defaultTemplates = this.aiProcessor._getAllDefaultChatTemplates();
                            const existingTemplates = config.chatInsertionTemplates || [];
                            const updatedTemplates = [...existingTemplates];
                            defaultTemplates.forEach(dt => {
                                const idx = updatedTemplates.findIndex(t => t.name === dt.name);
                                if (idx >= 0) updatedTemplates[idx] = JSON.parse(JSON.stringify(dt));
                                else updatedTemplates.push(JSON.parse(JSON.stringify(dt)));
                            });
                            config.chatInsertionTemplates = updatedTemplates;
                            config.activeChatInsertionTemplateName = '通用智能剧情插入';
                            this._updateChatTemplateSelect(config);

                            // 恢复绘图角色数据模板（实时数据）
                            const defaultDrawingTemplates = this.aiProcessor._getAllDefaultDrawingCharacterTemplates();
                            config.drawingCharacterDataTemplates = defaultDrawingTemplates.map(t => ({
                                name: t.name,
                                messages: JSON.parse(JSON.stringify(t.messages))
                            }));
                            config.activeDrawingCharacterDataTemplateName = '默认角色数据模板';
                            this._updateDrawingTemplateSelect();

                            // 设置默认预设并启用聊天插入（关闭其他预设的聊天插入避免冲突）
                            const defaultPresetName = 'gemini预设';
                            for (const p of this.allPresets) {
                                p.enableForChatInsertion = (p.name === defaultPresetName);
                                p.isEnabled = false; // 不自动启用主开关，避免冲突
                                await this.aiProcessor.addOrUpdatePreset(p);
                            }
                            // 切换到默认预设并加载到 UI
                            const targetPreset = this.allPresets.find(p => p.name === defaultPresetName);
                            if (targetPreset) {
                                this.currentPreset = targetPreset;
                                if (this.elements.presetSelect) {
                                    this.elements.presetSelect.value = defaultPresetName;
                                }
                                await this.loadPresetToUI(targetPreset);
                                // 触发 change 事件同步互斥逻辑（取消启用此预设勾选）
                                if (this.elements.enableForChatInsertionCheckbox) {
                                    this.elements.enableForChatInsertionCheckbox.dispatchEvent(new Event('change'));
                                }
                            }

                            // 同步导入默认时的其他设置
                            if (this.elements.enablePrecedingContext) this.elements.enablePrecedingContext.checked = false;
                            if (this.elements.enableStoryContext) this.elements.enableStoryContext.checked = false;
                            if (this.elements.batchAutoRequest) this.elements.batchAutoRequest.checked = false;
                            if (this.elements.enableTagRef) this.elements.enableTagRef.checked = false;
                            if (this.elements.tagLibLengthBlocklist) this.elements.tagLibLengthBlocklist.value = '1';
                            if (this.elements.enableTagLibRef) this.elements.enableTagLibRef.checked = true;
                            if (this.elements.chatInsertionConsistency) this.elements.chatInsertionConsistency.checked = true;

                            // [修复] 持久化第一步的所有配置变更（模板、全局设置等）到配置文件
                            await this.aiProcessor.saveSettings();

                            this.ctx.helpers.showToast('预设导入和结构恢复完成', 'success');
                        } catch (e) {
                            this.ctx.helpers.showToast('初始化失败: ' + e.message, 'error');
                        } finally {
                            if (btn) { btn.disabled = false; btn.innerHTML = '下一步 <i class="fa-solid fa-arrow-right"></i>'; }
                        }
                    }
                    goToStep(currentStep + 1);
                });

                if (currentStep === totalSteps - 1) {
                    dialog.querySelector('.ai-wizard-finish')?.addEventListener('click', async () => {
                        const finishBtn = dialog.querySelector('.ai-wizard-finish');
                        if (finishBtn) { finishBtn.disabled = true; finishBtn.textContent = '正在应用...'; }
                        try {
                            await this._applyWizardSettings(wizardState);
                            this._markHelpNavComplete();
                            this.ctx.helpers.showToast('向导设置已应用！', 'success');
                        } catch (e) {
                            this.ctx.helpers.showToast('应用设置失败: ' + e.message, 'error');
                        }
                        dialog.remove();
                        resolve(true);
                    });
                }
            };
            goToStep(0);
        });
    }

    /**
     * [新增] 应用向导收集的设置到UI
     */
    async _applyWizardSettings(state) {
        // 第2步：工具开关
        if (this.elements.chatToolEnabled) {
            this.elements.chatToolEnabled.checked = state.useTools;
            // [修复] 手动触发 change 事件，同步工具面板显示/隐藏与配置
            this.elements.chatToolEnabled.dispatchEvent(new Event('change'));
        }

        // 第3步：base64 注入
        if (this.elements.chatInsertionRandomBase64) {
            this.elements.chatInsertionRandomBase64.checked = state.useBase64;
            this.elements.chatInsertionRandomBase64.dispatchEvent(new Event('change'));
        }

        // 第4步：插入模式
        if (this.elements.chatInsertionAutoMode && this.elements.chatInsertionUniformMode) {
            this.elements.chatInsertionAutoMode.checked = (state.insertionMode === 'auto');
            this.elements.chatInsertionUniformMode.checked = (state.insertionMode === 'uniform');
            this.elements.chatInsertionAutoMode.dispatchEvent(new Event('change'));
            this.elements.chatInsertionUniformMode.dispatchEvent(new Event('change'));
        }

        // 第5步：历史楼层与用户消息
        if (this.elements.chatInsertionDepth) {
            this.elements.chatInsertionDepth.value = state.historyDepth;
            this.elements.chatInsertionDepth.dispatchEvent(new Event('change'));
        }
        if (this.elements.chatInsertionIgnoreUser) {
            this.elements.chatInsertionIgnoreUser.checked = !state.readUserMessages;
            this.elements.chatInsertionIgnoreUser.dispatchEvent(new Event('change'));
        }

        // 第6步：自动触发聊天插入
        if (this.elements.chatInsertionAutoClick) {
            this.elements.chatInsertionAutoClick.checked = state.autoClick;
            this.elements.chatInsertionAutoClick.dispatchEvent(new Event('change'));
        }

        // 第7步：世界书挂载（清掉已有，挂载选中的）
        if (state.selectedWorldBook && this.currentPreset) {
            this.currentPreset.worldBookNames = [state.selectedWorldBook];
            if (this.elements.useWorldBook) {
                this.elements.useWorldBook.checked = true;
                this.elements.useWorldBook.dispatchEvent(new Event('change'));
            }
            this._renderSelectedWorldBooks?.();
            this._updateAvailableWorldBookHighlights?.();
        }
    }

    _renderAdvancedPanel() {
        return `
            <div class="ai-settings-section">
                <h4>剧情参考抓取</h4>
                <div class="tsp-form-group">
                    <label>
                        <input type="checkbox" id="ai-enable-story-context">
                        <span>启用剧情参考 (标记模式)</span>
                    </label>
                    <div class="tsp-form-hint">使用标记符号抓取聊天中的剧情内容</div>
                </div>
                <div class="tsp-form-row">
                    <div class="tsp-form-group">
                        <label>开始标记 (Start)</label>
                        <input type="text" class="tsp-input" id="ai-context-start" placeholder="例如: [" value="[">
                    </div>
                    <div class="tsp-form-group">
                        <label>结束标记 (End)</label>
                        <input type="text" class="tsp-input" id="ai-context-end" placeholder="例如: ]" value="]">
                    </div>
                </div>
                <div class="tsp-form-group">
                    <label>
                        <input type="checkbox" id="ai-enable-preceding-context">
                        <span>启用标签前抓取模式</span>
                    </label>
                    <div class="tsp-form-hint">将抓取的内容作为主要输入，忽略按钮原始提示词</div>
                </div>

                <!--  原生世界书注入区域 -->
                <div class="tsp-form-group" style="margin-top: 10px; border-top: 1px dashed #ccc; padding-top: 10px;">
                    <label>SillyTavern 原生世界书 (用于注入占位符)</label>
                    <div class="tsp-input-group">
                        <select class="tsp-input" id="ai-native-wi-select">
                            <option value="">请选择世界书...</option>
                            <!-- JS 动态填充 -->
                        </select>
                        <button class="tsp-btn tsp-btn-primary" id="ai-inject-placeholder" title="注入绘图占位符条目">
                            <i class="fa-solid fa-syringe"></i> 注入
                        </button>
                    </div>
                    <div class="tsp-form-hint">向选定的原生世界书中注入"绘图占位符"蓝灯条目(D模式, 深度0, 顺序8888)。</div>
                </div>
                <!--  结束 -->

            </div>

            <div class="ai-settings-section">
                <h4>批量处理</h4>
                <div class="tsp-form-group">
                    <label>批量处理数量</label>
                    <input type="number" class="tsp-input" id="ai-batch-count"
                           min="0" max="20" value="0">
                    <div class="tsp-form-hint">设为 0 禁用批量处理，>1 启用</div>
                </div>
                <div class="tsp-form-group">
                    <label>
                        <input type="checkbox" id="ai-batch-auto-request">
                        <span>启用批量自动请求</span>
                    </label>
                    <div class="tsp-form-hint">当队列中的任务达到批量数量或遇到边界按钮时自动发起请求</div>
                </div>
            </div>

            <div class="ai-settings-section">
                <h4>Tag 库过滤</h4>
                <div class="tsp-form-group">
                    <label>标签黑名单 (用 | 分隔)</label>
                    <input type="text" class="tsp-input" id="ai-taglib-blocklist"
                           placeholder="标签1|标签2|标签3">
                </div>
                <div class="tsp-form-group">
                    <label>长度黑名单 (用 | 分隔)</label>
                    <input type="text" class="tsp-input" id="ai-taglib-length-blocklist"
                           placeholder="1|2">
                    <div class="tsp-form-hint">忽略指定长度的标签</div>
                </div>
            </div>

            <div class="ai-settings-section">
                <h4>预设管理</h4>
                <div class="tsp-form-row">
                     <!--  导入默认预设按钮 -->
                    <button class="tsp-btn tsp-btn-primary" id="ai-import-defaults" style="flex: 1;">
                        <i class="fa-solid fa-file-import"></i> 导入/更新默认预设
                    </button>
                    <!-- 原有的重置按钮 -->
                    <button class="tsp-btn tsp-btn-danger" id="ai-reset-presets" style="flex: 1;">
                        <i class="fa-solid fa-undo"></i> 恢复初始状态(清空)
                    </button>
                </div>
                 <div class="tsp-form-hint">
                    "导入": 添加或更新默认预设(保留其他自定义预设)。 <br>
                    "恢复": ⚠️ 删除所有预设并重置为初始状态。
                </div>
            </div>
        `;
    }


    _cacheElements() {
        this.elements = {

            presetSelect: this.modalEl.querySelector('#ai-preset-select'),
            enabledCheckbox: this.modalEl.querySelector('#ai-enabled'),
            enableForTagSupermarketCheckbox: this.modalEl.querySelector('#ai-enable-for-tag-supermarket'),
            enableForChatInsertionCheckbox: this.modalEl.querySelector('#ai-enable-for-chat-insertion'),
            apiUrl: this.modalEl.querySelector('#ai-api-url'),
            apiKey: this.modalEl.querySelector('#ai-api-key'),
            model: this.modalEl.querySelector('#ai-model'),
            temperature: this.modalEl.querySelector('#ai-temperature'),
            maxTokens: this.modalEl.querySelector('#ai-max-tokens'),
            stream: this.modalEl.querySelector('#ai-stream'),
            streamLabel: this.modalEl.querySelector('#ai-stream-label'),
            systemPrompt: this.modalEl.querySelector('#ai-system-prompt'),
            userPrompt: this.modalEl.querySelector('#ai-user-prompt'),
            targetFeatures: this.modalEl.querySelector('#ai-target-features'),

            cloneNativeWiSelect: this.modalEl.querySelector('#ai-clone-native-wi-select'),
            cloneNativeBtn: this.modalEl.querySelector('#ai-clone-native-btn'),

            useWorldBook: this.modalEl.querySelector('#ai-use-worldbook'),
            worldBookSelected: this.modalEl.querySelector('#ai-worldbook-selected'),
            worldBookList: this.modalEl.querySelector('#ai-worldbook-list'),


            enableTagRef: this.modalEl.querySelector('#ai-enable-tag-ref'),
            enableTagLibRef: this.modalEl.querySelector('#ai-enable-taglib-ref'),
            tagRefFolders: this.modalEl.querySelector('#ai-tagref-folders'),


            regexList: this.modalEl.querySelector('#ai-regex-list'),


            enableStoryContext: this.modalEl.querySelector('#ai-enable-story-context'),
            contextStart: this.modalEl.querySelector('#ai-context-start'),
            contextEnd: this.modalEl.querySelector('#ai-context-end'),
            enablePrecedingContext: this.modalEl.querySelector('#ai-enable-preceding-context'),
            nativeWiSelect: this.modalEl.querySelector('#ai-native-wi-select'),
            injectPlaceholderBtn: this.modalEl.querySelector('#ai-inject-placeholder'),
            batchCount: this.modalEl.querySelector('#ai-batch-count'),
            batchAutoRequest: this.modalEl.querySelector('#ai-batch-auto-request'),
            tagLibBlocklist: this.modalEl.querySelector('#ai-taglib-blocklist'),
            tagLibLengthBlocklist: this.modalEl.querySelector('#ai-taglib-length-blocklist'),

            //  聊天插入设置元素
            chatInsertionDepth: this.modalEl.querySelector('#ai-chat-insertion-depth'),
            chatInsertionUseRegex: this.modalEl.querySelector('#ai-chat-insertion-use-regex'),
            chatInsertionStartTag: this.modalEl.querySelector('#ai-chat-insertion-start-tag'),
            chatInsertionEndTag: this.modalEl.querySelector('#ai-chat-insertion-end-tag'),
            chatInsertionAutoMode: this.modalEl.querySelector('#ai-chat-insertion-auto-mode'),
            chatInsertionUniformMode: this.modalEl.querySelector('#ai-chat-insertion-uniform-mode'),
            chatInsertionAutoClick: this.modalEl.querySelector('#ai-chat-insertion-auto-click'),
            chatInsertionSkipImageCheck: this.modalEl.querySelector('#ai-chat-insertion-skip-image-check'),
            chatInsertionRandomBase64: this.modalEl.querySelector('#ai-chat-insertion-random-base64'),
            chatInsertionUseTavernProxy: this.modalEl.querySelector('#ai-chat-insertion-use-tavern-proxy'),
            chatInsertionConsistency: this.modalEl.querySelector('#ai-chat-insertion-consistency'),
            chatInsertionWorldbookStrict: this.modalEl.querySelector('#ai-chat-insertion-worldbook-strict'),
            chatInsertionIgnoreUser: this.modalEl.querySelector('#ai-chat-insertion-ignore-user'),
            chatInsertionSanitizeEnabled: this.modalEl.querySelector('#ai-chat-insertion-sanitize-enabled'),
            chatInsertionWordReplacements: this.modalEl.querySelector('#ai-chat-insertion-word-replacements'),
            chatInsertionAddReplacementBtn: this.modalEl.querySelector('#ai-chat-insertion-add-replacement'),

            //  漫画模式设置元素
            comicModeEnabled: this.modalEl.querySelector('#ai-comic-mode-enabled'),
            comicModeColorGroup: this.modalEl.querySelector('#ai-comic-color-group'),
            comicModePageCountGroup: this.modalEl.querySelector('#ai-comic-page-count-group'),
            comicModePageCountN: this.modalEl.querySelector('#ai-comic-page-count-n'),
            comicModeStoryboardGroup: this.modalEl.querySelector('#ai-comic-storyboard-group'),
            comicModeBlankGroup: this.modalEl.querySelector('#ai-comic-blank-group'),
            comicModeLanguageGroup: this.modalEl.querySelector('#ai-comic-language-group'),
            comicModeStyleGroup: this.modalEl.querySelector('#ai-comic-style-group'),

            //  实时数据设置元素
            realtimeDataEnabled: this.modalEl.querySelector('#ai-realtime-data-enabled'),
            replacementRestoreDefaultsBtn: this.modalEl.querySelector('#ai-replacement-restore-defaults'),
            replacementExportBtn: this.modalEl.querySelector('#ai-replacement-export'),
            replacementImportBtn: this.modalEl.querySelector('#ai-replacement-import'),

            //  模板管理元素
            chatTemplateSelect: this.modalEl.querySelector('#ai-chat-template-select'),
            chatTemplateSaveAs: this.modalEl.querySelector('#ai-chat-tmpl-save-as'),
            chatTemplateDelete: this.modalEl.querySelector('#ai-chat-tmpl-delete'),
            chatTemplateExport: this.modalEl.querySelector('#ai-chat-tmpl-export'),
            chatTemplateImport: this.modalEl.querySelector('#ai-chat-tmpl-import'),

            //  绘图角色数据收集模板元素
            drawingTemplateSelect: this.modalEl.querySelector('#ai-drawing-tmpl-select'),
            drawingTemplateSaveAs: this.modalEl.querySelector('#ai-drawing-tmpl-save-as'),
            drawingTemplateDelete: this.modalEl.querySelector('#ai-drawing-tmpl-delete'),
            drawingTemplateExport: this.modalEl.querySelector('#ai-drawing-tmpl-export'),
            drawingTemplateImport: this.modalEl.querySelector('#ai-drawing-tmpl-import'),

            //  自定义 Tool 工具配置元素
            chatToolEnabled: this.modalEl.querySelector('#ai-chat-tool-enabled'),
            chatToolDetails: this.modalEl.querySelector('#ai-chat-tool-details'),
            chatToolNameMode: this.modalEl.querySelector('#ai-chat-tool-name-mode'),
            chatToolFixedNameRow: this.modalEl.querySelector('#ai-chat-tool-fixed-name-row'),
            chatToolFixedName: this.modalEl.querySelector('#ai-chat-tool-fixed-name'),
            chatToolPrefix: this.modalEl.querySelector('#ai-chat-tool-prefix'),
            chatToolChoice: this.modalEl.querySelector('#ai-chat-tool-choice'),
            chatToolDesc: this.modalEl.querySelector('#ai-chat-tool-desc'),
            chatToolFieldList: this.modalEl.querySelector('#ai-chat-tool-field-list'),
            chatToolFieldAdd: this.modalEl.querySelector('#ai-chat-tool-field-add'),
            chatToolRestore: this.modalEl.querySelector('#ai-chat-tool-restore'),
            chatToolExport: this.modalEl.querySelector('#ai-chat-tool-export'),
            chatToolImport: this.modalEl.querySelector('#ai-chat-tool-import'),

            //  绘图数据收集自定义 Tool 工具配置元素
            drawingToolEnabled: this.modalEl.querySelector('#ai-drawing-tool-enabled'),
            drawingToolDetails: this.modalEl.querySelector('#ai-drawing-tool-details'),
            drawingToolNameMode: this.modalEl.querySelector('#ai-drawing-tool-name-mode'),
            drawingToolFixedNameRow: this.modalEl.querySelector('#ai-drawing-tool-fixed-name-row'),
            drawingToolFixedName: this.modalEl.querySelector('#ai-drawing-tool-fixed-name'),
            drawingToolPrefix: this.modalEl.querySelector('#ai-drawing-tool-prefix'),
            drawingToolChoice: this.modalEl.querySelector('#ai-drawing-tool-choice'),
            drawingToolDesc: this.modalEl.querySelector('#ai-drawing-tool-desc'),
            drawingToolFieldList: this.modalEl.querySelector('#ai-drawing-tool-field-list'),
            drawingToolFieldAdd: this.modalEl.querySelector('#ai-drawing-tool-field-add'),
            drawingToolRestore: this.modalEl.querySelector('#ai-drawing-tool-restore'),
            drawingToolExport: this.modalEl.querySelector('#ai-drawing-tool-export'),
            drawingToolImport: this.modalEl.querySelector('#ai-drawing-tool-import'),
        };
    }

    bindEvents() {
        // === 基础模态框事件 ===
        this.modalEl.querySelector('#ai-settings-close').addEventListener('click', () => {
            this.saveAndClose();
        });

        // === 模板区块：标题点击折叠/展开（默认收缩） ===
        [
            { header: '#ai-chat-tmpl-header', body: '#ai-chat-tmpl-body', icon: '#ai-chat-tmpl-icon' },
            { header: '#ai-drawing-tmpl-header', body: '#ai-drawing-tmpl-body', icon: '#ai-drawing-tmpl-icon' },
            { header: '#ai-chat-tool-header', body: '#ai-chat-tool-body', icon: '#ai-chat-tool-icon' },
            { header: '#ai-drawing-tool-header', body: '#ai-drawing-tool-body', icon: '#ai-drawing-tool-icon' }
        ].forEach(({ header, body, icon }) => {
            const headerEl = this.modalEl.querySelector(header);
            const bodyEl = this.modalEl.querySelector(body);
            const iconEl = this.modalEl.querySelector(icon);
            if (!headerEl || !bodyEl || !iconEl) return;
            headerEl.addEventListener('click', () => {
                const isHidden = bodyEl.style.display === 'none';
                bodyEl.style.display = isHidden ? 'block' : 'none';
                iconEl.classList.toggle('fa-chevron-right', !isHidden);
                iconEl.classList.toggle('fa-chevron-down', isHidden);
            });
        });

        this.modalEl.addEventListener('click', (e) => {
            if (e.target === this.modalEl) {
                this.saveAndClose();
            }
        });

        // === 导航栏切换 ===
        this.modalEl.querySelectorAll('.ai-settings-nav li').forEach(li => {
            li.addEventListener('click', () => {
                const panel = li instanceof HTMLElement ? li.dataset?.panel : undefined;
                this._switchPanel(panel);
            });
        });

        // === 预设管理事件 ===
        this.elements.presetSelect.addEventListener('change', async (e) => {
            const presetName = e.target.value;
            const preset = this.allPresets.find(p => p.name === presetName);
            if (preset) {
                this.currentPreset = preset;
                await this.loadPresetToUI(preset);
            }
        });
        this.elements.enabledCheckbox.addEventListener('change', (e) => {
            if (e.target.checked) {
                this.elements.enableForChatInsertionCheckbox.checked = false;
            }
        });
        if (this.elements.stream && this.elements.streamLabel) {
            this.elements.stream.addEventListener('change', (e) => {
                const on = e.target.checked;
                this.elements.streamLabel.textContent = on ? '开启' : '关闭';
                this.elements.streamLabel.style.color = on ? 'var(--tsp-accent-green)' : 'var(--tsp-text-muted)';
            });
        }
        // 如果勾选了"聊天插入预设"，自动取消"启用此预设"
        this.elements.enableForChatInsertionCheckbox.addEventListener('change', (e) => {
            if (e.target.checked) {
                this.elements.enabledCheckbox.checked = false;
            }
        });
        this.modalEl.querySelector('#ai-settings-save').addEventListener('click', () => {
            this.saveSettings();
        });

        this.modalEl.querySelector('#ai-settings-test').addEventListener('click', () => {
            this.testConnection();
        });

        // [帮助导航] 开始导航按钮
        this.modalEl.querySelector('#ai-helpnav-start')?.addEventListener('click', async () => {
            await this._showHelpWizard();
        });

        // [帮助导航] 同步更新按钮——一键触发绘图模板/预设导入/聊天结构/Tool配置恢复 + 记录版本
        this.modalEl.querySelector('#ai-helpnav-sync')?.addEventListener('click', async () => {
            const syncBtn = this.modalEl.querySelector('#ai-helpnav-sync');
            if (syncBtn) { syncBtn.disabled = true; syncBtn.textContent = '同步中...'; }
            try {
                const config = this.aiProcessor.config || this.aiProcessor.settings;

                // 1. 恢复绘图角色数据模板（实时数据）
                const defaultDrawingTemplates = this.aiProcessor._getAllDefaultDrawingCharacterTemplates();
                config.drawingCharacterDataTemplates = defaultDrawingTemplates.map(t => ({
                    name: t.name,
                    messages: JSON.parse(JSON.stringify(t.messages))
                }));
                config.activeDrawingCharacterDataTemplateName = '默认角色数据模板';
                this._updateDrawingTemplateSelect();

                // 2. 导入/更新默认预设
                await this.aiProcessor.importDefaultPresets();
                this.allPresets = await this.aiProcessor.getAllPresets();
                if (this.currentPreset) {
                    const updated = this.allPresets.find(p => p.name === this.currentPreset.name);
                    if (updated) {
                        this.currentPreset = updated;
                        await this.loadPresetToUI(this.currentPreset);
                    }
                }
                this._updatePresetSelect();

                // 3. 恢复聊天插入默认结构
                const defaultChatTemplates = this.aiProcessor._getAllDefaultChatTemplates();
                const existingTemplates = config.chatInsertionTemplates || [];
                const updatedTemplates = [...existingTemplates];
                defaultChatTemplates.forEach(dt => {
                    const idx = updatedTemplates.findIndex(t => t.name === dt.name);
                    if (idx >= 0) updatedTemplates[idx] = JSON.parse(JSON.stringify(dt));
                    else updatedTemplates.push(JSON.parse(JSON.stringify(dt)));
                });
                config.chatInsertionTemplates = updatedTemplates;
                config.activeChatInsertionTemplateName = '通用智能剧情插入';
                this._updateChatTemplateSelect(config);

                // 4. 恢复 Tool 工具默认配置（保留 enabled 状态）
                const currentToolEnabled = config.chatInsertionToolConfig?.enabled === true;
                const newToolCfg = JSON.parse(JSON.stringify(this.aiProcessor._getDefaultChatInsertionToolConfig()));
                newToolCfg.enabled = currentToolEnabled;
                config.chatInsertionToolConfig = newToolCfg;
                this._loadToolConfigToUI('chat', config);

                // 5. 同步其他设置（与导入默认预设一致）
                if (this.elements.enablePrecedingContext) this.elements.enablePrecedingContext.checked = false;
                if (this.elements.enableStoryContext) this.elements.enableStoryContext.checked = false;
                if (this.elements.batchAutoRequest) this.elements.batchAutoRequest.checked = false;
                if (this.elements.enableTagRef) this.elements.enableTagRef.checked = false;
                if (this.elements.tagLibLengthBlocklist) this.elements.tagLibLengthBlocklist.value = '1';
                if (this.elements.enableTagLibRef) this.elements.enableTagLibRef.checked = true;
                if (this.elements.chatInsertionConsistency) this.elements.chatInsertionConsistency.checked = true;

                // 6. 持久化所有变更
                await this.aiProcessor.saveSettings();

                // 7. 记录版本（消除感叹号）
                await this._markHelpNavComplete();

                this.ctx.helpers.showToast('同步更新完成！', 'success');
            } catch (e) {
                this.ctx.helpers.showToast('同步更新失败: ' + e.message, 'error');
            } finally {
                if (syncBtn) { syncBtn.disabled = false; syncBtn.innerHTML = '<i class="fa-solid fa-rotate"></i> 同步更新'; }
            }
        });

        // [帮助导航] 初始化时检查版本号
        this._checkHelpNavVersion();

        this.modalEl.querySelector('#ai-fetch-models').addEventListener('click', () => {
            this.fetchModels();
        });

        this.modalEl.querySelector('#ai-preset-new').addEventListener('click', () => {
            this.createNewPreset();
        });
        this.modalEl.querySelector('#ai-preset-delete').addEventListener('click', () => {
            this.deleteCurrentPreset();
        });
        this.modalEl.querySelector('#ai-preset-export').addEventListener('click', () => {
            this.exportPreset();
        });
        this.modalEl.querySelector('#ai-preset-import').addEventListener('click', () => {
            this.importPreset();
        });

        // === 世界书面板事件 ===
        this.modalEl.querySelector('#ai-toggle-worldbook-preview').addEventListener('click', () => {
            this.toggleWorldBookPreview();
        });

        this.elements.cloneNativeBtn.addEventListener('click', () => {
            this.cloneNativeWorldBookToPlugin();
        });
        this.modalEl.querySelector('#ai-worldbook-import').addEventListener('click', () => {
            this.importWorldBook();
        });

        // === 正则规则面板事件 ===
        this.modalEl.querySelector('#ai-regex-add').addEventListener('click', () => {
            this.addRegexRule();
        });
        const regexExportBtn = this.modalEl.querySelector('#ai-regex-export');
        if (regexExportBtn) {
            regexExportBtn.addEventListener('click', () => this.exportRegexRules());
        }

        const regexImportBtn = this.modalEl.querySelector('#ai-regex-import');
        if (regexImportBtn) {
            regexImportBtn.addEventListener('click', () => this.importRegexRules());
        }

        // === [新增] 内容替换词事件 ===
        if (this.elements.chatInsertionAddReplacementBtn) {
            this.elements.chatInsertionAddReplacementBtn.addEventListener('click', () => {
                this._addReplacementRow();
            });
        }
        if (this.elements.chatInsertionSanitizeEnabled) {
            this.elements.chatInsertionSanitizeEnabled.addEventListener('change', (e) => {
                const container = this.modalEl.querySelector('#ai-chat-insertion-sanitize-container');
                if (container) {
                    container.style.display = e.target.checked ? '' : 'none';
                }
            });
        }
        if (this.elements.replacementRestoreDefaultsBtn) {
            this.elements.replacementRestoreDefaultsBtn.addEventListener('click', () => {
                this._restoreDefaultReplacements();
            });
        }
        if (this.elements.replacementExportBtn) {
            this.elements.replacementExportBtn.addEventListener('click', () => {
                this._exportReplacementRules();
            });
        }
        if (this.elements.replacementImportBtn) {
            this.elements.replacementImportBtn.addEventListener('click', () => {
                this._importReplacementRules();
            });
        }

        // === 实时数据面板事件 ===
        const realtimeRefreshBtn = this.modalEl.querySelector('#ai-realtime-data-refresh');
        if (realtimeRefreshBtn) {
            realtimeRefreshBtn.addEventListener('click', () => {
                const { latestData } = this._findDrawingDataTarget();
                const count = latestData ? Object.keys(latestData).length : 0;
                this.ctx.helpers.showToast(
                    count > 0 ? `已刷新：找到 ${count} 个角色的绘图数据` : '已刷新：当前最新楼层暂无绘图角色数据',
                    count > 0 ? 'success' : 'info'
                );
                this._renderRealtimeDataView();
            });
        }
        const realtimeViewEl = this.modalEl.querySelector('#ai-realtime-data-view');
        if (realtimeViewEl) {
            realtimeViewEl.addEventListener('click', async (e) => {
                const btn = e.target.closest('button[data-action]');
                if (!btn) return;
                const action = btn.dataset.action;
                const name = btn.dataset.name;
                if (action === 'edit') {
                    this._enterEditMode(name);
                } else if (action === 'delete') {
                    const confirmed = await this.ctx.helpers.promptConfirm(`确定删除角色 "${name}" 的数据吗？`);
                    if (!confirmed) return;
                    const { targetMessage, latestData } = this._findDrawingDataTarget();
                    if (!targetMessage || !targetMessage.TSP_Drawing_CharacterData) {
                        this.ctx.helpers.showToast('未找到可删除的数据', 'warning');
                        return;
                    }
                    delete targetMessage.TSP_Drawing_CharacterData[name];
                    if (typeof saveChat === 'function') {
                        await saveChat();
                    }
                    this.ctx.helpers.showToast(`已删除角色 "${name}" 的数据`, 'success');
                    this._renderRealtimeDataView();
                } else if (action === 'save-edit') {
                    await this._saveEditedCharacter();
                } else if (action === 'cancel-edit') {
                    this._renderRealtimeDataView();
                } else if (action === 'add-field') {
                    this._addEditField();
                } else if (action === 'remove-field') {
                    this._removeEditField(btn);
                }
            });
        }

        // === 绘图角色数据收集模板事件 ===
        // 1. 模板切换
        if (this.elements.drawingTemplateSelect) {
            this.elements.drawingTemplateSelect.addEventListener('change', (e) => {
                const settings = this.aiProcessor.settings || {};
                settings.activeDrawingCharacterDataTemplateName = e.target.value;
                const template = settings.drawingCharacterDataTemplates.find(t => t.name === e.target.value);
                if (template) {
                    this._renderDrawingMessageList(template.messages);
                    this.aiProcessor.saveConfig();
                }
            });
        }

        // 2. 另存为模板
        if (this.elements.drawingTemplateSaveAs) {
            this.elements.drawingTemplateSaveAs.addEventListener('click', async () => {
                const settings = this.aiProcessor.settings || {};
                const newName = await this.ctx.helpers.promptInput('请输入新预设名称：');
                if (!newName || !newName.trim()) return;
                const trimmedName = newName.trim();

                if (settings.drawingCharacterDataTemplates.some(t => t.name === trimmedName)) {
                    this.ctx.helpers.showToast('预设名称已存在', 'error');
                    return;
                }

                const activeName = settings.activeDrawingCharacterDataTemplateName || '默认角色数据模板';
                const current = settings.drawingCharacterDataTemplates.find(t => t.name === activeName);
                const messagesToCopy = current ? current.messages : [];

                settings.drawingCharacterDataTemplates.push({
                    name: trimmedName,
                    messages: JSON.parse(JSON.stringify(messagesToCopy))
                });
                settings.activeDrawingCharacterDataTemplateName = trimmedName;

                this._updateDrawingTemplateSelect();
                this.ctx.helpers.showToast(`预设 "${trimmedName}" 已保存并切换`, 'success');
                this.aiProcessor.saveConfig();
            });
        }

        // 3. 删除模板
        if (this.elements.drawingTemplateDelete) {
            this.elements.drawingTemplateDelete.addEventListener('click', async () => {
                const settings = this.aiProcessor.settings || {};
                const currentName = settings.activeDrawingCharacterDataTemplateName;

                if (settings.drawingCharacterDataTemplates.length <= 1) {
                    this.ctx.helpers.showToast('至少需要保留一个预设，无法删除。', 'warning');
                    return;
                }

                if (await this.ctx.helpers.promptConfirm(`确定要删除预设 "${currentName}" 吗？`)) {
                    settings.drawingCharacterDataTemplates = settings.drawingCharacterDataTemplates.filter(t => t.name !== currentName);
                    settings.activeDrawingCharacterDataTemplateName = settings.drawingCharacterDataTemplates[0].name;

                    this._updateDrawingTemplateSelect();
                    this.ctx.helpers.showToast('预设已删除', 'success');
                    this.aiProcessor.saveConfig();
                }
            });
        }

        // 4. 导出模板
        if (this.elements.drawingTemplateExport) {
            this.elements.drawingTemplateExport.addEventListener('click', () => {
                const settings = this.aiProcessor.settings || {};
                const currentName = settings.activeDrawingCharacterDataTemplateName;
                const template = settings.drawingCharacterDataTemplates.find(t => t.name === currentName);

                if (!template) {
                    this.ctx.helpers.showToast('找不到当前预设', 'error');
                    return;
                }

                const exportData = JSON.stringify(template, null, 2);
                const blob = new Blob([exportData], { type: 'application/json' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `${currentName}.json`;
                a.click();
                URL.revokeObjectURL(url);
                this.ctx.helpers.showToast('预设已导出', 'success');
            });
        }

        // 5. 导入模板
        if (this.elements.drawingTemplateImport) {
            this.elements.drawingTemplateImport.addEventListener('click', () => {
                const input = document.createElement('input');
                input.type = 'file';
                input.accept = '.json';
                input.onchange = async (e) => {
                    const file = e.target.files[0];
                    if (!file) return;

                    try {
                        const text = await file.text();
                        const importedTemplate = JSON.parse(text);

                        // 验证模板结构
                        if (!importedTemplate.name || !Array.isArray(importedTemplate.messages)) {
                            this.ctx.helpers.showToast('预设文件格式不正确', 'error');
                            return;
                        }

                        const settings = this.aiProcessor.settings || {};

                        // 检查是否已存在同名预设
                        const existingIndex = settings.drawingCharacterDataTemplates.findIndex(t => t.name === importedTemplate.name);
                        if (existingIndex >= 0) {
                            if (!await this.ctx.helpers.promptConfirm(`预设 "${importedTemplate.name}" 已存在，是否覆盖？`)) {
                                return;
                            }
                            settings.drawingCharacterDataTemplates[existingIndex] = importedTemplate;
                        } else {
                            settings.drawingCharacterDataTemplates.push(importedTemplate);
                        }

                        // 激活导入的预设
                        settings.activeDrawingCharacterDataTemplateName = importedTemplate.name;
                        this._updateDrawingTemplateSelect();
                        this.ctx.helpers.showToast('预设已导入', 'success');
                        this.aiProcessor.saveConfig();
                    } catch (err) {
                        console.error('Import error:', err);
                        this.ctx.helpers.showToast('导入失败：' + err.message, 'error');
                    }
                };
                input.click();
            });
        }

        // 6. 添加一行消息（追加条目）
        const drawingMsgAddBtn = this.modalEl.querySelector('#ai-drawing-msg-add');
        if (drawingMsgAddBtn) {
            drawingMsgAddBtn.addEventListener('click', () => {
                const settings = this.aiProcessor.settings || {};
                const activeName = settings.activeDrawingCharacterDataTemplateName;
                const template = settings.drawingCharacterDataTemplates.find(t => t.name === activeName);

                if (template) {
                    template.messages.push({ role: 'system', content: '' });
                    this._renderDrawingMessageList(template.messages);
                } else {
                    this.ctx.helpers.showToast('找不到当前激活的预设数据', 'error');
                }
            });
        }

        // 7. 恢复默认预设
        const drawingMsgResetBtn = this.modalEl.querySelector('#ai-drawing-msg-reset');
        if (drawingMsgResetBtn) {
            drawingMsgResetBtn.addEventListener('click', async () => {
                if (await this.ctx.helpers.promptConfirm('确定要恢复默认预设吗？\n这将把“绘图角色数据收集模板”恢复为系统默认的角色数据收集模板。')) {
                    const settings = this.aiProcessor.settings || {};
                    const defaultTemplates = this.aiProcessor._getAllDefaultDrawingCharacterTemplates();
                    settings.drawingCharacterDataTemplates = defaultTemplates.map(t => ({
                        name: t.name,
                        messages: JSON.parse(JSON.stringify(t.messages))
                    }));
                    settings.activeDrawingCharacterDataTemplateName = '默认角色数据模板';

                    this._updateDrawingTemplateSelect();
                    this.ctx.helpers.showToast('已恢复默认预设', 'success');
                    this.aiProcessor.saveConfig();
                }
            });
        }

        // === Tag参考面板事件 ===
        this.modalEl.querySelector('#ai-tagref-add-folder').addEventListener('click', () => {
            this.addTagRefFolder();
        });

        // === 高级选项事件 ===
        this.elements.injectPlaceholderBtn.addEventListener('click', () => {
            this.injectPlaceholderEntry();
        });

        // 互斥开关逻辑：标记模式 vs 标签前抓取
        this.elements.enableStoryContext.addEventListener('change', (e) => {
            if (e.target.checked) {
                this.elements.enablePrecedingContext.checked = false;
            }
        });
        this.elements.enablePrecedingContext.addEventListener('change', (e) => {
            if (e.target.checked) {
                this.elements.enableStoryContext.checked = false;
            }
        });

        // 默认预设管理按钮
        const importDefaultsBtn = this.modalEl.querySelector('#ai-import-defaults');
        if (importDefaultsBtn) {
            importDefaultsBtn.addEventListener('click', async () => {
                const confirmed = await this.ctx.helpers.promptConfirm(
                    '这将导入“默认预设”和“gemini预设”。\n如果存在同名预设，它们的内容将被覆盖。\n确定继续吗？'
                );
                if (confirmed) {
                    try {
                        await this.aiProcessor.importDefaultPresets();
                        this.allPresets = await this.aiProcessor.getAllPresets();
                        if (this.currentPreset) {
                            const updated = this.allPresets.find(p => p.name === this.currentPreset.name);
                            if (updated) {
                                this.currentPreset = updated;
                                await this.loadPresetToUI(this.currentPreset);
                            }
                        }
                        this._updatePresetSelect();

                        this.elements.enablePrecedingContext.checked = false;
                        this.elements.enableStoryContext.checked = false;
                        this.elements.batchAutoRequest.checked = false;
                        this.elements.enableTagRef.checked = false;
                        this.elements.tagLibLengthBlocklist.value = '1';
                        this.elements.enableTagLibRef.checked = true;
                        this.elements.chatInsertionConsistency.checked = true;
                        this.elements.chatInsertionIgnoreUser.checked = true;
                        this.elements.chatInsertionWorldbookStrict.checked = true;

                        this.ctx.helpers.showToast('默认预设导入成功', 'success');
                    } catch (e) {
                        this.ctx.helpers.showToast('导入失败: ' + e.message, 'error');
                    }
                }
            });
        }

        this.modalEl.querySelector('#ai-reset-presets').addEventListener('click', async () => {
            const confirmed = await this.ctx.helpers.promptConfirm('⚠️ 警告：确定要执行【出厂重置】吗？\n这将删除所有自定义预设！如果不确定，请使用“导入默认预设”。');
            if (confirmed) {
                await this.aiProcessor.resetToDefaultPresets();
                this.allPresets = await this.aiProcessor.getAllPresets();
                this.currentPreset = this.allPresets[0];
                this._updatePresetSelect();
                await this.loadPresetToUI(this.currentPreset);
                this.ctx.helpers.showToast('已重置为初始状态', 'success');
            }
        });

        // =========================================================
        // === 聊天插入 (Chat Insertion) 面板事件 [新] ===
        // =========================================================

        const getConfig = () => this.aiProcessor.config || this.aiProcessor.settings;

        // 自动剧情定位模式与均匀插入模式互斥
        if (this.elements.chatInsertionAutoMode && this.elements.chatInsertionUniformMode) {
            this.elements.chatInsertionAutoMode.addEventListener('change', (e) => {
                if (e.target.checked) {
                    this.elements.chatInsertionUniformMode.checked = false;
                }
            });
            this.elements.chatInsertionUniformMode.addEventListener('change', (e) => {
                if (e.target.checked) {
                    this.elements.chatInsertionAutoMode.checked = false;
                }
            });
        }

        // 1. 模板切换 (下拉框 Change)
        if (this.elements.chatTemplateSelect) {
            this.elements.chatTemplateSelect.addEventListener('change', (e) => {
                const config = getConfig();
                const selectedName = e.target.value;
                config.activeChatInsertionTemplateName = selectedName;

                const template = config.chatInsertionTemplates.find(t => t.name === selectedName);
                if (template) {
                    this._renderChatInsertionMessageList(template.messages);
                    // 保存一下当前选中的状态，避免刷新丢失
                    this.aiProcessor.saveConfig();
                }
            });
        }

        // 2. 另存为模板 (Save As)
        if (this.elements.chatTemplateSaveAs) {
            this.elements.chatTemplateSaveAs.addEventListener('click', async () => {
                const config = getConfig();
                const newName = await this.ctx.helpers.promptInput('请输入新模板名称：');

                if (!newName || !newName.trim()) return;
                const trimmedName = newName.trim();

                if (config.chatInsertionTemplates.some(t => t.name === trimmedName)) {
                    this.ctx.helpers.showToast('模板名称已存在', 'error');
                    return;
                }

                // 获取当前正在编辑的列表数据（深拷贝）
                const currentActiveName = config.activeChatInsertionTemplateName || 'Default';
                const currentTemplateData = config.chatInsertionTemplates.find(t => t.name === currentActiveName);
                // 确保有数据，如果没有则用空数组
                const messagesToCopy = currentTemplateData ? currentTemplateData.messages : [];

                const newData = JSON.parse(JSON.stringify(messagesToCopy));

                // 保存新模板
                config.chatInsertionTemplates.push({
                    name: trimmedName,
                    messages: newData
                });

                // 切换到新模板
                config.activeChatInsertionTemplateName = trimmedName;

                // 刷新 UI
                this._updateChatTemplateSelect(config);
                this.ctx.helpers.showToast(`模板 "${trimmedName}" 已保存并切换`, 'success');
                // 触发持久化保存
                this.aiProcessor.saveConfig();
            });
        }

        // 3. 删除模板 (Delete)
        if (this.elements.chatTemplateDelete) {
            this.elements.chatTemplateDelete.addEventListener('click', async () => {
                const config = getConfig();
                const currentName = config.activeChatInsertionTemplateName;

                // 保护机制：至少保留一个模板
                if (config.chatInsertionTemplates.length <= 1) {
                    this.ctx.helpers.showToast('至少需要保留一个模板，无法删除。', 'warning');
                    return;
                }

                if (await this.ctx.helpers.promptConfirm(`确定要删除模板 "${currentName}" 吗？`)) {
                    // 过滤掉当前模板
                    config.chatInsertionTemplates = config.chatInsertionTemplates.filter(t => t.name !== currentName);

                    // 重置选择为第一个
                    const nextActive = config.chatInsertionTemplates[0].name;
                    config.activeChatInsertionTemplateName = nextActive;

                    // 刷新 UI
                    this._updateChatTemplateSelect(config);
                    this.ctx.helpers.showToast('模板已删除', 'success');

                    // 触发持久化保存
                    this.aiProcessor.saveConfig();
                }
            });
        }

        // 3.1 导出模板 (Export)
        if (this.elements.chatTemplateExport) {
            this.elements.chatTemplateExport.addEventListener('click', async () => {
                const config = getConfig();
                const currentName = config.activeChatInsertionTemplateName;
                const template = config.chatInsertionTemplates.find(t => t.name === currentName);

                if (!template) {
                    this.ctx.helpers.showToast('找不到当前模板', 'error');
                    return;
                }

                const exportData = JSON.stringify(template, null, 2);
                const blob = new Blob([exportData], { type: 'application/json' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `${currentName}.json`;
                a.click();
                URL.revokeObjectURL(url);
                this.ctx.helpers.showToast('模板已导出', 'success');
            });
        }

        // 3.2 导入模板 (Import)
        if (this.elements.chatTemplateImport) {
            this.elements.chatTemplateImport.addEventListener('click', async () => {
                const input = document.createElement('input');
                input.type = 'file';
                input.accept = '.json';
                input.onchange = async (e) => {
                    const file = e.target.files[0];
                    if (!file) return;

                    try {
                        const text = await file.text();
                        const importedTemplate = JSON.parse(text);

                        // 验证模板结构
                        if (!importedTemplate.name || !Array.isArray(importedTemplate.messages)) {
                            this.ctx.helpers.showToast('模板文件格式不正确', 'error');
                            return;
                        }

                        const config = getConfig();

                        // 检查是否已存在同名模板
                        const existingIndex = config.chatInsertionTemplates.findIndex(t => t.name === importedTemplate.name);
                        if (existingIndex >= 0) {
                            if (!await this.ctx.helpers.promptConfirm(`模板 "${importedTemplate.name}" 已存在，是否覆盖？`)) {
                                return;
                            }
                            config.chatInsertionTemplates[existingIndex] = importedTemplate;
                        } else {
                            config.chatInsertionTemplates.push(importedTemplate);
                        }

                        // 激活导入的模板
                        config.activeChatInsertionTemplateName = importedTemplate.name;
                        this._updateChatTemplateSelect(config);
                        this.ctx.helpers.showToast('模板已导入', 'success');
                        this.aiProcessor.saveConfig();
                    } catch (err) {
                        console.error('Import error:', err);
                        this.ctx.helpers.showToast('导入失败：' + err.message, 'error');
                    }
                };
                input.click();
            });
        }

        // 4. 添加新消息行 (Add Row)
        // 操作当前选中的模板数据
        const addMsgBtn = this.modalEl.querySelector('#ai-chat-msg-add');
        if (addMsgBtn) {
            addMsgBtn.addEventListener('click', () => {
                const config = getConfig();
                const activeName = config.activeChatInsertionTemplateName || 'Default';
                const template = config.chatInsertionTemplates.find(t => t.name === activeName);

                if (template) {
                    // 添加一行默认为 System 的空消息
                    template.messages.push({ role: 'system', content: '' });
                    // 重新渲染列表
                    this._renderChatInsertionMessageList(template.messages);
                } else {
                    this.ctx.helpers.showToast('找不到当前激活的模板数据', 'error');
                }
            });
        }

        // 5. 恢复默认结构 (Reset to Default Structure)
        // 将 *当前选中* 的模板内容重置为代码中定义的默认结构
        const resetMsgBtn = this.modalEl.querySelector('#ai-chat-msg-reset');
        if (resetMsgBtn) {
            resetMsgBtn.addEventListener('click', async () => {
                if (await this.ctx.helpers.promptConfirm('确定要重置模版吗？\n这将恢复为系统默认的两个模版：\n1. 普通插入模式\n2. 智能剧情插入模式 (新功能)')) {
                    const config = getConfig();

                    // 获取最新的默认模版列表
                    const defaultTemplates = this.aiProcessor._getAllDefaultChatTemplates();

                    // 只覆盖同名模板，无同名时新增
                    const existingTemplates = config.chatInsertionTemplates || [];
                    const updatedTemplates = [...existingTemplates];

                    defaultTemplates.forEach(defaultTemplate => {
                        const existingIndex = updatedTemplates.findIndex(t => t.name === defaultTemplate.name);
                        if (existingIndex >= 0) {
                            // 覆盖同名模板
                            updatedTemplates[existingIndex] = JSON.parse(JSON.stringify(defaultTemplate));
                        } else {
                            // 新增模板
                            updatedTemplates.push(JSON.parse(JSON.stringify(defaultTemplate)));
                        }
                    });

                    config.chatInsertionTemplates = updatedTemplates;
                    config.activeChatInsertionTemplateName = '智能剧情插入'; // 默认切换到新功能

                    // 刷新UI
                    this._updateChatTemplateSelect(config);
                    this.elements.chatInsertionAutoMode.checked = true;
                    this.elements.chatInsertionUniformMode.checked = false;

                    this.ctx.helpers.showToast('已恢复所有默认模版', 'success');
                    this.aiProcessor.saveConfig();
                }
            });
        }

        // === [新增] 自定义 Tool 工具配置事件 ===
        // 启用开关：展开/收起详细配置
        if (this.elements.chatToolEnabled) {
            this.elements.chatToolEnabled.addEventListener('change', () => {
                this._updateChatToolVisibility();
            });
        }
        // 命名方式切换：固定名输入框仅在 fixed 模式显示
        if (this.elements.chatToolNameMode) {
            this.elements.chatToolNameMode.addEventListener('change', () => {
                this._updateChatToolVisibility();
            });
        }
        // 添加参数字段
        if (this.elements.chatToolFieldAdd) {
            this.elements.chatToolFieldAdd.addEventListener('click', () => {
                const draft = this._ensureChatToolDraft();
                draft.fields = this._collectChatToolFieldsFromUI();
                draft.fields.push({ name: '', description: '', required: true, wrapTag: '' });
                this._renderChatToolFields(draft.fields);
            });
        }
        // 恢复默认配置（立即生效）
        if (this.elements.chatToolRestore) {
            this.elements.chatToolRestore.addEventListener('click', () => {
                this._restoreChatToolConfig();
            });
        }
        // 导出配置
        if (this.elements.chatToolExport) {
            this.elements.chatToolExport.addEventListener('click', () => {
                this._exportChatToolConfig();
            });
        }
        // 导入配置
        if (this.elements.chatToolImport) {
            this.elements.chatToolImport.addEventListener('click', () => {
                this._importChatToolConfig();
            });
        }

        // === [新增] 绘图数据收集 Tool 工具配置事件 ===
        // 启用开关：展开/收起详细配置
        if (this.elements.drawingToolEnabled) {
            this.elements.drawingToolEnabled.addEventListener('change', () => {
                this._updateToolVisibility('drawing');
            });
        }
        // 命名方式切换：固定名输入框仅在 fixed 模式显示
        if (this.elements.drawingToolNameMode) {
            this.elements.drawingToolNameMode.addEventListener('change', () => {
                this._updateToolVisibility('drawing');
            });
        }
        // 添加参数字段
        if (this.elements.drawingToolFieldAdd) {
            this.elements.drawingToolFieldAdd.addEventListener('click', () => {
                const draft = this._ensureToolDraft('drawing');
                draft.fields = this._collectToolFieldsFromUI('drawing');
                draft.fields.push({ name: '', description: '', required: true, wrapTag: '' });
                this._renderToolFields('drawing', draft.fields);
            });
        }
        // 恢复默认配置（立即生效）
        if (this.elements.drawingToolRestore) {
            this.elements.drawingToolRestore.addEventListener('click', () => {
                this._restoreToolConfig('drawing');
            });
        }
        // 导出配置
        if (this.elements.drawingToolExport) {
            this.elements.drawingToolExport.addEventListener('click', () => {
                this._exportToolConfig('drawing');
            });
        }
        // 导入配置
        if (this.elements.drawingToolImport) {
            this.elements.drawingToolImport.addEventListener('click', () => {
                this._importToolConfig('drawing');
            });
        }
    }


    _switchPanel(panelName) {

        this.modalEl.querySelectorAll('.ai-settings-nav li').forEach(li => {
            if (li instanceof HTMLElement) {
                li.classList.toggle('active', li.dataset?.panel === panelName);
            }
        });


        this.modalEl.querySelectorAll('.ai-content-panel').forEach(panel => {
            if (panel instanceof HTMLElement) {
                panel.classList.toggle('active', panel.dataset?.panel === panelName);
            }
        });


        if (panelName === 'worldbook') {
            this.loadWorldBooks();
            //  切换到此面板时，更新傻瓜模式预览
            this._updateSimpleModePreview();
            this._updateSimpleModePreview(); // 更新傻瓜模式预览
            this.populateCloneNativeList(); //  加载原生世界书下拉列表
        } else if (panelName === 'tokenstats') {
            // 切换到统计面板时，执行计算
            this._updateTokenStats();
        } else if (panelName === 'regex') {

            this.loadRegexRules();
        } else if (panelName === 'tagref') {
            this.loadTagRefFolders();
        } else if (panelName === 'realtime') {
            this._renderRealtimeDataView();
            this._updateDrawingTemplateSelect();
        }
        //  切换到高级面板时加载原生世界书列表
        else if (panelName === 'advanced') {
            this.populateNativeWorldNames();
        }
    }
    /**
     *  刷新傻瓜模式数据预览
     */
    async _updateSimpleModePreview() {
        const previewEl = this.modalEl.querySelector('#ai-simple-mode-preview');
        if (!previewEl) return;

        try {
            const charDB = this.ctx.getModule('characterDB');
            const aiProcessor = this.ctx.getModule('aiProcessor');

            if (!charDB || !aiProcessor) {
                previewEl.textContent = '错误：依赖的模块未加载。';
                return;
            }

            // 1. 获取所有启用傻瓜模式的角色
            const enabledCharacters = await charDB.getEnabledSimpleModeCharacters();

            if (enabledCharacters.length === 0) {
                previewEl.textContent = '当前没有启用“傻瓜模式”的角色。';
                return;
            }

            // 2. 使用AI处理器的函数来格式化数据
            const formattedData = aiProcessor._formatCharactersToYaml(enabledCharacters);

            // 3. 显示在预览区
            previewEl.textContent = formattedData || '格式化数据失败或无内容。';

        } catch (e) {
            this.ctx.error('ai-settings', '更新傻瓜模式预览失败:', e);
            previewEl.textContent = `加载预览失败: ${e.message}`;
        }
    }
    /**
     * 加载预设到 UI
     */
    async loadPresetToUI(preset) {
        if (!preset) return;
        this.worldBookPreviewVisible = false;
        this._tempOriginalFeatures = '';
        if(this.elements.targetFeatures) {
            this.elements.targetFeatures.style.backgroundColor = '';
            this.elements.targetFeatures.readOnly = false;
        }
        this.elements.enabledCheckbox.checked = preset.isEnabled || false;
        this.elements.enableForTagSupermarketCheckbox.checked = preset.enableForTagSupermarket || false;
        this.elements.enableForChatInsertionCheckbox.checked = preset.enableForChatInsertion || false;
        this.elements.apiUrl.value = preset.apiUrl || '';
        this.elements.apiKey.value = preset.apiKey || '';
        this.elements.model.value = preset.model || '';
        this.elements.temperature.value = typeof preset.temperature === 'number' ? preset.temperature : 0.45;
        this.elements.maxTokens.value = typeof preset.maxTokens === 'number' && preset.maxTokens > 0 ? preset.maxTokens : 8192;
        this.elements.stream.checked = preset.stream === true;
        if (this.elements.streamLabel) {
            const on = this.elements.stream.checked;
            this.elements.streamLabel.textContent = on ? '开启' : '关闭';
            this.elements.streamLabel.style.color = on ? 'var(--tsp-accent-green)' : 'var(--tsp-text-muted)';
        }
        this.elements.systemPrompt.value = preset.systemPrompt || '';
        this.elements.userPrompt.value = preset.userPrompt || '';
        this.elements.targetFeatures.value = preset.targetFeatures || '';
        this.elements.useWorldBook.checked = preset.useWorldBook || false;

        // 加载全局配置
        const config = this.aiProcessor.config || {};
        this.elements.enableStoryContext.checked = config.enableStoryContext || false;
        this.elements.contextStart.value = config.storyContextStart || '[';
        this.elements.contextEnd.value = config.storyContextEnd || ']';
        this.elements.enablePrecedingContext.checked = config.enablePrecedingContext || false;
        this.elements.enableTagRef.checked = config.enableTagReference || false;
        this.elements.enableTagLibRef.checked = config.enableTagLibReference || false;
        this.elements.batchCount.value = config.batchProcessingCount || 0;
        this.elements.batchAutoRequest.checked = config.batchAutoRequest || false;
        this.elements.tagLibBlocklist.value = config.tagLibBlocklist || '';
        this.elements.tagLibLengthBlocklist.value = config.tagLibLengthBlocklist || '';

        //  加载聊天插入设置
        this.elements.chatInsertionDepth.value = config.chatInsertionDepth || 5;
        this.elements.chatInsertionIgnoreUser.checked = config.chatInsertionIgnoreUserMessages || false;
        this.elements.chatInsertionConsistency.checked = config.chatInsertionConsistency || false;
        this.elements.chatInsertionWorldbookStrict.checked = config.chatInsertionWorldbookStrict || false;
        this.elements.chatInsertionUseRegex.checked = config.chatInsertionUseRegex || false;
        this.elements.chatInsertionStartTag.value = config.chatInsertionStartTag || '<图片>';
        this.elements.chatInsertionEndTag.value = config.chatInsertionEndTag || '</图片>';
        this.elements.chatInsertionAutoMode.checked = config.chatInsertionAutoMode || false;
        this.elements.chatInsertionUniformMode.checked = config.chatInsertionUniformMode || false;
        this.elements.chatInsertionAutoClick.checked = config.chatInsertionAutoClick || false;
        this.elements.chatInsertionSkipImageCheck.checked = config.chatInsertionSkipImageCheck || false;
        // [新增] 随机base64注入默认开启（仅显式关闭时为 false）
        this.elements.chatInsertionRandomBase64.checked = config.chatInsertionRandomBase64 !== false;
        // [新增] 酒馆代理通道开关（默认开启）
        this.elements.chatInsertionUseTavernProxy.checked = config.chatInsertionUseTavernProxy !== false;

        // [新增] 加载实时数据开关（默认关闭）
        if (this.elements.realtimeDataEnabled) {
            this.elements.realtimeDataEnabled.checked = config.drawingCharacterDataEnabled === true;
        }

        // [漫画模式] 加载漫画模式设置（默认关闭；各分组默认选中第一项）
        if (this.elements.comicModeEnabled) {
            this.elements.comicModeEnabled.checked = config.comicModeEnabled === true;
            this._setComicRadioGroup(this.elements.comicModeColorGroup, config.comicModeColor || '黑白');
            this._setComicRadioGroup(this.elements.comicModePageCountGroup, config.comicModePageCountMode || '手动');
            if (this.elements.comicModePageCountN) {
                this.elements.comicModePageCountN.value = Math.min(20, Math.max(1, parseInt(config.comicModePageCountN, 10) || 6));
            }
            this._setComicRadioGroup(this.elements.comicModeStoryboardGroup, config.comicModeStoryboard || '经典四格');
            this._setComicRadioGroup(this.elements.comicModeBlankGroup, config.comicModeBlankSpace || '天地出血');
            this._setComicRadioGroup(this.elements.comicModeLanguageGroup, config.comicModeDialogueLanguage || '简体中文');
            this._setComicRadioGroup(this.elements.comicModeStyleGroup, config.comicModeStylePreset || '黑白');
        }

        // [新增] 加载内容替换词设置（空值兜底，参考聊天模板迁移模式）
        this.elements.chatInsertionSanitizeEnabled.checked = config.chatInsertionSanitizeEnabled !== false;
        const container = this.modalEl.querySelector('#ai-chat-insertion-sanitize-container');
        if (container) {
            container.style.display = this.elements.chatInsertionSanitizeEnabled.checked ? '' : 'none';
        }
        // 显式判断空数组（空数组 [] 在 || 中是 truthy，不能用链式 || 兜底）
        let replacements = null;
        const cfgWr = config.chatInsertionWordReplacements;
        const setWr = this.aiProcessor.settings?.chatInsertionWordReplacements;
        if (cfgWr && Array.isArray(cfgWr) && cfgWr.length > 0) {
            replacements = cfgWr;
        } else if (setWr && Array.isArray(setWr) && setWr.length > 0) {
            replacements = setWr;
        } else {
            // 两层都空 → 自动导入出厂默认规则（写入 config，防止下次保存时又写空）
            replacements = this.aiProcessor._getDefaultWordReplacements();
            config.chatInsertionWordReplacements = JSON.parse(JSON.stringify(replacements));
            this.ctx.log('ai-settings', '[迁移] 预设/设置中替换词规则为空，已自动导入默认规则');
        }
        this._renderReplacementList(replacements);

        // ===  聊天模板加载逻辑 ===
        // 如果没有模板列表，导入所有默认预设模板
        if (!config.chatInsertionTemplates || !Array.isArray(config.chatInsertionTemplates) || config.chatInsertionTemplates.length === 0) {
            const defaultTemplates = this.aiProcessor._getAllDefaultChatTemplates();
            config.chatInsertionTemplates = defaultTemplates.map(t => ({
                name: t.name,
                messages: JSON.parse(JSON.stringify(t.messages))
            }));
            // 默认选中 '通用智能剧情插入'
            config.activeChatInsertionTemplateName = '通用智能剧情插入';
        }

        // 刷新下拉框并渲染列表
        this._updateChatTemplateSelect(config);

        // [新增] 绘图角色数据收集模板：刷新下拉框并渲染列表（内部自带默认兜底）
        this._updateDrawingTemplateSelect();

        // [新增] 自定义 Tool 工具配置：回填到 UI（内部自带默认兜底）
        this._loadChatToolConfigToUI(config);

        // [新增] 绘图数据收集 Tool 工具配置：回填到 UI（内部自带默认兜底）
        this._loadToolConfigToUI('drawing', config);
    }
    /**
     *  更新聊天模板下拉框并渲染当前选中的消息列表
     */
    _updateChatTemplateSelect(config) {
        if (!this.elements.chatTemplateSelect) return;

        const templates = config.chatInsertionTemplates;
        const activeName = config.activeChatInsertionTemplateName || 'Default';

        // 1. 填充下拉框
        this.elements.chatTemplateSelect.innerHTML = templates.map(t =>
            `<option value="${t.name}" ${t.name === activeName ? 'selected' : ''}>${t.name}</option>`
        ).join('');

        // 2. 找到当前激活的模板数据
        let activeTemplate = templates.find(t => t.name === activeName);
        if (!activeTemplate) {
            // 如果没找到（可能被删了），回退到第一个
            activeTemplate = templates[0];
            config.activeChatInsertionTemplateName = activeTemplate.name;
            this.elements.chatTemplateSelect.value = activeTemplate.name;
        }

        // 3. 渲染消息列表
        this._renderChatInsertionMessageList(activeTemplate.messages);
    }

    /**
     * [新增] 更新绘图角色数据收集模板下拉框并渲染当前选中的消息列表
     * 直接读写 this.aiProcessor.settings，避免写入临时对象导致数据丢失。
     */
    _updateDrawingTemplateSelect() {
        const selectEl = this.elements.drawingTemplateSelect;
        if (!selectEl) return;
        const settings = this.aiProcessor.settings || {};

        // 兜底：若模板列表缺失或为空，自动填充默认模板
        if (!Array.isArray(settings.drawingCharacterDataTemplates) || settings.drawingCharacterDataTemplates.length === 0) {
            const defaultTemplates = this.aiProcessor._getAllDefaultDrawingCharacterTemplates();
            settings.drawingCharacterDataTemplates = defaultTemplates.map(t => ({
                name: t.name,
                messages: JSON.parse(JSON.stringify(t.messages))
            }));
            settings.activeDrawingCharacterDataTemplateName = '默认角色数据模板';
        }

        const templates = settings.drawingCharacterDataTemplates;
        const activeName = settings.activeDrawingCharacterDataTemplateName || templates[0]?.name || '';

        // 1. 填充下拉框
        selectEl.innerHTML = templates.map(t =>
            `<option value="${this._escapeHtml(t.name)}" ${t.name === activeName ? 'selected' : ''}>${this._escapeHtml(t.name)}</option>`
        ).join('');

        // 2. 找到当前激活的模板数据
        let activeTemplate = templates.find(t => t.name === activeName);
        if (!activeTemplate) {
            activeTemplate = templates[0];
            settings.activeDrawingCharacterDataTemplateName = activeTemplate.name;
            selectEl.value = activeTemplate.name;
        }

        // 3. 渲染消息列表
        this._renderDrawingMessageList(activeTemplate.messages);
    }
    _collectPresetFromUI() {
        let realTargetFeatures;
        if (this.worldBookPreviewVisible) {
            realTargetFeatures = this._tempOriginalFeatures;
        } else {
            realTargetFeatures = this.elements.targetFeatures.value;
        }
        const tempVal = parseFloat(this.elements.temperature.value);
        const maxTokVal = parseInt(this.elements.maxTokens.value);
        return {
            name: this.elements.presetSelect.value,
            isEnabled: this.elements.enabledCheckbox.checked,
            enableForTagSupermarket: this.elements.enableForTagSupermarketCheckbox.checked,
            enableForChatInsertion: this.elements.enableForChatInsertionCheckbox.checked,
            apiUrl: this.elements.apiUrl.value.trim(),
            apiKey: this.elements.apiKey.value.trim(),
            model: this.elements.model.value.trim(),
            temperature: isNaN(tempVal) ? 0.45 : Math.max(0, Math.min(2, tempVal)),
            maxTokens: isNaN(maxTokVal) || maxTokVal <= 0 ? 8192 : maxTokVal,
            stream: this.elements.stream.checked,
            systemPrompt: this.elements.systemPrompt.value,
            userPrompt: this.elements.userPrompt.value,
            targetFeatures: realTargetFeatures,
            useWorldBook: this.elements.useWorldBook.checked,
            worldBookNames: this.currentPreset?.worldBookNames || [],
        };
    }


    async saveSettings() {
        try {
            const presetData = this._collectPresetFromUI();

            // ▼▼▼ 修改逻辑：全局互斥处理 ▼▼▼
            // 如果当前正在保存的预设开启了“主启用”或“聊天插入”
            if (presetData.isEnabled || presetData.enableForChatInsertion) {

                // 1. 设置为激活预设名称 (告诉处理器这是当前的焦点)
                await this.aiProcessor.setActivePreset(presetData.name);

                // 2. 遍历所有预设，关闭其他预设的开关
                const updatePromises = [];
                for (const p of this.allPresets) {
                    // 如果不是当前正在保存的预设，且它处于开启状态
                    if (p.name !== presetData.name && (p.isEnabled || p.enableForChatInsertion)) {
                        p.isEnabled = false;
                        p.enableForChatInsertion = false;
                        // 将修改后的状态写入数据库，确保下次加载也是关闭的
                        updatePromises.push(this.aiProcessor.addOrUpdatePreset(p));
                    }
                }

                if (updatePromises.length > 0) {
                    await Promise.all(updatePromises);
                    this.ctx.log('ai-settings', `已自动关闭其他 ${updatePromises.length} 个预设的开关`);
                }
            } else {
                // 如果当前预设两个都关了，且它是之前记录的 activePresetName，
                // 你可能想清空 activePresetName，或者是保持不变，这里维持原逻辑即可。
            }
            // ▲▲▲ 修改逻辑结束 ▲▲▲

            // 保存当前预设
            await this.aiProcessor.addOrUpdatePreset(presetData);

            // 更新内存中的列表，确保 UI 下拉框数据最新
            this.allPresets = await this.aiProcessor.getAllPresets();
            // 更新 currentPreset 引用
            this.currentPreset = this.allPresets.find(p => p.name === presetData.name);

            // 更新全局配置
            const config = this.aiProcessor.config || this.aiProcessor.settings;
            if (config) {
                config.enableStoryContext = this.elements.enableStoryContext.checked;
                config.storyContextStart = this.elements.contextStart.value;
                config.storyContextEnd = this.elements.contextEnd.value;
                config.enablePrecedingContext = this.elements.enablePrecedingContext.checked;
                config.enableTagReference = this.elements.enableTagRef.checked;
                config.enableTagLibReference = this.elements.enableTagLibRef.checked;
                config.batchProcessingCount = parseInt(this.elements.batchCount.value) || 0;
                config.batchAutoRequest = this.elements.batchAutoRequest.checked;
                config.tagLibBlocklist = this.elements.tagLibBlocklist.value;
                config.tagLibLengthBlocklist = this.elements.tagLibLengthBlocklist.value;

                // 保存聊天插入设置
                config.chatInsertionDepth = parseInt(this.elements.chatInsertionDepth.value) || 5;
                config.chatInsertionIgnoreUserMessages = this.elements.chatInsertionIgnoreUser.checked;
                config.chatInsertionConsistency = this.elements.chatInsertionConsistency.checked;
                config.chatInsertionWorldbookStrict = this.elements.chatInsertionWorldbookStrict.checked;
                config.chatInsertionUseRegex = this.elements.chatInsertionUseRegex.checked;
                config.chatInsertionStartTag = this.elements.chatInsertionStartTag.value.trim();
                config.chatInsertionEndTag = this.elements.chatInsertionEndTag.value.trim();
                config.chatInsertionAutoMode = this.elements.chatInsertionAutoMode.checked;
                config.chatInsertionUniformMode = this.elements.chatInsertionUniformMode.checked;
                config.chatInsertionAutoClick = this.elements.chatInsertionAutoClick.checked;
                config.chatInsertionSkipImageCheck = this.elements.chatInsertionSkipImageCheck.checked;
                config.chatInsertionRandomBase64 = this.elements.chatInsertionRandomBase64.checked;
                config.chatInsertionUseTavernProxy = this.elements.chatInsertionUseTavernProxy.checked;
                // [新增] 保存内容替换词设置
                config.chatInsertionSanitizeEnabled = this.elements.chatInsertionSanitizeEnabled.checked;
                config.chatInsertionWordReplacements = this._getReplacementDataFromUI();

                // [新增] 保存自定义 Tool 工具配置
                if (this.elements.chatToolEnabled) {
                    config.chatInsertionToolConfig = this._collectChatToolConfigFromUI();
                }

                // [新增] 保存绘图数据收集自定义 Tool 工具配置
                if (this.elements.drawingToolEnabled) {
                    config.drawingToolConfig = this._collectToolConfigFromUI('drawing');
                }

                // [新增] 保存实时数据开关
                if (this.elements.realtimeDataEnabled) {
                    config.drawingCharacterDataEnabled = this.elements.realtimeDataEnabled.checked;
                }

                // [漫画模式] 保存漫画模式设置
                if (this.elements.comicModeEnabled) {
                    config.comicModeEnabled = this.elements.comicModeEnabled.checked;
                    config.comicModeColor = this._getComicRadioValue(this.elements.comicModeColorGroup) || '黑白';
                    config.comicModePageCountMode = this._getComicRadioValue(this.elements.comicModePageCountGroup) || '手动';
                    config.comicModePageCountN = Math.min(20, Math.max(1, parseInt(this.elements.comicModePageCountN?.value, 10) || 6));
                    config.comicModeStoryboard = this._getComicRadioValue(this.elements.comicModeStoryboardGroup) || '经典四格';
                    config.comicModeBlankSpace = this._getComicRadioValue(this.elements.comicModeBlankGroup) || '天地出血';
                    config.comicModeDialogueLanguage = this._getComicRadioValue(this.elements.comicModeLanguageGroup) || '简体中文';
                    config.comicModeStylePreset = this._getComicRadioValue(this.elements.comicModeStyleGroup) || '黑白';
                }
            }

            await this.aiProcessor.saveConfig();

            this.ctx.helpers.showToast(`配置 "${presetData.name}" 已保存`, 'success');

        } catch (e) {
            this.ctx.error('ai-settings', '保存失败:', e);
            this.ctx.helpers.showToast(`保存失败: ${e.message}`, 'error');
        }
    }

    /**
     * 保存并关闭
     */
    async saveAndClose() {
        await this.saveSettings();
        this.close();
    }

    /**
     * 测试连接
     */
    async testConnection() {
        // 1. 获取输入值
        const url = this.elements.apiUrl.value.trim();
        const apiKey = this.elements.apiKey.value.trim();
        const model = this.elements.model.value.trim();

        // 2. 校验
        if (!url || !model) {
            this.ctx.helpers.showToast('请输入 API 地址和模型名称 (本地部署可不填 Key)', 'error');
            return;
        }

        this.ctx.helpers.showToast('正在测试发送...', 'info');

        // 3. 构建 Headers
        const headers = {
            'Content-Type': 'application/json'
        };
        if (apiKey) {
            headers['Authorization'] = `Bearer ${apiKey}`;
        }

        // 4. 构建 Payload
        const payload = {
            model: model,
            messages: [{
                role: 'user',
                content: 'Human: Hi'
            }],
            temperature: 1.15,
            top_p: 0.98,
            max_tokens: 8192,
            stream: false,
        };

        // 5. 构建代理请求数据 (用于 fallback)
        const proxyData = {
            reverse_proxy: "",
            proxy_password: "",
            chat_completion_source: "custom",
            custom_url: url,
            custom_include_headers: apiKey ? `Authorization: Bearer ${apiKey}` : "",
            model: model,
            messages: payload.messages,
            temperature: 0.45,
            max_tokens: 8192,
            stream: false
        };

        // 6. 尝试直接请求
        try {
            const baseUrl = url.replace(/\/$/, '');
            // 只有带 v1 的 URL 才添加 /chat/completions 后缀
            const chatUrl = /\/v1\b/.test(url) ? `${baseUrl}/chat/completions` : baseUrl;

            console.log("[AI测试] 请求 URL:", chatUrl);

            const response = await fetch(chatUrl, {
                method: 'POST',
                headers: headers,
                body: JSON.stringify(payload)
            });

            // 7. 处理 HTTP 错误
            if (!response.ok) {
                let errText = '';
                try {
                    errText = await response.text();
                    const errJson = JSON.parse(errText);
                    if (errJson.error && errJson.error.message) {
                        errText = errJson.error.message;
                    }
                } catch (e) {
                    // 忽略 JSON 解析错误
                }
                throw new Error(`HTTP ${response.status}: ${errText.substring(0, 100)}`);
            }

            // 8. 解析响应数据
            const data = await response.json();
            console.log("[AI测试] 原始响应内容:", data);

            // 9. 校验返回结构
            if (!data.choices || data.choices.length === 0) {
                console.warn("[AI测试] AI返回了空 choices 数组，可能是模型未生成内容。");
                throw new Error("AI未返回任何内容（choices 为空）。");
            }

            if (data.choices[0]?.message) {
                const replyContent = data.choices[0].message.content || '(无内容)';
                this.ctx.helpers.showToast(`测试成功！AI回复: ${replyContent.substring(0, 15)}...`, 'success', 5000);
            } else {
                console.log("[AI测试] 异常的数据结构:", data);
                throw new Error('AI响应格式不正确 (缺少 choices[0].message)');
            }

        } catch (e) {
            console.error("[AI测试] 直接请求失败，尝试使用代理:", e);

            // 10. Fallback: 使用酒馆代理请求
            try {
                this.ctx.helpers.showToast('直接请求失败，尝试使用酒馆代理...', 'info');

                const proxyResponse = await fetch('/api/backends/chat-completions/generate', {
                    method: 'POST',
                    headers: getRequestHeaders(),
                    body: JSON.stringify(proxyData)
                });

                if (!proxyResponse.ok) {
                    const errText = await proxyResponse.text();
                    throw new Error(`代理请求失败: HTTP ${proxyResponse.status}: ${errText}`);
                }

                const proxyResult = await proxyResponse.json();
                console.log("[AI测试] 代理响应:", proxyResult);

                if (proxyResult.choices && proxyResult.choices[0]?.message) {
                    const replyContent = proxyResult.choices[0].message.content || '(无内容)';
                    this.ctx.helpers.showToast(`测试成功！(代理) AI回复: ${replyContent.substring(0, 15)}...`, 'success', 5000);
                } else {
                    throw new Error('代理响应格式不正确');
                }

            } catch (proxyErr) {
                console.error("[AI测试] 代理请求也失败:", proxyErr);
                this.ctx.helpers.showToast(`连接测试失败: ${e.message}`, 'error');
            }
        }
    }

    /**
     * 获取模型列表
     */
    async fetchModels() {
        const url = this.elements.apiUrl.value.trim();
        const apiKey = this.elements.apiKey.value.trim();

        if (!url) {
            this.ctx.helpers.showToast('请输入 API 地址', 'error');
            return;
        }

        this.ctx.helpers.showToast('正在获取模型列表...', 'info');

        try {
            const baseUrl = url.replace(/\/$/, '');
            const modelsUrl = `${baseUrl}/models`;

            const headers = { 'Content-Type': 'application/json' };
            if (apiKey) {
                headers['Authorization'] = `Bearer ${apiKey}`;
            }

            const response = await fetch(modelsUrl, { headers });

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }

            const data = await response.json();
            const models = data.data || data.models || [];

            if (models.length === 0) {
                this.ctx.helpers.showToast('未找到可用模型', 'warning');
                return;
            }

            // 创建选择弹窗
            const modelNames = models.map(m => m.id || m.name || m);
            const selected = await this._showModelSelectDialog(modelNames);

            if (selected) {
                this.elements.model.value = selected;
                this.ctx.helpers.showToast(`已选择模型: ${selected}`, 'success');
            }

        } catch (e) {
            this.ctx.helpers.showToast(`直接请求失败，尝试使用酒馆原生方式...`, 'info');
            // 使用酒馆原生方式作为 fallback
            try {
                // 保存临时 API 密钥到本地存储
                if (apiKey) {
                    localStorage.setItem('tsp_temp_api_key', apiKey);
                }

                // 构建请求数据
                const data = {
                    reverse_proxy: "",
                    proxy_password: "",
                    chat_completion_source: "custom",
                    custom_url: url,
                    custom_include_headers: apiKey ? `Authorization: Bearer ${apiKey}` : ""
                };

                // 调用本地 API 端点
                const response = await fetch('/api/backends/chat-completions/status', {
                    method: 'POST',
                    headers: getRequestHeaders(),
                    body: JSON.stringify(data)
                });

                if (!response.ok) {
                    throw new Error(`HTTP ${response.status}`);
                }

                const responseData = await response.json();
                const models = responseData.data || [];

                if (models.length === 0) {
                    this.ctx.helpers.showToast('未找到可用模型', 'warning');
                    return;
                }

                // 创建选择弹窗
                const modelNames = models.map(m => m.id || m.name || m);
                const selected = await this._showModelSelectDialog(modelNames);

                if (selected) {
                    this.elements.model.value = selected;
                    this.ctx.helpers.showToast(`已选择模型: ${selected}`, 'success');
                }

            } catch (fallbackError) {
                this.ctx.helpers.showToast(`获取模型失败: ${fallbackError.message}`, 'error');
            } finally {
                // 清理临时 API 密钥
                localStorage.removeItem('tsp_temp_api_key');
            }
        }
    }

    /**
     * 显示模型选择对话框
     */
    async _showModelSelectDialog(models) {
        return new Promise((resolve) => {
            const dialog = document.createElement('div');
            dialog.className = 'tsp-modal-overlay visible';
            dialog.innerHTML = `
                <div class="tsp-modal" style="max-width: 400px;">
                    <div class="tsp-modal-header">
                        <div class="tsp-modal-title">选择模型</div>
                    </div>
                    <div class="tsp-modal-body">
                        <select class="tsp-input" size="10" style="width: 100%;">
                            ${models.map(m => `<option value="${m}">${m}</option>`).join('')}
                        </select>
                    </div>
                    <div class="tsp-modal-footer">
                        <button class="tsp-btn" id="model-cancel">取消</button>
                        <button class="tsp-btn tsp-btn-primary" id="model-confirm">确定</button>
                    </div>
                </div>
            `;

            document.body.appendChild(dialog);

            const select = dialog.querySelector('select');
            dialog.querySelector('#model-confirm').addEventListener('click', () => {
                dialog.remove();
                resolve(select.value);
            });
            dialog.querySelector('#model-cancel').addEventListener('click', () => {
                dialog.remove();
                resolve(null);
            });
        });
    }

    /**
     * 创建新预设
     */
    async createNewPreset() {
        const name = await this.ctx.helpers.promptInput('请输入新预设名称:');
        if (!name || !name.trim()) return;

        const trimmedName = name.trim();
        if (this.allPresets.some(p => p.name === trimmedName)) {
            this.ctx.helpers.showToast('预设名称已存在', 'error');
            return;
        }

        const newPreset = {
            name: trimmedName,
            isEnabled: false,
            apiUrl: '',
            apiKey: '',
            model: '',
            systemPrompt: this.elements.systemPrompt.value,
            userPrompt: '',
            targetFeatures: '',
            useWorldBook: false,
            worldBookNames: [],
        };

        await this.aiProcessor.addOrUpdatePreset(newPreset);
        this.allPresets = await this.aiProcessor.getAllPresets();
        this.currentPreset = newPreset;

        this._updatePresetSelect();
        this.elements.presetSelect.value = trimmedName;
        await this.loadPresetToUI(newPreset);

        this.ctx.helpers.showToast(`预设 "${trimmedName}" 已创建`, 'success');
    }

    /**
     * 删除当前预设
     */
    async deleteCurrentPreset() {
        if (this.allPresets.length <= 1) {
            this.ctx.helpers.showToast('至少需要保留一个预设', 'error');
            return;
        }

        const name = this.currentPreset.name;
        const confirmed = await this.ctx.helpers.promptConfirm(`确定删除预设 "${name}" 吗？`);
        if (!confirmed) return;

        await this.aiProcessor.deletePreset(name);
        this.allPresets = await this.aiProcessor.getAllPresets();
        this.currentPreset = this.allPresets[0];

        this._updatePresetSelect();
        await this.loadPresetToUI(this.currentPreset);

        this.ctx.helpers.showToast(`预设 "${name}" 已删除`, 'success');
    }

    /**
     * 更新预设选择下拉框
     */
    _updatePresetSelect() {
        this.elements.presetSelect.innerHTML = this.allPresets.map(p =>
            `<option value="${p.name}" ${p.name === this.currentPreset?.name ? 'selected' : ''}>${p.name}</option>`
        ).join('');
    }

    /**
     * 导出预设
     */
    exportPreset() {
        const presetData = this._collectPresetFromUI();
        const blob = new Blob([JSON.stringify(presetData, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `ai-preset-${presetData.name}.json`;
        a.click();
        URL.revokeObjectURL(url);
        this.ctx.helpers.showToast('预设已导出', 'success');
    }

    /**
     * 导入预设
     */
    importPreset() {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.json';
        input.onchange = async (e) => {
            const target = /** @type {EventTarget | null} */ (e.target);
            const file = target instanceof HTMLInputElement ? target.files?.[0] : null;
            if (!file) return;

            try {
                const text = await file.text();
                const preset = JSON.parse(text);

                if (!preset.name) {
                    throw new Error('预设格式无效');
                }

                await this.aiProcessor.addOrUpdatePreset(preset);
                this.allPresets = await this.aiProcessor.getAllPresets();
                this.currentPreset = preset;

                this._updatePresetSelect();
                this.elements.presetSelect.value = preset.name;
                await this.loadPresetToUI(preset);

                this.ctx.helpers.showToast(`预设 "${preset.name}" 已导入`, 'success');
            } catch (e) {
                this.ctx.helpers.showToast(`导入失败: ${e.message}`, 'error');
            }
        };
        input.click();
    }

    /**
    * 切换世界书预览
    */
    async toggleWorldBookPreview() {
        // 切换状态
        this.worldBookPreviewVisible = !this.worldBookPreviewVisible;

        if (this.worldBookPreviewVisible) {
            // ===【开启预览模式】===

            // 1. 先备份当前用户输入的内容！防止丢失
            this._tempOriginalFeatures = this.elements.targetFeatures.value;

            // 2. 生成预览内容
            const preset = this.currentPreset;
            // 如果 preset 被污染了，这里要小心。理论上如果有数据，生成字符串
            if (preset?.useWorldBook && preset?.worldBookNames?.length > 0) {
                this.ctx.helpers.showToast('正在生成世界书预览...', 'info');

                const combinedData = { entries: {} };
                const allBookData = await Promise.all(
                    preset.worldBookNames.map(name => this.aiProcessor.getWorldBookByName(name))
                );

                for (let i = 0; i < allBookData.length; i++) {
                    const wb = allBookData[i];
                    if (wb?.data?.entries) {
                        for (const uid in wb.data.entries) {
                            combinedData.entries[`${wb.name}::${uid}`] = wb.data.entries[uid];
                        }
                    }
                }

                // 设置显示内容
                this.elements.targetFeatures.value = this.aiProcessor.generateWorldBookString(combinedData, '');

                // UI 样式调整：黄色背景 + 只读，提示用户这是预览
                this.elements.targetFeatures.style.backgroundColor = 'rgba(255, 255, 0, 0.1)';
                this.elements.targetFeatures.readOnly = true;
            } else {
                this.elements.targetFeatures.value = '请先启用世界书并选择至少一本世界书进行预览。';
                // 虽然是提示，也属于预览模式
                this.elements.targetFeatures.style.backgroundColor = 'rgba(255, 255, 0, 0.1)';
                this.elements.targetFeatures.readOnly = true;
            }

        } else {
            // ===【关闭预览模式】===

            // 1. 恢复备份的内容
            if (this._tempOriginalFeatures !== undefined && this._tempOriginalFeatures !== null) {
                this.elements.targetFeatures.value = this._tempOriginalFeatures;
            } else {
                // 保底逻辑：如果备份为空，尝试从当前预设对象读取
                this.elements.targetFeatures.value = this.currentPreset?.targetFeatures || '';
            }

            // 2. 清理 UI 样式
            this.elements.targetFeatures.style.backgroundColor = '';
            this.elements.targetFeatures.readOnly = false; // 恢复可编辑

            // 3. 清理缓存
            this._tempOriginalFeatures = '';
        }
    }

    /**
     * [修改后] 加载并渲染世界书列表
     */
    async loadWorldBooks() {
        const allBooks = await this.aiProcessor.getAllWorldBooks() || [];
        const listContainer = this.modalEl.querySelector('#ai-worldbook-list');
        if (!listContainer) return;

        if (allBooks.length === 0) {
            listContainer.innerHTML = `
                <div class="ai-empty-state">
                    <i class="fa-solid fa-book"></i>
                    <p>暂无世界书</p>
                    <p class="tsp-form-hint">点击"导入"添加</p>
                </div>
            `;
            return;
        }

        // 渲染可用世界书列表
        listContainer.innerHTML = allBooks.map(wb => `
            <div class="ai-worldbook-item" data-name="${this._escapeHtml(wb.name)}">
                <span class="ai-worldbook-name">${this._escapeHtml(wb.name)}</span>
                <div class="ai-worldbook-item-actions">
                    <button class="tsp-btn tsp-btn-sm tsp-btn-icon" data-action="edit" title="编辑"><i class="fa-solid fa-edit"></i></button>
                    <button class="tsp-btn tsp-btn-sm tsp-btn-icon" data-action="export" title="导出"><i class="fa-solid fa-file-export"></i></button>
                    <button class="tsp-btn tsp-btn-sm tsp-btn-icon tsp-btn-danger" data-action="delete" title="删除"><i class="fa-solid fa-trash"></i></button>
                </div>
            </div>
        `).join('');

        // 绑定事件
        listContainer.querySelectorAll('.ai-worldbook-item').forEach(item => {
            const name = item.dataset.name;
            if (!name) return;

            // [核心修改] 点击整个条目 = 切换选中状态
            item.addEventListener('click', (e) => {
                if (e.target.closest('button')) return; // 如果点击的是按钮，则不触发
                this.toggleWorldBookSelection(name); // <-- 改为调用切换函数
            });
            item.querySelector('[data-action="edit"]')?.addEventListener('click', () => this.editWorldBook(name));
            item.querySelector('[data-action="export"]')?.addEventListener('click', () => this.exportWorldBook(name));
            item.querySelector('[data-action="delete"]')?.addEventListener('click', () => this.deleteWorldBook(name));
        });

        //  初始化时，渲染已选和高亮状态
        this._renderSelectedWorldBooks();
        this._updateAvailableWorldBookHighlights();
    }

    /**
     *  渲染已选择的世界书标签
     */
    _renderSelectedWorldBooks() {
        const selectedContainer = this.modalEl.querySelector('#ai-worldbook-selected');
        if (!selectedContainer) return;

        const selectedNames = this.currentPreset?.worldBookNames || [];

        if (selectedNames.length === 0) {
            selectedContainer.innerHTML = '<span class="tsp-form-hint">暂未选择世界书</span>';
            return;
        }

        selectedContainer.innerHTML = selectedNames.map(name => `
            <div class="tsp-tag" data-name="${this._escapeHtml(name)}">
                <span>${this._escapeHtml(name)}</span>
                <button class="tsp-tag-remove">×</button>
            </div>
        `).join('');

        // 绑定移除事件
        selectedContainer.querySelectorAll('.tsp-tag-remove').forEach(btn => {
            btn.addEventListener('click', () => {
                const name = btn.parentElement.dataset.name;
                this.removeWorldBookFromSelection(name);
            });
        });
    }

    /**
     *  添加世界书到当前预设的选择列表
     */
    addWorldBookToSelection(name) {
        if (!this.currentPreset) return;
        if (!this.currentPreset.worldBookNames) {
            this.currentPreset.worldBookNames = [];
        }
        if (!this.currentPreset.worldBookNames.includes(name)) {
            this.currentPreset.worldBookNames.push(name);
            this._renderSelectedWorldBooks();
            this._updateAvailableWorldBookHighlights(); // <--  更新高亮
        }
    }

    /**
     *  从当前预设的选择列表中移除世界书
     */
    removeWorldBookFromSelection(name) {
        if (!this.currentPreset || !this.currentPreset.worldBookNames) return;
        this.currentPreset.worldBookNames = this.currentPreset.worldBookNames.filter(n => n !== name);
        this._renderSelectedWorldBooks();
        this._updateAvailableWorldBookHighlights(); // <--  更新高亮
    }
    /**
     *  切换单个世界书的选中状态
     */
    toggleWorldBookSelection(name) {
        if (!this.currentPreset) return;
        const isSelected = (this.currentPreset.worldBookNames || []).includes(name);

        if (isSelected) {
            this.removeWorldBookFromSelection(name);
        } else {
            this.addWorldBookToSelection(name);
        }
    }

    /**
     *  更新可用世界书列表的高亮状态
     */
    _updateAvailableWorldBookHighlights() {
        const listContainer = this.modalEl.querySelector('#ai-worldbook-list');
        if (!listContainer) return;

        const selectedNames = this.currentPreset?.worldBookNames || [];

        listContainer.querySelectorAll('.ai-worldbook-item').forEach(item => {
            const name = item.dataset.name;
            if (name) {
                // 根据是否在已选列表中，切换 'active' 类
                item.classList.toggle('active', selectedNames.includes(name));
            }
        });
    }
    /**
     * [修改后] 导入世界书 (使用文件名作为默认名)
     */
    importWorldBook() {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.json,.js';
        input.onchange = async (e) => {
            const target = /** @type {EventTarget | null} */ (e.target);
            const file = target instanceof HTMLInputElement ? target.files?.[0] : null;
            if (!file) return;

            try {
                let content = await file.text();
                const fileName = file.name.split('.').slice(0, -1).join('.');

                if (file.name.endsWith('.js')) { // 兼容 SillyTavern .js 导出
                    const match = content.match(/\{[\s\S]*\}/);
                    if (match) content = match[0];
                }

                let parsedData = JSON.parse(content);
                // 确保保留所有字段，只验证关键字段
                if (typeof parsedData.entries !== 'object' || parsedData.entries === null) {
                    throw new Error("文件内容缺少 'entries' 对象。");
                }

                // ====================== 修复点开始 ======================
                // 如果是导入从 ST 导出的文件，进行格式修正
                parsedData = this._sanitizeWorldBookData(parsedData);
                // ====================== 修复点结束 ======================

                // 直接使用文件名作为默认名导入
                const worldBookToSave = {
                    name: fileName,
                    data: parsedData,
                    enabled: true, // 默认启用
                };

                await this.aiProcessor.addOrUpdateWorldBook(worldBookToSave);
                await this.loadWorldBooks();
                this.ctx.helpers.showToast(`世界书 "${fileName}" 导入成功`, 'success');

            } catch (err) {
                this.ctx.error('ai-settings', '导入世界书失败:', err);
                this.ctx.helpers.showToast(`导入失败: ${err.message}`, 'error');
            }
        };
        input.click();
    }
    /**
     *  填充用于克隆的原生世界书下拉列表
     */
    populateCloneNativeList() {
        const select = this.elements.cloneNativeWiSelect;
        if (!select) return;

        select.innerHTML = '<option value="">请选择 ST 原生世界书...</option>';

        // world_names 来自 world-info.js 导入
        if (Array.isArray(world_names) && world_names.length > 0) {
            world_names.forEach(name => {
                const option = document.createElement('option');
                option.value = name;
                option.textContent = name;
                select.appendChild(option);
            });
        } else {
             select.innerHTML = '<option value="">未找到原生世界书</option>';
        }
    }

    /**
     *  将选中的原生世界书克隆并保存到插件数据库
     */
    async cloneNativeWorldBookToPlugin() {
        const nativeName = this.elements.cloneNativeWiSelect.value;
        if (!nativeName) {
            this.ctx.helpers.showToast('请先选择一个要克隆的原生世界书', 'warning');
            return;
        }

        try {
            // 1. 调用 ST 核心 API 获取数据
            const nativeData = await loadWorldInfo(nativeName);
            if (!nativeData || !nativeData.entries) {
                throw new Error('无法读取该世界书数据或数据为空');
            }

            // ====================== 修复点开始 ======================
            // 对原生数据进行清洗，修复 position/depth 映射问题
            // 我们使用 JSON.parse(JSON.stringify(...)) 深拷贝一份，以免修改了 ST原本的内存数据
            const sanitizedData = this._sanitizeWorldBookData(JSON.parse(JSON.stringify(nativeData)));
            // ====================== 修复点结束 ======================

            // 2. 检查同名冲突 (插件内)
            const existingPluginBooks = await this.aiProcessor.getAllWorldBooks() || [];
            const duplicate = existingPluginBooks.find(wb => wb.name === nativeName);

            if (duplicate) {
                const confirm = await this.ctx.helpers.promptConfirm(
                    `插件内已存在名为 "${nativeName}" 的世界书。\n确定要覆盖它吗？`
                );
                if (!confirm) return;
            }

            // 3. 构造符合插件存储格式的对象
            const worldBookToSave = {
                name: nativeName,
                data: sanitizedData, // 使用清洗后的数据
                enabled: true
            };

            // 4. 保存
            await this.aiProcessor.addOrUpdateWorldBook(worldBookToSave);

            // 5. 刷新
            await this.loadWorldBooks();

            this.ctx.helpers.showToast(`世界书 "${nativeName}" 已成功克隆到插件！`, 'success');

        } catch (e) {
            console.error(e);
            this.ctx.helpers.showToast(`克隆失败: ${e.message}`, 'error');
        }
    }

    /**
     *  导出世界书
     */
    async exportWorldBook(name) {
        const worldBook = await this.aiProcessor.getWorldBookByName(name);
        if (worldBook) {
            const blob = new Blob([JSON.stringify(worldBook.data, null, 4)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `${name}.json`;
            a.click();
            URL.revokeObjectURL(url);
        }
    }

    /**
     * [修改后] 删除世界书
     */
    async deleteWorldBook(name) {
        const confirmed = await this.ctx.helpers.promptConfirm(`确定删除世界书 "${name}" 吗？`);
        if (!confirmed) return;

        // 从当前预设中移除
        this.removeWorldBookFromSelection(name);

        // 从数据库中删除
        await this.aiProcessor.deleteWorldBook(name);
        await this.loadWorldBooks(); // 刷新列表
        this.ctx.helpers.showToast(`世界书 "${name}" 已删除`, 'success');
    }

    /**
     * [修复后] 编辑世界书 (移植并改造自油猴脚本)
     */
    async editWorldBook(worldBookName) {
        // 防止重复打开
        if (document.getElementById('world-book-editor-overlay')) return;

        const worldBook = await this.aiProcessor.getWorldBookByName(worldBookName);
        if (!worldBook) {
            this.ctx.helpers.showToast(`加载世界书 "${worldBookName}" 失败!`, 'error');
            return;
        }
        // 深拷贝一份数据用于编辑，避免直接修改原始对象
        let editableData = JSON.parse(JSON.stringify(worldBook.data));

        const overlay = document.createElement('div');
        overlay.id = 'world-book-editor-overlay';
        overlay.className = 'tsp-modal-overlay';
        overlay.innerHTML = `
            <div class="tsp-modal tsp-modal-xl">
                <div class="tsp-modal-header">
                    <div class="tsp-modal-title"><i class="fa-solid fa-book"></i> 编辑世界书: ${worldBookName}</div>
                    <button class="tsp-btn tsp-btn-icon" id="wb-editor-close"><i class="fa-solid fa-times"></i></button>
                </div>
                <div class="tsp-modal-body" id="wb-editor-body">
                    <div class="ai-worldbook-entry-list"></div>
                </div>
                <div class="tsp-modal-footer">
                     <button class="tsp-btn" id="wb-editor-add-entry"><i class="fa-solid fa-plus"></i> 新增条目</button>
                    <button class="tsp-btn tsp-btn-primary" id="wb-editor-save-btn"><i class="fa-solid fa-save"></i> 保存并关闭</button>
                </div>
            </div>`;
        document.body.appendChild(overlay);
        requestAnimationFrame(() => overlay.classList.add('visible'));

        const entryListContainer = overlay.querySelector('.ai-worldbook-entry-list');
        const editorApi = this; // 方便内部函数访问 this

        // 核心渲染函数
        const renderEntries = () => {
            entryListContainer.innerHTML = '';
            // 使用 Object.values 并确保条目有 uid
            const entries = Object.values(editableData.entries).map((entry, index) => {
                 if (!entry.uid) entry.uid = `entry_${Date.now()}_${index}`;
                 return entry;
            });

            // 按ST的排序逻辑
            entries.sort((a, b) => (b.order || 0) - (a.order || 0) || a.uid.toString().localeCompare(b.uid.toString()));

            // [核心优化] 展开时才加载内容的辅助函数
            const populateAndShowExpandedView = (expandedView, entry) => {
                if (expandedView.innerHTML.trim() !== '') return; // 如果已渲染，则跳过

                expandedView.innerHTML = `
                    <div class="tsp-form-row">
                        <div class="tsp-form-group">
                            <label>触发词 (绿灯生效, 逗号分隔)</label>
                            <textarea class="tsp-input key-input" rows="4"></textarea>
                        </div>
                        <div class="tsp-form-group">
                            <label>发送内容</label>
                            <textarea class="tsp-input content-input" rows="4"></textarea>
                        </div>
                    </div>`;

                // 填充数据并绑定事件
                const keyInput = expandedView.querySelector('.key-input');
                const contentInput = expandedView.querySelector('.content-input');
                keyInput.value = (entry.key || []).join(', ');
                contentInput.value = entry.content || '';

                keyInput.addEventListener('input', (e) => {
                    entry.key = e.target.value.split(',').map(k => k.trim()).filter(Boolean);
                });
                contentInput.addEventListener('input', (e) => {
                    entry.content = e.target.value;
                });
            };

            entries.forEach((entry, index) => {
                const entryDiv = document.createElement('div');
                entry.displayIndex = index; // 确保排序字段存在
                entryDiv.className = 'ai-worldbook-entry';
                if (entry.disable) entryDiv.classList.add('disabled');

                //  头部摘要信息生成
                let typeText, strategyText;
                if (entry.role === 0) { typeText = '⚙️ 深度'; }
                else if (entry.role === null && entry.position === 1) { typeText = '之后'; }
                else { typeText = '之前'; }

                strategyText = entry.constant === true ?
                    '<span class="wb-status-badge blue">🔵 蓝灯</span>' :
                    '<span class="wb-status-badge green">🟢 绿灯</span>';

                entryDiv.innerHTML = `
                    <div class="ai-worldbook-entry-header">
                        <div class="ai-worldbook-entry-top-line">
                            <div class="ai-worldbook-entry-title">${editorApi._escapeHtml(entry.comment || '未命名条目')}</div>
                            <div class="ai-worldbook-entry-controls">
                                <button class="tsp-btn tsp-btn-icon" data-action="toggle-expand" title="展开/折叠"><i class="fa-solid fa-chevron-down"></i></button>
                                <button class="tsp-btn tsp-btn-icon tsp-btn-danger" data-action="delete" title="删除条目"><i class="fa-solid fa-trash"></i></button>
                            </div>
                        </div>
                        <!--  摘要信息区域 -->
                        <div class="ai-worldbook-entry-summary">
                            <span class="wb-summary-item">${strategyText}</span>
                            <span class="wb-summary-item"><strong>类型:</strong> ${typeText}</span>
                            <span class="wb-summary-item"><strong>顺序:</strong> ${entry.order || 1000}</span>
                            <span class="wb-summary-item"><strong>深度:</strong> ${entry.position !== undefined ? entry.position : 0}</span>
                            ${entry.disable ? '<span class="wb-summary-item"><strong class="wb-status-badge disabled">禁用</strong></span>' : ''}
                        </div>
                    </div>
                    <div class="ai-worldbook-entry-body" style="display: none;">
                         <div class="tsp-form-row">
                            <div class="tsp-form-group">
                                <label>条目命名</label>
                                <input type="text" class="tsp-input comment-input" value="${editorApi._escapeHtml(entry.comment || '')}">
                            </div>
                            <div class="tsp-form-group">
                                <label>状态类型</label>
                                <select class="tsp-input entry-type-select"></select>
                            </div>
                            <div class="tsp-form-group">
                                <label>策略</label>
                                <select class="tsp-input strategy-select"></select>
                            </div>
                        </div>
                        <div class="tsp-form-row">
                            <div class="tsp-form-group">
                                <label>顺序</label>
                                <input type="number" class="tsp-input order-input" value="${entry.order || 1000}">
                            </div>
                            <div class="tsp-form-group">
                                <label>深度 (D)</label>
                                <input type="number" class="tsp-input position-input" value="${entry.position !== undefined ? entry.position : 0}">
                            </div>
                             <div class="tsp-form-group" style="justify-content: flex-end;">
                                <label class="tsp-switch-label">
                                    <input type="checkbox" class="tsp-switch toggle-disable-switch">
                                    <span class="tsp-switch-slider"></span>
                                    <span>启用</span>
                                </label>
                            </div>
                        </div>
                        <div class="ai-worldbook-entry-expanded"></div>
                    </div>
                `;

                // 绑定所有控件的事件
                entryDiv.querySelector('.comment-input').addEventListener('input', (e) => {
                    entry.comment = e.target.value.trim();
                    entryDiv.querySelector('.ai-worldbook-entry-title').textContent = entry.comment || '未命名条目';
                });

                const strategySelect = entryDiv.querySelector('.strategy-select');
                strategySelect.innerHTML = `<option value="true">🔵 蓝灯 (固定生效)</option><option value="false">🟢 绿灯 (触发器生效)</option>`;
                strategySelect.value = String(entry.constant);
                strategySelect.addEventListener('change', () => { entry.constant = strategySelect.value === 'true'; renderEntries(); }); // 切换策略后刷新摘要

                const typeSelect = entryDiv.querySelector('.entry-type-select');
                const positionInput = entryDiv.querySelector('.position-input');
                typeSelect.innerHTML = `<option value="before_def">角色定义之前</option><option value="after_def">角色定义之后</option><option value="gear">⚙️ 深度消息</option>`;
                if (entry.role === 0) { typeSelect.value = 'gear'; positionInput.disabled = false; }
                else if (entry.role === null && entry.position === 1) { typeSelect.value = 'after_def'; positionInput.disabled = true; }
                else { typeSelect.value = 'before_def'; positionInput.disabled = true; }
                typeSelect.addEventListener('change', () => {
                    const selectedType = typeSelect.value;
                    if (selectedType === 'gear') { entry.role = 0; positionInput.disabled = false; }
                    else if (selectedType === 'after_def') { entry.role = null; entry.position = 1; positionInput.value = 1; positionInput.disabled = true; }
                    else { entry.role = null; entry.position = 0; positionInput.value = 0; positionInput.disabled = true; }
                    renderEntries(); // 切换类型后刷新摘要
                });

                const toggleSwitch = entryDiv.querySelector('.toggle-disable-switch');
                toggleSwitch.checked = !entry.disable;
                toggleSwitch.addEventListener('change', () => { entry.disable = !toggleSwitch.checked; renderEntries(); }); // 切换禁用后刷新摘要

                entryDiv.querySelector('.order-input').addEventListener('input', (e) => { entry.order = parseInt(e.target.value, 10); renderEntries(); });
                positionInput.addEventListener('input', (e) => { if (entry.role === 0) entry.position = parseInt(e.target.value, 10); renderEntries(); });

                // 展开/折叠按钮
                entryDiv.querySelector('[data-action="toggle-expand"]').addEventListener('click', (e) => {
                    const bodyView = entryDiv.querySelector('.ai-worldbook-entry-body');
                    const isVisible = bodyView.style.display === 'block';

                    if (!isVisible) { // 如果即将展开
                        const expandedView = bodyView.querySelector('.ai-worldbook-entry-expanded');
                        populateAndShowExpandedView(expandedView, entry);
                    }

                    bodyView.style.display = isVisible ? 'none' : 'block';
                    entryDiv.classList.toggle('expanded', !isVisible);
                });

                // 删除条目按钮
                entryDiv.querySelector('[data-action="delete"]').addEventListener('click', async () => {
                    if (await editorApi.ctx.helpers.promptConfirm(`确定删除条目 "${entry.comment || '未命名'}" 吗？`)) {
                        delete editableData.entries[entry.uid];
                        renderEntries();
                    }
                });

                entryListContainer.appendChild(entryDiv);
            });
        };

        renderEntries();

        // 新增条目
        overlay.querySelector('#wb-editor-add-entry').addEventListener('click', () => {
            const newUid = `entry_${Date.now()}`;
            editableData.entries[newUid] = {
                uid: newUid, key: [], comment: "新条目", content: "",
                disable: false, constant: false, order: 1000, position: 0, role: null,
            };
            renderEntries();
            // 自动滚动到底部并展开新条目
            const lastEntry = entryListContainer.lastElementChild;
            if (lastEntry) {
                 lastEntry.scrollIntoView({ behavior: 'smooth', block: 'end' });
                 setTimeout(() => lastEntry.querySelector('[data-action="toggle-expand"]')?.click(), 300);
            }
        });

        // 保存并关闭
        overlay.querySelector('#wb-editor-save-btn').addEventListener('click', async () => {
            // 在保存前，重新生成 displayIndex 以确保顺序正确
            Object.values(editableData.entries).sort((a,b) => (b.order || 0) - (a.order || 0) || a.uid.toString().localeCompare(b.uid.toString()))
                .forEach((entry, index) => { entry.displayIndex = index; });

            worldBook.data = editableData;
            await editorApi.aiProcessor.addOrUpdateWorldBook(worldBook);
            editorApi.ctx.helpers.showToast(`世界书 "${worldBookName}" 已保存`, 'success');
            overlay.remove();
        });

        overlay.querySelector('#wb-editor-close').addEventListener('click', () => {
            overlay.classList.remove('visible');
            setTimeout(() => overlay.remove(), 200);
        });
    }


    /**
     * 加载正则规则列表 (支持折叠展开)
     */
    async loadRegexRules() {
        const rules = await this.aiProcessor.getAllRegexRules();

        if (rules.length === 0) {
            this.elements.regexList.innerHTML = `
                <div class="ai-empty-state">
                    <i class="fa-solid fa-code"></i>
                    <p>暂无正则规则</p>
                </div>
            `;
            return;
        }

        this.elements.regexList.innerHTML = rules.map(rule => `
            <div class="ai-regex-item collapsed" data-id="${rule.id}">
                <!-- 头部：始终显示 -->
                <div class="ai-regex-item-header">
                    <div class="ai-regex-toggle-icon"><i class="fa-solid fa-chevron-right"></i></div>
                    <label class="ai-regex-label">
                        <input type="checkbox" ${rule.disabled ? '' : 'checked'} class="rule-enable-check">
                        <span class="rule-name">${rule.scriptName || '未命名规则'}</span>
                    </label>
                    <button class="tsp-btn tsp-btn-sm tsp-btn-icon tsp-btn-danger" data-action="delete" title="删除">
                        <i class="fa-solid fa-trash"></i>
                    </button>
                </div>
                <!-- 内容：折叠区域 -->
                <div class="ai-regex-item-body">
                    <div class="tsp-form-group">
                        <label>名称</label>
                        <input type="text" class="tsp-input" value="${this._escapeHtml(rule.scriptName || '')}"
                               placeholder="规则名称" data-field="scriptName">
                    </div>
                    <div class="tsp-form-group">
                        <label>查找 (正则)</label>
                        <input type="text" class="tsp-input" value="${this._escapeHtml(rule.findRegex || '')}"
                               placeholder="/pattern/flags" data-field="findRegex">
                    </div>
                    <div class="tsp-form-group">
                        <label>替换为 (留空即删除)</label>
                        <input type="text" class="tsp-input" value="${this._escapeHtml(rule.replaceString || '')}"
                               placeholder="替换内容" data-field="replaceString">
                    </div>
                </div>
            </div>
        `).join('');

        // 绑定事件
        this.elements.regexList.querySelectorAll('.ai-regex-item').forEach(item => {
            const id = item.dataset.id;
            const header = item.querySelector('.ai-regex-item-header');

            // 1. 折叠/展开点击事件 (点击头部空白处或箭头)
            header.addEventListener('click', (e) => {
                // 如果点的是 checkbox 或 delete 按钮，不触发折叠
                if (e.target.closest('input') || e.target.closest('button')) return;

                item.classList.toggle('collapsed');
                // 切换图标
                const icon = item.querySelector('.ai-regex-toggle-icon i');
                if (item.classList.contains('collapsed')) {
                    icon.className = 'fa-solid fa-chevron-right';
                } else {
                    icon.className = 'fa-solid fa-chevron-down';
                }
            });

            // 2. 启用/禁用
            item.querySelector('.rule-enable-check').addEventListener('change', async (e) => {
                const rule = rules.find(r => r.id === id);
                if (rule) {
                    rule.disabled = !e.target.checked;
                    await this.aiProcessor.addOrUpdateRegexRule(rule);
                }
            });

            // 3. 删除
            item.querySelector('[data-action="delete"]').addEventListener('click', async (e) => {
                e.stopPropagation(); // 防止触发折叠
                const confirmed = await this.ctx.helpers.promptConfirm('确定删除此规则吗？');
                if (confirmed) {
                    await this.aiProcessor.deleteRegexRule(id);
                    await this.loadRegexRules(); // 刷新列表
                    this.ctx.helpers.showToast('规则已删除', 'success');
                }
            });

            // 4. 字段更新 (实时保存)
            item.querySelectorAll('[data-field]').forEach(input => {
                input.addEventListener('change', async () => {
                    const rule = rules.find(r => r.id === id);
                    if (rule) {
                        rule[input.dataset.field] = input.value;
                        // 如果改的是名字，同时更新头部的显示
                        if (input.dataset.field === 'scriptName') {
                            item.querySelector('.rule-name').textContent = input.value || '未命名规则';
                        }
                        await this.aiProcessor.addOrUpdateRegexRule(rule);
                    }
                });
            });
        });
    }
    /**
     * 导出所有正则规则 (原样导出所有字段)
     */
    async exportRegexRules() {
        const rules = await this.aiProcessor.getAllRegexRules();
        if (rules.length === 0) {
            this.ctx.helpers.showToast('没有可导出的规则', 'warning');
            return;
        }
        // 直接导出数据库里的对象，这会包含所有保留的字段
        const blob = new Blob([JSON.stringify(rules, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        // 使用 ST 风格的命名
        a.download = `regex_scripts_${new Date().toISOString().slice(0, 10)}.json`;
        a.click();
        URL.revokeObjectURL(url);
        this.ctx.helpers.showToast('正则规则已导出', 'success');
    }

    /**
     * 导入正则规则 (兼容 ST 格式，保留多余字段)
     */
    importRegexRules() {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.json';
        input.onchange = async (e) => {
            const target = /** @type {EventTarget | null} */ (e.target);
            const file = target instanceof HTMLInputElement ? target.files?.[0] : null;
            if (!file) return;

            try {
                const text = await file.text();
                let data = JSON.parse(text);

                // 兼容处理：SillyTavern 导出可能是数组，也可能是单个对象
                let rulesList = [];
                if (Array.isArray(data)) {
                    rulesList = data;
                } else if (typeof data === 'object') {
                    rulesList = [data]; // 转为数组统一处理
                } else {
                    throw new Error('无效的规则文件格式');
                }

                let count = 0;
                for (const item of rulesList) {
                    // 必须包含脚本名称和正则内容才视为有效
                    if (item.scriptName && item.findRegex) {
                        // 【关键】直接保存整个 item 对象，不筛选字段
                        // 这样 SillyTavern 特有的 placement, markdownOnly 等字段都会被保留

                        // 为了避免ID冲突（如果用户是重复导入），可以选择：
                        // 1. 保留原 ID (overwrite): item.id 保持不变
                        // 2. 生成新 ID (duplicate): item.id = null
                        // 这里为了"兼容性"，我们优先保留原 ID，但为了防止数据库键冲突逻辑，
                        // aiProcessor.addOrUpdateRegexRule 会处理保存。
                        // 如果你想强制作为新规则导入而不是覆盖，可以解开下面这行的注释：
                        // item.id = null;

                        // 确保 disabled 字段存在，默认 false
                        if (typeof item.disabled === 'undefined') item.disabled = false;

                        await this.aiProcessor.addOrUpdateRegexRule(item);
                        count++;
                    }
                }

                await this.loadRegexRules();
                this.ctx.helpers.showToast(`成功导入 ${count} 条规则`, 'success');
            } catch (e) {
                console.error(e);
                this.ctx.helpers.showToast(`导入失败: ${e.message}`, 'error');
            }
        };
        input.click();
    }
    /**
     * 添加正则规则
     */
    async addRegexRule() {
        const name = await this.ctx.helpers.promptInput('请输入规则名称:');
        if (!name) return;

        const newRule = {
            scriptName: name.trim(),
            findRegex: '',
            replaceString: '',
            disabled: false,
        };

        await this.aiProcessor.addOrUpdateRegexRule(newRule);
        await this.loadRegexRules();
        this.ctx.helpers.showToast('规则已添加', 'success');
    }

    /**
     * [新增] 渲染替换词规则列表
     * @param {Array} replacements - 替换词规则数组
     */
    _renderReplacementList(replacements) {
        if (!this.elements.chatInsertionWordReplacements) return;

        if (!replacements || replacements.length === 0) {
            this.elements.chatInsertionWordReplacements.innerHTML = `
                <div class="ai-empty-state">
                    <i class="fa-solid fa-list"></i>
                    <p>暂无替换规则，点击下方按钮添加</p>
                </div>
            `;
            return;
        }

        this.elements.chatInsertionWordReplacements.innerHTML = replacements.map((rule, index) => `
            <div class="ai-regex-item ai-regex-row" data-index="${index}">
                <div class="ai-regex-field">
                    <label>源词</label>
                    <input type="text" class="tsp-input replacement-from" value="${(rule.from || '').replace(/"/g, '&quot;')}" placeholder="要替换的词">
                </div>
                <div class="ai-regex-arrow">→</div>
                <div class="ai-regex-field">
                    <label>目标词</label>
                    <input type="text" class="tsp-input replacement-to" value="${(rule.to || '').replace(/"/g, '&quot;')}" placeholder="替换为">
                </div>
                <label class="replacement-regex-toggle" title="开启后源词作为正则表达式处理">
                    <input type="checkbox" class="replacement-regex" ${rule.regex ? 'checked' : ''}>
                    <span>正则</span>
                </label>
                <button class="tsp-btn tsp-btn-sm tsp-btn-icon tsp-btn-danger replacement-delete" data-action="delete" title="删除">
                    <i class="fa-solid fa-trash"></i>
                </button>
            </div>
        `).join('');

        // 绑定删除和输入事件
        const rows = this.elements.chatInsertionWordReplacements.querySelectorAll('.ai-regex-row');
        rows.forEach(row => {
            row.querySelector('.replacement-delete')?.addEventListener('click', () => {
                const index = parseInt(row.dataset.index);
                const current = this._getReplacementDataFromUI();
                current.splice(index, 1);
                this._renderReplacementList(current);
            });

            // 正则开关切换时改变源词输入框样式提示
            const regexCheckbox = row.querySelector('.replacement-regex');
            const fromInput = row.querySelector('.replacement-from');
            if (regexCheckbox && fromInput) {
                const updateRegexStyle = () => {
                    if (regexCheckbox.checked) {
                        fromInput.style.borderColor = 'var(--tsp-accent-primary)';
                        fromInput.placeholder = '正则表达式，如: (?<!\\\\d)(?:[0-9]|1[0-6])\\\\s*岁';
                    } else {
                        fromInput.style.borderColor = '';
                        fromInput.placeholder = '要替换的词';
                    }
                };
                regexCheckbox.addEventListener('change', updateRegexStyle);
                updateRegexStyle();
            }
        });
    }

    /**
     * [新增] 从UI获取替换词数据
     * @returns {Array} 替换词规则数组
     */
    _getReplacementDataFromUI() {
        if (!this.elements.chatInsertionWordReplacements) return [];

        const rows = this.elements.chatInsertionWordReplacements.querySelectorAll('.ai-regex-row');
        const replacements = [];

        rows.forEach(row => {
            const from = row.querySelector('.replacement-from')?.value.trim() || '';
            const to = row.querySelector('.replacement-to')?.value.trim() || '';
            const isRegex = row.querySelector('.replacement-regex')?.checked || false;
            if (from) {
                const rule = { from, to };
                if (isRegex) {
                    rule.regex = true;
                }
                replacements.push(rule);
            }
        });

        return replacements;
    }

    /**
     * [新增] 添加替换词行
     */
    _addReplacementRow() {
        const current = this._getReplacementDataFromUI();
        current.push({ from: '', to: '' });
        this._renderReplacementList(current);
    }

    /**
     * [新增] 恢复默认替换词规则（立即生效）
     */
    async _restoreDefaultReplacements() {
        const confirmed = await this.ctx.helpers.promptConfirm(
            '这将用默认规则覆盖当前的替换词规则，并立即保存生效，确定继续吗？'
        );
        if (!confirmed) return;

        try {
            // 从 AIProcessor 取出厂默认规则（单一数据源）
            const defaults = this.aiProcessor._getDefaultWordReplacements();

            // 1. 更新 UI 显示
            this._renderReplacementList(defaults);

            // 2. 立即写入运行时 settings 并保存到存储，使其即时生效
            this.aiProcessor.settings.chatInsertionWordReplacements = JSON.parse(JSON.stringify(defaults));
            await this.aiProcessor.saveConfig();

            this.ctx.helpers.showToast('已恢复默认替换词规则并立即生效', 'success');
        } catch (err) {
            this.ctx.error('ai-settings', '恢复默认替换词规则失败:', err);
            this.ctx.helpers.showToast(`恢复失败: ${err.message}`, 'error');
        }
    }

    /**
     * [新增] 导出替换词规则为 JSON 文件
     */
    _exportReplacementRules() {
        const rules = this._getReplacementDataFromUI();
        if (rules.length === 0) {
            this.ctx.helpers.showToast('没有可导出的规则', 'warning');
            return;
        }
        const blob = new Blob([JSON.stringify(rules, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `word_replacements_${new Date().toISOString().slice(0, 10)}.json`;
        a.click();
        URL.revokeObjectURL(url);
        this.ctx.helpers.showToast('替换词规则已导出', 'success');
    }

    /**
     * [新增] 从 JSON 文件导入替换词规则
     */
    _importReplacementRules() {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.json';
        input.onchange = async (e) => {
            const target = /** @type {EventTarget | null} */ (e.target);
            const file = target instanceof HTMLInputElement ? target.files?.[0] : null;
            if (!file) return;

            try {
                const text = await file.text();
                let data = JSON.parse(text);

                // 兼容数组或单对象格式
                let rulesList = [];
                if (Array.isArray(data)) {
                    rulesList = data;
                } else if (typeof data === 'object') {
                    rulesList = [data];
                } else {
                    throw new Error('无效的规则文件格式');
                }

                // 过滤出有效规则（必须有 from 字段）
                const validRules = rulesList
                    .filter(item => item && typeof item === 'object' && item.from)
                    .map(item => ({
                        from: String(item.from),
                        to: String(item.to || ''),
                        ...(item.regex ? { regex: true } : {}),
                        ...(item.flags ? { flags: String(item.flags) } : {}),
                    }));

                if (validRules.length === 0) {
                    throw new Error('文件中未找到有效的替换规则');
                }

                // 让用户选择导入方式：覆盖 or 追加
                const mode = await this.ctx.helpers.promptSelect(
                    `检测到 ${validRules.length} 条规则，请选择导入方式：`,
                    [
                        { value: 'replace', label: '覆盖现有规则' },
                        { value: 'merge', label: '追加到现有规则末尾' },
                    ]
                );
                if (!mode) return; // 用户取消

                let finalRules;
                if (mode === 'merge') {
                    finalRules = this._getReplacementDataFromUI().concat(validRules);
                } else {
                    finalRules = validRules;
                }

                this._renderReplacementList(finalRules);
                this.ctx.helpers.showToast(
                    `已导入 ${validRules.length} 条规则（${mode === 'merge' ? '追加' : '覆盖'}，需点击保存生效）`,
                    'success'
                );
            } catch (err) {
                this.ctx.error('ai-settings', '导入替换词规则失败:', err);
                this.ctx.helpers.showToast(`导入失败: ${err.message}`, 'error');
            }
        };
        input.click();
    }

    /**
     * 加载 Tag 参考文件夹
     */
    async loadTagRefFolders() {
        const folders = await this.aiProcessor.getAllTagRefFolders();

        if (folders.length === 0) {
            this.elements.tagRefFolders.innerHTML = `
                <div class="ai-empty-state">
                    <i class="fa-solid fa-folder-open"></i>
                    <p>暂无 Tag 参考文件夹</p>
                </div>
            `;
            return;
        }

        this.elements.tagRefFolders.innerHTML = folders.map(folder => `
            <div class="ai-tagref-folder" data-id="${folder.id}">
                <div class="ai-tagref-folder-header">
                    <span class="ai-tagref-folder-name">
                        <i class="fa-solid fa-folder"></i>
                        ${folder.name}
                    </span>
                    <span class="ai-tagref-folder-type ${folder.type}">${folder.type === 'positive' ? '正面' : '负面'}</span>
                    <span class="ai-tagref-folder-count">${folder.imageIds?.length || 0} 张</span>
                    <button class="tsp-btn tsp-btn-sm tsp-btn-icon tsp-btn-danger" data-action="delete">
                        <i class="fa-solid fa-trash"></i>
                    </button>
                </div>
            </div>
        `).join('');

        // 绑定删除事件
        this.elements.tagRefFolders.querySelectorAll('[data-action="delete"]').forEach(btn => {
            btn.addEventListener('click', async () => {
                const folder = btn.closest('.ai-tagref-folder');
                const id = parseInt(folder.dataset.id);
                await this.aiProcessor.deleteTagRefFolder(id);
                await this.loadTagRefFolders();
                this.ctx.helpers.showToast('文件夹已删除', 'success');
            });
        });
    }

    /**
     * 添加 Tag 参考文件夹
     */
    async addTagRefFolder() {
        const name = await this.ctx.helpers.promptInput('请输入文件夹名称:');
        if (!name) return;

        const type = await this.ctx.helpers.promptSelect('选择文件夹类型:', [
            { value: 'positive', label: '正面参考' },
            { value: 'negative', label: '负面参考' },
        ]);
        if (!type) return;

        await this.aiProcessor.addOrUpdateTagRefFolder({
            name: name.trim(),
            type: type,
            imageIds: [],
        });

        await this.loadTagRefFolders();
        this.ctx.helpers.showToast('文件夹已创建', 'success');
    }
    /**
     *  填充原生世界书下拉列表
     */
    populateNativeWorldNames() {
        const select = this.elements.nativeWiSelect;
        if (!select) return;

        // 保存当前选中的值
        const currentVal = select.value;

        // 清空现有选项
        select.innerHTML = '<option value="">请选择世界书...</option>';

        // 从导入的 world_names 中获取列表
        if (Array.isArray(world_names)) {
            world_names.forEach(name => {
                const option = document.createElement('option');
                option.value = name;
                option.textContent = name;
                select.appendChild(option);
            });
        }

        // 尝试恢复选中值
        if (currentVal) {
            select.value = currentVal;
        }
    }

    /**
     *  注入占位符条目到选定的原生世界书
     */
    async injectPlaceholderEntry() {
        const worldName = this.elements.nativeWiSelect.value;
        if (!worldName) {
            this.ctx.helpers.showToast('请先选择一个原生世界书', 'error');
            return;
        }

        try {
            // 1. 加载原生世界书数据
            const wiData = await loadWorldInfo(worldName);
            if (!wiData) {
                throw new Error(`无法加载世界书 "${worldName}"`);
            }

            // 2. 创建新条目
            const entry = createWorldInfoEntry(worldName, wiData);
            if (!entry) {
                throw new Error('创建条目失败');
            }

            // 3. 配置条目属性
            entry.comment = "绘图占位符";
            entry.key = ["placeholder"]; // 随便给个key，因为是常驻
            entry.content = `为了搭配绘图模型生成图片。在诱人、色情等关键剧情下方使用<image>image###插图###</image>标签作为占位符。**一次回复最少包含2-3组占位符**，不要集中在文末，适当穿插在正文之内。并且内容直接用插图*表示不用任何其它的描述，脚本自动会处理该占位符，示例:
剧情内容
<image>image###插图1###</image>
剧情内容
<image>image###插图2###</image>
注意:不要少于两组占位符`;

            // 蓝灯 (Constant)
            entry.constant = true;

            // 深度 0
            entry.depth = 0;

            // 顺序 8888
            entry.order = 8888;

            // 策略: D模式 (Gear/Depth)
            // 在 ST 中, position 4 代表 'atDepth' (@D)，配合 role 0 (System) 实现类似 D模式的效果
            entry.position = 4;
            entry.role = 0;
            entry.group = "";

            // 4. 保存更改 (true 表示立即保存)
            await saveWorldInfo(worldName, wiData, true);

            this.ctx.helpers.showToast(`成功注入"绘图占位符"到 "${worldName}"`, 'success');

        } catch (e) {
            console.error(e);
            this.ctx.helpers.showToast(`注入失败: ${e.message}`, 'error');
        }
    }
    /**
     * [修复] 清洗导入的世界书数据
     * 解决 ST 原生 position=4 (策略) 与 插件 position=深度 (数值) 的定义冲突
     */
    _sanitizeWorldBookData(data) {
        if (!data || !data.entries) return data;

        // 遍历所有条目进行修正
        for (const uid in data.entries) {
            const entry = data.entries[uid];

            // 检测特征：如果是 ST 原生的 "指定深度" 策略 (position === 4)
            // 且存在 depth 属性
            if (entry.position === 4 && entry.depth !== undefined) {
                // 修正为插件格式：
                // 1. 设置为 Role 0 (插件识别为 Gear/深度类条目)
                entry.role = 0;
                // 2. 将真实的深度值 (entry.depth) 转移给 entry.position
                entry.position = parseInt(entry.depth) || 0;
            }
            // 额外修正：确保 uid 存在，防止编辑器报错
            if (!entry.uid) entry.uid = uid;
        }

        return data;
    }
}

