'use strict';
import { getRequestHeaders } from '../../../../../../script.js';
import { StoreNames } from '../../core/db-manager.js';

/**
 * ComfyUI 设置面板
 * 移植自: 酒馆文生图插件-2.58.user.js
 */
export class ComfyUISettings {
    constructor(context) {
        this.ctx = context;
        this.containerEl = null;
        this.apiPresets = []; // 保存所有API预设
        this.activeApiPreset = ''; // 当前选中的API预设名
        // 默认设置
        // 注意：宽度、高度、步数、CFG 在通用设置页面配置，这里不重复
        this.defaultSettings = {
            url: 'http://127.0.0.1:8188',
            apiPresets: [], // API 预设列表
            activeApiPreset: '', // 当前激活的 API 预设名
            apiMode: 'original', // 'direct' (跨域) or 'original' (原生/代理)
            model: '',
            sampler: 'euler_ancestral',
            scheduler: 'normal',
            // 多角色
            multiCharacterEnabled: false,
            // 高级设置
            detailerModel: '',
            detailerSampler: 'euler_ancestral',
            detailerScheduler: 'normal',
            upscaleModel: '',
            upscaleBy: 1.5,
            ultimateSteps: 20,
            ultimateSampler: 'euler_ancestral',
            ultimateScheduler: 'normal',
            pureWorkflowMode: false,
            i2iWorkflow: '', // [新增] 图生图工作流
            activeWorkflow: '',
            activeLoraPreset: '',
        };

        // 缓存的选项列表
        this.loadedOptions = {
            models: [],
            samplers: [],
            schedulers: [],
            upscaleModels: [],
            detectorModels: [],
            loras: [],
        };

        // 工作流和 LoRA 预设
        this.workflows = [];
        this.loraPresets = [];
    }

    _getSettings() {
        try {
            const imageGen = this.ctx?.getModule?.('imageGen');
            const comfyui = imageGen?.settings?.comfyui || {};
            return { ...this.defaultSettings, ...comfyui };
        } catch (e) {
            return this.defaultSettings;
        }
    }
    // [新增] 同步 ComfyUI 数据到服务器
    async _syncDataToServer() {
        const imageGen = this.ctx?.getModule?.('imageGen');
        const storage = imageGen?.storageManager;

        // 只有当 storageManager 可用且处于 tavern 模式或用户希望同步时才保存
        // 这里为了确保数据互通，我们只要能访问到 storage 就尝试保存
        if (storage && this.ctx?.db) {
            try {
                // 获取最新的数据
                const workflows = await this.ctx.db.getAll(StoreNames.WORKFLOWS) || [];
                const loraPresets = await this.ctx.db.getAll(StoreNames.LORA_PRESETS) || [];

                // 异步保存，不阻塞 UI
                storage.saveComfyUIData({ workflows, loraPresets }).catch(e => {
                    console.error('ComfyUI 数据后台同步失败:', e);
                });
            } catch (e) {
                console.warn('准备 ComfyUI 同步数据失败:', e);
            }
        }
    }

