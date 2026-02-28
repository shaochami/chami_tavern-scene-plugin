'use strict';



export class OtherAPISettings {
    constructor(context) {
        this.ctx = context;
        this.containerEl = null;

        
        this.defaultSettings = {
            url: '',
            apiKey: '',
            model: '',
            width: 1024,
            height: 1024,
            timeout: 120,
            steps: 20,
            cfgScale: 7,
            customHeaders: '',
            customBody: '',
            presets: [],
            activePreset: '',
            placeholders: [],
            pureMode: false,
        };

        
        this.models = [];
        this.presets = [];
        this.activePreset = '';
    }

    
    _getSettings() {
        try {
            const imageGen = this.ctx?.getModule?.('imageGen');
            const other = imageGen?.settings?.other || {};
            const settings = { ...this.defaultSettings, ...other };
            
            // 加载预设
            this.presets = settings.presets || [];
            this.activePreset = settings.activePreset || '';
            
            return settings;
        } catch (e) {
            return this.defaultSettings;
        }
    }

    
    render() {
        const s = this._getSettings();

        return `
        <div class="tsp-settings-pane-inner">
            <!-- 通用 API 设置 -->
            <div class="tsp-settings-group">
                <h4 class="tsp-settings-group-title">
                    <i class="fa-solid fa-plug"></i> 通用 API 设置 (Other API)
                </h4>
                <p class="tsp-text-muted" style="margin-top: -5px; margin-bottom: 15px;">
                    此模式用于连接任何兼容 OpenAI 接口的图像生成服务。
                </p>

                <div class="tsp-form-group">
                    <label>API 请求地址 (URL)</label>
                    <input type="text" class="tsp-input" id="other-api-url"
                        value="${s.url}"
                        placeholder="例如: https://api.example.com/v1/images/generations">
                </div>

                <!-- [修改开始]：增加了Key显示按钮 -->
                <div class="tsp-form-group">
                    <label>API 密钥 (Key)</label>
                    <div class="tsp-input-group">
                        <input type="password" class="tsp-input" id="other-api-key"
                               value="${s.apiKey}"
                               placeholder="sk-xxxxxxx...">
                        <button class="tsp-btn tsp-btn-icon" id="other-key-toggle" title="显示/隐藏 Key">
                            <i class="fa-solid fa-eye"></i>
                        </button>
                    </div>
                </div>

                <div class="tsp-form-group">
                    <label>模型名称 (Model)</label>
                    <div class="tsp-form-row" style="align-items: flex-end; gap: 10px;">
                        <div class="tsp-form-group" style="flex: 1; margin-bottom: 0;">
                            <input type="text" class="tsp-input" id="other-model"
                                   value="${s.model}"
                                   placeholder="输入或选择模型名称">
                        </div>
                        <div class="tsp-form-group" style="flex: 1; margin-bottom: 0;">
                            <select class="tsp-input" id="other-model-select">
                                <option value="">-- 点击刷新 --</option>
                            </select>
                        </div>
                        <button class="tsp-btn tsp-btn-primary" id="other-refresh-models-btn">
                            <i class="fa-solid fa-sync"></i> 刷新
                        </button>
                    </div>
                    <small class="tsp-text-muted">* 以左侧输入框的内容为准</small>
                </div>
            </div>

            <!-- 请求参数 -->
            <div class="tsp-settings-group">
                <h4 class="tsp-settings-group-title">
                    <i class="fa-solid fa-sliders"></i> 请求参数
                </h4>
                <div class="tsp-form-row">
                    <div class="tsp-form-group">
                        <label>宽度</label>
                        <input type="number" class="tsp-input" id="other-width"
                               value="${s.width}" min="64" step="64">
                    </div>
                    <div class="tsp-form-group">
                        <label>高度</label>
                        <input type="number" class="tsp-input" id="other-height"
                               value="${s.height}" min="64" step="64">
                    </div>
                    <div class="tsp-form-group">
                        <label>超时 (秒)</label>
                        <input type="number" class="tsp-input" id="other-timeout"
                               value="${s.timeout}" min="30" max="600">
                    </div>
                    <div class="tsp-form-group">
                        <label>CFG Scale</label>
                        <input type="number" class="tsp-input" id="other-cfg"
                               value="${s.cfgScale || 7}" step="0.5" min="1" max="30">
                    </div>
                </div>
            </div>

            <!-- 高级选项 -->
            <div class="tsp-settings-group">
                <h4 class="tsp-settings-group-title">
                    <i class="fa-solid fa-cog"></i> 高级选项
                </h4>
                
                <!-- 预设管理 -->
                <div class="tsp-form-row" style="align-items: flex-end; gap: 10px; margin-bottom: 15px;">
                    <div class="tsp-form-group" style="flex: 1; margin-bottom: 0;">
                        <label>预设</label>
                        <select class="tsp-input" id="other-preset-select">
                            <option value="">-- 选择预设 --</option>
                            ${this.presets.map(preset => `<option value="${preset.name}" ${this.activePreset === preset.name ? 'selected' : ''}>${preset.name}</option>`).join('')}
                        </select>
                    </div>
                    <div class="tsp-btn-group" style="flex-wrap: nowrap; gap: 5px;">
                        <button class="tsp-btn" id="other-preset-save" title="另存为新预设">
                            <i class="fa-solid fa-save"></i> 另存
                        </button>
                        <button class="tsp-btn" id="other-preset-update" title="更新当前预设">
                            <i class="fa-solid fa-sync"></i> 更新
                        </button>
                        <button class="tsp-btn" id="other-preset-export" title="导出预设">
                            <i class="fa-solid fa-file-export"></i> 导出
                        </button>
                        <button class="tsp-btn" id="other-preset-import" title="导入预设">
                            <i class="fa-solid fa-file-import"></i> 导入
                        </button>
                        <button class="tsp-btn tsp-btn-danger" id="other-preset-delete" title="删除当前预设">
                            <i class="fa-solid fa-trash"></i> 删除
                        </button>
                    </div>
                </div>
                
                <div class="tsp-form-group">
                    <label>自定义请求头 (JSON 格式)</label>
                    <textarea class="tsp-input" id="other-custom-headers" rows="3"
                              placeholder='{"X-Custom-Header": "value"}'>${s.customHeaders}</textarea>
                </div>
                <div class="tsp-form-group">
                    <label>自定义请求体字段 (JSON 格式)</label>
                    <textarea class="tsp-input" id="other-custom-body" rows="3"
                              placeholder='{"quality": "hd", "style": "vivid"}'>${s.customBody}</textarea>
                    <small class="tsp-text-muted">这些字段将与默认请求体合并</small>
                </div>
                <div class="tsp-form-group">
                    <label>
                        <input type="checkbox" id="other-pure-mode" ${s.pureMode ? 'checked' : ''}>
                        纯净模式
                    </label>
                    <small class="tsp-text-muted">启用后，直接使用自定义请求体作为完整请求，不进行任何字段合并或修改</small>
                </div>
                
                <!-- 自定义占位符 -->
                <div class="tsp-form-group">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
                        <label>自定义占位符</label>
                        <button class="tsp-btn tsp-btn-sm" id="other-add-placeholder" title="添加占位符">
                            <i class="fa-solid fa-plus"></i> 添加
                        </button>
                    </div>
                    <div id="other-placeholder-list" style="margin-bottom: 10px;">
                        ${(s.placeholders || []).map((placeholder, index) => {
                            const options = placeholder.value.split('|').map(opt => opt.trim()).filter(opt => opt);
                            return `
                                <div class="tsp-form-row" style="align-items: center; gap: 10px; margin-bottom: 5px;">
                                    <div class="tsp-form-group" style="flex: 1; margin-bottom: 0;">
                                        <input type="text" class="tsp-input" placeholder="占位符名称" value="${placeholder.name}" data-index="${index}">
                                    </div>
                                    <div class="tsp-form-group" style="flex: 1; margin-bottom: 0;">
                                        <input type="text" class="tsp-input tsp-placeholder-value" placeholder="默认值" value="${placeholder.value}" data-index="${index}">
                                        ${options.length > 1 ? `
                                            <select class="tsp-input tsp-placeholder-select" style="margin-top: 5px;" data-index="${index}">
                                                ${options.map(opt => `<option value="${opt}" ${options[0] === opt ? 'selected' : ''}>${opt}</option>`).join('')}
                                            </select>
                                        ` : ''}
                                    </div>
                                    <button class="tsp-btn tsp-btn-sm tsp-btn-danger" title="删除占位符" data-index="${index}">
                                        <i class="fa-solid fa-trash"></i>
                                    </button>
                                </div>
                            `;
                        }).join('')}
                    </div>
                    <small class="tsp-text-muted">占位符可以在自定义请求体中使用，格式为 {"key": "占位符名称"}<br>当前可用的固定占位符：<br>正面提示词<br>负面提示词<br>宽度<br>高度<br>步数<br>CFG<br>尺寸 (如 1024x1024)<br>宽度x高度<br>宽度:高度<br>图片 (图生图时的base64数据，无前缀)<br>图片完整 (图生图时的完整data URL)<br>蒙版 (图生图蒙版的base64数据，无前缀)<br>蒙版完整 (图生图蒙版的完整data URL)</small>
                </div>
            </div>

            <!-- 常见 API 预设 -->
            <div class="tsp-settings-group">
                <h4 class="tsp-settings-group-title">
                    <i class="fa-solid fa-bookmark"></i> 常见 API 预设
                </h4>
                <p class="tsp-text-muted" style="margin-top: -5px; margin-bottom: 10px;">
                    点击按钮快速填入常见服务的配置
                </p>
                <div class="tsp-btn-group" style="flex-wrap: wrap; gap: 8px;">
                    <button class="tsp-btn" data-preset="openai">
                        <i class="fa-solid fa-robot"></i> OpenAI DALL-E
                    </button>
                    <button class="tsp-btn" data-preset="stability">
                        <i class="fa-solid fa-image"></i> Stability AI
                    </button>
                    <button class="tsp-btn" data-preset="replicate">
                        <i class="fa-solid fa-clone"></i> Replicate
                    </button>
                    <button class="tsp-btn" data-preset="azure">
                        <i class="fa-solid fa-cloud"></i> Azure OpenAI
                    </button>
                    <button class="tsp-btn" data-preset="novelai">
                        <i class="fa-solid fa-book"></i> NovelAI兼容模式
                    </button>
                    <button class="tsp-btn" data-preset="img2img">
                        <i class="fa-solid fa-images"></i> 火山图生图API
                    </button>
                </div>
            </div>
        </div>
        `;
    }

