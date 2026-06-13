'use strict';

import { MultiCharacterParser } from '../modules/multi-character-parser.js';

export class PromptBuilder {
    constructor(context) {
        this.ctx = context;


        this.currentPrompt = {

            baseTags: [],

            characterTags: [],

            sceneTags: [],

            qualityTags: [],

            negativeTags: [],

            customTags: [],

            rawInput: '',

            aiProcessedResult: null,
        };


        this.presets = {
            defaultQuality: ['best quality', 'amazing quality', 'very aesthetic', 'masterpiece'],
            defaultNegative: ['lowres', 'bad anatomy', 'bad hands', 'text', 'error', 'missing fingers',
                            'extra digit', 'fewer digits', 'cropped', 'worst quality', 'low quality',
                            'normal quality', 'jpeg artifacts', 'signature', 'watermark', 'username', 'blurry'],
        };


        this._targetGenerator = null;
        this._targetButton = null;


        this.triggers = [];
    }

    async init() {
        this.ctx.log('prompt-builder', '初始化');


        this._setupEventListeners();


        this.ctx.promptBuilder = this;

        this.ctx.log('prompt-builder', '初始化完成');
    }


    _setupEventListeners() {

        this.ctx.events.on('tag:selected', ({ cn, en, selected }) => {
            if (selected) {
                this.addTag('base', en);
            } else {
                this.removeTag('base', en);
            }
        });


        this.ctx.events.on('tag:batch-submit', ({ tags }) => {
            tags.forEach(tag => this.addTag('base', tag.en));
        });


        this.ctx.events.on('character:applied', ({ characterData }) => {
            this.applyCharacterData(characterData);
        });


        this.ctx.events.on('ai-process:complete', ({ result }) => {
            this.currentPrompt.aiProcessedResult = result;
        });


        this.ctx.events.on('prompt:generate', () => {
            this.submitToGenerator();
        });
    }




    addTag(category, tag) {
        const tagArray = this._getTagArray(category);
        if (tagArray && !tagArray.includes(tag)) {
            tagArray.push(tag);
            this.ctx.events.emit('prompt:updated', { category, action: 'add', tag });
        }
    }


    removeTag(category, tag) {
        const tagArray = this._getTagArray(category);
        if (tagArray) {
            const index = tagArray.indexOf(tag);
            if (index > -1) {
                tagArray.splice(index, 1);
                this.ctx.events.emit('prompt:updated', { category, action: 'remove', tag });
            }
        }
    }


    clearTags(category) {
        const tagArray = this._getTagArray(category);
        if (tagArray) {
            tagArray.length = 0;
            this.ctx.events.emit('prompt:updated', { category, action: 'clear' });
        }
    }


    clearAll() {
        this.currentPrompt.baseTags = [];
        this.currentPrompt.characterTags = [];
        this.currentPrompt.sceneTags = [];
        this.currentPrompt.customTags = [];
        this.currentPrompt.rawInput = '';
        this.currentPrompt.aiProcessedResult = null;
        this.ctx.events.emit('prompt:cleared');
    }


    _getTagArray(category) {
        const map = {
            'base': this.currentPrompt.baseTags,
            'character': this.currentPrompt.characterTags,
            'scene': this.currentPrompt.sceneTags,
            'quality': this.currentPrompt.qualityTags,
            'negative': this.currentPrompt.negativeTags,
            'custom': this.currentPrompt.customTags,
        };
        return map[category];
    }




