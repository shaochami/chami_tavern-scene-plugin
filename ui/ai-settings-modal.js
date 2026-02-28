'use strict';
import { world_names, loadWorldInfo, saveWorldInfo, createWorldInfoEntry, checkWorldInfo, getSortedEntries } from '../../../../world-info.js';

import { getTokenCountAsync } from '../../../../tokenizers.js';
import { chat } from '../../../../../script.js';
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
                                <li data-panel="regex">
                                    <i class="fa-solid fa-code"></i>
                                    <span>正则规则</span>
                                </li>
                                <li data-panel="advanced">
                                    <i class="fa-solid fa-cog"></i>
                                    <span>高级选项</span>
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

                            <!-- 正则规则面板 -->
                            <div class="ai-content-panel" data-panel="regex">
                                ${this._renderRegexPanel()}
                            </div>

                            <!-- 高级选项面板 -->
                            <div class="ai-content-panel" data-panel="advanced">
                                ${this._renderAdvancedPanel()}
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
                        <input type="checkbox" id="ai-chat-insertion-consistency">
                        <span>一致性</span>
                    </label>
                    <div class="tsp-form-hint">启用后，收集上下文时优先提取<image>标签内容作为生图一致性参考。</div>
                </div>

                <div class="tsp-form-group">
                    <label>
                        <input type="checkbox" id="ai-chat-insertion-use-regex">
                        <span>应用正则处理</span>
                    </label>
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
                <!-- ▲▲▲ 新增代码结束 ▲▲▲ -->
            </div>

            <!-- 模板编辑器 -->
            <div class="ai-settings-section">
                <div class="ai-regex-header">
                    <h4>提示词模板 (Template)</h4>
                    <div class="ai-regex-actions">
                         <button class="tsp-btn tsp-btn-sm tsp-btn-danger" id="ai-chat-tmpl-delete" title="删除当前模板">
                            <i class="fa-solid fa-trash"></i>
                        </button>
                         <button class="tsp-btn tsp-btn-sm tsp-btn-primary" id="ai-chat-tmpl-save-as" title="另存为新模板">
                            <i class="fa-solid fa-save"></i> 另存为
                        </button>
                    </div>
                </div>

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
        `;
    }
    /**
     *  渲染聊天插入的消息列表编辑器
     * @param {Array} messages 消息数组
     */
    _renderChatInsertionMessageList(messages) {
        const container = this.modalEl.querySelector('#ai-chat-msg-list');
        if (!container) return;

        // 保存当前正在编辑的数组引用，供内部事件修改
        // 注意：这里的 messages 引用直接指向 config 对象里的数组
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

            // [修改] 增强的视觉提示
            let hintHtml = '';
            if (msg.content.includes('{{historyContext}}')) {
                hintHtml += '<span style="color: var(--tsp-accent-blue); font-size: 0.8em; margin-left: 8px; background: rgba(0,0,255,0.1); padding: 2px 4px; border-radius: 4px;"><i class="fa-solid fa-clock-rotate-left"></i> 历史记录插槽</span>';
            }
            if (msg.content.includes('{{currentPlot}}')) {
                hintHtml += '<span style="color: var(--tsp-accent-primary); font-size: 0.8em; margin-left: 8px; background: rgba(255,0,0,0.1); padding: 2px 4px; border-radius: 4px;"><i class="fa-solid fa-pen-nib"></i> 当前正文插槽</span>';
            }
            if (msg.content.includes('{{worldInfo}}')) {
                hintHtml += '<span style="color: var(--tsp-accent-green); font-size: 0.8em; margin-left: 8px; background: rgba(0,255,0,0.1); padding: 2px 4px; border-radius: 4px;"><i class="fa-solid fa-globe"></i> 世界书/Character注入</span>';
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
                this._renderChatInsertionMessageList(messages);
            });

            // 移动
            upBtn.addEventListener('click', () => {
                if (index > 0) {
                    [messages[index], messages[index - 1]] = [messages[index - 1], messages[index]];
                    this._renderChatInsertionMessageList(messages);
                }
            });
            downBtn.addEventListener('click', () => {
                if (index < messages.length - 1) {
                    [messages[index], messages[index + 1]] = [messages[index + 1], messages[index]];
                    this._renderChatInsertionMessageList(messages);
                }
            });

            // 内容实时更新到内存对象
            const contentArea = row.querySelector('.msg-content');
            contentArea.addEventListener('input', (e) => {
                msg.content = e.target.value;
                // 检测是否改变了占位符，如果改变则刷新该行的小字提示
                // 为了简单，不重新渲染整个列表，只在保存时生效，或者失去焦点时验证也可
            });

            const roleSel = row.querySelector('.msg-role');
            roleSel.addEventListener('change', (e) => {
                msg.role = e.target.value;
            });

            container.appendChild(row);
        });
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
        `;
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
            chatInsertionConsistency: this.modalEl.querySelector('#ai-chat-insertion-consistency'),

            //  模板管理元素
            chatTemplateSelect: this.modalEl.querySelector('#ai-chat-template-select'),
            chatTemplateSaveAs: this.modalEl.querySelector('#ai-chat-tmpl-save-as'),
            chatTemplateDelete: this.modalEl.querySelector('#ai-chat-tmpl-delete'),
        };
    }

    bindEvents() {
        // === 基础模态框事件 ===
        this.modalEl.querySelector('#ai-settings-close').addEventListener('click', () => {
            this.saveAndClose();
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
                    this.elements.chatInsertionAutoMode.checked = true; // 顺便帮用户勾选自动模式

                    this.ctx.helpers.showToast('已恢复所有默认模版', 'success');
                    this.aiProcessor.saveConfig();
                }
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
        this.elements.chatInsertionConsistency.checked = config.chatInsertionConsistency || false;
        this.elements.chatInsertionUseRegex.checked = config.chatInsertionUseRegex || false;
        this.elements.chatInsertionStartTag.value = config.chatInsertionStartTag || '<图片>';
        this.elements.chatInsertionEndTag.value = config.chatInsertionEndTag || '</图片>';
        this.elements.chatInsertionAutoMode.checked = config.chatInsertionAutoMode || false;
        this.elements.chatInsertionUniformMode.checked = config.chatInsertionUniformMode || false;
        this.elements.chatInsertionAutoClick.checked = config.chatInsertionAutoClick || false;

        // ===  聊天模板加载逻辑 ===
        // 如果没有模板列表，初始化一个默认的
        if (!config.chatInsertionTemplates || !Array.isArray(config.chatInsertionTemplates)) {
            // 尝试迁移旧数据，或者获取新版默认结构
            const initialMsgs = (config.chatInsertionMessages && config.chatInsertionMessages.length > 0)
                ? config.chatInsertionMessages
                : this.aiProcessor._getDefaultChatInsertionMessages();

            config.chatInsertionTemplates = [{
                name: 'Default',
                messages: JSON.parse(JSON.stringify(initialMsgs))
            }];
            config.activeChatInsertionTemplateName = 'Default';
        }

        // 刷新下拉框并渲染列表
        this._updateChatTemplateSelect(config);
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
    _collectPresetFromUI() {
        let realTargetFeatures;
        if (this.worldBookPreviewVisible) {
            realTargetFeatures = this._tempOriginalFeatures;
        } else {
            realTargetFeatures = this.elements.targetFeatures.value;
        }
        return {
            name: this.elements.presetSelect.value,
            isEnabled: this.elements.enabledCheckbox.checked,
            enableForTagSupermarket: this.elements.enableForTagSupermarketCheckbox.checked,
            enableForChatInsertion: this.elements.enableForChatInsertionCheckbox.checked,
            apiUrl: this.elements.apiUrl.value.trim(),
            apiKey: this.elements.apiKey.value.trim(),
            model: this.elements.model.value.trim(),
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
                config.chatInsertionConsistency = this.elements.chatInsertionConsistency.checked;
                config.chatInsertionUseRegex = this.elements.chatInsertionUseRegex.checked;
                config.chatInsertionStartTag = this.elements.chatInsertionStartTag.value.trim();
                config.chatInsertionEndTag = this.elements.chatInsertionEndTag.value.trim();
                config.chatInsertionAutoMode = this.elements.chatInsertionAutoMode.checked;
                config.chatInsertionUniformMode = this.elements.chatInsertionUniformMode.checked;
                config.chatInsertionAutoClick = this.elements.chatInsertionAutoClick.checked;
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

        // 2. 校验 (去掉了 apiKey 的强制检查，改为检查 model)
        if (!url || !model) {
            this.ctx.helpers.showToast('请输入 API 地址和模型名称 (本地部署可不填 Key)', 'error');
            return;
        }

        this.ctx.helpers.showToast('正在测试发送...', 'info');

        try {
            // 3. 构建 URL (去除末尾斜杠并拼接 chat/completions)
            const baseUrl = url.replace(/\/$/, '');
            const chatUrl = `${baseUrl}/chat/completions`;

            // 4. 构建 Headers
            const headers = {
                'Content-Type': 'application/json'
            };
            if (apiKey) {
                headers['Authorization'] = `Bearer ${apiKey}`;
            }

            // 5. 构建与提供的逻辑一致的 Payload
            const payload = {
                model: model,
                messages: [{
                    role: 'user',
                    content: 'Human: Hi'
                }],
                temperature: 1.15,
                top_p: 0.98,
                max_tokens: 8192, // 测试时设小一点即可
                stream: false,
            };

            // 6. 发送 POST 请求 (使用 fetch)
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
                    // 尝试解析错误 JSON
                    const errJson = JSON.parse(errText);
                    if (errJson.error && errJson.error.message) {
                        errText = errJson.error.message;
                    }
                } catch (e) {
                    // 忽略 JSON 解析错误，使用原始文本
                }
                throw new Error(`HTTP ${response.status}: ${errText.substring(0, 100)}`);
            }

            // 8. 解析响应数据
            const data = await response.json();
            console.log("[AI测试] 原始响应内容:", data);

            // 9. 校验返回结构 (仿照提供的逻辑)
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
            console.error("[AI测试] 请求失败或解析失败:", e);
            this.ctx.helpers.showToast(`连接测试失败: ${e.message}`, 'error');
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
            this.ctx.helpers.showToast(`获取模型失败: ${e.message}`, 'error');
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
    /**
     * HTML 转义
     */
    _escapeHtml(str) {
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }
}