    /**
     * 绑定事件
     */
    bindEvents(containerEl) {
        this.containerEl = containerEl;
        containerEl.querySelector('#other-key-toggle')?.addEventListener('click', (e) => {
            e.preventDefault();
            const input = containerEl.querySelector('#other-api-key');
            const icon = e.currentTarget.querySelector('i');

            if (input && icon) {
                if (input.type === 'password') {
                    input.type = 'text';
                    icon.classList.remove('fa-eye');
                    icon.classList.add('fa-eye-slash');
                } else {
                    input.type = 'password';
                    icon.classList.remove('fa-eye-slash');
                    icon.classList.add('fa-eye');
                }
            }
        });
        // 刷新模型列表
        containerEl.querySelector('#other-refresh-models-btn')?.addEventListener('click', () => {
            this.refreshModels();
        });

        // 模型下拉选择
        containerEl.querySelector('#other-model-select')?.addEventListener('change', (e) => {
            const modelInput = containerEl.querySelector('#other-model');
            if (modelInput && e.target.value) {
                modelInput.value = e.target.value;
            }
        });

        // 预设按钮
        containerEl.querySelectorAll('[data-preset]').forEach(btn => {
            btn.addEventListener('click', () => {
                this._applyPreset(btn.dataset.preset);
            });
        });

        // 预设管理事件
        containerEl.querySelector('#other-preset-select')?.addEventListener('change', async (e) => {
            const presetName = e.target.value;
            if (presetName) {
                await this._loadPreset(presetName);
                // 重置修改状态
                if (this.ctx.getModule('settingsPanel')) {
                    this.ctx.getModule('settingsPanel').isApiPresetModified.other = false;
                }
            }
        });

        containerEl.querySelector('#other-preset-save')?.addEventListener('click', async () => {
            const presetName = prompt('请输入预设名称:');
            if (presetName) {
                await this._savePreset(presetName);
            }
        });

        containerEl.querySelector('#other-preset-update')?.addEventListener('click', async () => {
            if (this.activePreset) {
                await this._updatePreset();
                // 重置修改状态
                if (this.ctx.getModule('settingsPanel')) {
                    this.ctx.getModule('settingsPanel').isApiPresetModified.other = false;
                }
            } else {
                this.ctx?.helpers?.showToast?.('请先选择一个预设', 'warning');
            }
        });

        // 防傻操作：监听API预设相关输入框变化
        const urlInput = containerEl.querySelector('#other-api-url');
        const keyInput = containerEl.querySelector('#other-api-key');
        const modelInput = containerEl.querySelector('#other-model');
        const customHeadersInput = containerEl.querySelector('#other-custom-headers');
        const customBodyInput = containerEl.querySelector('#other-custom-body');
        if (urlInput) {
            urlInput.addEventListener('input', () => {
                if (this.ctx.getModule('settingsPanel')) {
                    this.ctx.getModule('settingsPanel').isApiPresetModified.other = true;
                }
            });
        }
        if (keyInput) {
            keyInput.addEventListener('input', () => {
                if (this.ctx.getModule('settingsPanel')) {
                    this.ctx.getModule('settingsPanel').isApiPresetModified.other = true;
                }
            });
        }
        if (modelInput) {
            modelInput.addEventListener('input', () => {
                if (this.ctx.getModule('settingsPanel')) {
                    this.ctx.getModule('settingsPanel').isApiPresetModified.other = true;
                }
            });
        }
        if (customHeadersInput) {
            customHeadersInput.addEventListener('input', () => {
                if (this.ctx.getModule('settingsPanel')) {
                    this.ctx.getModule('settingsPanel').isApiPresetModified.other = true;
                }
            });
        }
        if (customBodyInput) {
            customBodyInput.addEventListener('input', () => {
                if (this.ctx.getModule('settingsPanel')) {
                    this.ctx.getModule('settingsPanel').isApiPresetModified.other = true;
                }
            });
        }

        containerEl.querySelector('#other-preset-export')?.addEventListener('click', () => {
            this._exportPreset();
        });

        containerEl.querySelector('#other-preset-import')?.addEventListener('click', () => {
            this._importPreset();
        });

        containerEl.querySelector('#other-preset-delete')?.addEventListener('click', async () => {
            if (this.activePreset) {
                if (confirm(`确定要删除预设 "${this.activePreset}" 吗？`)) {
                    await this._deletePreset();
                }
            } else {
                this.ctx?.helpers?.showToast?.('请先选择一个预设', 'warning');
            }
        });

        // 占位符管理事件
        containerEl.querySelector('#other-add-placeholder')?.addEventListener('click', () => {
            this._addPlaceholder();
        });

        // 绑定占位符删除事件
        containerEl.querySelectorAll('#other-placeholder-list .tsp-btn-danger').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const index = parseInt(e.currentTarget.dataset.index);
                this._removePlaceholder(index);
            });
        });

        // 绑定占位符值输入事件，动态生成下拉框
        containerEl.querySelectorAll('#other-placeholder-list .tsp-placeholder-value').forEach(input => {
            this._bindPlaceholderInputEvent(input);
        });

        // 绑定下拉框选择事件
        containerEl.querySelectorAll('#other-placeholder-list .tsp-placeholder-select').forEach(select => {
            this._bindPlaceholderSelectEvent(select);
        });

        // 绑定占位符相关事件的方法
        this._bindPlaceholderEvents = () => {
            if (!this.containerEl) return;

            // 绑定占位符删除事件
            this.containerEl.querySelectorAll('#other-placeholder-list .tsp-btn-danger').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    const index = parseInt(e.currentTarget.dataset.index);
                    this._removePlaceholder(index);
                });
            });

            // 绑定占位符值输入事件，动态生成下拉框
            this.containerEl.querySelectorAll('#other-placeholder-list .tsp-placeholder-value').forEach(input => {
                this._bindPlaceholderInputEvent(input);
            });

            // 绑定下拉框选择事件
            this.containerEl.querySelectorAll('#other-placeholder-list .tsp-placeholder-select').forEach(select => {
                this._bindPlaceholderSelectEvent(select);
            });
        };
    }

    // 加载预设
    async _loadPreset(presetName) {
        const preset = this.presets.find(p => p.name === presetName);
        if (preset) {
            const setVal = (id, val) => {
                const el = this.containerEl?.querySelector(`#${id}`);
                if (el) el.value = val;
            };

            setVal('other-api-url', preset.url || '');
            setVal('other-api-key', preset.apiKey || '');
            setVal('other-model', preset.model || '');
            setVal('other-width', preset.width || 1024);
            setVal('other-height', preset.height || 1024);
            setVal('other-timeout', preset.timeout || 120);
            setVal('other-cfg', preset.cfgScale || 7);
            setVal('other-custom-headers', preset.customHeaders || '');
            setVal('other-custom-body', preset.customBody || '');

            // 更新占位符列表
            this._updatePlaceholderList(preset.placeholders || []);

            this.activePreset = presetName;
            this.ctx?.helpers?.showToast?.(`已加载预设 "${presetName}"`, 'success');
        }
    }

    // 保存预设
    async _savePreset(presetName) {
        const settings = this.collectSettings();
        const preset = {
            name: presetName,
            ...settings
        };

        // 检查是否已存在同名预设
        const existingIndex = this.presets.findIndex(p => p.name === presetName);
        if (existingIndex >= 0) {
            this.presets[existingIndex] = preset;
        } else {
            this.presets.push(preset);
        }

        this.activePreset = presetName;
        await this._savePresets();
        this._updatePresetSelect();
        this.ctx?.helpers?.showToast?.(`预设 "${presetName}" 已保存`, 'success');
    }

    // 更新预设
    async _updatePreset() {
        if (!this.activePreset) return;

        const settings = this.collectSettings();
        const preset = {
            name: this.activePreset,
            ...settings
        };

        const index = this.presets.findIndex(p => p.name === this.activePreset);
        if (index >= 0) {
            this.presets[index] = preset;
            await this._savePresets();
            this.ctx?.helpers?.showToast?.(`预设 "${this.activePreset}" 已更新`, 'success');
        }
    }

    // 删除预设
    async _deletePreset() {
        if (!this.activePreset) return;

        this.presets = this.presets.filter(p => p.name !== this.activePreset);
        this.activePreset = '';

        await this._savePresets();
        this._updatePresetSelect();
        this.ctx?.helpers?.showToast?.(`预设已删除`, 'success');
    }

    // 导出预设
    _exportPreset() {
        const preset = this.presets.find(p => p.name === this.activePreset);
        if (preset) {
            // [修改开始]：创建副本并脱敏 Key
            // 使用 JSON 序列化/反序列化进行深拷贝，防止修改到原对象
            const exportData = JSON.parse(JSON.stringify(preset));

            // 将 Key 替换为提示语
            exportData.apiKey = "填写自己的key";
            // [修改结束]

            const dataStr = JSON.stringify(exportData, null, 2);
            const dataBlob = new Blob([dataStr], { type: 'application/json' });
            const url = URL.createObjectURL(dataBlob);
            const link = document.createElement('a');
            link.href = url;
            link.download = `${preset.name}_other_preset.json`;
            link.click();
            URL.revokeObjectURL(url);

            // 提示语稍微改一下，让用户知道 key 已被隐藏
            this.ctx?.helpers?.showToast?.(`预设已导出 (Key已隐藏)`, 'success');
        } else {
            this.ctx?.helpers?.showToast?.(`请先选择一个预设`, 'warning');
        }
    }

    // 导入预设
    _importPreset() {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.json';
        input.onchange = async (e) => {
            const file = e.target.files[0];
            if (file) {
                try {
                    const reader = new FileReader();
                    reader.onload = async (event) => {
                        try {
                            const preset = JSON.parse(event.target.result);
                            if (preset.name) {
                                // 检查是否已存在同名预设
                                const existingIndex = this.presets.findIndex(p => p.name === preset.name);
                                if (existingIndex >= 0) {
                                    this.presets[existingIndex] = preset;
                                } else {
                                    this.presets.push(preset);
                                }

                                this.activePreset = preset.name;
                                await this._savePresets();
                                this._updatePresetSelect();
                                await this._loadPreset(preset.name);
                                this.ctx?.helpers?.showToast?.(`预设 "${preset.name}" 已导入`, 'success');
                            } else {
                                this.ctx?.helpers?.showToast?.(`无效的预设文件`, 'error');
                            }
                        } catch (err) {
                            this.ctx?.helpers?.showToast?.(`解析预设文件失败: ${err.message}`, 'error');
                        }
                    };
                    reader.readAsText(file);
                } catch (err) {
                    this.ctx?.helpers?.showToast?.(`导入预设失败: ${err.message}`, 'error');
                }
            }
        };
        input.click();
    }

    // 保存所有预设
    async _savePresets() {
        const imageGen = this.ctx?.getModule?.('imageGen');
        if (imageGen) {
            // 1. 更新内存中的 ImageGen 设置
            imageGen.settings.other.presets = this.presets;
            imageGen.settings.other.activePreset = this.activePreset;

            // 2. 定向保存到 other_preset.json
            if (imageGen.storageManager) {
                this.ctx?.log?.('settings-panel', '正在独立保存 Other API 预设...');

                await imageGen.storageManager.saveOtherPresets({
                    presets: this.presets,
                    activePreset: this.activePreset
                });

                // 可选：为了保证本地 API (extension_settings) 也同步数据，可以手动调用一次 setValue
                // 这样避免了调用 imageGen.saveSettings() 带来的副作用
                if (this.ctx.api) {
                    await this.ctx.api.setValue('image_gen_settings', imageGen.settings);
                }
            } else {
                // 兼容性回退：如果没有 storageManager (非酒馆模式等)，才调用全局保存
                await imageGen.saveSettings();
            }
        }
    }

    // 更新预设选择框
    _updatePresetSelect() {
        const select = this.containerEl?.querySelector('#other-preset-select');
        if (select) {
            select.innerHTML = '<option value="">-- 选择预设 --</option>';
            this.presets.forEach(preset => {
                const option = document.createElement('option');
                option.value = preset.name;
                option.textContent = preset.name;
                if (preset.name === this.activePreset) {
                    option.selected = true;
                }
                select.appendChild(option);
            });
        }
    }

    // 添加占位符
    _addPlaceholder() {
        const placeholderList = this.containerEl?.querySelector('#other-placeholder-list');
        if (placeholderList) {
            const index = placeholderList.children.length;
            const placeholderEl = document.createElement('div');
            placeholderEl.className = 'tsp-form-row';
            placeholderEl.style = 'align-items: center; gap: 10px; margin-bottom: 5px;';
            placeholderEl.innerHTML = `
                <div class="tsp-form-group" style="flex: 1; margin-bottom: 0;">
                    <input type="text" class="tsp-input" placeholder="占位符名称" data-index="${index}">
                </div>
                <div class="tsp-form-group" style="flex: 1; margin-bottom: 0;">
                    <input type="text" class="tsp-input tsp-placeholder-value" placeholder="默认值" data-index="${index}">
                </div>
                <button class="tsp-btn tsp-btn-sm tsp-btn-danger" title="删除占位符" data-index="${index}">
                    <i class="fa-solid fa-trash"></i>
                </button>
            `;
            placeholderList.appendChild(placeholderEl);

            // 绑定删除事件
            const deleteBtn = placeholderEl.querySelector('.tsp-btn-danger');
            deleteBtn.addEventListener('click', (e) => {
                const idx = parseInt(e.currentTarget.dataset.index);
                this._removePlaceholder(idx);
            });

            // 绑定输入事件
            const valueInput = placeholderEl.querySelector('.tsp-placeholder-value');
            if (valueInput) {
                this._bindPlaceholderInputEvent(valueInput);
            }
        }
    }

    // 移除占位符
    _removePlaceholder(index) {
        const placeholderList = this.containerEl?.querySelector('#other-placeholder-list');
        if (placeholderList && placeholderList.children[index]) {
            placeholderList.removeChild(placeholderList.children[index]);
            // 更新索引
            Array.from(placeholderList.children).forEach((child, idx) => {
                child.querySelectorAll('input, button').forEach(el => {
                    el.dataset.index = idx;
                });
            });
        }
    }

    // 更新占位符列表
    _updatePlaceholderList(placeholders) {
        const placeholderList = this.containerEl?.querySelector('#other-placeholder-list');
        if (placeholderList) {
            placeholderList.innerHTML = '';
            placeholders.forEach((placeholder, index) => {
                const placeholderEl = document.createElement('div');
                placeholderEl.className = 'tsp-form-row';
                placeholderEl.style = 'align-items: center; gap: 10px; margin-bottom: 5px;';
                const options = placeholder.value.split('|').map(opt => opt.trim()).filter(opt => opt);
                placeholderEl.innerHTML = `
                    <div class="tsp-form-group" style="flex: 1; margin-bottom: 0;">
                        <input type="text" class="tsp-input" placeholder="占位符名称" value="${placeholder.name}" data-index="${index}">
                    </div>
                    <div class="tsp-form-group" style="flex: 1; margin-bottom: 0;">
                        <input type="text" class="tsp-input tsp-placeholder-value" placeholder="默认值" value="${placeholder.value}" data-index="${index}">
                        ${options.length > 1 ? `
                            <select class="tsp-input tsp-placeholder-select" style="margin-top: 5px;" data-index="${index}">
                                ${options.map(opt => `<option value="${opt}" ${options[0] === opt ? 'selected' : ''}>${opt}</option>`).join('')}
                            </select>
                        ` : ''}
                    </div>
                    <button class="tsp-btn tsp-btn-sm tsp-btn-danger" title="删除占位符" data-index="${index}">
                        <i class="fa-solid fa-trash"></i>
                    </button>
                `;
                placeholderList.appendChild(placeholderEl);

                // 绑定删除事件
                const deleteBtn = placeholderEl.querySelector('.tsp-btn-danger');
                deleteBtn.addEventListener('click', (e) => {
                    const idx = parseInt(e.currentTarget.dataset.index);
                    this._removePlaceholder(idx);
                });

                // 绑定输入事件
                const valueInput = placeholderEl.querySelector('.tsp-placeholder-value');
                if (valueInput) {
                    this._bindPlaceholderInputEvent(valueInput);
                }

                // 绑定选择事件
                const select = placeholderEl.querySelector('.tsp-placeholder-select');
                if (select) {
                    this._bindPlaceholderSelectEvent(select);
                }
            });
        }
    }

    // 绑定占位符输入事件
    _bindPlaceholderInputEvent(input) {
        input.addEventListener('input', (e) => {
            const value = e.currentTarget.value;
            const index = parseInt(e.currentTarget.dataset.index);
            const parent = e.currentTarget.parentElement;
            
            // 移除旧的下拉框
            const oldSelect = parent.querySelector('.tsp-placeholder-select');
            if (oldSelect) {
                oldSelect.remove();
            }
            
            // 生成新的下拉框
            const options = value.split('|').map(opt => opt.trim()).filter(opt => opt);
            if (options.length > 1) {
                const select = document.createElement('select');
                select.className = 'tsp-input tsp-placeholder-select';
                select.style = 'margin-top: 5px;';
                select.dataset.index = index;
                
                options.forEach(opt => {
                    const option = document.createElement('option');
                    option.value = opt;
                    option.textContent = opt;
                    if (opt === options[0]) {
                        option.selected = true;
                    }
                    select.appendChild(option);
                });
                
                parent.appendChild(select);
                this._bindPlaceholderSelectEvent(select);
            }
        });
    }

    // 绑定占位符选择事件
    _bindPlaceholderSelectEvent(select) {
        select.addEventListener('change', (e) => {
            const selectedValue = e.currentTarget.value;
            const index = parseInt(e.currentTarget.dataset.index);
            const parent = e.currentTarget.parentElement;
            const input = parent.querySelector('.tsp-placeholder-value');
            
            if (input) {
                // 保持原始的|分隔值不变，只在使用时取选中的值
                // 这里可以根据需要添加逻辑，比如将选中的值显示在某个地方
                console.log(`Placeholder ${index} selected: ${selectedValue}`);
            }
        });
    }

    /**
     * 刷新模型列表
     */
    async refreshModels() {
        const urlInput = this.containerEl?.querySelector('#other-api-url');
        const keyInput = this.containerEl?.querySelector('#other-api-key');

        const baseUrl = urlInput?.value || '';
        const apiKey = keyInput?.value || '';

        if (!baseUrl) {
            this.ctx?.helpers?.showToast?.('请先填写 API 地址', 'warning');
            return;
        }

        this.ctx?.helpers?.showToast?.('正在获取模型列表...', 'info');

        try {
            const modelsUrl = this._getModelsUrl(baseUrl);

            const headers = { 'Content-Type': 'application/json' };
            if (apiKey) {
                headers['Authorization'] = `Bearer ${apiKey}`;
            }

            const response = await fetch(modelsUrl, { headers });

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }

            const data = await response.json();

            let models = [];
            if (Array.isArray(data)) {
                models = data.map(m => typeof m === 'string' ? m : (m.id || m.name || m.model));
            } else if (data.data && Array.isArray(data.data)) {
                models = data.data.map(m => m.id || m.name || m.model);
            } else if (data.models && Array.isArray(data.models)) {
                models = data.models.map(m => typeof m === 'string' ? m : (m.id || m.name));
            }

            this.models = models.filter(Boolean);
            this._populateModelSelect();

            this.ctx?.helpers?.showToast?.(`获取到 ${this.models.length} 个模型`, 'success');

        } catch (error) {
            this.ctx?.helpers?.showToast?.(`获取失败: ${error.message}`, 'error');
        }
    }

    _getModelsUrl(baseUrl) {
        baseUrl = baseUrl.replace(/\/+$/, '');
        if (baseUrl.includes('/v1/images') || baseUrl.includes('/v1/chat')) {
            return baseUrl.replace(/\/v1\/(images|chat).*/, '/v1/models');
        }
        if (baseUrl.endsWith('/v1')) {
            return `${baseUrl}/models`;
        }
        return `${baseUrl}/v1/models`;
    }

    _populateModelSelect() {
        const select = this.containerEl?.querySelector('#other-model-select');
        if (!select) return;

        select.innerHTML = '<option value="">-- 选择模型 --</option>';
        this.models.forEach(model => {
            select.appendChild(new Option(model, model));
        });
    }

    _applyPreset(preset) {
        const presets = {
            openai: {
                url: 'https://api.openai.com/v1/images/generations',
                model: 'dall-e-3',
                width: 1024,
                height: 1024,
            },
            stability: {
                url: 'https://api.stability.ai/v1/generation/stable-diffusion-xl-1024-v1-0/text-to-image',
                model: 'stable-diffusion-xl-1024-v1-0',
                width: 1024,
                height: 1024,
            },
            replicate: {
                url: 'https://api.replicate.com/v1/predictions',
                model: 'stability-ai/sdxl',
                width: 1024,
                height: 1024,
            },
            azure: {
                url: 'https://YOUR-RESOURCE.openai.azure.com/openai/deployments/YOUR-DEPLOYMENT/images/generations?api-version=2024-02-01',
                model: '',
                width: 1024,
                height: 1024,
            },
        };

        // 处理 NovelAI 兼容模式
        if (preset === 'novelai') {
            // 设置自定义请求体字段
            const customBodyEl = this.containerEl?.querySelector('#other-custom-body');
            if (customBodyEl) {
                customBodyEl.value = JSON.stringify({
                    "negative_prompt": "负面提示词",
                    "sampler": "采样器",
                    "size": "宽度:高度",
                    "steps": "步数",
                    "CFG": "CFG"
                }, null, 2);
            }

            // 设置自定义占位符
            const placeholderListEl = this.containerEl?.querySelector('#other-placeholder-list');
            if (placeholderListEl) {
                placeholderListEl.innerHTML = `
                    <div class="tsp-form-row" style="align-items: center; gap: 10px; margin-bottom: 5px;">
                        <div class="tsp-form-group" style="flex: 1; margin-bottom: 0;">
                            <input type="text" class="tsp-input" placeholder="占位符名称" value="采样器" data-index="0">
                        </div>
                        <div class="tsp-form-group" style="flex: 1; margin-bottom: 0;">
                            <input type="text" class="tsp-input tsp-placeholder-value" placeholder="默认值" value="k_euler|k_euler_ancestral|k_dpmpp_2s_ancestral|k_dpmpp_2m_sde|k_dpmpp_2m|k_dpmpp_sde" data-index="0">
                            <select class="tsp-input tsp-placeholder-select" data-index="0" style="margin-top: 5px;">
                                <option value="k_euler">k_euler</option>
                                <option value="k_euler_ancestral">k_euler_ancestral</option>
                                <option value="k_dpmpp_2s_ancestral">k_dpmpp_2s_ancestral</option>
                                <option value="k_dpmpp_2m_sde">k_dpmpp_2m_sde</option>
                                <option value="k_dpmpp_2m">k_dpmpp_2m</option>
                                <option value="k_dpmpp_sde">k_dpmpp_sde</option>
                            </select>
                        </div>
                        <button class="tsp-btn tsp-btn-sm tsp-btn-danger" title="删除占位符" data-index="0">
                            <i class="fa-solid fa-trash"></i>
                        </button>
                    </div>
                `;

                // 重新绑定占位符相关事件
                this._bindPlaceholderEvents();
            }

            this.ctx?.helpers?.showToast?.(`已应用 NovelAI 兼容模式预设`, 'success');
            return;
        }

        // 处理图生图API预设
        if (preset === 'img2img') {
            // 设置自定义请求体字段 - 使用你提到的格式
            const customBodyEl = this.containerEl?.querySelector('#other-custom-body');
            if (customBodyEl) {
                customBodyEl.value = JSON.stringify({
                    "prompt": "正面提示词",
                    "sequential_image_generation": "disabled",
                    "response_format": "b64_json",
                    "image": "图片完整",
                    "size": "尺寸",
                    "stream": false,
                    "watermark": false
                }, null, 2);
            }

            this.ctx?.helpers?.showToast?.(`已应用图生图API预设，请配置URL和Key`, 'success');
            return;
        }

        const config = presets[preset];
        if (!config) return;

        const setVal = (id, val) => {
            const el = this.containerEl?.querySelector(`#${id}`);
            if (el) el.value = val;
        };

        setVal('other-api-url', config.url);
        setVal('other-model', config.model);
        setVal('other-width', config.width);
        setVal('other-height', config.height);

        this.ctx?.helpers?.showToast?.(`已应用 ${preset.toUpperCase()} 预设`, 'success');
    }

    /**
     * 收集表单数据
     */
    collectSettings() {
        if (!this.containerEl) return null;

        let customHeaders = '';
        let customBody = '';
        let hasError = false;

        try {
            const headersText = this.containerEl.querySelector('#other-custom-headers')?.value || '';
            if (headersText.trim()) {
                JSON.parse(headersText);
                customHeaders = headersText;
            }
        } catch (e) {
            this.ctx?.helpers?.showToast?.(`自定义请求头 JSON 格式错误: ${e.message}`, 'error');
            hasError = true;
            customHeaders = this.containerEl.querySelector('#other-custom-headers')?.value || '';
        }

        try {
            const bodyText = this.containerEl.querySelector('#other-custom-body')?.value || '';
            if (bodyText.trim()) {
                JSON.parse(bodyText);
                customBody = bodyText;
            }
        } catch (e) {
            this.ctx?.helpers?.showToast?.(`自定义请求体 JSON 格式错误: ${e.message}`, 'error');
            hasError = true;
            customBody = this.containerEl.querySelector('#other-custom-body')?.value || '';
        }

        // 收集占位符
        const placeholders = [];
        const placeholderList = this.containerEl?.querySelector('#other-placeholder-list');
        if (placeholderList) {
            // 遍历每一行
            Array.from(placeholderList.children).forEach(child => {
                // 获取当前行所有的输入框
                const inputs = child.querySelectorAll('input.tsp-input');

                // 确保我们找到了两个输入框 (0:Name, 1:Value)
                if (inputs.length >= 2) {
                    const nameVal = inputs[0].value.trim();
                    const valueVal = inputs[1].value.trim();
                    
                    // 检查是否有下拉框，如果有，获取选中的值
                    let selectedValue = valueVal;
                    const select = child.querySelector('.tsp-placeholder-select');
                    if (select) {
                        selectedValue = select.value;
                    }

                    // 只有当名字不为空时才保存
                    if (nameVal) {
                        placeholders.push({
                            name: nameVal,
                            value: valueVal, // 保存原始值，包含所有选项
                            selectedValue: selectedValue // 保存选中的值
                        });
                    }
                }
            });
        }

        return {
            url: this.containerEl.querySelector('#other-api-url')?.value || '',
            apiKey: this.containerEl.querySelector('#other-api-key')?.value || '',
            model: this.containerEl.querySelector('#other-model')?.value || '',
            width: parseInt(this.containerEl.querySelector('#other-width')?.value) || 1024,
            height: parseInt(this.containerEl.querySelector('#other-height')?.value) || 1024,
            timeout: parseInt(this.containerEl.querySelector('#other-timeout')?.value) || 120,
            cfgScale: parseFloat(this.containerEl.querySelector('#other-cfg')?.value) || 7,
            customHeaders,
            customBody,
            placeholders,
            pureMode: this.containerEl.querySelector('#other-pure-mode')?.checked || false
        };
    }
}