    applyCharacterData(characterData) {
        if (!characterData) return;


        this.currentPrompt.characterTags = [];


        const extractTags = (value) => {
            if (!value) return [];
            return value.split(',').map(t => t.trim()).filter(Boolean);
        };


        if (characterData.fandom) {
            this.currentPrompt.characterTags.push(...extractTags(characterData.fandom));
        }


        if (characterData.hair) {
            this.currentPrompt.characterTags.push(...extractTags(characterData.hair));
        }


        if (characterData.clothes) {
            this.currentPrompt.characterTags.push(...extractTags(characterData.clothes));
        }


        if (characterData.pants) {
            this.currentPrompt.characterTags.push(...extractTags(characterData.pants));
        }


        if (characterData.body) {
            this.currentPrompt.characterTags.push(...extractTags(characterData.body));
        }


        if (characterData.customFeatures) {
            for (const value of Object.values(characterData.customFeatures)) {
                if (value) {
                    this.currentPrompt.characterTags.push(...extractTags(value));
                }
            }
        }

        this.ctx.events.emit('prompt:character-applied', {
            characterName: characterData.nameTrigger,
            tagCount: this.currentPrompt.characterTags.length
        });

        this.ctx.log('prompt-builder', `应用角色数据: ${characterData.nameTrigger}, 标签数: ${this.currentPrompt.characterTags.length}`);
    }

    // ==================== 提示词构建 ====================

    /**
     * 构建最终的正向提示词
     * @param {Object} options 构建选项
     * @returns {string}
     */
    buildPositivePrompt(options = {}) {
        const {
            includeQuality = true,
            includeCharacter = true,
            useAiResult = false,
        } = options;

        // 如果有 AI 处理结果且启用，直接返回
        if (useAiResult && this.currentPrompt.aiProcessedResult) {
            return this._cleanPromptText(this.currentPrompt.aiProcessedResult);
        }

        const parts = [];

        // 质量标签 (放最前面)
        if (includeQuality && this.currentPrompt.qualityTags.length > 0) {
            parts.push(...this.currentPrompt.qualityTags);
        }

        // 角色标签
        if (includeCharacter && this.currentPrompt.characterTags.length > 0) {
            parts.push(...this.currentPrompt.characterTags);
        }

        // 基础标签 (来自标签超市)
        if (this.currentPrompt.baseTags.length > 0) {
            parts.push(...this.currentPrompt.baseTags);
        }

        // 场景标签
        if (this.currentPrompt.sceneTags.length > 0) {
            parts.push(...this.currentPrompt.sceneTags);
        }

        // 自定义标签
        if (this.currentPrompt.customTags.length > 0) {
            parts.push(...this.currentPrompt.customTags);
        }

        // 原始输入
        if (this.currentPrompt.rawInput) {
            parts.push(this.currentPrompt.rawInput);
        }

        // 去重并连接
        const uniqueParts = [...new Set(parts)];
        let prompt = uniqueParts.join(', ');

        // 多角色平铺（当未开启多角色模式时）
        prompt = this._flattenMultiCharacterPrompt(prompt);

        // 触发词替换
        prompt = this._processTriggers(prompt);

        // 清理标点和空格
        return this._cleanPromptText(prompt);
    }

    /**
     * 构建负向提示词
     * @returns {string}
     */
    buildNegativePrompt() {
        const uniqueTags = [...new Set(this.currentPrompt.negativeTags)];
        const prompt = uniqueTags.join(', ');
        return this._cleanPromptText(prompt);
    }

    /**
     * 获取完整的提示词对象
     */
    getPromptObject() {
        return {
            positive: this.buildPositivePrompt(),
            negative: this.buildNegativePrompt(),
            raw: { ...this.currentPrompt },
        };
    }

    // ==================== 生成器交互 ====================

    /**
     * 设置目标生成器
     * @param {Object} generator 生成器实例
     * @param {HTMLElement} button 可选的目标按钮
     */
    setTargetGenerator(generator, button = null) {
        this._targetGenerator = generator;
        this._targetButton = button;
    }