    // [新增] 从服务器同步数据到本地数据库
    async _syncDataFromServer() {
        const imageGen = this.ctx?.getModule?.('imageGen');
        const storage = imageGen?.storageManager;

        if (storage && this.ctx?.db) {
            try {
                const serverData = await storage.loadComfyUIData();
                if (serverData) {
                    // 同步工作流
                    if (Array.isArray(serverData.workflows)) {
                        for (const wf of serverData.workflows) {
                            await this.ctx.db.put(StoreNames.WORKFLOWS, wf);
                        }
                    }
                    // 同步 LoRA 预设
                    if (Array.isArray(serverData.loraPresets)) {
                        for (const lp of serverData.loraPresets) {
                            await this.ctx.db.put(StoreNames.LORA_PRESETS, lp);
                        }
                    }
                    this.ctx.log('comfyui-settings', '已从服务器同步数据到本地');
                }
            } catch (e) {
                console.warn('从服务器同步 ComfyUI 数据失败:', e);
            }
        }
    }
    render() {
        const s = this._getSettings();

        return `
        <div class="tsp-settings-pane-inner">
            <!-- API & 核心参数 -->
            <div class="tsp-settings-group">
                <h4 class="tsp-settings-group-title">
                    <i class="fa-solid fa-server"></i> API & 核心参数
                </h4>
                <div class="tsp-settings-group" style="padding: 12px; background: var(--tsp-bg-tertiary); border-radius:8px; margin-bottom:15px;">
                    <h5 style="margin-top:0; font-size:0.9em; color:var(--tsp-text-secondary);">API 预设管理</h5>
                    <div class="tsp-form-row">
                        <div class="tsp-form-group" style="flex:2;">
                            <label>选择预设</label>
                            <select class="tsp-input" id="comfy-api-preset-select">
                                <option value="">-- 新建预设 --</option>
                            </select>
                        </div>
                        <div class="tsp-btn-group" style="flex:1; align-self: flex-end; justify-content: flex-end;">
                            <button type="button" class="tsp-btn" id="comfy-api-preset-save" title="将当前配置另存为新预设">
                                <i class="fa-solid fa-save"></i> 保存
                            </button>
                            <button type="button" class="tsp-btn tsp-btn-danger" id="comfy-api-preset-delete" title="删除当前预设">
                                <i class="fa-solid fa-trash"></i> 删除
                            </button>
                        </div>
                    </div>
                </div>
                <div class="tsp-form-group">
                    <label>ComfyUI API 地址</label>
                    <div class="tsp-input-group">
                        <input type="text" class="tsp-input" id="comfyui-url"
                               value="${s.url}"
                               placeholder="http://127.0.0.1:8188 或 https://your.comfyui.server">
                        <button class="tsp-btn tsp-btn-primary" id="comfyui-refresh-btn">
                            <i class="fa-solid fa-sync"></i> 刷新数据
                        </button>
                    </div>
                    <div class="tsp-form-group" style="margin-top: 10px;">
                        <label>请求方式</label>
                        <select class="tsp-input" id="comfyui-api-mode">
                            <option value="direct" ${s.apiMode === 'direct' ? 'selected' : ''}>跨域 (Direct/CORS)</option>
                            <option value="original" ${s.apiMode === 'original' ? 'selected' : ''}>原生 (SillyTavern Proxy)</option>
                        </select>
                        <p class="tsp-text-muted" style="margin-top: 5px; font-size: 0.85em;">
                            <i class="fa-solid fa-info-circle"></i> 跨域模式需要启动参数 <code>--enable-cors-header "*"</code>，原生模式使用酒馆后端代理。
                        </p>
                    </div>
                    <p class="tsp-text-muted" style="margin-top: 5px; font-size: 0.85em;">
                        <i class="fa-solid fa-info-circle"></i> 提示：如遇跨域问题，请确保 ComfyUI 启动时使用 <code>--enable-cors-header</code> 参数
                    </p>
                </div>
                <div class="tsp-form-row">
                    <div class="tsp-form-group">
                        <label>主模型 (Checkpoint)</label>
                        <select class="tsp-input" id="comfyui-model">
                            <option value="${s.model}">${s.model || '-- 点击刷新加载 --'}</option>
                        </select>
                    </div>
                    <div class="tsp-form-group">
                        <label>采样器 (Sampler)</label>
                        <select class="tsp-input" id="comfyui-sampler">
                            <option value="${s.sampler}">${s.sampler}</option>
                        </select>
                    </div>
                </div>
                <div class="tsp-form-row">
                    <div class="tsp-form-group">
                        <label>调度器 (Scheduler)</label>
                        <select class="tsp-input" id="comfyui-scheduler">
                            <option value="${s.scheduler}">${s.scheduler}</option>
                        </select>
                    </div>
                    <div class="tsp-form-group" style="display: flex; align-items: center; padding-top: 25px;">
                        <label class="tsp-switch-label">
                            <input type="checkbox" class="tsp-switch" id="comfyui-multi-char" ${s.multiCharacterEnabled ? 'checked' : ''}>
                            <span class="tsp-switch-slider"></span>
                            <span>多角色 (Attention Couple)</span>
                        </label>
                    </div>
                </div>
            </div>

            <!-- LoRA 预设管理 -->
            <div class="tsp-settings-group">
                <h4 class="tsp-settings-group-title">
                    <i class="fa-solid fa-layer-group"></i> LoRA 预设管理
                </h4>
                <div class="tsp-form-group">
                    <label>选择 LoRA 预设</label>
                    <div class="tsp-input-group">
                        <select class="tsp-input" id="comfyui-lora-preset-select" style="flex: 1;">
                            <option value="">-- 无预设 --</option>
                        </select>
                        <button class="tsp-btn tsp-btn-primary" id="lora-preset-update-btn" title="更新当前预设">
                            <i class="fa-solid fa-upload"></i>
                        </button>
                        <button class="tsp-btn" id="lora-preset-save-as-btn" title="另存为新预设">
                            <i class="fa-solid fa-save"></i>
                        </button>
                        <button class="tsp-btn tsp-btn-danger" id="lora-preset-delete-btn" title="删除预设">
                            <i class="fa-solid fa-trash"></i>
                        </button>
                    </div>
                </div>

                <!-- [新增] 绑定工作流选择器 -->
                <div class="tsp-form-group">
                    <label>绑定到工作流 (切换预设时自动应用)</label>
                    <select class="tsp-input" id="lora-bound-workflow-select">
                        <option value="">-- 不绑定 --</option>
                    </select>
                </div>

                <div class="tsp-form-group" style="margin-top: 10px;">
                    <button class="tsp-btn" id="open-lora-config-modal-btn" style="width: 100%;">
                        <i class="fa-solid fa-cogs"></i> 配置 LoRA 详细参数
                    </button>
                </div>
                <div id="lora-preview-container" class="tsp-lora-preview" style="display: none;">
                    <h5 style="margin: 0 0 8px 0; color: var(--tsp-accent-primary); font-size: 0.9em;">当前 LoRA 配置:</h5>
                    <div id="lora-preview-list" style="font-size: 0.85em; color: var(--tsp-text-muted);"></div>
                </div>
            </div>

            <!-- 高级设置 -->
            <div class="tsp-settings-group">
                <h4 class="tsp-settings-group-title tsp-collapsible" id="comfyui-advanced-toggle">
                    <i class="fa-solid fa-sliders"></i> 高级设置 <small class="tsp-text-muted">(占位符生效)</small>
                    <i class="fa-solid fa-chevron-down tsp-collapse-icon"></i>
                </h4>
                <div class="tsp-collapsible-content" id="comfyui-advanced-content">
                    <div class="tsp-form-row">
                        <div class="tsp-form-group">
                            <label>修复模型 (FaceDetailer)</label>
                            <select class="tsp-input" id="comfyui-detailer-model">
                                <option value="${s.detailerModel}">${s.detailerModel || '-- 点击刷新 --'}</option>
                            </select>
                        </div>
                        <div class="tsp-form-group">
                            <label>修复采样器</label>
                            <select class="tsp-input" id="comfyui-detailer-sampler">
                                <option value="${s.detailerSampler}">${s.detailerSampler}</option>
                            </select>
                        </div>
                    </div>
                    <div class="tsp-form-row">
                        <div class="tsp-form-group">
                            <label>修复调度器</label>
                            <select class="tsp-input" id="comfyui-detailer-scheduler">
                                <option value="${s.detailerScheduler}">${s.detailerScheduler}</option>
                            </select>
                        </div>
                        <div class="tsp-form-group">
                            <label>修复步数</label>
                            <input type="number" class="tsp-input" id="comfyui-ultimate-steps"
                                   value="${s.ultimateSteps}" min="1" max="150">
                        </div>
                    </div>
                    <div class="tsp-form-row">
                        <div class="tsp-form-group">
                            <label>放大模型 (Upscaler)</label>
                            <select class="tsp-input" id="comfyui-upscale-model">
                                <option value="${s.upscaleModel}">${s.upscaleModel || '-- 点击刷新 --'}</option>
                            </select>
                        </div>
                        <div class="tsp-form-group">
                            <label>放大倍率</label>
                            <input type="number" class="tsp-input" id="comfyui-upscale-by"
                                   value="${s.upscaleBy}" min="1" max="4" step="0.1">
                        </div>
                    </div>
                    <div class="tsp-form-row">
                        <div class="tsp-form-group">
                            <label>Ultimate 采样器</label>
                            <select class="tsp-input" id="comfyui-ultimate-sampler">
                                <option value="${s.ultimateSampler}">${s.ultimateSampler}</option>
                            </select>
                        </div>
                        <div class="tsp-form-group">
                            <label>Ultimate 调度器</label>
                            <select class="tsp-input" id="comfyui-ultimate-scheduler">
                                <option value="${s.ultimateScheduler}">${s.ultimateScheduler}</option>
                            </select>
                        </div>
                    </div>
                </div>
            </div>

            <!-- 工作流管理 -->
            <div class="tsp-settings-group">
                <h4 class="tsp-settings-group-title">
                    <i class="fa-solid fa-diagram-project"></i> 工作流 (Workflow) 管理
                </h4>

                <div class="tsp-form-group" style="background: rgba(247, 118, 142, 0.1); padding: 10px; border-radius: 8px; border: 1px solid var(--tsp-accent-secondary);">
                    <label class="tsp-switch-label">
                        <input type="checkbox" class="tsp-switch" id="comfyui-pure-workflow" ${s.pureWorkflowMode ? 'checked' : ''}>
                        <span class="tsp-switch-slider"></span>
                        <span><strong style="color: var(--tsp-accent-secondary);">纯净工作流模式:</strong> 只注入正/负向提示词</span>
                    </label>
                </div>

                <div class="tsp-form-group" style="margin-top: 15px;">
                    <label>选择工作流</label>
                    <div class="tsp-input-group">
                        <select class="tsp-input" id="comfyui-workflow-select" style="flex: 1;">
                            <option value="">-- 请选择工作流 --</option>
                        </select>
                        <button class="tsp-btn tsp-btn-primary" id="workflow-update-btn" title="更新">
                            <i class="fa-solid fa-upload"></i>
                        </button>
                        <button class="tsp-btn" id="workflow-save-as-btn" title="另存为">
                            <i class="fa-solid fa-save"></i>
                        </button>
                        <button class="tsp-btn tsp-btn-danger" id="workflow-delete-btn" title="删除">
                            <i class="fa-solid fa-trash"></i>
                        </button>
                    </div>
                </div>
                <div class="tsp-form-group" style="margin-top: 10px;">
                    <label>图生图/重绘工作流 (Img2Img/Inpaint)</label>
                    <select class="tsp-input" id="comfyui-i2i-workflow-select">
                        <option value="">-- 跟随文生图或手动选择 --</option>
                    </select>
                    <small class="tsp-text-muted">当执行图生图或蒙版重绘操作时，将自动切换到此工作流</small>
                </div>
                <div class="tsp-form-group" style="margin-top: 15px; border-top: 1px solid var(--tsp-border); padding-top: 15px;">
                    <label>数据管理</label>
                    <div class="tsp-input-group">
                        <button class="tsp-btn tsp-btn-primary" id="workflow-import-default-btn" title="导入内置的默认工作流模板">
                            <i class="fa-solid fa-wand-magic-sparkles"></i> 导入默认工作流
                        </button>
                        <button class="tsp-btn" id="workflow-import-btn">
                            <i class="fa-solid fa-file-import"></i> 导入
                        </button>
                        <input type="file" id="workflow-import-input" style="display: none;" accept=".json">
                        <button class="tsp-btn" id="workflow-export-all-btn">
                            <i class="fa-solid fa-file-export"></i> 导出全部
                        </button>
                    </div>
                </div>

                <div class="tsp-form-group" style="margin-top: 15px;">
                    <label>工作流 JSON (可编辑)</label>
                    <div class="tsp-workflow-editor-container">
                        <textarea class="tsp-input tsp-workflow-editor" id="comfyui-workflow-editor"
                                placeholder="在此粘贴或编辑 ComfyUI 工作流 JSON..."
                                style="font-family: monospace; font-size: 0.85em;"></textarea>
                        <div class="tsp-param-checker" id="workflow-param-checker" style="flex: 0 0 200px; max-height: 250px;">
                            <h5 style="margin: 0 0 10px 0; color: var(--tsp-accent-primary); font-size: 0.9em;">参数检查器</h5>
                            <ul id="param-checker-list" style="list-style: none; padding: 0; margin: 0; font-size: 0.85em;"></ul>
                        </div>
                    </div>
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
        this._renderApiPresetDropdown();
        this._applyActivePresetToUI();

        containerEl.querySelector('#comfy-api-preset-select')?.addEventListener('change', (e) => {
            this.activeApiPreset = e.target.value;
            this._applyActivePresetToUI();
        });

        containerEl.querySelector('#comfy-api-preset-save')?.addEventListener('click', () => this._saveApiPreset());
        containerEl.querySelector('#comfy-api-preset-delete')?.addEventListener('click', () => this._deleteApiPreset());
        // 加载数据
        this._loadWorkflows();
        this._loadLoraPresets();
        this._loadCachedOptions();

        // 刷新按钮
        containerEl.querySelector('#comfyui-refresh-btn')?.addEventListener('click', () => {
            this.refreshOptions();
        });

        // 高级设置折叠
        const advancedToggle = containerEl.querySelector('#comfyui-advanced-toggle');
        const advancedContent = containerEl.querySelector('#comfyui-advanced-content');
        if (advancedToggle && advancedContent) {
            advancedToggle.addEventListener('click', () => {
                advancedToggle.classList.toggle('tsp-collapsed');
                advancedContent.classList.toggle('tsp-hidden');
            });
        }

        // 工作流选择变化
        containerEl.querySelector('#comfyui-workflow-select')?.addEventListener('change', (e) => {
            this._loadWorkflowContent(e.target.value);
            // [新增]
            this._handleWorkflowChange(e.target.value);
        });

        // 工作流编辑器变化
        containerEl.querySelector('#comfyui-workflow-editor')?.addEventListener('input', () => {
            this._updateParamChecker();
        });

        // 工作流 CRUD 按钮
        containerEl.querySelector('#workflow-update-btn')?.addEventListener('click', () => this._updateWorkflow());
        containerEl.querySelector('#workflow-save-as-btn')?.addEventListener('click', () => this._saveWorkflowAs());
        containerEl.querySelector('#workflow-delete-btn')?.addEventListener('click', () => this._deleteWorkflow());

        // 导入导出
        containerEl.querySelector('#workflow-import-default-btn')?.addEventListener('click', () => {
            this._importDefaultWorkflows();
        });
        containerEl.querySelector('#workflow-import-btn')?.addEventListener('click', () => {
            containerEl.querySelector('#workflow-import-input')?.click();
        });
        containerEl.querySelector('#workflow-import-input')?.addEventListener('change', (e) => {
            this._importWorkflows(e.target.files);
        });
        containerEl.querySelector('#workflow-export-all-btn')?.addEventListener('click', () => {
            this._exportAllWorkflows();
        });
        containerEl.querySelector('#comfyui-lora-preset-select')?.addEventListener('change', (e) => {
            // 传入 false，表示这是手动操作，需要触发自动工作流切换
            this._handleLoraPresetChange(e.target.value, false);
        });
        // LoRA 预设相关
        containerEl.querySelector('#lora-bound-workflow-select')?.addEventListener('change', async (e) => {
            const activePresetName = containerEl.querySelector('#comfyui-lora-preset-select')?.value;
            const newBoundWorkflow = e.target.value;
            if (activePresetName && this.loraPresets) {
                const preset = this.loraPresets.find(p => p.name === activePresetName);
                if (preset) {
                    preset.boundWorkflow = newBoundWorkflow;
                    if (this.ctx?.db) {
                        await this.ctx.db.put(StoreNames.LORA_PRESETS, preset);
                        this.ctx?.helpers?.showToast?.(`预设 "${activePresetName}" 已绑定到工作流: ${newBoundWorkflow || '无'}`);
                    }
                }
            }
        });
        containerEl.querySelector('#lora-preset-update-btn')?.addEventListener('click', () => this._updateLoraPreset());
        containerEl.querySelector('#lora-preset-save-as-btn')?.addEventListener('click', () => this._saveLoraPresetAs());
        containerEl.querySelector('#lora-preset-delete-btn')?.addEventListener('click', () => this._deleteLoraPreset());
        containerEl.querySelector('#open-lora-config-modal-btn')?.addEventListener('click', () => this._openLoraConfigModal());
    }

    /**
     * 从缓存加载选项
     */
    async _loadCachedOptions() {
        try {
            const cachedModels = await this.ctx?.api?.getValue?.('comfyui_cached_models');
            const cachedSamplers = await this.ctx?.api?.getValue?.('comfyui_cached_samplers');
            const cachedSchedulers = await this.ctx?.api?.getValue?.('comfyui_cached_schedulers');
            const cachedLoras = await this.ctx?.api?.getValue?.('comfyui_cached_loras');
            const cachedUpscaleModels = await this.ctx?.api?.getValue?.('comfyui_cached_upscalemodels');
            const cachedDetectorModels = await this.ctx?.api?.getValue?.('comfyui_cached_detectormodels');

            if (cachedModels) this.loadedOptions.models = JSON.parse(cachedModels);
            if (cachedSamplers) this.loadedOptions.samplers = JSON.parse(cachedSamplers);
            if (cachedSchedulers) this.loadedOptions.schedulers = JSON.parse(cachedSchedulers);
            if (cachedLoras) this.loadedOptions.loras = JSON.parse(cachedLoras);
            if (cachedUpscaleModels) this.loadedOptions.upscaleModels = JSON.parse(cachedUpscaleModels);
            if (cachedDetectorModels) this.loadedOptions.detectorModels = JSON.parse(cachedDetectorModels);

            // 如果有缓存数据，填充下拉框
            if (this.loadedOptions.models.length > 0) {
                this._populateSelect('#comfyui-model', this.loadedOptions.models);
                this._populateSelect('#comfyui-sampler', this.loadedOptions.samplers);
                this._populateSelect('#comfyui-scheduler', this.loadedOptions.schedulers);
                this._populateSelect('#comfyui-detailer-sampler', this.loadedOptions.samplers);
                this._populateSelect('#comfyui-detailer-scheduler', this.loadedOptions.schedulers);
                this._populateSelect('#comfyui-ultimate-sampler', this.loadedOptions.samplers);
                this._populateSelect('#comfyui-ultimate-scheduler', this.loadedOptions.schedulers);
                if (this.loadedOptions.upscaleModels.length > 0) {
                    this._populateSelect('#comfyui-upscale-model', this.loadedOptions.upscaleModels);
                }
                if (this.loadedOptions.detectorModels.length > 0) {
                    this._populateSelect('#comfyui-detailer-model', this.loadedOptions.detectorModels);
                }
                this._restoreCurrentValues();
            }
        } catch (e) {
            this.ctx?.log?.('comfyui-settings', '加载缓存选项失败:', e);
        }
    }

    /**
     * 刷新 ComfyUI 选项
     */
    /**
     * [修复] 刷新选项，解决 [object Object] 问题并适配原生模式
     */
    async refreshOptions() {
        const urlInput = this.containerEl?.querySelector('#comfyui-url');
        const apiModeSelect = this.containerEl?.querySelector('#comfyui-api-mode');
        // 获取当前的请求模式
        const apiMode = apiModeSelect?.value || 'direct';
        const url = urlInput?.value?.replace(/\/+$/, '') || 'http://127.0.0.1:8188';

        this.ctx?.helpers?.showToast?.('正在刷新 ComfyUI 数据...', 'info');
        this._setSelectsLoading();

        try {
            if (apiMode === 'original') {
                // === 原生模式 (ST Proxy) ===
                const requestOptions = {
                    method: 'POST',
                    headers: getRequestHeaders(),
                    body: JSON.stringify({ url: url })
                };

                // ST 接口返回的是简单的字符串数组，例如 ["model1.safetensors", "model2.ckpt"]
                const [models, samplers, schedulers, workflows] = await Promise.all([
                    fetch('/api/sd/comfy/models', requestOptions).then(r => r.json()),
                    fetch('/api/sd/comfy/samplers', requestOptions).then(r => r.json()),
                    fetch('/api/sd/comfy/schedulers', requestOptions).then(r => r.json()),
                    fetch('/api/sd/comfy/workflows', requestOptions).then(r => r.json()).catch(() => [])
                ]);

                // 强制转为字符串数组，防止 null
                this.loadedOptions.models = Array.isArray(models) ? models : [];
                this.loadedOptions.samplers = Array.isArray(samplers) ? samplers : [];
                this.loadedOptions.schedulers = Array.isArray(schedulers) ? schedulers : [];
                this.workflows = (Array.isArray(workflows) ? workflows : []).map(w => ({ name: w, content: "" }));

                // 填充下拉框 (原生模式下这些数据是纯字符串)
                this._populateSelect('#comfyui-model', this.loadedOptions.models);
                this._populateSelect('#comfyui-sampler', this.loadedOptions.samplers);
                this._populateSelect('#comfyui-scheduler', this.loadedOptions.schedulers);

                // 修复模型 (Detailer/Detector) 列表
                const defaultDetectorModels = [
                    "bbox/deepfashion2_yolov8s-seg.pt",
                    "bbox/face_yolov8m.pt",
                    "bbox/face_yolov8n.pt",
                    "bbox/face_yolov8n_v2.pt",
                    "bbox/face_yolov8s.pt",
                    "bbox/face_yolov9c.pt",
                    "bbox/hand_yolov8n.pt",
                    "bbox/hand_yolov8s.pt",
                    "bbox/hand_yolov9c.pt",
                    "bbox/person_yolov8m-seg.pt",
                    "bbox/person_yolov8n-seg.pt",
                    "bbox/person_yolov8s-seg.pt"
                ];

                // 放大模型 (Upscaler) 列表
                const defaultUpscaleModels = [
                    "PixArtMS_XL_2",
                    "PixArtMS_Sigma_XL_2",
                    "PixArtMS_Sigma_XL_2_900M",
                    "PixArtMS_Sigma_XL_2_2K",
                    "PixArt_XL_2",
                    "ControlPixArtHalf",
                    "ControlPixArtMSHalf",
                    "4x-AnimeSharp.pth",
                    "4xUltrasharp_4xUltrasharpV10.pt",
                    "BSRGAN.pth",
                    "ESRGAN_4x.pth",
                    "RealESRGAN_x4plus.pth",
                    "RealESRGAN_x4plus_anime_6B.pth",
                    "SwinIR_4x.pth",
                    // 包含检测器作为可选项 (ComfyUI有时混用)
                    "bbox/deepfashion2_yolov8s-seg.pt",
                    "bbox/face_yolov8m.pt",
                    "bbox/face_yolov8n.pt",
                    "bbox/face_yolov8n_v2.pt",
                    "bbox/face_yolov8s.pt",
                    "bbox/face_yolov9c.pt",
                    "bbox/hand_yolov8n.pt",
                    "bbox/hand_yolov8s.pt",
                    "bbox/hand_yolov9c.pt",
                    "bbox/person_yolov8m-seg.pt",
                    "bbox/person_yolov8n-seg.pt",
                    "bbox/person_yolov8s-seg.pt",
                    "sam_vit_b_01ec64.pth",
                    "buffalo_l",
                    "antelopev2",
                    "segformer_b3_clothes",
                    "segformer_b2_clothes",
                    "segformer_b3_fashion"
                ];

                this.loadedOptions.detectorModels = defaultDetectorModels;
                this.loadedOptions.upscaleModels = defaultUpscaleModels;

                this._populateSelect('#comfyui-upscale-model', this.loadedOptions.upscaleModels, true);
                this._populateSelect('#comfyui-detailer-model', this.loadedOptions.detectorModels, true);

            } else {
                // === 跨域模式 (Direct) ===
                const objectInfo = await this._fetchComfyUIObjectInfo(url);
                this.loadedOptions.models = this._extractOptions(objectInfo, 'CheckpointLoaderSimple', 'ckpt_name');
                this.loadedOptions.samplers = this._extractOptions(objectInfo, 'KSampler', 'sampler_name');
                this.loadedOptions.schedulers = this._extractOptions(objectInfo, 'KSampler', 'scheduler');
                this.loadedOptions.loras = this._extractOptions(objectInfo, 'LoraLoader', 'lora_name');
                this.loadedOptions.upscaleModels = this._extractAllOptions(objectInfo, 'model_name', ['UpscaleModelLoader']);
                this.loadedOptions.detectorModels = this._extractAllOptions(objectInfo, 'model_name', ['UltralyticsDetectorProvider', 'DownloadAndLoadUltralyticsDetector']);

                // 填充下拉框
                this._populateSelect('#comfyui-model', this.loadedOptions.models);
                this._populateSelect('#comfyui-sampler', this.loadedOptions.samplers);
                this._populateSelect('#comfyui-scheduler', this.loadedOptions.schedulers);
                this._populateSelect('#comfyui-upscale-model', this.loadedOptions.upscaleModels, true);
                this._populateSelect('#comfyui-detailer-model', this.loadedOptions.detectorModels, true);
            }

            // 通用后续处理
            await this._cacheOptions();
            this._populateSelect('#comfyui-detailer-sampler', this.loadedOptions.samplers);
            this._populateSelect('#comfyui-detailer-scheduler', this.loadedOptions.schedulers);
            this._populateSelect('#comfyui-ultimate-sampler', this.loadedOptions.samplers);
            this._populateSelect('#comfyui-ultimate-scheduler', this.loadedOptions.schedulers);

            this._restoreCurrentValues();
            this.ctx?.helpers?.showToast?.('ComfyUI 数据刷新成功', 'success');

        } catch (error) {
            console.error(error);
            this.ctx?.error?.('comfyui-settings', '刷新失败:', error);
            this.ctx?.helpers?.showToast?.(`刷新失败: ${error.message}`, 'error');
            this._setSelectsFailed();
        }
    }


    /**
     * 获取 ComfyUI object_info
     * 支持跨域请求
     */
    async _fetchComfyUIObjectInfo(url) {
        // 尝试直接 fetch
        try {
            const response = await fetch(`${url}/object_info`, {
                method: 'GET',
                headers: { 'Accept': 'application/json' },
            });
            if (response.ok) {
                return await response.json();
            }
        } catch (e) {
            this.ctx?.log?.('comfyui-settings', '直接 fetch 失败，尝试代理:', e.message);
        }

        // 尝试通过 SillyTavern 代理
        try {
            const response = await fetch('/api/sd/comfy/object-info', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ url: url }),
            });
            if (response.ok) {
                return await response.json();
            }
        } catch (e) {
            this.ctx?.log?.('comfyui-settings', 'SillyTavern 代理也失败:', e.message);
        }

        // 最后尝试直接请求（可能有 CORS 问题）
        const response = await fetch(`${url}/object_info`);
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        return await response.json();
    }

    /**
     * 缓存选项到存储
     */
    async _cacheOptions() {
        try {
            await this.ctx?.api?.setValue?.('comfyui_cached_models', JSON.stringify(this.loadedOptions.models));
            await this.ctx?.api?.setValue?.('comfyui_cached_samplers', JSON.stringify(this.loadedOptions.samplers));
            await this.ctx?.api?.setValue?.('comfyui_cached_schedulers', JSON.stringify(this.loadedOptions.schedulers));
            await this.ctx?.api?.setValue?.('comfyui_cached_loras', JSON.stringify(this.loadedOptions.loras));
            await this.ctx?.api?.setValue?.('comfyui_cached_upscalemodels', JSON.stringify(this.loadedOptions.upscaleModels));
            await this.ctx?.api?.setValue?.('comfyui_cached_detectormodels', JSON.stringify(this.loadedOptions.detectorModels));
        } catch (e) {
            this.ctx?.log?.('comfyui-settings', '缓存选项失败:', e);
        }
    }

    _setSelectsLoading() {
        const selectors = [
            '#comfyui-model', '#comfyui-sampler', '#comfyui-scheduler',
            '#comfyui-detailer-model', '#comfyui-detailer-sampler', '#comfyui-detailer-scheduler',
            '#comfyui-upscale-model', '#comfyui-ultimate-sampler', '#comfyui-ultimate-scheduler',
        ];
        selectors.forEach(sel => {
            const el = this.containerEl?.querySelector(sel);
            if (el) el.innerHTML = '<option>加载中...</option>';
        });
    }

    _setSelectsFailed() {
        const selectors = [
            '#comfyui-model', '#comfyui-sampler', '#comfyui-scheduler',
            '#comfyui-detailer-model', '#comfyui-detailer-sampler', '#comfyui-detailer-scheduler',
            '#comfyui-upscale-model', '#comfyui-ultimate-sampler', '#comfyui-ultimate-scheduler',
        ];
        selectors.forEach(sel => {
            const el = this.containerEl?.querySelector(sel);
            if (el) el.innerHTML = '<option>-- 刷新失败 --</option>';
        });
    }

    _extractOptions(objectInfo, nodeType, inputName) {
        const node = objectInfo?.[nodeType];
        if (!node?.input?.required?.[inputName]) return [];
        const values = node.input.required[inputName][0];
        return Array.isArray(values) ? values : [];
    }

    _extractAllOptions(objectInfo, inputName, preferredNodes = []) {
        const resultSet = new Set();

        // 优先从指定节点提取
        for (const nodeName of preferredNodes) {
            const node = objectInfo?.[nodeName];
            if (node?.input?.required?.[inputName]) {
                const values = node.input.required[inputName][0];
                if (Array.isArray(values)) {
                    values.forEach(v => resultSet.add(v));
                }
            }
        }

        // 如果没找到，遍历所有节点
        if (resultSet.size === 0) {
            for (const nodeName in objectInfo) {
                const node = objectInfo[nodeName];
                if (node?.input?.required?.[inputName]) {
                    const values = node.input.required[inputName][0];
                    if (Array.isArray(values)) {
                        values.forEach(v => resultSet.add(v));
                    }
                }
            }
        }

        return Array.from(resultSet);
    }

    /**
     * [修复] 填充 Select，兼容字符串和对象，防止 [object Object]
     */
    _populateSelect(selector, items, addNone = false) {
        const select = this.containerEl?.querySelector(selector);
        if (!select) return;

        select.innerHTML = '';
        if (addNone) {
            select.appendChild(new Option('None', ''));
        }

        items.forEach(item => {
            // 智能处理：如果是对象，尝试取 text/name/value，否则直接作为字符串
            let text = item;
            let value = item;

            if (typeof item === 'object' && item !== null) {
                text = item.text || item.name || item.value || JSON.stringify(item);
                value = item.value || item.name || JSON.stringify(item);
            }

            select.appendChild(new Option(text, value));
        });
    }

    _restoreCurrentValues() {
        const s = this._getSettings();
        const restore = (selector, value) => {
            const el = this.containerEl?.querySelector(selector);
            if (el && value) el.value = value;
        };

        restore('#comfyui-model', s.model);
        restore('#comfyui-sampler', s.sampler);
        restore('#comfyui-scheduler', s.scheduler);
        restore('#comfyui-detailer-model', s.detailerModel);
        restore('#comfyui-detailer-sampler', s.detailerSampler);
        restore('#comfyui-detailer-scheduler', s.detailerScheduler);
        restore('#comfyui-upscale-model', s.upscaleModel);
        restore('#comfyui-ultimate-sampler', s.ultimateSampler);
        restore('#comfyui-ultimate-scheduler', s.ultimateScheduler);
    }

    // ==================== LoRA 预设管理 ====================

    async _loadLoraPresets() {
        try {
            await this._syncDataFromServer();
            if (this.ctx?.db) {
                this.loraPresets = await this.ctx.db.getAll(StoreNames.LORA_PRESETS) || [];
            } else {
                this.loraPresets = [];
            }
            this._renderLoraPresetSelect();
        } catch (e) {
            this.loraPresets = [];
            this._renderLoraPresetSelect();
        }
    }

    _renderLoraPresetSelect() {
        const select = this.containerEl?.querySelector('#comfyui-lora-preset-select');
        const workflowBindSelect = this.containerEl?.querySelector('#lora-bound-workflow-select');
        if (!select) return;

        const s = this._getSettings();
        // ... (中间代码保持不变，填充 LoRA options) ...
        select.innerHTML = '<option value="">-- 无预设 --</option>';
        this.loraPresets.forEach(preset => {
            const isActive = preset.status === 1 || preset.name === s.activeLoraPreset;
            const text = isActive ? `${preset.name} ✓` : preset.name;
            const option = new Option(text, preset.name);
            if (isActive) option.selected = true;
            select.appendChild(option);
        });

        // [新增] 填充绑定工作流下拉框
        if (workflowBindSelect) {
            workflowBindSelect.innerHTML = '<option value="">-- 不绑定 --</option>';
            this.workflows.forEach(wf => {
                workflowBindSelect.appendChild(new Option(wf.name, wf.name));
            });
        }

        // 显示当前激活预设的预览
        const activePreset = this.loraPresets.find(p => p.status === 1);
        this._updateLoraPreview(activePreset);

        // --- 修改开始：确保绑定下拉框显示正确 ---
        // 获取当前UI选中的LoRA名称（优先使用select的值，如果刚渲染可能为空则取激活的）
        const currentSelectedLoraName = select.value || (activePreset ? activePreset.name : '');

        // 再次确保 select 的 value 是正确的
        if (select.value !== currentSelectedLoraName) {
            select.value = currentSelectedLoraName;
        }

        // 根据当前选中的 LoRA，更新下方的“绑定到工作流”显示
        if (workflowBindSelect) {
            const currentPreset = this.loraPresets.find(p => p.name === currentSelectedLoraName);
            workflowBindSelect.value = currentPreset ? (currentPreset.boundWorkflow || '') : '';
        }
        // --- 修改结束 ---
    }

    _updateLoraPreview(preset) {
        const container = this.containerEl?.querySelector('#lora-preview-container');
        const list = this.containerEl?.querySelector('#lora-preview-list');
        if (!container || !list) return;

        if (preset?.loras?.length > 0) {
            const activeLoras = preset.loras.filter(l => l.name && l.name !== 'None');
            if (activeLoras.length > 0) {
                container.style.display = 'block';
                list.innerHTML = activeLoras.map(l =>
                    `<div style="padding: 2px 0;">• ${l.name} <span style="color: var(--tsp-accent-primary);">(${l.strength})</span></div>`
                ).join('');
                return;
            }
        }
        container.style.display = 'none';
    }
    /**
     * 当工作流切换时，检查并自动切换绑定的 LoRA 预设
     */
    async _handleWorkflowChange(newWorkflowName) {
        if (!newWorkflowName || !this.loraPresets) return;

        // 查找是否有 LoRA 预设绑定到了这个新选择的工作流
        const targetLoraPreset = this.loraPresets.find(p => p.boundWorkflow === newWorkflowName);
        const currentLoraSelect = this.containerEl?.querySelector('#comfyui-lora-preset-select');

        if (!currentLoraSelect) return;

        if (targetLoraPreset) {
            // 情况A: 该工作流有绑定的 LoRA
            // 如果当前 LoRA 没选对，就切过去
            if (currentLoraSelect.value !== targetLoraPreset.name) {
                currentLoraSelect.value = targetLoraPreset.name;
                // 传入 true，告诉它这是由工作流触发的，不要再切回来！
                await this._handleLoraPresetChange(targetLoraPreset.name, true);
                this.ctx?.helpers?.showToast?.(`工作流联动: 已自动加载 LoRA "${targetLoraPreset.name}"`, 'info');
            }
        } else {
            // 情况B: 该工作流没有绑定 LoRA
            // 只有当当前还选着某个 LoRA 时，才重置为 "无" (可选，如果不想要这个行为可以删除这块 else)
            // if (currentLoraSelect.value !== "") {
            //     currentLoraSelect.value = "";
            //     await this._handleLoraPresetChange("", true);
            // }

            // 建议：保持现状，只在 UI 上刷新绑定信息（其实不需要做，因为 LoRA 没变，绑定信息也没变）
        }
    }

    // --- 修改开始：增加 fromWorkflow 标志防止死循环 ---
    async _handleLoraPresetChange(name, fromWorkflow = false) {
        const updatePromises = [];

        // 1. 更新数据库中所有预设的激活状态
        this.loraPresets.forEach(p => {
            if (p.name === name) {
                if (p.status !== 1) {
                    p.status = 1;
                    updatePromises.push(this.ctx?.db?.put(StoreNames.LORA_PRESETS, p));
                }
            } else if (p.status === 1) {
                p.status = 0;
                updatePromises.push(this.ctx?.db?.put(StoreNames.LORA_PRESETS, p));
            }
        });

        if (updatePromises.length > 0) {
            await Promise.all(updatePromises);
        }

        // 同步到服务器
        this._syncDataToServer();

        // 获取当前选中的预设对象 (如果选了"无"，activePreset 为 undefined)
        const activePreset = this.loraPresets.find(p => p.name === name);
        this._updateLoraPreview(activePreset);

        // 【修复 bug 2】强制更新“绑定到工作流”的下拉框显示
        // 无论 activePreset 是否存在，都要更新。如果不存在(选择了无)，则重置为 ''
        const workflowBindSelect = this.containerEl?.querySelector('#lora-bound-workflow-select');
        if (workflowBindSelect) {
            // 获取绑定值，如果没有预设或没绑定，则为空字符串
            const boundVal = (activePreset && activePreset.boundWorkflow) ? activePreset.boundWorkflow : '';
            workflowBindSelect.value = boundVal;
        }

        // 【修复 bug 1】自动切换工作流逻辑
        // 只有当操作 不是 由工作流切换触发时（fromWorkflow 为 false），才执行主动切换
        if (!fromWorkflow && activePreset && activePreset.boundWorkflow) {
            const targetWorkflow = activePreset.boundWorkflow;
            const workflowSelect = this.containerEl?.querySelector('#comfyui-workflow-select');

            // 检查目标工作流是否存在于列表中，并且当前并未选中它
            if (workflowSelect && workflowSelect.value !== targetWorkflow) {
                if (this.workflows.some(w => w.name === targetWorkflow)) {
                    workflowSelect.value = targetWorkflow;
                    // 重要：加载工作流内容到编辑器并更新状态
                    this._loadWorkflowContent(targetWorkflow);
                    // 提示用户
                    this.ctx?.helpers?.showToast?.(`LoRA联动: 已自动切换到工作流 "${targetWorkflow}"`, 'info');
                } else {
                    // 如果绑定的工作流被删了，可选：提示一下
                    console.warn(`绑定的工作流 "${targetWorkflow}" 不存在`);
                }
            }
        }
    }

    async _updateLoraPreset() {
        const select = this.containerEl?.querySelector('#comfyui-lora-preset-select');
        const name = select?.value;

        if (!name) {
            this.ctx?.helpers?.showToast?.('请先选择一个 LoRA 预设', 'warning');
            return;
        }

        const preset = this.loraPresets.find(p => p.name === name);
        if (preset && this.ctx?.db) {
            await this.ctx.db.put(StoreNames.LORA_PRESETS, preset);
            this.ctx?.helpers?.showToast?.(`LoRA 预设 "${name}" 已更新`, 'success');
        }
    }

    async _saveLoraPresetAs() {
        const name = prompt('输入新 LoRA 预设名称:');
        if (!name) return;

        if (this.loraPresets.some(p => p.name === name)) {
            this.ctx?.helpers?.showToast?.('该名称已存在', 'error');
            return;
        }

        const boundWf = this.containerEl?.querySelector('#lora-bound-workflow-select')?.value || '';

        const newPreset = {
            name,
            loras: Array(8).fill(null).map(() => ({ name: 'None', strength: 1.0 })),
            status: 0,
            boundWorkflow: boundWf, // [新增]
            createdAt: Date.now(),
        };

        if (this.ctx?.db) {
            await this.ctx.db.put(StoreNames.LORA_PRESETS, newPreset);
        }
        this.loraPresets.push(newPreset);
        this._renderLoraPresetSelect();
        // [新增] 同步到服务器
        this._syncDataToServer();
        this.ctx?.helpers?.showToast?.(`LoRA 预设 "${name}" 已保存`, 'success');
    }

    async _deleteLoraPreset() {
        const select = this.containerEl?.querySelector('#comfyui-lora-preset-select');
        const name = select?.value;

        if (!name) {
            this.ctx?.helpers?.showToast?.('请先选择一个 LoRA 预设', 'warning');
            return;
        }

        if (!confirm(`确定删除 LoRA 预设 "${name}" 吗？`)) return;

        if (this.ctx?.db) {
            await this.ctx.db.delete(StoreNames.LORA_PRESETS, name);
            this.loraPresets = this.loraPresets.filter(p => p.name !== name);
            this._renderLoraPresetSelect();
            // [新增] 同步到服务器
            this._syncDataToServer();
            this.ctx?.helpers?.showToast?.(`LoRA 预设 "${name}" 已删除`, 'success');
        }
    }

    async _openLoraConfigModal() {
        // 获取当前活动的 LoRA 预设
        let activePresetName = this.containerEl?.querySelector('#comfyui-lora-preset-select')?.value;
        let activePreset = this.loraPresets.find(p => p.name === activePresetName);

        if (!activePreset) {
            activePreset = {
                name: '未保存 (临时)',
                loras: Array(8).fill(null).map(() => ({ name: 'None', strength: 1.0 })),
            };
        } else if (!activePreset.loras || activePreset.loras.length < 8) {
            // 补全数据结构
            const filled = Array(8).fill(null).map((_, i) => activePreset.loras?.[i] || { name: 'None', strength: 1.0 });
            activePreset.loras = filled;
        }

        // 准备 LoRA 列表数据
        const allLoras = this.loadedOptions.loras || [];

        // 构建模态框 HTML
        let loraUnitsHtml = '';
        for (let i = 1; i <= 8; i++) {
            const loraData = activePreset.loras[i - 1] || { name: 'None', strength: 1.0 };
            const loraId = `modal_lora_${i}`;
            const strengthId = `modal_lora_strength_${i}`;
            const searchBoxId = `modal_lora_search_${i}`;

            loraUnitsHtml += `
                <div class="tsp-lora-unit">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 5px;">
                        <label style="font-weight: bold; color: var(--tsp-accent-primary);">LoRA 模型 ${i}</label>
                        <div style="display: flex; align-items: center; gap: 8px;">
                            <label for="${strengthId}" style="font-size: 0.9em;">权重:</label>
                            <input type="number" id="${strengthId}" class="tsp-input" style="width: 70px; padding: 2px 5px;"
                                   value="${loraData.strength}" min="-2" max="6" step="0.05">
                        </div>
                    </div>
                    <div style="display: flex; gap: 8px; margin-bottom: 8px;">
                        <input type="text" id="${searchBoxId}" class="tsp-input lora-search-input"
                               placeholder="搜索 LoRA..." style="flex: 1;" data-index="${i}">
                        <button class="tsp-btn tsp-btn-primary lora-search-btn" data-index="${i}" title="搜索">
                            <i class="fa-solid fa-search"></i>
                        </button>
                    </div>
                    <select id="${loraId}" class="tsp-input lora-select" style="width: 100%;">
                        <option value="None">None</option>
                        <option value="${loraData.name}" selected>${loraData.name}</option>
                    </select>
                </div>
            `;
        }

        const modalOverlay = document.createElement('div');
        modalOverlay.className = 'tsp-modal-overlay';
        modalOverlay.style.zIndex = '10007';
        modalOverlay.innerHTML = `
            <div class="tsp-modal" style="width: 700px; max-height: 85vh; display: flex; flex-direction: column;">
                <div class="tsp-modal-header">
                    <div class="tsp-modal-title"><i class="fa-solid fa-cogs"></i> 配置 LoRA 详细参数</div>
                    <button class="tsp-btn tsp-btn-icon" id="close-lora-modal"><i class="fa-solid fa-times"></i></button>
                </div>
                <div class="tsp-modal-body" style="overflow-y: auto; padding: 20px;">
                    <div class="tsp-info-box" style="margin-bottom: 15px;">
                        当前预设: <strong>${activePreset.name}</strong>
                    </div>
                    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 15px;">
                        ${loraUnitsHtml}
                    </div>
                </div>
                <div class="tsp-modal-footer">
                    <span style="margin-right: auto; color: var(--tsp-text-muted); font-size: 0.9em;">修改后点击保存生效</span>
                    <button class="tsp-btn" id="cancel-lora-modal">取消</button>
                    <button class="tsp-btn tsp-btn-primary" id="save-lora-modal">保存配置</button>
                </div>
            </div>
        `;

        document.body.appendChild(modalOverlay);
        requestAnimationFrame(() => modalOverlay.classList.add('visible'));

        // ==================== 辅助函数：填充 Select ====================
        const populateSelect = (selectEl, items, selectedValue) => {
            selectEl.innerHTML = '<option value="None">None</option>';
            // 创建文档片段以提高性能
            const fragment = document.createDocumentFragment();
            items.forEach(item => {
                const option = document.createElement('option');
                option.value = item;
                option.textContent = item;
                if (item === selectedValue) option.selected = true;
                fragment.appendChild(option);
            });
            selectEl.appendChild(fragment);

            // 再次确保选中状态（如果 value 不在列表中，手动添加一个临时选项）
            if (selectedValue && selectedValue !== 'None' && !items.includes(selectedValue)) {
                const tempOpt = new Option(selectedValue, selectedValue, true, true);
                selectEl.add(tempOpt, selectEl.options[1]);
            }
            selectEl.value = selectedValue;
        };

        // 初始填充所有 Select
        for (let i = 1; i <= 8; i++) {
            const select = modalOverlay.querySelector(`#${`modal_lora_${i}`}`);
            const currentVal = activePreset.loras[i - 1].name;
            // 初始显示全部（或者前100个以提高性能，但在搜索功能下全部加载更好）
            // 注意：如果列表极大，这里会卡顿。优化策略：初始只加载 currentVal 和 None
            populateSelect(select, allLoras, currentVal);
        }