    /**
     * 提交到生成器
     * @param {Object} options 选项
     */
    async submitToGenerator(options = {}) {
        const prompt = this.buildPositivePrompt(options);
        const negative = this.buildNegativePrompt();

        if (!prompt) {
            this.ctx.helpers.showToast('提示词为空，请先选择标签', 'warning');
            return false;
        }

        this.ctx.log('prompt-builder', '提交到生成器:', prompt.substring(0, 100) + '...');

        // 如果有目标生成器，直接调用
        const imageGen = this._targetGenerator || this.ctx.getModule('imageGen');
        if (imageGen) {
            try {
                // 创建虚拟按钮数据
                const buttonData = {
                    dataset: {
                        link: prompt,
                        negative: negative,
                    },
                    _fromPromptBuilder: true,
                };

                await imageGen.generate(buttonData, false);
                this.ctx.helpers.showToast('已提交到生成器', 'success');
                return true;
            } catch (error) {
                this.ctx.error('prompt-builder', '提交生成失败:', error);
                this.ctx.helpers.showToast(`生成失败: ${error.message}`, 'error');
                return false;
            }
        } else {
            // 没有生成器，触发生成事件
            this.ctx.events.emit('prompt:submit', {
                positive: prompt,
                negative,
                source: 'prompt-builder'
            });

            // 复制到剪贴板
            try {
                await navigator.clipboard.writeText(prompt);
                this.ctx.helpers.showToast('提示词已复制到剪贴板', 'info');
                return true;
            } catch (e) {
                this.ctx.helpers.showToast('复制失败', 'error');
                return false;
            }
        }
    }

    /**
     * 打开预览/编辑窗口
     */
    openPreviewModal() {
        // 即使没有内容也允许打开，用户可以查看当前状态
        const promptObj = this.getPromptObject();
        const stats = this.getStats();

        const overlay = document.createElement('div');
        overlay.className = 'tsp-modal-overlay';
        overlay.innerHTML = `
            <div class="tsp-modal tsp-modal-large">
                <div class="tsp-modal-header">
                    <div class="tsp-modal-title">
                        <i class="fa-solid fa-eye"></i>
                        提示词预览与编辑
                    </div>
                    <button class="tsp-btn tsp-btn-icon" id="tsp-preview-close" title="关闭">
                        <i class="fa-solid fa-times"></i>
                    </button>
                </div>
                <div class="tsp-modal-body">
                    <div class="tsp-prompt-preview-layout">
                        <div class="tsp-preview-stats">
                            <div class="tsp-stat-item">
                                <span class="tsp-stat-label">基础标签:</span>
                                <span class="tsp-stat-value">${stats.base}</span>
                            </div>
                            <div class="tsp-stat-item">
                                <span class="tsp-stat-label">角色特征:</span>
                                <span class="tsp-stat-value">${stats.character}</span>
                            </div>
                            <div class="tsp-stat-item">
                                <span class="tsp-stat-label">场景标签:</span>
                                <span class="tsp-stat-value">${stats.scene}</span>
                            </div>
                            <div class="tsp-stat-item">
                                <span class="tsp-stat-label">质量标签:</span>
                                <span class="tsp-stat-value">${stats.quality}</span>
                            </div>
                            <div class="tsp-stat-item">
                                <span class="tsp-stat-label">总计:</span>
                                <span class="tsp-stat-value">${stats.total}</span>
                            </div>
                        </div>

                        <div class="tsp-form-group">
                            <label>正向提示词</label>
                            <textarea class="tsp-input" id="tsp-preview-positive"
                                      rows="6" readonly>${promptObj.positive}</textarea>
                            <button class="tsp-btn tsp-btn-sm" id="tsp-copy-positive">
                                <i class="fa-solid fa-copy"></i> 复制
                            </button>
                        </div>

                        <div class="tsp-form-group">
                            <label>负面提示词</label>
                            <textarea class="tsp-input" id="tsp-preview-negative"
                                      rows="4" readonly>${promptObj.negative}</textarea>
                            <button class="tsp-btn tsp-btn-sm" id="tsp-copy-negative">
                                <i class="fa-solid fa-copy"></i> 复制
                            </button>
                        </div>

                        <div class="tsp-form-group">
                            <label>标签分类</label>
                            <div class="tsp-tag-categories">
                                ${this._renderTagCategories()}
                            </div>
                        </div>
                    </div>
                </div>
                <div class="tsp-modal-footer">
                    <button class="tsp-btn tsp-btn-primary" id="tsp-preview-generate">
                        <i class="fa-solid fa-paper-plane"></i> 提交生成
                    </button>
                    <button class="tsp-btn" id="tsp-preview-clear">
                        <i class="fa-solid fa-eraser"></i> 清空
                    </button>
                </div>
            </div>
        `;

        document.body.appendChild(overlay);

        // 绑定事件
        overlay.querySelector('#tsp-preview-close').addEventListener('click', () => {
            overlay.classList.remove('visible');
            setTimeout(() => overlay.remove(), 200);
        });

        overlay.querySelector('#tsp-copy-positive').addEventListener('click', () => {
            navigator.clipboard.writeText(promptObj.positive);
            this.ctx.helpers.showToast('正向提示词已复制', 'success');
        });

        overlay.querySelector('#tsp-copy-negative').addEventListener('click', () => {
            navigator.clipboard.writeText(promptObj.negative);
            this.ctx.helpers.showToast('负面提示词已复制', 'success');
        });

        overlay.querySelector('#tsp-preview-generate').addEventListener('click', async () => {
            await this.submitToGenerator();
            overlay.classList.remove('visible');
            setTimeout(() => overlay.remove(), 200);
        });

        overlay.querySelector('#tsp-preview-clear').addEventListener('click', async () => {
            const confirmed = await this.ctx.helpers.promptConfirm('确定清空所有提示词吗？');
            if (confirmed) {
                this.clearAll();
                overlay.classList.remove('visible');
                setTimeout(() => overlay.remove(), 200);
                this.ctx.helpers.showToast('已清空', 'info');
            }
        });

        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) {
                overlay.classList.remove('visible');
                setTimeout(() => overlay.remove(), 200);
            }
        });

        // 动画显示
        requestAnimationFrame(() => overlay.classList.add('visible'));
    }

    /**
     * 渲染标签分类
     */
    _renderTagCategories() {
        const categories = [
            { name: '基础标签', tags: this.currentPrompt.baseTags, key: 'base' },
            { name: '角色特征', tags: this.currentPrompt.characterTags, key: 'character' },
            { name: '场景标签', tags: this.currentPrompt.sceneTags, key: 'scene' },
            { name: '质量标签', tags: this.currentPrompt.qualityTags, key: 'quality' },
            { name: '自定义', tags: this.currentPrompt.customTags, key: 'custom' },
        ];

        return categories.map(cat => `
            <div class="tsp-tag-category">
                <div class="tsp-tag-category-header">
                    <span>${cat.name} (${cat.tags.length})</span>
                    <button class="tsp-btn tsp-btn-xs" data-clear-category="${cat.key}">
                        <i class="fa-solid fa-times"></i>
                    </button>
                </div>
                <div class="tsp-tag-category-tags">
                    ${cat.tags.length > 0
                        ? cat.tags.map(tag => `
                            <span class="tsp-tag-chip" data-category="${cat.key}" data-tag="${tag}">
                                ${tag}
                                <i class="fa-solid fa-times"></i>
                            </span>
                        `).join('')
                        : '<span class="tsp-muted">无标签</span>'
                    }
                </div>
            </div>
        `).join('');
    }

    // ==================== 预设管理 ====================

    /**
     * 应用质量预设
     * @param {string} presetName 预设名称
     */
    applyQualityPreset(presetName) {
        if (this.presets[presetName]) {
            this.currentPrompt.qualityTags = [...this.presets[presetName]];
            this.ctx.events.emit('prompt:preset-applied', { type: 'quality', name: presetName });
        }
    }

    /**
     * 重置为默认负面提示词
     */
    resetNegativeToDefault() {
        this.currentPrompt.negativeTags = [...this.presets.defaultNegative];
        this.ctx.events.emit('prompt:preset-applied', { type: 'negative', name: 'default' });
    }

    // ==================== 状态查询 ====================

    /**
     * 获取当前标签统计
     */
    getStats() {
        return {
            base: this.currentPrompt.baseTags.length,
            character: this.currentPrompt.characterTags.length,
            scene: this.currentPrompt.sceneTags.length,
            quality: this.currentPrompt.qualityTags.length,
            negative: this.currentPrompt.negativeTags.length,
            custom: this.currentPrompt.customTags.length,
            total: this.currentPrompt.baseTags.length +
                   this.currentPrompt.characterTags.length +
                   this.currentPrompt.sceneTags.length +
                   this.currentPrompt.customTags.length,
        };
    }

    /**
     * 检查是否有内容
     */
    hasContent() {
        return this.currentPrompt.baseTags.length > 0 ||
               this.currentPrompt.characterTags.length > 0 ||
               this.currentPrompt.sceneTags.length > 0 ||
               this.currentPrompt.customTags.length > 0 ||
               this.currentPrompt.rawInput.length > 0;
    }

    async cleanup() {
        // 无需特殊清理
    }

    // ==================== 内部工具 ====================

    /**
     * 清理提示词：去除重复逗号、首尾逗号与多余空格
     */
    _cleanPromptText(text) {
        if (!text) return '';
        return text
            .replace(/,(\s*,)+/g, ',')   // 多个逗号合并
            .replace(/, /g, ',')        // 统一逗号空格
            .replace(/ ,/g, ',')
            .replace(/(^,\s*)|(\s*,$)/g, '') // 去首尾逗号
            .replace(/\s+/g, ' ')       // 多余空格
            .trim();
    }

    /**
     * 平铺 NovelAI 多角色提示词（当未开启多角色模式时）
     */
    _flattenMultiCharacterPrompt(promptText) {
        if (!promptText || typeof promptText !== 'string') return promptText;

        const imageGen = this.ctx.getModule('imageGen');
        const multiRoleEnabled = imageGen?.settings?.nai?.multiRoleEnabled;
        if (multiRoleEnabled) return promptText;

        if (!MultiCharacterParser.isMultiCharacterPrompt(promptText)) {
            return promptText;
        }

        return MultiCharacterParser.flattenMultiCharacterPrompt(promptText);
    }

    /**
     * 简化版触发词替换：
     * - 来自设置面板保存的 triggers（格式: {trigger, replacement}）
     * - 来自角色数据库的 nameTrigger -> 拼接角色特征
     */
    _processTriggers(promptText) {
        if (!promptText || typeof promptText !== 'string') return promptText;

        let result = promptText;

        // 1) 设置面板触发词
        if (Array.isArray(this.triggers) && this.triggers.length > 0) {
            const sorted = [...this.triggers].sort((a, b) => (b.trigger || '').length - (a.trigger || '').length);
            sorted.forEach(rule => {
                if (!rule?.trigger || !rule?.replacement) return;
                try {
                    const escaped = rule.trigger.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                    result = result.replace(new RegExp(escaped, 'g'), rule.replacement);
                } catch (e) {
                    this.ctx.warn('prompt-builder', '触发词替换失败:', rule, e);
                }
            });
        }

        // 2) 角色数据库 nameTrigger -> 角色特征
        try {
            const charDB = this.ctx.getModule('characterDB');
            if (charDB?.getEnabledSimpleModeCharactersData) {
                const roles = charDB.getEnabledSimpleModeCharactersData();
                roles.forEach(role => {
                    const triggerStr = role?.data?.nameTrigger;
                    if (!triggerStr) return;
                    const aliases = triggerStr.split('|').map(t => t.trim()).filter(Boolean);
                    if (aliases.length === 0) return;

                    const replacement = [
                        role.data?.body,
                        role.data?.hair,
                        role.data?.clothes,
                        role.data?.pants,
                    ].filter(Boolean).join(', ');

                    if (!replacement) return;

                    aliases.forEach(alias => {
                        const escaped = alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                        result = result.replace(new RegExp(escaped, 'g'), replacement);
                    });
                });
            }
        } catch (e) {
            this.ctx.warn('prompt-builder', '角色触发词替换失败', e);
        }

        return result;
    }
}