        // ==================== 事件绑定 ====================

        // 1. 搜索功能实现
        const handleSearch = (index) => {
            const input = modalOverlay.querySelector(`#modal_lora_search_${index}`);
            const select = modalOverlay.querySelector(`#modal_lora_${index}`);
            const query = input.value.toLowerCase().trim();
            const currentVal = select.value;

            let filtered = allLoras;
            if (query) {
                filtered = allLoras.filter(lora => lora.toLowerCase().includes(query));
            }

            populateSelect(select, filtered, currentVal);
            // 如果搜索结果不为空，尝试展开或提示（标准 select 无法程序化展开，这里只做数据过滤）
            if (query) {
                this.ctx?.helpers?.showToast?.(`已过滤: 找到 ${filtered.length} 个模型`, 'info', 1000);
            }
        };

        modalOverlay.querySelectorAll('.lora-search-btn').forEach(btn => {
            btn.addEventListener('click', () => handleSearch(btn.dataset.index));
        });

        modalOverlay.querySelectorAll('.lora-search-input').forEach(input => {
            input.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') handleSearch(input.dataset.index);
            });
        });

        // 2. 关闭与保存
        const closeModal = () => {
            modalOverlay.classList.remove('visible');
            setTimeout(() => modalOverlay.remove(), 200);
        };

        modalOverlay.querySelector('#close-lora-modal')?.addEventListener('click', closeModal);
        modalOverlay.querySelector('#cancel-lora-modal')?.addEventListener('click', closeModal);

        modalOverlay.querySelector('#save-lora-modal')?.addEventListener('click', async () => {
            const newLoras = [];
            for (let i = 1; i <= 8; i++) {
                const name = modalOverlay.querySelector(`#modal_lora_${i}`).value;
                const strength = parseFloat(modalOverlay.querySelector(`#modal_lora_strength_${i}`).value) || 1.0;
                newLoras.push({ name, strength });
            }

            // 更新到当前预设对象
            if (activePreset && this.loraPresets.includes(activePreset)) {
                activePreset.loras = newLoras;
                // 持久化保存
                if (this.ctx?.db) {
                    // [新增] 同步到服务器
                    this._syncDataToServer();
                    await this.ctx.db.put(StoreNames.LORA_PRESETS, activePreset);
                }
                this._updateLoraPreview(activePreset);
                this.ctx?.helpers?.showToast?.('LoRA 配置已更新并保存', 'success');
            } else {
                // 如果是“未保存”状态的，提示用户在主界面另存为
                this.ctx?.helpers?.showToast?.('这是临时配置，请点击主界面的“保存”按钮创建新预设', 'warning');
                // 这里我们暂存到内存中的一个临时位置，或者更新 UI 上的“临时”预设
                // 为了简单，我们暂不支持修改不存在的预设
            }
            closeModal();
        });
    }


    // ==================== 工作流管理 ====================

    async _loadWorkflows() {
        try {
            if (this.ctx?.db) {
                this.workflows = await this.ctx.db.getAll(StoreNames.WORKFLOWS) || [];

                // [优化] 如果数据库为空，自动导入默认工作流
                if (this.workflows.length === 0) {
                    this.ctx?.log?.('comfyui-settings', '检测到工作流为空，正在初始化默认工作流...');
                    const defaultWfs = this._getDefaultWorkflows();
                    const operations = [];
                    const now = Date.now();

                    for (const [name, content] of Object.entries(defaultWfs)) {
                        // 默认激活第一个工作流作为文生图
                        const status = name.includes('默认') ? 1 : 0;
                        const wf = {
                            name,
                            content: JSON.stringify(content, null, 2),
                            status,
                            createdAt: now
                        };
                        operations.push(this.ctx.db.put(StoreNames.WORKFLOWS, wf));
                        this.workflows.push(wf);
                    }

                    await Promise.all(operations);
                    this.ctx?.helpers?.showToast?.('已初始化默认 ComfyUI 工作流', 'success');
                }
            } else {
                this.workflows = [];
            }
            this._renderWorkflowSelect();
        } catch (e) {
            this.workflows = [];
            this._renderWorkflowSelect();
        }
    }

    _renderWorkflowSelect() {
        const select = this.containerEl?.querySelector('#comfyui-workflow-select');
        const i2iSelect = this.containerEl?.querySelector('#comfyui-i2i-workflow-select'); // [新增]
        if (!select) return;

        const s = this._getSettings();
        select.innerHTML = '<option value="">-- 请选择工作流 --</option>';
        if (i2iSelect) i2iSelect.innerHTML = '<option value="">-- 跟随文生图或手动选择 --</option>'; // [新增]

        // --- 修改开始：优化选择逻辑，优先匹配 saved activeWorkflow ---
        let activeWorkflowName = '';

        // 1. 先尝试在列表中找到与设置中 activeWorkflow 名称完全匹配的那一项
        const settingMatch = this.workflows.find(w => w.name === s.activeWorkflow);
        // 2. 如果设置为空或找不到，再尝试找 status=1 (默认) 的
        const defaultMatch = this.workflows.find(w => w.status === 1 || w.status === 3);

        // 3. 确定最终应该选中的名称
        const targetActiveName = settingMatch ? settingMatch.name : (defaultMatch ? defaultMatch.name : '');

        this.workflows.forEach(wf => {
            // 文生图选择器：只依据 targetActiveName 判断是否选中
            const isTxtActive = wf.name === targetActiveName;

            const txtText = isTxtActive ? `${wf.name} (T2I) ✓` : wf.name;
            const option = new Option(txtText, wf.name);
            if (isTxtActive) {
                option.selected = true;
                activeWorkflowName = wf.name;
            }
            select.appendChild(option);

            // [新增] 图生图选择器
            if (i2iSelect) {
                const isI2iActive = wf.name === s.i2iWorkflow;
                const i2iOption = new Option(wf.name, wf.name);
                if (isI2iActive) i2iOption.selected = true;
                i2iSelect.appendChild(i2iOption);
            }
        });
        // --- 修改结束 ---

        // 自动加载当前选中工作流的内容到编辑器
        if (activeWorkflowName) {
            this._loadWorkflowContent(activeWorkflowName);
        }
    }

    _loadWorkflowContent(name) {
        const workflow = this.workflows.find(w => w.name === name);
        const editor = this.containerEl?.querySelector('#comfyui-workflow-editor');

        if (workflow && editor) {
            editor.value = workflow.content || '';
            this._updateParamChecker();
        }
    }

    async _updateWorkflow() {
        const select = this.containerEl?.querySelector('#comfyui-workflow-select');
        const editor = this.containerEl?.querySelector('#comfyui-workflow-editor');
        const name = select?.value;
        const content = editor?.value;

        if (!name) {
            this.ctx?.helpers?.showToast?.('请先选择一个工作流', 'warning');
            return;
        }

        try {
            JSON.parse(content);
        } catch (e) {
            this.ctx?.helpers?.showToast?.('工作流 JSON 格式错误', 'error');
            return;
        }

        const workflow = this.workflows.find(w => w.name === name);
        if (workflow && this.ctx?.db) {
            workflow.content = content;
            await this.ctx.db.put(StoreNames.WORKFLOWS, workflow);
            this._syncDataToServer();
            this.ctx?.helpers?.showToast?.(`工作流 "${name}" 已更新`, 'success');
        }
    }

    async _saveWorkflowAs() {
        const editor = this.containerEl?.querySelector('#comfyui-workflow-editor');
        const content = editor?.value;

        if (!content) {
            this.ctx?.helpers?.showToast?.('请先输入工作流内容', 'warning');
            return;
        }

        try {
            JSON.parse(content);
        } catch (e) {
            this.ctx?.helpers?.showToast?.('工作流 JSON 格式错误', 'error');
            return;
        }

        const name = prompt('输入新工作流名称:');
        if (!name) return;

        if (this.workflows.some(w => w.name === name)) {
            this.ctx?.helpers?.showToast?.('该名称已存在', 'error');
            return;
        }

        const newWorkflow = { name, content, status: 0, createdAt: Date.now() };

        if (this.ctx?.db) {
            await this.ctx.db.put(StoreNames.WORKFLOWS, newWorkflow);
        }
        this.workflows.push(newWorkflow);
        this._renderWorkflowSelect();
        // [新增] 同步
        this._syncDataToServer();
        this.ctx?.helpers?.showToast?.(`工作流 "${name}" 已保存`, 'success');
    }

    async _deleteWorkflow() {
        const select = this.containerEl?.querySelector('#comfyui-workflow-select');
        const name = select?.value;

        if (!name) {
            this.ctx?.helpers?.showToast?.('请先选择一个工作流', 'warning');
            return;
        }

        if (!confirm(`确定删除工作流 "${name}" 吗？`)) return;

        const workflow = this.workflows.find(w => w.name === name);
        if (workflow && this.ctx?.db) {
            await this.ctx.db.delete(StoreNames.WORKFLOWS, workflow.id || workflow.name);
            this.workflows = this.workflows.filter(w => w.name !== name);
            this._renderWorkflowSelect();

            const editor = this.containerEl?.querySelector('#comfyui-workflow-editor');
            if (editor) editor.value = '';
            // [新增] 同步
            this._syncDataToServer();
            this.ctx?.helpers?.showToast?.(`工作流 "${name}" 已删除`, 'success');
        }
    }

    async _importWorkflows(files) {
        if (!files || files.length === 0) return;

        let imported = 0;
        for (const file of files) {
            try {
                const text = await file.text();
                const data = JSON.parse(text);

                if (Array.isArray(data)) {
                    for (const wf of data) {
                        await this._importSingleWorkflow(wf);
                        imported++;
                    }
                } else if (data.name && data.content) {
                    await this._importSingleWorkflow(data);
                    imported++;
                } else {
                    const name = file.name.replace('.json', '');
                    await this._importSingleWorkflow({ name, content: text, status: 0 });
                    imported++;
                }
            } catch (e) {
                console.error('导入工作流失败:', e);
            }
        }

        if (imported > 0) {
            await this._loadWorkflows();
            this._syncDataToServer();
            this.ctx?.helpers?.showToast?.(`成功导入 ${imported} 个工作流`, 'success');
        }
    }

    async _importSingleWorkflow(wf) {
        const existing = this.workflows.find(w => w.name === wf.name);
        if (existing) {
            existing.content = wf.content;
            if (this.ctx?.db) await this.ctx.db.put(StoreNames.WORKFLOWS, existing);
        } else {
            const newWf = {
                name: wf.name,
                content: typeof wf.content === 'string' ? wf.content : JSON.stringify(wf.content),
                status: wf.status || 0,
                createdAt: Date.now(),
            };
            if (this.ctx?.db) await this.ctx.db.put(StoreNames.WORKFLOWS, newWf);
        }
    }

    _exportAllWorkflows() {
        if (this.workflows.length === 0) {
            this.ctx?.helpers?.showToast?.('没有可导出的工作流', 'warning');
            return;
        }

        const data = this.workflows.map(wf => ({
            name: wf.name,
            content: wf.content,
            status: wf.status,
        }));

        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `comfyui-workflows-${new Date().toISOString().slice(0, 10)}.json`;
        a.click();
        URL.revokeObjectURL(url);

        this.ctx?.helpers?.showToast?.('工作流已导出', 'success');
    }

    _updateParamChecker() {
        const editor = this.containerEl?.querySelector('#comfyui-workflow-editor');
        const listContainer = this.containerEl?.querySelector('#param-checker-list');

        if (!editor || !listContainer) return;

        const workflowText = editor.value;

        const paramsToCheck = [
            { label: '正向提示词', placeholders: ['正面提示词', '正向提示词'] },
            { label: '反向提示词', placeholders: ['负面提示词', '负向提示词', '反向提示词'] },
            { label: '主模型', placeholders: ['主模型'] },
            { label: '采样器', placeholders: ['采样器'] },
            { label: '调度器', placeholders: ['调度器'] },
            { label: '宽度/高度', placeholders: ['宽度', '高度'] },
            { label: '步数', placeholders: ['步数'] },
            { label: '种子', placeholders: ['种子'] },
            { label: 'CFG', placeholders: ['CFG'] },
        ];

        let html = '';
        paramsToCheck.forEach(param => {
            const found = param.placeholders.some(p => workflowText.includes(`"${p}"`));
            const icon = found
                ? '<span style="color: var(--tsp-success);">✔</span>'
                : '<span style="color: var(--tsp-danger);">✖</span>';
            html += `<li style="padding: 3px 0;">${icon} ${param.label}</li>`;
        });

        listContainer.innerHTML = html;
    }
    /**
     * 渲染API预设下拉框
     */
    _renderApiPresetDropdown() {
        const select = this.containerEl.querySelector('#comfy-api-preset-select');
        if (!select) return;

        const settings = this._getSettings();
        this.apiPresets = settings.apiPresets || [];
        this.activeApiPreset = settings.activeApiPreset || (this.apiPresets[0]?.name || '');

        select.innerHTML = '<option value="">-- 新建预设 --</option>';
        this.apiPresets.forEach(preset => {
            const option = document.createElement('option');
            option.value = preset.name;
            option.textContent = preset.name;
            select.appendChild(option);
        });

        if (this.activeApiPreset) {
            select.value = this.activeApiPreset;
        }
    }

    /**
     * 将当前选中的预设数据应用到UI
     */
    _applyActivePresetToUI() {
        const preset = this.apiPresets.find(p => p.name === this.activeApiPreset);
        const urlInput = this.containerEl.querySelector('#comfyui-url');
        const apiModeSelect = this.containerEl.querySelector('#comfyui-api-mode');
        const deleteBtn = this.containerEl.querySelector('#comfy-api-preset-delete');

        if (preset) {
            if (urlInput) urlInput.value = preset.url || '';
            if (apiModeSelect) apiModeSelect.value = preset.apiMode || 'direct';
            if (deleteBtn) deleteBtn.disabled = false;
        } else {
            // “新建预设”状态
            if (urlInput) urlInput.value = '';
            if (apiModeSelect) apiModeSelect.value = 'direct'; // 默认值
            if (deleteBtn) deleteBtn.disabled = true;
        }
    }

    /**
     * 保存为新API预设
     */
    async _saveApiPreset() {
        const newName = await this.ctx.helpers.promptInput('输入新 API 预设名称');
        if (!newName || !newName.trim()) return;

        if (this.apiPresets.some(p => p.name === newName)) {
            this.ctx.helpers.showToast('预设名称已存在', 'error');
            return;
        }

        const newPreset = {
            name: newName,
            url: this.containerEl.querySelector('#comfyui-url')?.value.trim() || '',
            apiMode: this.containerEl.querySelector('#comfyui-api-mode')?.value || 'direct',
        };

        this.apiPresets.push(newPreset);
        this.activeApiPreset = newName;
        this._renderApiPresetDropdown();
        this._applyActivePresetToUI();
        this.ctx.helpers.showToast('API 预设已保存', 'success');
    }

    /**
     * 删除当前API预设
     */
    async _deleteApiPreset() {
        if (!this.activeApiPreset) return;

        const confirmed = await this.ctx.helpers.promptConfirm(`确定要删除预设 "${this.activeApiPreset}" 吗?`);
        if (!confirmed) return;

        this.apiPresets = this.apiPresets.filter(p => p.name !== this.activeApiPreset);
        this.activeApiPreset = this.apiPresets.length > 0 ? this.apiPresets[0].name : '';

        this._renderApiPresetDropdown();
        this._applyActivePresetToUI();
        this.ctx.helpers.showToast('API 预设已删除', 'success');
    }
    /**
     * 收集表单数据
     */
    collectSettings() {
        if (!this.containerEl) return null;
        const activeApiPresetName = this.containerEl.querySelector('#comfy-api-preset-select')?.value || '';
        const preset = this.apiPresets.find(p => p.name === activeApiPresetName);

        const currentUrl = preset ? preset.url : (this.containerEl.querySelector('#comfyui-url')?.value || '');
        const currentApiMode = preset ? preset.apiMode : (this.containerEl.querySelector('#comfyui-api-mode')?.value || 'direct');

        // 注意：宽度、高度、步数、CFG 在通用设置页面配置，这里不收集
        return {
            url: currentUrl,
            apiMode: currentApiMode,
            model: this.containerEl.querySelector('#comfyui-model')?.value || '',
            sampler: this.containerEl.querySelector('#comfyui-sampler')?.value || '',
            scheduler: this.containerEl.querySelector('#comfyui-scheduler')?.value || '',
            // 多角色
            multiCharacterEnabled: this.containerEl.querySelector('#comfyui-multi-char')?.checked || false,
            // 高级设置
            detailerModel: this.containerEl.querySelector('#comfyui-detailer-model')?.value || '',
            detailerSampler: this.containerEl.querySelector('#comfyui-detailer-sampler')?.value || '',
            detailerScheduler: this.containerEl.querySelector('#comfyui-detailer-scheduler')?.value || '',
            upscaleModel: this.containerEl.querySelector('#comfyui-upscale-model')?.value || '',
            upscaleBy: parseFloat(this.containerEl.querySelector('#comfyui-upscale-by')?.value) || 1.5,
            ultimateSteps: parseInt(this.containerEl.querySelector('#comfyui-ultimate-steps')?.value) || 20,
            ultimateSampler: this.containerEl.querySelector('#comfyui-ultimate-sampler')?.value || '',
            ultimateScheduler: this.containerEl.querySelector('#comfyui-ultimate-scheduler')?.value || '',
            pureWorkflowMode: this.containerEl.querySelector('#comfyui-pure-workflow')?.checked || false,
            activeWorkflow: this.containerEl.querySelector('#comfyui-workflow-select')?.value || '',
            i2iWorkflow: this.containerEl.querySelector('#comfyui-i2i-workflow-select')?.value || '', // [新增]
            activeLoraPreset: this.containerEl.querySelector('#comfyui-lora-preset-select')?.value || '',
            apiPresets: this.apiPresets,
            activeApiPreset: activeApiPresetName,
        };
    }

    /**
     * 导入默认工作流
     */
    async _importDefaultWorkflows() {
        const defaultWorkflows = this._getDefaultWorkflows();
        const workflowNames = Object.keys(defaultWorkflows);

        if (workflowNames.length === 0) {
            this.ctx?.helpers?.showToast?.('没有可导入的默认工作流', 'warning');
            return;
        }

        // 确认导入
        const existingNames = this.workflows.map(w => w.name);
        const willOverwrite = workflowNames.filter(n => existingNames.includes(n));

        let confirmMsg = `将导入 ${workflowNames.length} 个默认工作流:\n\n`;
        confirmMsg += workflowNames.map(n => `• ${n}`).join('\n');
        if (willOverwrite.length > 0) {
            confirmMsg += `\n\n⚠️ 以下工作流将被覆盖:\n${willOverwrite.join(', ')}`;
        }

        if (!confirm(confirmMsg)) return;

        let imported = 0;
        for (const name of workflowNames) {
            const content = JSON.stringify(defaultWorkflows[name], null, 2);
            await this._importSingleWorkflow({ name, content, status: 0 });
            imported++;
        }

        await this._loadWorkflows();
        this.ctx?.helpers?.showToast?.(`成功导入 ${imported} 个默认工作流`, 'success');
    }

    /**
     * 获取默认工作流配置
     * 包含多种常用工作流模板
     */
    _getDefaultWorkflows() {
        return {
            "基础绘图 (无修复功能)": {"3":{"inputs":{"filename_prefix":"日期","images":["15",0]},"class_type":"SaveImage","_meta":{"title":"保存图像"}},"6":{"inputs":{"lora_01":"lora1","strength_01":1,"lora_02":"lora2","strength_02":1,"lora_03":"lora3","strength_03":1,"lora_04":"lora4","strength_04":1,"model":["10",0],"clip":["10",1]},"class_type":"Lora Loader Stack (rgthree)","_meta":{"title":"Lora Loader Stack (rgthree)"}},"8":{"inputs":{"text":"正面提示词","clip":["6",1]},"class_type":"CLIPTextEncode","_meta":{"title":"正面提示词"}},"9":{"inputs":{"text":"负面提示词","clip":["10",1]},"class_type":"CLIPTextEncode","_meta":{"title":"负面提示词"}},"10":{"inputs":{"ckpt_name":"主模型"},"class_type":"CheckpointLoaderSimple","_meta":{"title":"主模型 (Checkpoint)"}},"12":{"inputs":{"width":"宽度","height":"高度","batch_size":1},"class_type":"EmptyLatentImage","_meta":{"title":"分辨率 (Empty Latent)"}},"13":{"inputs":{"seed":"种子","steps":"步数","cfg":"CFG","sampler_name":"采样器","scheduler":"调度器","denoise":1,"model":["6",0],"positive":["8",0],"negative":["9",0],"latent_image":["12",0]},"class_type":"KSampler","_meta":{"title":"采样器 (KSampler)"}},"15":{"inputs":{"samples":["13",0],"vae":["10",2]},"class_type":"VAEDecode","_meta":{"title":"VAE解码"}}},

            "多人带修脸": 
            {
                "3": {
                    "inputs": {
                        "seed": "种子",
                        "steps": "步数",
                        "cfg": "CFG",
                        "sampler_name": "采样器",
                        "scheduler": "调度器",
                        "denoise": 1,
                        "model": [
                            "116",
                            0
                        ],
                        "positive": [
                            "109",
                            0
                        ],
                        "negative": [
                            "7",
                            0
                        ],
                        "latent_image": [
                            "67",
                            0
                        ]
                    },
                    "class_type": "KSampler",
                    "_meta": {
                        "title": "K采样器"
                    }
                },
                "7": {
                    "inputs": {
                        "text": "反向提示词",
                        "clip": [
                            "14",
                            1
                        ]
                    },
                    "class_type": "CLIPTextEncode",
                    "_meta": {
                        "title": "反向提示词"
                    }
                },
                "8": {
                    "inputs": {
                        "samples": [
                            "3",
                            0
                        ],
                        "vae": [
                            "14",
                            2
                        ]
                    },
                    "class_type": "VAEDecode",
                    "_meta": {
                        "title": "VAE解码"
                    }
                },
                "14": {
                    "inputs": {
                        "ckpt_name": "主模型"
                    },
                    "class_type": "CheckpointLoaderSimple",
                    "_meta": {
                        "title": "Checkpoint加载器（简易）"
                    }
                },
                "23": {
                    "inputs": {
                        "model_name": "修复模型"
                    },
                    "class_type": "UltralyticsDetectorProvider",
                    "_meta": {
                        "title": "UltralyticsDetectorProvider"
                    }
                },
                "25": {
                    "inputs": {
                        "model_name": "sam_vit_b_01ec64.pth",
                        "device_mode": "AUTO"
                    },
                    "class_type": "SAMLoader",
                    "_meta": {
                        "title": "SAMLoader (Impact)"
                    }
                },
                "30": {
                    "inputs": {
                        "filename_prefix": "ComfyUI",
                        "images": [
                            "35",
                            0
                        ]
                    },
                    "class_type": "SaveImage",
                    "_meta": {
                        "title": "保存图像"
                    }
                },
                "35": {
                    "inputs": {
                        "guide_size": 512,
                        "guide_size_for": true,
                        "max_size": 1024,
                        "seed": "种子",
                        "steps": "修复步数",
                        "cfg": "CFG",
                        "sampler_name": "采样器",
                        "scheduler": "调度器",
                        "denoise": 0.5,
                        "feather": 5,
                        "noise_mask": true,
                        "force_inpaint": true,
                        "bbox_threshold": 0.5,
                        "bbox_dilation": 10,
                        "bbox_crop_factor": 3,
                        "sam_detection_hint": "center-1",
                        "sam_dilation": 0,
                        "sam_threshold": 0.93,
                        "sam_bbox_expansion": 0,
                        "sam_mask_hint_threshold": 0.7,
                        "sam_mask_hint_use_negative": "False",
                        "drop_size": 10,
                        "wildcard": "",
                        "cycle": 1,
                        "inpaint_model": false,
                        "noise_mask_feather": 20,
                        "tiled_encode": true,
                        "tiled_decode": false,
                        "image": [
                            "8",
                            0
                        ],
                        "model": [
                            "14",
                            0
                        ],
                        "clip": [
                            "14",
                            1
                        ],
                        "vae": [
                            "14",
                            2
                        ],
                        "positive": [
                            "109",
                            0
                        ],
                        "negative": [
                            "7",
                            0
                        ],
                        "bbox_detector": [
                            "23",
                            0
                        ],
                        "sam_model_opt": [
                            "25",
                            0
                        ]
                    },
                    "class_type": "FaceDetailer",
                    "_meta": {
                        "title": "FaceDetailer"
                    }
                },
                "67": {
                    "inputs": {
                        "width": "宽度",
                        "height": "高度",
                        "batch_size": 1
                    },
                    "class_type": "EmptyLatentImage",
                    "_meta": {
                        "title": "空Latent图像"
                    }
                },
                "70": {
                    "inputs": {
                        "syntax_mode": "attention_couple",
                        "use_fill": false,
                        "mce_config": "{\"version\":\"1.1.0\",\"syntax_mode\":\"attention_couple\",\"base_prompt\":\"\",\"global_prompt\":\"\",\"use_fill\":false,\"global_use_fill\":false,\"canvas\":{\"width\":1024,\"height\":1024},\"characters\":[],\"settings\":{\"language\":\"zh-CN\",\"theme\":{\"primaryColor\":\"#743795\",\"backgroundColor\":\"#2a2a2a\",\"secondaryColor\":\"#333333\"}},\"timestamp\":1761132791536}",
                        "canvas_width": "宽度",
                        "canvas_height": "高度",
                        "multi_character_editor": ""
                    },
                    "class_type": "MultiCharacterEditorNode",
                    "_meta": {
                        "title": "多人角色提示词编辑器 (Multi Character Editor)"
                    }
                },
                "109": {
                    "inputs": {
                        "text": [
                            "112",
                            0
                        ],
                        "clip": [
                            "116",
                            1
                        ]
                    },
                    "class_type": "PCLazyTextEncode",
                    "_meta": {
                        "title": "PC: Schedule Prompt"
                    }
                },
                "112": {
                    "inputs": {
                        "selected_prompts": "正向提示词",
                        "prompt_selector": "",
                        "prefix_prompt": [
                            "70",
                            0
                        ]
                    },
                    "class_type": "PromptSelector",
                    "_meta": {
                        "title": "提示词选择器 (Prompt Selector)"
                    }
                },
                "115": {
                    "inputs": {
                        "lora_01": "lora1",
                        "strength_01": 1,
                        "lora_02": "lora2",
                        "strength_02": 1,
                        "lora_03": "lora3",
                        "strength_03": 1,
                        "lora_04": "lora4",
                        "strength_04": 1,
                        "model": [
                            "14",
                            0
                        ],
                        "clip": [
                            "14",
                            1
                        ]
                    },
                    "class_type": "Lora Loader Stack (rgthree)",
                    "_meta": {
                        "title": "LoRA堆加载器"
                    }
                },
                "116": {
                    "inputs": {
                        "lora_01": "lora5",
                        "strength_01": 1,
                        "lora_02": "lora6",
                        "strength_02": 1,
                        "lora_03": "lora7",
                        "strength_03": 1,
                        "lora_04": "lora8",
                        "strength_04": 1,
                        "model": [
                            "115",
                            0
                        ],
                        "clip": [
                            "115",
                            1
                        ]
                    },
                    "class_type": "Lora Loader Stack (rgthree)",
                    "_meta": {
                        "title": "LoRA堆加载器"
                    }
                }
            },

            "默认(高清放大)": {"3":{"inputs":{"seed":"种子","steps":"步数","cfg":"CFG","sampler_name":"采样器","scheduler":"调度器","denoise":1,"model":["42",0],"positive":["125",2],"negative":["125",3],"latent_image":["5",0]},"class_type":"KSampler","_meta":{"title":"K采样器"}},"5":{"inputs":{"width":"宽度","height":"高度","batch_size":1},"class_type":"EmptyLatentImage","_meta":{"title":"分辨率设置"}},"30":{"inputs":{"filename_prefix":"日期","images":["106",0]},"class_type":"SaveImage","_meta":{"title":"保存图像"}},"41":{"inputs":{"method":"from cond","model":["75",0]},"class_type":"Support empty uncond","_meta":{"title":"Support empty uncond"}},"42":{"inputs":{"object_to_patch":"diffusion_model","residual_diff_threshold":0.2,"start":0.2,"end":0.8,"max_consecutive_cache_hits":5,"model":["125",1]},"class_type":"ApplyFBCacheOnModel","_meta":{"title":"Apply First Block Cache"}},"43":{"inputs":{"start":0,"end":0.7,"conditioning":["75",2]},"class_type":"ConditioningSetTimestepRange","_meta":{"title":"设置条件时间"}},"48":{"inputs":{"upscale_factor":"放大倍率","steps":["73",0],"temp_prefix":"","step_mode":"simple","samples":["3",0],"upscaler":["49",0]},"class_type":"IterativeLatentUpscale","_meta":{"title":"Iterative Upscale (Latent/on Pixel Space)"}},"49":{"inputs":{"scale_method":"lanczos","seed":"种子","steps":["72",0],"cfg":7,"sampler_name":"res_multistep","scheduler":"kl_optimal","denoise":0.3,"use_tiled_vae":false,"tile_size":1024,"model":["74",0],"vae":["127",5],"positive":["127",2],"negative":["127",3]},"class_type":"PixelKSampleUpscalerProvider","_meta":{"title":"PixelKSampleUpscalerProvider"}},"55":{"inputs":{"pipe":["91",0]},"class_type":"easy pipeOut","_meta":{"title":"节点束输出"}},"72":{"inputs":{"value":"修复步数"},"class_type":"easy int","_meta":{"title":"每次迭代的步数"}},"73":{"inputs":{"value":1},"class_type":"easy int","_meta":{"title":"迭代次数"}},"74":{"inputs":{"object_to_patch":"diffusion_model","residual_diff_threshold":0.2,"start":0,"end":1,"max_consecutive_cache_hits":5,"model":["127",1]},"class_type":"ApplyFBCacheOnModel","_meta":{"title":"Apply First Block Cache"}},"75":{"inputs":{"positive":["76",0],"negative":["76",1],"打开可视化PromptUI":"","model":["130",0],"clip":["130",1]},"class_type":"WeiLinComfyUIPromptToLoras","_meta":{"title":"Lora和提示词加载"}},"76":{"inputs":{"positive":"正向提示词","negative":"反向提示词","打开可视化PromptUI":""},"class_type":"WeiLinPromptToString","_meta":{"title":"提示词与Lora"}},"91":{"inputs":{"ckpt_name":"主模型","vae_name":"Baked VAE","clip_skip":-2,"lora_name":"None","lora_model_strength":1,"lora_clip_strength":1,"resolution":"1024 x 1024","empty_latent_width":512,"empty_latent_height":512,"positive":["92",0],"negative":["92",0],"batch_size":1},"class_type":"easy comfyLoader","_meta":{"title":"底模加载"}},"92":{"inputs":{"value":""},"class_type":"PrimitiveString","_meta":{"title":"伪提示词"}},"102":{"inputs":{"signal":["48",0],"any_input":["48",0]},"class_type":"ImpactIfNone","_meta":{"title":"ImpactIfNone"}},"104":{"inputs":{"boolean":["102",1],"on_true":["102",0],"on_false":["3",0]},"class_type":"easy ifElse","_meta":{"title":"是否判断"}},"106":{"inputs":{"samples":["104",0],"vae":["128",5]},"class_type":"VAEDecode","_meta":{"title":"VAE解码"}},"122":{"inputs":{"pipe":["55",0],"model":["41",0],"pos":["75",1],"neg":["43",0],"latent":["55",4],"vae":["55",5],"clip":["55",6],"image":["55",7]},"class_type":"easy pipeIn","_meta":{"title":"节点束输入"}},"125":{"inputs":{"pipe":["122",0]},"class_type":"easy pipeOut","_meta":{"title":"节点束输出"}},"127":{"inputs":{"pipe":["122",0]},"class_type":"easy pipeOut","_meta":{"title":"节点束输出"}},"128":{"inputs":{"pipe":["122",0]},"class_type":"easy pipeOut","_meta":{"title":"节点束输出"}},"129":{"inputs":{"lora_01":"lora1","strength_01":1,"lora_02":"lora2","strength_02":1.8,"lora_03":"lora3","strength_03":1,"lora_04":"lora4","strength_04":1,"model":["91",1],"clip":["55",6]},"class_type":"Lora Loader Stack (rgthree)","_meta":{"title":"LoRA堆加载器"}},"130":{"inputs":{"lora_01":"lora5","strength_01":1,"lora_02":"lora6","strength_02":1.8,"lora_03":"lora7","strength_03":1,"lora_04":"lora8","strength_04":1,"model":["129",0],"clip":["129",1]},"class_type":"Lora Loader Stack (rgthree)","_meta":{"title":"LoRA堆加载器"}}},

            "绘图(高清修复+脸部细节)": {"3":{"inputs":{"seed":"种子","steps":"步数","cfg":"CFG","sampler_name":"采样器","scheduler":"调度器","denoise":1,"model":["42",0],"positive":["125",2],"negative":["125",3],"latent_image":["5",0]},"class_type":"KSampler","_meta":{"title":"K采样器"}},"5":{"inputs":{"width":"宽度","height":"高度","batch_size":1},"class_type":"EmptyLatentImage","_meta":{"title":"分辨率"}},"30":{"inputs":{"filename_prefix":"日期","images":["107",0]},"class_type":"SaveImage","_meta":{"title":"保存图像"}},"41":{"inputs":{"method":"from cond","model":["75",0]},"class_type":"Support empty uncond","_meta":{"title":"Support empty uncond"}},"42":{"inputs":{"object_to_patch":"diffusion_model","residual_diff_threshold":0.2,"start":0.2,"end":0.8,"max_consecutive_cache_hits":5,"model":["125",1]},"class_type":"ApplyFBCacheOnModel","_meta":{"title":"Apply First Block Cache"}},"43":{"inputs":{"start":0,"end":0.7,"conditioning":["75",2]},"class_type":"ConditioningSetTimestepRange","_meta":{"title":"设置条件时间"}},"48":{"inputs":{"upscale_factor":"放大倍率","steps":["73",0],"temp_prefix":"","step_mode":"simple","samples":["3",0],"upscaler":["49",0]},"class_type":"IterativeLatentUpscale","_meta":{"title":"Iterative Upscale (Latent/on Pixel Space)"}},"49":{"inputs":{"scale_method":"lanczos","seed":1053770938993714,"steps":["72",0],"cfg":"CFG","sampler_name":"res_multistep","scheduler":"kl_optimal","denoise":0.3,"use_tiled_vae":false,"tile_size":1024,"model":["74",0],"vae":["127",5],"positive":["127",2],"negative":["127",3]},"class_type":"PixelKSampleUpscalerProvider","_meta":{"title":"PixelKSampleUpscalerProvider"}},"55":{"inputs":{"pipe":["91",0]},"class_type":"easy pipeOut","_meta":{"title":"节点束输出"}},"72":{"inputs":{"value":"修复步数"},"class_type":"easy int","_meta":{"title":"每次迭代的步数"}},"73":{"inputs":{"value":1},"class_type":"easy int","_meta":{"title":"迭代次数"}},"74":{"inputs":{"object_to_patch":"diffusion_model","residual_diff_threshold":0.2,"start":0,"end":1,"max_consecutive_cache_hits":5,"model":["127",1]},"class_type":"ApplyFBCacheOnModel","_meta":{"title":"Apply First Block Cache"}},"75":{"inputs":{"positive":["76",0],"negative":["76",1],"打开可视化PromptUI":"","model":["133",0],"clip":["133",1]},"class_type":"WeiLinComfyUIPromptToLoras","_meta":{"title":"提示词加载"}},"76":{"inputs":{"positive":"正向提示词","negative":"负面提示词","打开可视化PromptUI":""},"class_type":"WeiLinPromptToString","_meta":{"title":"提示词与Lora"}},"91":{"inputs":{"ckpt_name":"主模型","vae_name":"Baked VAE","clip_skip":-2,"lora_name":"None","lora_model_strength":1,"lora_clip_strength":1,"resolution":"1024 x 1024","empty_latent_width":512,"empty_latent_height":512,"positive":["92",0],"negative":["92",0],"batch_size":1},"class_type":"easy comfyLoader","_meta":{"title":"底模加载"}},"92":{"inputs":{"value":""},"class_type":"PrimitiveString","_meta":{"title":"伪提示词"}},"102":{"inputs":{"signal":["48",0],"any_input":["48",0]},"class_type":"ImpactIfNone","_meta":{"title":"ImpactIfNone"}},"104":{"inputs":{"boolean":["102",1],"on_true":["102",0],"on_false":["3",0]},"class_type":"easy ifElse","_meta":{"title":"是否判断"}},"106":{"inputs":{"samples":["104",0],"vae":["128",5]},"class_type":"VAEDecode","_meta":{"title":"VAE解码"}},"107":{"inputs":{"guide_size":1024,"guide_size_for":true,"max_size":1024,"seed":"种子","steps":"修复步数","cfg":"CFG","sampler_name":"采样器","scheduler":"调度器","denoise":0.2,"feather":5,"noise_mask":true,"force_inpaint":true,"bbox_threshold":0.5,"bbox_dilation":10,"bbox_crop_factor":3,"sam_detection_hint":"center-1","sam_dilation":0,"sam_threshold":0.93,"sam_bbox_expansion":0,"sam_mask_hint_threshold":0.7,"sam_mask_hint_use_negative":"False","drop_size":10,"wildcard":"","cycle":1,"inpaint_model":false,"noise_mask_feather":20,"tiled_encode":false,"tiled_decode":false,"image":["106",0],"model":["108",0],"clip":["128",6],"vae":["128",5],"positive":["128",2],"negative":["128",3],"bbox_detector":["130",0],"sam_model_opt":["110",0]},"class_type":"FaceDetailer","_meta":{"title":"FaceDetailer"}},"108":{"inputs":{"object_to_patch":"diffusion_model","residual_diff_threshold":0.2,"start":0,"end":1,"max_consecutive_cache_hits":5,"model":["128",1]},"class_type":"ApplyFBCacheOnModel","_meta":{"title":"Apply First Block Cache"}},"110":{"inputs":{"model_name":"sam_vit_b_01ec64.pth","device_mode":"AUTO"},"class_type":"SAMLoader","_meta":{"title":"SAMLoader (Impact)"}},"122":{"inputs":{"pipe":["55",0],"model":["41",0],"pos":["75",1],"neg":["43",0],"latent":["55",4],"vae":["55",5],"clip":["55",6],"image":["55",7]},"class_type":"easy pipeIn","_meta":{"title":"节点束输入"}},"125":{"inputs":{"pipe":["122",0]},"class_type":"easy pipeOut","_meta":{"title":"节点束输出"}},"127":{"inputs":{"pipe":["122",0]},"class_type":"easy pipeOut","_meta":{"title":"节点束输出"}},"128":{"inputs":{"pipe":["122",0]},"class_type":"easy pipeOut","_meta":{"title":"节点束输出"}},"130":{"inputs":{"model_name":"修复模型"},"class_type":"UltralyticsDetectorProvider","_meta":{"title":"检测加载器"}},"132":{"inputs":{"lora_01":"lora1","strength_01":1,"lora_02":"lora2","strength_02":1.8,"lora_03":"lora3","strength_03":1,"lora_04":"lora4","strength_04":1,"model":["91",1],"clip":["55",6]},"class_type":"Lora Loader Stack (rgthree)","_meta":{"title":"LoRA堆加载器"}},"133":{"inputs":{"lora_01":"lora5","strength_01":1,"lora_02":"lora6","strength_02":1.8,"lora_03":"lora7","strength_03":1,"lora_04":"lora8","strength_04":1,"model":["132",0],"clip":["132",1]},"class_type":"Lora Loader Stack (rgthree)","_meta":{"title":"LoRA堆加载器"}}},

            "区域重绘": 
            {
                "1": {
                    "inputs": {
                        "width": "宽度",
                        "height": "高度",
                        "batch_size": 1
                    },
                    "class_type": "EmptyLatentImage",
                    "_meta": {
                        "title": "分辨率设置"
                    }
                },
                "2": {
                    "inputs": {
                        "image": "底图"
                    },
                    "class_type": "ETN_LoadImageBase64",
                    "_meta": {
                        "title": "原图"
                    }
                },
                "3": {
                    "inputs": {
                        "image": "重绘"
                    },
                    "class_type": "ETN_LoadImageBase64",
                    "_meta": {
                        "title": "重绘"
                    }
                },
                "4": {
                    "inputs": {
                        "positive": "正向提示词",
                        "negative": "反向提示词",
                        "打开可视化PromptUI": ""
                    },
                    "class_type": "WeiLinPromptToString",
                    "_meta": {
                        "title": "提示词与Lora"
                    }
                },
                "5": {
                    "inputs": {
                        "seed": 980341561222644
                    },
                    "class_type": "easy seed",
                    "_meta": {
                        "title": "随机种"
                    }
                },
                "6": {
                    "inputs": {
                        "model": [
                            "7",
                            0
                        ],
                        "clip": [
                            "7",
                            1
                        ],
                        "vae": [
                            "7",
                            2
                        ],
                        "latent": [
                            "1",
                            0
                        ],
                        "images": [
                            "2",
                            0
                        ]
                    },
                    "class_type": "Context (rgthree)",
                    "_meta": {
                        "title": "Context (rgthree)"
                    }
                },
                "7": {
                    "inputs": {
                        "ckpt_name": "主模型"
                    },
                    "class_type": "CheckpointLoaderSimpleMira",
                    "_meta": {
                        "title": "底模加载器"
                    }
                },
                "8": {
                    "inputs": {
                        "model_name": "RealESRGAN_x4plus_anime_6B.pth"
                    },
                    "class_type": "UpscaleModelLoader",
                    "_meta": {
                        "title": "加载放大模型"
                    }
                },
                "9": {
                    "inputs": {
                        "object_to_patch": "diffusion_model",
                        "residual_diff_threshold": 0.2,
                        "start": 0,
                        "end": 1,
                        "max_consecutive_cache_hits": -1,
                        "model": [
                            "6",
                            1
                        ]
                    },
                    "class_type": "ApplyFBCacheOnModel",
                    "_meta": {
                        "title": "Apply First Block Cache"
                    }
                },
                "10": {
                    "inputs": {
                        "boolean": false,
                        "on_true": [
                            "9",
                            0
                        ],
                        "on_false": [
                            "6",
                            1
                        ]
                    },
                    "class_type": "easy ifElse",
                    "_meta": {
                        "title": "是否判断"
                    }
                },
                "11": {
                    "inputs": {
                        "strength": 1,
                        "model": [
                            "10",
                            0
                        ]
                    },
                    "class_type": "DifferentialDiffusion",
                    "_meta": {
                        "title": "差异扩散DifferentialDiffusion"
                    }
                },
                "14": {
                    "inputs": {
                        "filename_prefix": "ComfyUI",
                        "images": [
                            "13:2619",
                            0
                        ]
                    },
                    "class_type": "SaveImage",
                    "_meta": {
                        "title": "保存图像"
                    }
                },
                "18": {
                    "inputs": {
                        "value": 0.5,
                        "mask": [
                            "3",
                            1
                        ]
                    },
                    "class_type": "ThresholdMask",
                    "_meta": {
                        "title": "遮罩阈值"
                    }
                },
                "23": {
                    "inputs": {
                        "image": [
                            "2",
                            0
                        ]
                    },
                    "class_type": "AILab_ImagePreview",
                    "_meta": {
                        "title": "图像预览 (RMBG) 🖼️"
                    }
                },
                "24": {
                    "inputs": {
                        "image": [
                            "3",
                            0
                        ]
                    },
                    "class_type": "AILab_ImagePreview",
                    "_meta": {
                        "title": "图像预览 (RMBG) 🖼️"
                    }
                },
                "25": {
                    "inputs": {
                        "channel": "red",
                        "image": [
                            "24",
                            0
                        ]
                    },
                    "class_type": "ImageToMask",
                    "_meta": {
                        "title": "图像转换为遮罩"
                    }
                },
                "13:2607": {
                    "inputs": {
                        "stitcher": [
                            "13:2585",
                            0
                        ],
                        "inpainted_image": [
                            "13:2660",
                            0
                        ]
                    },
                    "class_type": "InpaintStitchImproved",
                    "_meta": {
                        "title": "✂️ Inpaint Stitch (Improved)"
                    }
                },
                "13:2650": {
                    "inputs": {
                        "width": 64,
                        "height": 64,
                        "batch_size": 1,
                        "color": 0
                    },
                    "class_type": "EmptyImage",
                    "_meta": {
                        "title": "空图像"
                    }
                },
                "13:2648": {
                    "inputs": {
                        "boolean": [
                            "11",
                            0
                        ],
                        "on_true": [
                            "13:2660",
                            0
                        ],
                        "on_false": [
                            "13:2585",
                            1
                        ]
                    },
                    "class_type": "easy ifElse",
                    "_meta": {
                        "title": "是否启用（部位图像 - 后）"
                    }
                },
                "13:2649": {
                    "inputs": {
                        "boolean": "1",
                        "on_true": [
                            "13:2585",
                            1
                        ],
                        "on_false": [
                            "13:2650",
                            0
                        ]
                    },
                    "class_type": "easy ifElse",
                    "_meta": {
                        "title": "是否启用（部位图像 - 前）"
                    }
                },
                "13:2643": {
                    "inputs": {
                        "value": 1.2
                    },
                    "class_type": "easy float",
                    "_meta": {
                        "title": "放大倍数"
                    }
                },
                "13:2660": {
                    "inputs": {
                        "image": [
                            "13:2669",
                            0
                        ]
                    },
                    "class_type": "ImagePass",
                    "_meta": {
                        "title": "ImagePass"
                    }
                },
                "13:2637": {
                    "inputs": {
                        "mask": [
                            "13:2585",
                            2
                        ]
                    },
                    "class_type": "MaskToImage",
                    "_meta": {
                        "title": "遮罩转换为图像"
                    }
                },
                "13:2636": {
                    "inputs": {
                        "upscale_method": "lanczos",
                        "scale_by": [
                            "13:2643",
                            0
                        ],
                        "image": [
                            "13:2637",
                            0
                        ]
                    },
                    "class_type": "ImageScaleBy",
                    "_meta": {
                        "title": "缩放图像（比例）"
                    }
                },
                "13:2638": {
                    "inputs": {
                        "channel": "red",
                        "image": [
                            "13:2636",
                            0
                        ]
                    },
                    "class_type": "ImageToMask",
                    "_meta": {
                        "title": "图像转换为遮罩"
                    }
                },
                "13:2654": {
                    "inputs": {
                        "resize_scale": [
                            "13:2643",
                            0
                        ],
                        "resize_method": "lanczos",
                        "upscale_model": [
                            "8",
                            0
                        ],
                        "image": [
                            "13:2649",
                            0
                        ]
                    },
                    "class_type": "UpscaleImageByModelThenResize",
                    "_meta": {
                        "title": "Upscale Image By Model Then Resize"
                    }
                },
                "13:2585": {
                    "inputs": {
                        "downscale_algorithm": "bilinear",
                        "upscale_algorithm": "bicubic",
                        "preresize": false,
                        "preresize_mode": "ensure minimum resolution",
                        "preresize_min_width": 1024,
                        "preresize_min_height": 1024,
                        "preresize_max_width": 16384,
                        "preresize_max_height": 16384,
                        "mask_fill_holes": true,
                        "mask_expand_pixels": 0,
                        "mask_invert": false,
                        "mask_blend_pixels": 32,
                        "mask_hipass_filter": 0.1,
                        "extend_for_outpainting": false,
                        "extend_up_factor": 1,
                        "extend_down_factor": 1,
                        "extend_left_factor": 1,
                        "extend_right_factor": 1,
                        "context_from_mask_extend_factor": 2.0000000000000004,
                        "output_resize_to_target_size": true,
                        "output_target_width": 1024,
                        "output_target_height": 1024,
                        "output_padding": "32",
                        "image": [
                            "23",
                            0
                        ],
                        "mask": [
                            "25",
                            0
                        ]
                    },
                    "class_type": "InpaintCropImproved",
                    "_meta": {
                        "title": "✂️ Inpaint Crop (Improved)"
                    }
                },
                "13:2664": {
                    "inputs": {
                        "text": [
                            "4",
                            1
                        ],
                        "clip": [
                            "6",
                            2
                        ]
                    },
                    "class_type": "CLIPTextEncode",
                    "_meta": {
                        "title": "CLIP文本编码"
                    }
                },
                "13:2663": {
                    "inputs": {
                        "text": [
                            "4",
                            0
                        ],
                        "clip": [
                            "6",
                            2
                        ]
                    },
                    "class_type": "CLIPTextEncode",
                    "_meta": {
                        "title": "CLIP文本编码"
                    }
                },
                "13:2657": {
                    "inputs": {
                        "noise_mask": true,
                        "positive": [
                            "13:2663",
                            0
                        ],
                        "negative": [
                            "13:2664",
                            0
                        ],
                        "vae": [
                            "6",
                            3
                        ],
                        "pixels": [
                            "13:2654",
                            0
                        ],
                        "mask": [
                            "13:2638",
                            0
                        ]
                    },
                    "class_type": "InpaintModelConditioning",
                    "_meta": {
                        "title": "内补模型条件"
                    }
                },
                "13:2619": {
                    "inputs": {
                        "boolean": "1",
                        "on_true": [
                            "13:2607",
                            0
                        ],
                        "on_false": [
                            "23",
                            0
                        ]
                    },
                    "class_type": "easy ifElse",
                    "_meta": {
                        "title": "是否启用（最终图像）"
                    }
                },
                "13:2658": {
                    "inputs": {
                        "seed": [
                            "5",
                            0
                        ],
                        "steps": "步数",
                        "cfg": 5,
                        "sampler_name": "res_multistep",
                        "scheduler": "kl_optimal",
                        "denoise": 0.9,
                        "model": [
                            "11",
                            0
                        ],
                        "positive": [
                            "13:2657",
                            0
                        ],
                        "negative": [
                            "13:2657",
                            1
                        ],
                        "latent_image": [
                            "13:2657",
                            2
                        ]
                    },
                    "class_type": "KSampler",
                    "_meta": {
                        "title": "K采样器"
                    }
                },
                "13:2669": {
                    "inputs": {
                        "tile_size": 1024,
                        "overlap": 64,
                        "temporal_size": 64,
                        "temporal_overlap": 8,
                        "samples": [
                            "13:2658",
                            0
                        ],
                        "vae": [
                            "6",
                            3
                        ]
                    },
                    "class_type": "VAEDecodeTiled",
                    "_meta": {
                        "title": "VAE解码（分块）"
                    }
                }
            },
        
        };
    }
}
