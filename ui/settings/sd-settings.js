'use strict';

import { getRequestHeaders } from '../../../../../../script.js';

/**
 * Stable Diffusion 设置面板
 * 修复了 ControlNet 参数类型错误 (Control Mode / Resize Mode)
 * 并增加了完整的 ControlNet 配置支持
 */
export class SDSettings {
    constructor(context) {
        this.ctx = context;
        this.containerEl = null;
        this.apiPresets = []; // 保存所有API预设
        this.activeApiPreset = ''; // 当前选中的API预设名
        // 默认设置
        this.defaultSettings = {
            apiPresets: [], // API 预设列表
            activeApiPreset: '', // 当前激活的 API 预设名
            url: 'http://127.0.0.1:7860',
            auth: '', // 增加鉴权字段
            apiMode: 'original', // 'direct' 或 'original'
            model: '',
            sampler: 'Euler a',
            scheduler: 'automatic',
            steps: 20,
            cfgScale: 7,
            width: 832,
            height: 1216,
            seed: -1,
            restoreFaces: false,
            loraWeight: 1,

            // 高清修复相关
            enableHr: false,
            hrScale: 2,
            hrUpscaler: 'Latent',
            hrDenoisingStrength: 0.5,
            hrSecondPassSteps: 15,

            // ADetailer 相关
            adetailerEnabled: false,
            adModel: 'face_yolov8n.pt',
            adDenoisingStrength: 0.4,
            adMaskBlur: 4,
            adInpaintPadding: 32,

            // ControlNet 相关
            controlNetEnabled: false,
            controlNetUnits: [],
        };

        // 缓存的选项列表
        this.loadedOptions = {
            models: [],
            samplers: [],
            schedulers: [],
            upscalers: [],
            loras: [],
            cnModels: [],   // ControlNet 模型列表
            cnModules: [],  // ControlNet 预处理器列表
        };
    }

    /**
     * 获取当前设置（合并默认值）
     */
    _getSettings() {
        try {
            const imageGen = this.ctx?.getModule?.('imageGen');
            const sd = imageGen?.settings?.sd || {};
            // [修改] 直接返回合并后的对象，默认值已包含 presets
            return { ...this.defaultSettings, ...sd };
        } catch (e) {
            return this.defaultSettings;
        }
    }

    /**
     * 渲染设置面板 HTML
     */
    render() {
        const s = this._getSettings();

        return `
        <div class="tsp-settings-pane-inner">
            <!-- API & 模型设置区域 -->
            <div class="tsp-settings-group">
                <h4 class="tsp-settings-group-title">
                    <i class="fa-solid fa-server"></i> API & 模型
                </h4>
                <div class="tsp-settings-group" style="padding: 12px; background: var(--tsp-bg-tertiary); border-radius:8px; margin-bottom:15px;">
                    <h5 style="margin-top:0; font-size:0.9em; color:var(--tsp-text-secondary);">API 预设管理</h5>
                    <div class="tsp-form-row">
                        <div class="tsp-form-group" style="flex:2;">
                            <label>选择预设</label>
                            <select class="tsp-input" id="sd-api-preset-select">
                                <option value="">-- 新建预设 --</option>
                            </select>
                        </div>
                        <div class="tsp-btn-group" style="flex:1; align-self: flex-end; justify-content: flex-end;">
                            <button type="button" class="tsp-btn" id="sd-api-preset-save" title="将当前配置另存为新预设">
                                <i class="fa-solid fa-save"></i> 保存
                            </button>
                            <button type="button" class="tsp-btn tsp-btn-danger" id="sd-api-preset-delete" title="删除当前预设">
                                <i class="fa-solid fa-trash"></i> 删除
                            </button>
                        </div>
                    </div>
                </div>
                <div class="tsp-form-group">
                    <label>SD WebUI API 地址</label>
                    <div class="tsp-input-group">
                        <input type="text" class="tsp-input" id="sd-url"
                               value="${s.url}"
                               placeholder="http://127.0.0.1:7860">
                        <button class="tsp-btn tsp-btn-primary" id="sd-refresh-btn">
                            <i class="fa-solid fa-sync"></i> 刷新数据
                        </button>
                    </div>

                    <div class="tsp-form-group" style="margin-top: 10px;">
                        <label>API 鉴权 (可选)</label>
                        <input type="password" class="tsp-input" id="sd-auth"
                               value="${s.auth || ''}"
                               placeholder="username:password">
                    </div>

                    <div class="tsp-form-group" style="margin-top: 10px;">
                        <label>请求方式</label>
                        <select class="tsp-input" id="sd-api-mode">
                            <option value="direct" ${s.apiMode === 'direct' ? 'selected' : ''}>跨域直连 (Direct/CORS)</option>
                            <option value="original" ${s.apiMode === 'original' ? 'selected' : ''}>原生代理 (SillyTavern Proxy)</option>
                        </select>
                        <p class="tsp-text-muted" style="margin-top: 5px; font-size: 0.85em;">
                            <i class="fa-solid fa-info-circle"></i> 跨域模式需要 WebUI 启动参数 <code>--api --cors-allow-origins "*"</code>。<br>
                            原生模式使用酒馆后端转发，无需配置跨域，但不支持部分扩展功能。
                        </p>
                    </div>
                </div>

                <div class="tsp-form-row">
                    <div class="tsp-form-group">
                        <label>SD 模型 (Checkpoint)</label>
                        <select class="tsp-input" id="sd-model">
                            <option value="${s.model}">${s.model || '-- 点击刷新加载 --'}</option>
                        </select>
                    </div>
                    <div class="tsp-form-group">
                        <label>采样方式 (Sampler)</label>
                        <select class="tsp-input" id="sd-sampler">
                            <option value="${s.sampler}">${s.sampler}</option>
                        </select>
                    </div>
                </div>

                <div class="tsp-form-row">
                    <div class="tsp-form-group">
                        <label>调度器 (Scheduler)</label>
                        <select class="tsp-input" id="sd-scheduler">
                            <option value="${s.scheduler}">${s.scheduler}</option>
                        </select>
                    </div>
                    <div class="tsp-form-group">
                        <label>LoRA 模型</label>
                        <select class="tsp-input" id="sd-lora">
                            <option value="">-- 点击刷新加载 --</option>
                        </select>
                    </div>
                </div>

                <div class="tsp-form-group">
                    <label>LoRA 权重</label>
                    <div class="tsp-slider-group">
                        <input type="range" class="tsp-slider" id="sd-lora-weight"
                               min="0" max="3" step="0.05" value="${s.loraWeight}">
                        <span class="tsp-slider-value" id="sd-lora-weight-value">${Number(s.loraWeight).toFixed(2)}</span>
                        <button class="tsp-btn" id="sd-lora-insert-btn">
                            <i class="fa-solid fa-plus"></i> 填入
                        </button>
                    </div>
                </div>
            </div>

            <!-- 基础参数区域 -->
            <div class="tsp-settings-group">
                <h4 class="tsp-settings-group-title">
                    <i class="fa-solid fa-sliders"></i> 基础参数
                </h4>
                <div class="tsp-form-row">
                    <div class="tsp-form-group">
                        <label>步数 (Steps)</label>
                        <input type="number" class="tsp-input" id="sd-steps"
                               value="${s.steps}" min="1" max="150">
                    </div>
                    <div class="tsp-form-group">
                        <label>CFG Scale</label>
                        <input type="number" class="tsp-input" id="sd-cfg"
                               value="${s.cfgScale}" min="1" max="30" step="0.5">
                    </div>
                    <div class="tsp-form-group">
                        <label>种子 (Seed)</label>
                        <input type="number" class="tsp-input" id="sd-seed"
                               value="${s.seed}" placeholder="-1 为随机">
                    </div>
                </div>
                <div class="tsp-form-row">
                    <div class="tsp-form-group">
                        <label>宽度</label>
                        <input type="number" class="tsp-input" id="sd-width"
                               value="${s.width}" min="64" step="64">
                    </div>
                    <div class="tsp-form-group">
                        <label>高度</label>
                        <input type="number" class="tsp-input" id="sd-height"
                               value="${s.height}" min="64" step="64">
                    </div>
                    <div class="tsp-form-group" style="display: flex; align-items: center; padding-top: 25px;">
                        <label class="tsp-switch-label">
                            <input type="checkbox" class="tsp-switch" id="sd-restore-faces" ${s.restoreFaces ? 'checked' : ''}>
                            <span class="tsp-switch-slider"></span>
                            <span>面部修复</span>
                        </label>
                    </div>
                </div>
            </div>

            <!-- 高清修复区域 -->
            <div class="tsp-settings-group">
                <h4 class="tsp-settings-group-title">
                    <i class="fa-solid fa-expand"></i> 高分辨率修复 (Hires. fix)
                </h4>
                <div class="tsp-form-group">
                    <label class="tsp-switch-label">
                        <input type="checkbox" class="tsp-switch" id="sd-enable-hr" ${s.enableHr ? 'checked' : ''}>
                        <span class="tsp-switch-slider"></span>
                        <span>启用 Hires. fix</span>
                    </label>
                </div>
                <div class="tsp-form-row sd-hr-options" style="${s.enableHr ? '' : 'opacity: 0.5; pointer-events: none;'}">
                    <div class="tsp-form-group">
                        <label>放大算法 (Upscaler)</label>
                        <select class="tsp-input" id="sd-hr-upscaler">
                            <option value="${s.hrUpscaler}">${s.hrUpscaler}</option>
                        </select>
                    </div>
                    <div class="tsp-form-group">
                        <label>放大倍率 (Scale)</label>
                        <input type="number" class="tsp-input" id="sd-hr-scale"
                               value="${s.hrScale}" min="1" max="4" step="0.1">
                    </div>
                </div>
                <div class="tsp-form-row sd-hr-options" style="${s.enableHr ? '' : 'opacity: 0.5; pointer-events: none;'}">
                    <div class="tsp-form-group">
                        <label>重绘幅度 (Denoising)</label>
                        <input type="number" class="tsp-input" id="sd-hr-denoising"
                               value="${s.hrDenoisingStrength}" min="0" max="1" step="0.05">
                    </div>
                    <div class="tsp-form-group">
                        <label>Hires Steps</label>
                        <input type="number" class="tsp-input" id="sd-hr-steps"
                               value="${s.hrSecondPassSteps}" min="0" max="150">
                    </div>
                </div>
            </div>

            <!-- ADetailer 区域 -->
            <div class="tsp-settings-group">
                <h4 class="tsp-settings-group-title">
                    <i class="fa-solid fa-face-smile"></i> ADetailer (面部修复)
                </h4>
                <div class="tsp-form-group">
                    <label class="tsp-switch-label">
                        <input type="checkbox" class="tsp-switch" id="sd-adetailer-enabled" ${s.adetailerEnabled ? 'checked' : ''}>
                        <span class="tsp-switch-slider"></span>
                        <span>启用 ADetailer</span>
                    </label>
                </div>
                <div class="sd-adetailer-options" style="${s.adetailerEnabled ? '' : 'opacity: 0.5; pointer-events: none;'}">
                    <div class="tsp-form-group">
                        <label>ADetailer 模型</label>
                        <select class="tsp-input" id="sd-ad-model">
                            <option value="face_yolov8n.pt" ${s.adModel === 'face_yolov8n.pt' ? 'selected' : ''}>face_yolov8n.pt</option>
                            <option value="face_yolov8s.pt" ${s.adModel === 'face_yolov8s.pt' ? 'selected' : ''}>face_yolov8s.pt</option>
                            <option value="face_yolov8m.pt" ${s.adModel === 'face_yolov8m.pt' ? 'selected' : ''}>face_yolov8m.pt</option>
                            <option value="hand_yolov8n.pt" ${s.adModel === 'hand_yolov8n.pt' ? 'selected' : ''}>hand_yolov8n.pt</option>
                        </select>
                    </div>
                    <div class="tsp-form-row">
                        <div class="tsp-form-group">
                            <label>去噪强度</label>
                            <input type="number" class="tsp-input" id="sd-ad-denoising"
                                   value="${s.adDenoisingStrength}" min="0" max="1" step="0.1">
                        </div>
                        <div class="tsp-form-group">
                            <label>蒙版模糊</label>
                            <input type="number" class="tsp-input" id="sd-ad-mask-blur"
                                   value="${s.adMaskBlur}" min="0" max="100">
                        </div>
                        <div class="tsp-form-group">
                            <label>修复填充</label>
                            <input type="number" class="tsp-input" id="sd-ad-inpaint-padding"
                                   value="${s.adInpaintPadding}" min="0" max="256">
                        </div>
                    </div>
                </div>
            </div>

            <!-- ControlNet 区域 -->
            <div class="tsp-settings-group">
                <h4 class="tsp-settings-group-title">
                    <i class="fa-solid fa-diagram-project"></i> ControlNet
                </h4>
                <div class="tsp-form-row" style="align-items: center;">
                    <div class="tsp-form-group" style="flex: 1;">
                        <label class="tsp-switch-label">
                            <input type="checkbox" class="tsp-switch" id="sd-controlnet-enabled" ${s.controlNetEnabled ? 'checked' : ''}>
                            <span class="tsp-switch-slider"></span>
                            <span>启用 ControlNet</span>
                        </label>
                    </div>
                    <button class="tsp-btn tsp-btn-primary" id="sd-controlnet-config-btn">
                        <i class="fa-solid fa-cogs"></i> 配置 ControlNet 单元
                    </button>
                </div>
                <div id="sd-controlnet-units-preview" class="tsp-cn-preview">
                    ${this._renderControlNetPreview(s.controlNetUnits || [])}
                </div>
            </div>
        </div>
        `;
    }

    /**
     * 渲染 ControlNet 预览区域（显示已配置的单元）
     */
    _renderControlNetPreview(units) {
        const activeUnits = (units || []).filter(u => u && u.enabled);
        if (activeUnits.length === 0) {
            return '<p class="tsp-text-muted">未配置 ControlNet 单元</p>';
        }
        return activeUnits.map((u, i) => `
            <div class="tsp-cn-unit-preview" style="display: flex; align-items: center; gap: 10px; margin-bottom: 5px;">
                <span class="tsp-cn-unit-badge">Unit ${i}</span>
                ${u.image
                    ? `<img src="${u.image}" style="width: 30px; height: 30px; object-fit: cover; border-radius: 4px; border: 1px solid var(--tsp-border);">`
                    : '<span style="width: 30px; height: 30px; display: inline-block; background: rgba(255,255,255,0.1); border-radius: 4px; text-align:center; line-height:30px;"><i class="fa-solid fa-image"></i></span>'
                }
                <span>${u.module || 'none'}</span>
                <span class="tsp-text-muted" style="margin-left: auto;">Model: ${u.model || 'None'}</span>
            </div>
        `).join('');
    }

    /**
     * 绑定 DOM 事件
     */
    bindEvents(containerEl) {
        this.containerEl = containerEl;
        this._renderApiPresetDropdown();
        this._applyActivePresetToUI();

        containerEl.querySelector('#sd-api-preset-select')?.addEventListener('change', (e) => {
            this.activeApiPreset = e.target.value;
            this._applyActivePresetToUI();
        });

        containerEl.querySelector('#sd-api-preset-save')?.addEventListener('click', () => this._saveApiPreset());
        containerEl.querySelector('#sd-api-preset-delete')?.addEventListener('click', () => this._deleteApiPreset());
        // 刷新按钮
        containerEl.querySelector('#sd-refresh-btn')?.addEventListener('click', () => {
            this.refreshOptions();
        });

        // LoRA 权重滑块实时显示
        const loraSlider = containerEl.querySelector('#sd-lora-weight');
        const loraValue = containerEl.querySelector('#sd-lora-weight-value');
        if (loraSlider && loraValue) {
            loraSlider.addEventListener('input', () => {
                loraValue.textContent = parseFloat(loraSlider.value).toFixed(2);
            });
        }

        // LoRA 填入按钮
        containerEl.querySelector('#sd-lora-insert-btn')?.addEventListener('click', () => {
            this._insertLora();
        });

        // 高清修复开关联动
        const hrSwitch = containerEl.querySelector('#sd-enable-hr');
        if (hrSwitch) {
            hrSwitch.addEventListener('change', () => {
                containerEl.querySelectorAll('.sd-hr-options').forEach(el => {
                    el.style.cssText = hrSwitch.checked ? '' : 'opacity: 0.5; pointer-events: none;';
                });
            });
        }

        // ADetailer 开关联动
        const adSwitch = containerEl.querySelector('#sd-adetailer-enabled');
        if (adSwitch) {
            adSwitch.addEventListener('change', () => {
                const opts = containerEl.querySelector('.sd-adetailer-options');
                if (opts) {
                    opts.style.cssText = adSwitch.checked ? '' : 'opacity: 0.5; pointer-events: none;';
                }
            });
        }

        // 打开 ControlNet 模态框
        containerEl.querySelector('#sd-controlnet-config-btn')?.addEventListener('click', () => {
            this.openControlNetModal();
        });
    }

    /**
     * 刷新 SD 选项列表 (模型、采样器、ControlNet 等)
     */
    async refreshOptions() {
        const urlInput = this.containerEl?.querySelector('#sd-url');
        const authInput = this.containerEl?.querySelector('#sd-auth');
        const apiModeSelect = this.containerEl?.querySelector('#sd-api-mode');

        // 处理 URL 尾部斜杠
        const sdUrl = urlInput?.value?.replace(/\/+$/, '') || 'http://127.0.0.1:7860';
        const sdAuth = authInput?.value || '';
        const apiMode = apiModeSelect?.value || 'original'; // 获取当前选择的 API 模式

        this.ctx?.helpers?.showToast?.('正在刷新 SD 数据...', 'info');

        try {
            /**
             * 通用请求函数，处理代理和直连逻辑
             * @param {string} type - 资源类型 (models, samplers, etc.)
             * @param {string} [directEndpoint] - 直连时的特定端点 (可选，默认 sdapi/v1/...)
             */
            const doFetch = async (type, directEndpoint = null) => {
                if (apiMode === 'original') {
                    // === 原生模式 (SillyTavern Proxy) ===
                    let proxyUrl = `/api/sd/${type}`;

                    // 修正原生代理下的 ControlNet 路径映射
                    if (type === 'cn_models') proxyUrl = '/api/sd/controlnet/model_list';
                    if (type === 'cn_modules') proxyUrl = '/api/sd/controlnet/module_list';

                    return fetch(proxyUrl, {
                        method: 'POST',
                        headers: getRequestHeaders(),
                        body: JSON.stringify({ url: sdUrl, auth: sdAuth })
                    }).then(res => {
                        if (!res.ok) throw new Error(`Proxy ${type} failed: ${res.status}`);
                        return res.json();
                    });
                } else {
                    // === 跨域直连模式 (Direct/CORS) ===
                    let endpoint = directEndpoint;
                    if (!endpoint) {
                        endpoint = `sdapi/v1/${type}`;
                        // 特殊映射
                        if (type === 'models') endpoint = 'sdapi/v1/sd-models';
                        if (type === 'cn_models') endpoint = 'controlnet/model_list';
                        if (type === 'cn_modules') endpoint = 'controlnet/module_list';
                    }

                    const headers = {};
                    if (sdAuth) {
                        headers['Authorization'] = 'Basic ' + btoa(sdAuth);
                    }

                    return fetch(`${sdUrl}/${endpoint}`, {
                        method: 'GET',
                        headers: headers
                    }).then(res => {
                        if (!res.ok) throw new Error(`Direct ${type} failed: ${res.status}`);
                        return res.json();
                    });
                }
            };

            // 并发请求所有数据
            const results = await Promise.allSettled([
                doFetch('models'),
                doFetch('samplers'),
                doFetch('schedulers'),
                doFetch('upscalers'),
                doFetch('loras'),
                doFetch('cn_models'), // ControlNet 模型
                doFetch('cn_modules') // ControlNet 预处理器
            ]);

            const [modelsRes, samplersRes, schedulersRes, upscalersRes, lorasRes, cnModelsRes, cnModulesRes] = results;

            // 1. SD 主模型
            if (modelsRes.status === 'fulfilled') {
                this.loadedOptions.models = modelsRes.value || [];
                this._populateSelect('#sd-model', this.loadedOptions.models, 'title');
            } else {
                console.error('Fetch models failed:', modelsRes.reason);
            }

            // 2. 采样器
            if (samplersRes.status === 'fulfilled') {
                this.loadedOptions.samplers = samplersRes.value || [];
                this._populateSelect('#sd-sampler', this.loadedOptions.samplers, 'name');
            }

            // 3. 调度器
            if (schedulersRes.status === 'fulfilled') {
                this.loadedOptions.schedulers = schedulersRes.value || [];
                this._populateSelect('#sd-scheduler', this.loadedOptions.schedulers, 'name');
            }

            // 4. 放大算法
            if (upscalersRes.status === 'fulfilled') {
                this.loadedOptions.upscalers = upscalersRes.value || [];
                this._populateSelect('#sd-hr-upscaler', this.loadedOptions.upscalers, 'name');
            }

            // 5. LoRA
            if (lorasRes.status === 'fulfilled') {
                this.loadedOptions.loras = lorasRes.value || [];
                // LoRA 列表增加一个 "None" 和别名
                const formattedLoras = [{ name: 'None' }, ...this.loadedOptions.loras];
                this._populateSelect('#sd-lora', formattedLoras, 'name');
            }

            // 6. ControlNet 模型
            if (cnModelsRes.status === 'fulfilled') {
                const data = cnModelsRes.value;
                this.loadedOptions.cnModels = Array.isArray(data.model_list) ? data.model_list : [];
                console.log('CN Models loaded:', this.loadedOptions.cnModels.length);
            } else {
                console.warn('Fetch CN Models failed (Check if ControlNet installed):', cnModelsRes.reason);
            }

            // 7. ControlNet 预处理器
            if (cnModulesRes.status === 'fulfilled') {
                const data = cnModulesRes.value;
                this.loadedOptions.cnModules = Array.isArray(data.module_list) ? data.module_list : [];
                console.log('CN Modules loaded:', this.loadedOptions.cnModules.length);
            } else {
                console.warn('Fetch CN Modules failed:', cnModulesRes.reason);
            }

            // 恢复之前选中的值
            this._restoreCurrentValues();

            this.ctx?.helpers?.showToast?.('SD 数据刷新成功', 'success');

        } catch (error) {
            console.error('SD Refresh Error:', error);
            this.ctx?.helpers?.showToast?.(`刷新失败: ${error.message}`, 'error');
        }
    }

    /**
     * 打开 ControlNet 配置模态框 (包含核心修复)
     */
    async openControlNetModal() {
        const s = this._getSettings();
        // 【新增】获取当前设置的目标分辨率
        const targetW = parseInt(s.width) || 512;
        const targetH = parseInt(s.height) || 512;
        // 深拷贝现有配置，避免直接修改
        let tempUnits = JSON.parse(JSON.stringify(s.controlNetUnits || []));

        // 确保至少显示 3 个单元
        while (tempUnits.length < 3) {
            tempUnits.push({
                enabled: false,
                image: null,
                module: 'none',
                model: 'None',
                weight: 1.0,
                // 【修复】默认值使用正确的字符串枚举
                resize_mode: 'Just Resize',
                control_mode: 'Balanced',
                pixel_perfect: false,
                lowvram: false,
                processor_res: 512,
                threshold_a: 64,
                threshold_b: 64,
                guidance_start: 0,
                guidance_end: 1,
            });
        }
        // 【新增】打开模态框前，强制将所有已存在的图片调整为当前生成尺寸
        if (tempUnits.some(u => u.image)) {
            this.ctx?.helpers?.showToast?.(`正在将 ControlNet 图片适配为 ${targetW}x${targetH}...`, 'info');
            // 并发处理所有图片
            await Promise.all(tempUnits.map(async (unit) => {
                if (unit.image) {
                    unit.image = await this._resizeImageToTarget(unit.image, targetW, targetH);
                }
            }));
        }
        // 构建模态框 HTML
        const modalHtml = `
        <div class="tsp-modal-overlay visible" id="tsp-cn-modal" style="z-index: 10006;">
            <div class="tsp-modal tsp-modal-large" style="max-width: 800px;">
                <div class="tsp-modal-header">
                    <div class="tsp-modal-title">
                        <i class="fa-solid fa-diagram-project"></i> ControlNet 配置
                    </div>
                    <button class="tsp-btn tsp-btn-icon" id="tsp-cn-modal-close"><i class="fa-solid fa-times"></i></button>
                </div>
                <div class="tsp-modal-body" style="max-height: 70vh; overflow-y: auto; padding: 20px;">
                    <div id="tsp-cn-units-container">
                        ${tempUnits.map((unit, i) => this._renderControlNetUnit(unit, i)).join('')}
                    </div>
                </div>
                <div class="tsp-modal-footer">
                    <button class="tsp-btn tsp-btn-primary" id="tsp-cn-modal-save"><i class="fa-solid fa-save"></i> 保存配置</button>
                    <button class="tsp-btn" id="tsp-cn-modal-cancel">取消</button>
                </div>
            </div>
        </div>
        `;

        // 插入 DOM
        const modalEl = document.createElement('div');
        modalEl.innerHTML = modalHtml;
        document.body.appendChild(modalEl.firstElementChild);

        const modal = document.getElementById('tsp-cn-modal');
        const container = modal.querySelector('#tsp-cn-units-container');

        // ========== 1. 填充所有单元的下拉列表 ==========

        const cnModels = this.loadedOptions.cnModels && this.loadedOptions.cnModels.length > 0
            ? ['None', ...this.loadedOptions.cnModels]
            : ['None'];

        const defaultModules = ['none', 'canny', 'depth', 'openpose', 'lineart', 'softedge', 'scribble'];
        const cnModules = this.loadedOptions.cnModules && this.loadedOptions.cnModules.length > 0
            ? ['none', ...this.loadedOptions.cnModules]
            : defaultModules;

        // 遍历所有单元并填充
        tempUnits.forEach((unit, index) => {
            const unitEl = container.querySelector(`.tsp-cn-unit[data-index="${index}"]`);
            if (unitEl) {
                const modelSelect = unitEl.querySelector(`#cn-model-${index}`);
                const moduleSelect = unitEl.querySelector(`#cn-module-${index}`);

                // 填充模型
                if (modelSelect) {
                    modelSelect.innerHTML = '';
                    cnModels.forEach(m => modelSelect.add(new Option(m, m)));
                    modelSelect.value = unit.model || 'None';
                }

                // 填充预处理器
                if (moduleSelect) {
                    moduleSelect.innerHTML = '';
                    cnModules.forEach(m => moduleSelect.add(new Option(m, m)));
                    moduleSelect.value = unit.module || 'none';
                }
            }
        });

        // ========== 2. 绑定事件 ==========

        // 图像上传处理
        container.addEventListener('change', (e) => {
            if (e.target.classList.contains('cn-image-input')) {
                const file = e.target.files[0];
                const index = parseInt(e.target.dataset.index);
                if (file) {
                    const reader = new FileReader();
                    reader.onload = (ev) => {
                        // 更新临时数据
                        tempUnits[index].image = ev.target.result;
                        // 更新 UI 预览
                        const unitEl = container.querySelector(`.tsp-cn-unit[data-index="${index}"]`);
                        const imgWrapper = unitEl.querySelector('.cn-image-upload-wrapper');
                        imgWrapper.innerHTML = `
                            <img src="${ev.target.result}" style="width: 100%; height: 100%; object-fit: cover;">
                            <div class="cn-image-clear-btn" data-index="${index}" style="position: absolute; top: 2px; right: 2px; background: rgba(0,0,0,0.6); color: white; border-radius: 50%; width: 20px; height: 20px; display: flex; align-items: center; justify-content: center; font-size: 12px; z-index: 2;">✕</div>
                        `;
                    };
                    reader.readAsDataURL(file);
                }
            }
        });

        // 图像清除 & 点击上传
        container.addEventListener('change', (e) => {
            if (e.target.classList.contains('cn-image-input')) {
                const file = e.target.files[0];
                const index = parseInt(e.target.dataset.index);
                if (file) {
                    const reader = new FileReader();
                    // 这里改为 async 处理
                    reader.onload = async (ev) => {
                        const rawBase64 = ev.target.result;

                        // 【新增】上传后立即调整尺寸
                        const resizedBase64 = await this._resizeImageToTarget(rawBase64, targetW, targetH);

                        // 更新数据
                        tempUnits[index].image = resizedBase64;

                        // 更新 UI 预览
                        const unitEl = container.querySelector(`.tsp-cn-unit[data-index="${index}"]`);
                        const imgWrapper = unitEl.querySelector('.cn-image-upload-wrapper');
                        imgWrapper.innerHTML = `
                            <img src="${resizedBase64}" style="width: 100%; height: 100%; object-fit: cover;">
                            <div class="cn-image-clear-btn" data-index="${index}" style="position: absolute; top: 2px; right: 2px; background: rgba(0,0,0,0.6); color: white; border-radius: 50%; width: 20px; height: 20px; display: flex; align-items: center; justify-content: center; font-size: 12px; z-index: 2;">✕</div>
                        `;

                        // this.ctx?.helpers?.showToast?.(`图片已调整为 ${targetW}x${targetH}`, 'success');
                    };
                    reader.readAsDataURL(file);
                }
            }
        });

        // 图像清除 & 点击上传 (保持原逻辑)
        container.addEventListener('click', (e) => {
            if (e.target.closest('.cn-image-clear-btn')) {
                e.stopPropagation();
                const index = parseInt(e.target.closest('.cn-image-clear-btn').dataset.index);
                tempUnits[index].image = null;
                const unitEl = container.querySelector(`.tsp-cn-unit[data-index="${index}"]`);
                const imgWrapper = unitEl.querySelector('.cn-image-upload-wrapper');
                imgWrapper.innerHTML = `
                    <div class="cn-upload-placeholder" style="text-align: center; color: var(--tsp-text-muted); pointer-events: none;">
                        <i class="fa-solid fa-image" style="font-size: 2em; display: block; margin-bottom: 5px;"></i>
                        <span style="font-size: 0.8em;">点击上传</span>
                    </div>
                    <input type="file" id="cn-image-input-${index}" class="cn-image-input" data-index="${index}" accept="image/*" style="display: none;">
                `;
                return;
            }
            if (e.target.closest('.cn-image-upload-wrapper')) {
                const wrapper = e.target.closest('.cn-image-upload-wrapper');
                wrapper.querySelector('input[type="file"]').click();
            }
        });

        // 关闭逻辑
        const closeModal = () => {
            modal.classList.remove('visible');
            setTimeout(() => modal.remove(), 200);
        };
        modal.querySelector('#tsp-cn-modal-close').addEventListener('click', closeModal);
        modal.querySelector('#tsp-cn-modal-cancel').addEventListener('click', closeModal);
        modal.addEventListener('click', (e) => { if (e.target === modal) closeModal(); });

        // 保存逻辑 (保持参数读取逻辑)
        modal.querySelector('#tsp-cn-modal-save').addEventListener('click', async () => {
            tempUnits.forEach((unit, i) => {
                const unitEl = container.querySelector(`.tsp-cn-unit[data-index="${i}"]`);
                if (!unitEl) return;

                unit.enabled = unitEl.querySelector(`#cn-enabled-${i}`).checked;
                unit.module = unitEl.querySelector(`#cn-module-${i}`).value;
                unit.model = unitEl.querySelector(`#cn-model-${i}`).value;
                unit.weight = parseFloat(unitEl.querySelector(`#cn-weight-${i}`).value) || 1.0;
                unit.resize_mode = unitEl.querySelector(`#cn-resize-${i}`).value;
                unit.control_mode = unitEl.querySelector(`#cn-control-mode-${i}`).value;
                unit.pixel_perfect = unitEl.querySelector(`#cn-pixel-perfect-${i}`).checked;
                unit.lowvram = unitEl.querySelector(`#cn-lowvram-${i}`).checked; // 别漏了这个
                unit.processor_res = parseInt(unitEl.querySelector(`#cn-res-${i}`).value) || 512;
                unit.guidance_start = parseFloat(unitEl.querySelector(`#cn-start-${i}`).value) || 0;
                unit.guidance_end = parseFloat(unitEl.querySelector(`#cn-end-${i}`).value) || 1;

                // 读取上次我们添加的阈值参数
                const tA = unitEl.querySelector(`#cn-threshold-a-${i}`);
                const tB = unitEl.querySelector(`#cn-threshold-b-${i}`);
                if (tA) unit.threshold_a = parseFloat(tA.value) || 0;
                if (tB) unit.threshold_b = parseFloat(tB.value) || 0;
            });

            // 保存到全局设置
            this.ctx.getModule('imageGen').settings.sd.controlNetUnits = JSON.parse(JSON.stringify(tempUnits));
            await this.ctx.getModule('imageGen').saveSettings();

            // 更新父面板预览
            const preview = this.containerEl?.querySelector('#sd-controlnet-units-preview');
            if (preview) {
                preview.innerHTML = this._renderControlNetPreview(tempUnits);
            }

            this.ctx?.helpers?.showToast?.('ControlNet 配置已保存', 'success');
            closeModal();
        });
    }

    /**
     * 渲染 ControlNet 单元 HTML (用于模态框)
     * 【修复】选项值已改为具体的字符串枚举
     */
    _renderControlNetUnit(unit, index) {
        const hasImage = unit.image && unit.image.length > 10;

        return `
        <div class="tsp-cn-unit" data-index="${index}" style="border: 1px solid var(--tsp-border); padding: 15px; margin-bottom: 15px; border-radius: 8px; background: var(--tsp-bg-secondary);">
            <div class="tsp-cn-unit-header" style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
                <label class="tsp-switch-label" style="font-weight: bold;">
                    <input type="checkbox" class="tsp-switch" id="cn-enabled-${index}" ${unit.enabled ? 'checked' : ''}>
                    <span class="tsp-switch-slider"></span>
                    <span>ControlNet Unit ${index}</span>
                </label>
            </div>

            <div class="tsp-cn-unit-body" style="display: flex; gap: 20px;">
                <!-- 左侧图片区 -->
                <div class="cn-image-area" style="flex: 0 0 120px;">
                    <div class="cn-image-upload-wrapper" style="width: 120px; height: 120px; border: 2px dashed var(--tsp-border); border-radius: 8px; display: flex; align-items: center; justify-content: center; cursor: pointer; position: relative; overflow: hidden; background: var(--tsp-bg-input);">
                        ${hasImage
                            ? `<img src="${unit.image}" style="width: 100%; height: 100%; object-fit: cover;">
                               <div class="cn-image-clear-btn" data-index="${index}" style="position: absolute; top: 2px; right: 2px; background: rgba(0,0,0,0.6); color: white; border-radius: 50%; width: 20px; height: 20px; display: flex; align-items: center; justify-content: center; font-size: 12px; z-index: 2;">✕</div>`
                            : `<div class="cn-upload-placeholder" style="text-align: center; color: var(--tsp-text-muted); pointer-events: none;">
                                <i class="fa-solid fa-image" style="font-size: 2em; display: block; margin-bottom: 5px;"></i>
                                <span style="font-size: 0.8em;">点击上传</span>
                               </div>`
                        }
                        <input type="file" id="cn-image-input-${index}" class="cn-image-input" data-index="${index}" accept="image/*" style="display: none;">
                    </div>
                </div>

                <!-- 右侧参数区 -->
                <div class="cn-settings-area" style="flex: 1;">
                    <div class="tsp-form-row">
                        <div class="tsp-form-group">
                            <label>预处理器 (Preprocessor)</label>
                            <select class="tsp-input" id="cn-module-${index}"><option value="none">none</option></select>
                        </div>
                        <div class="tsp-form-group">
                            <label>模型 (Model)</label>
                            <select class="tsp-input" id="cn-model-${index}"><option value="None">None</option></select>
                        </div>
                    </div>

                    <div class="tsp-form-row">
                        <div class="tsp-form-group">
                            <label>权重 (Weight)</label>
                            <input type="number" class="tsp-input" id="cn-weight-${index}" value="${unit.weight || 1}" step="0.05">
                        </div>
                        <div class="tsp-form-group">
                            <label>分辨率 (Resolution)</label>
                            <input type="number" class="tsp-input" id="cn-res-${index}" value="${unit.processor_res || 512}" step="64">
                        </div>
                    </div>
                    <div class="tsp-form-row">
                        <div class="tsp-form-group">
                            <label>阈值 A (Threshold A)</label>
                            <input type="number" class="tsp-input" id="cn-threshold-a-${index}" value="${unit.threshold_a ?? 64}" step="0.05">
                            <small class="tsp-text-muted" style="font-size:0.7em">Canny高阈值 / Reference风格度(0.5)</small>
                        </div>
                        <div class="tsp-form-group">
                            <label>阈值 B (Threshold B)</label>
                            <input type="number" class="tsp-input" id="cn-threshold-b-${index}" value="${unit.threshold_b ?? 64}" step="0.05">
                            <small class="tsp-text-muted" style="font-size:0.7em">Canny低阈值</small>
                        </div>
                    </div>
                    <div class="tsp-form-row">
                        <div class="tsp-form-group">
                            <label>开始引导 (Start)</label>
                            <input type="number" class="tsp-input" id="cn-start-${index}" value="${unit.guidance_start || 0}" step="0.05" min="0" max="1">
                        </div>
                        <div class="tsp-form-group">
                            <label>结束引导 (End)</label>
                            <input type="number" class="tsp-input" id="cn-end-${index}" value="${unit.guidance_end || 1}" step="0.05" min="0" max="1">
                        </div>
                    </div>

                    <div class="tsp-form-row">
                        <div class="tsp-form-group">
                            <label>缩放模式</label>
                            <select class="tsp-input" id="cn-resize-${index}">
                                <option value="Just Resize" ${unit.resize_mode === 'Just Resize' || unit.resize_mode == 0 ? 'selected' : ''}>拉伸 (Just Resize)</option>
                                <option value="Crop and Resize" ${unit.resize_mode === 'Crop and Resize' || unit.resize_mode == 1 ? 'selected' : ''}>比例缩放 (Crop and Resize)</option>
                                <option value="Resize and Fill" ${unit.resize_mode === 'Resize and Fill' || unit.resize_mode == 2 ? 'selected' : ''}>填充 (Resize and Fill)</option>
                            </select>
                        </div>
                        <div class="tsp-form-group">
                            <label>控制模式</label>
                            <select class="tsp-input" id="cn-control-mode-${index}">
                                <option value="Balanced" ${unit.control_mode === 'Balanced' || unit.control_mode == 0 ? 'selected' : ''}>平衡 (Balanced)</option>
                                <option value="My prompt is more important" ${unit.control_mode === 'My prompt is more important' || unit.control_mode == 1 ? 'selected' : ''}>提示词优先 (My prompt...)</option>
                                <option value="ControlNet is more important" ${unit.control_mode === 'ControlNet is more important' || unit.control_mode == 2 ? 'selected' : ''}>CN 优先 (ControlNet...)</option>
                            </select>
                        </div>
                    </div>

                    <div class="tsp-form-group" style="margin-top: 10px;">
                        <label class="tsp-switch-label">
                            <input type="checkbox" class="tsp-switch" id="cn-pixel-perfect-${index}" ${unit.pixel_perfect ? 'checked' : ''}>
                            <span class="tsp-switch-slider"></span>
                            <span>完美像素 (Pixel Perfect)</span>
                        </label>
                        <label class="tsp-switch-label" style="margin-left: 15px;">
                            <input type="checkbox" class="tsp-switch" id="cn-lowvram-${index}" ${unit.lowvram ? 'checked' : ''}>
                            <span class="tsp-switch-slider"></span>
                            <span>低显存 (Low VRAM)</span>
                        </label>
                    </div>
                </div>
            </div>
        </div>
        `;
    }
    /**
     * 【新增】图片强制缩放工具：将图片拉伸至目标分辨率
     */
    _resizeImageToTarget(base64Str, targetW, targetH) {
        return new Promise((resolve) => {
            // 如果没有图片或尺寸无效，原样返回
            if (!base64Str || !targetW || !targetH) return resolve(base64Str);

            const img = new Image();
            img.onload = () => {
                // 如果尺寸已经完全一致，直接返回，避免重绘损失质量
                if (img.naturalWidth === targetW && img.naturalHeight === targetH) {
                    resolve(base64Str);
                    return;
                }

                const canvas = document.createElement('canvas');
                canvas.width = targetW;
                canvas.height = targetH;
                const ctx = canvas.getContext('2d');

                // 使用拉伸模式填满 (ControlNet 通常需要像素级对齐)
                ctx.imageSmoothingEnabled = true;
                ctx.imageSmoothingQuality = 'high';
                ctx.drawImage(img, 0, 0, targetW, targetH);

                resolve(canvas.toDataURL('image/png'));
            };
            img.onerror = () => {
                console.error('Resize image failed');
                resolve(base64Str);
            };
            img.src = base64Str;
        });
    }

    /**
     * 辅助函数：智能填充下拉列表
     */
    _populateSelect(selector, items, preferredKey = 'name') {
        const select = this.containerEl?.querySelector(selector);
        if (!select) return;

        select.innerHTML = '';
        items.forEach(item => {
            const option = document.createElement('option');
            let text = item;
            let value = item;

            if (typeof item === 'object' && item !== null) {
                if (item.text !== undefined) {
                    text = item.text;
                    value = item.value || item.text;
                } else if (item.title !== undefined) {
                    text = item.title;
                    value = item.title;
                } else if (item.name !== undefined) {
                    text = item.name;
                    value = item.name;
                    if (item.alias) text = `${item.name} (${item.alias})`;
                } else if (item[preferredKey] !== undefined) {
                    text = item[preferredKey];
                    value = item[preferredKey];
                } else {
                    text = JSON.stringify(item);
                    value = JSON.stringify(item);
                }
            }

            option.value = value;
            option.textContent = text;
            select.appendChild(option);
        });
    }

    /**
     * 恢复当前设置到 UI
     */
    _restoreCurrentValues() {
        const s = this._getSettings();
        const setVal = (sel, val) => {
            const el = this.containerEl?.querySelector(sel);
            if (el && val) el.value = val;
        };

        setVal('#sd-model', s.model);
        setVal('#sd-sampler', s.sampler);
        setVal('#sd-scheduler', s.scheduler);
        setVal('#sd-hr-upscaler', s.hrUpscaler);
    }

    /**
     * 插入 LoRA 到提示词构建器/剪贴板
     */
    _insertLora() {
        const loraSelect = this.containerEl?.querySelector('#sd-lora');
        const weightInput = this.containerEl?.querySelector('#sd-lora-weight');

        if (!loraSelect || !loraSelect.value) {
            this.ctx?.helpers?.showToast?.('请先选择一个 LoRA', 'warning');
            return;
        }

        const loraName = loraSelect.value;
        const weight = parseFloat(weightInput?.value || 1);
        const loraTag = `<lora:${loraName}:${weight.toFixed(2)}>`;

        navigator.clipboard.writeText(loraTag).then(() => {
            this.ctx?.helpers?.showToast?.(`已复制: ${loraTag}`, 'success');
        });

        const promptBuilder = this.ctx?.promptBuilder;
        if (promptBuilder) {
            promptBuilder.addTag('custom', loraTag);
        }
    }
    /**
     * 渲染API预设下拉框
     */
    _renderApiPresetDropdown() {
        const select = this.containerEl.querySelector('#sd-api-preset-select');
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
        const urlInput = this.containerEl.querySelector('#sd-url');
        const authInput = this.containerEl.querySelector('#sd-auth');
        const apiModeSelect = this.containerEl.querySelector('#sd-api-mode');
        const deleteBtn = this.containerEl.querySelector('#sd-api-preset-delete');

        if (preset) {
            if (urlInput) urlInput.value = preset.url || '';
            if (authInput) authInput.value = preset.auth || '';
            if (apiModeSelect) apiModeSelect.value = preset.apiMode || 'original';
            if (deleteBtn) deleteBtn.disabled = false;
        } else {
            // “新建预设”状态
            if (urlInput) urlInput.value = '';
            if (authInput) authInput.value = '';
            if (apiModeSelect) apiModeSelect.value = 'original'; // 默认值
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
            url: this.containerEl.querySelector('#sd-url')?.value.trim() || '',
            auth: this.containerEl.querySelector('#sd-auth')?.value.trim() || '',
            apiMode: this.containerEl.querySelector('#sd-api-mode')?.value || 'original',
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
        const activeApiPresetName = this.containerEl.querySelector('#sd-api-preset-select')?.value || '';
        const preset = this.apiPresets.find(p => p.name === activeApiPresetName);

        // 如果当前选中了一个预设，就用预设的值；否则用输入框的值
        const currentUrl = preset ? preset.url : (this.containerEl.querySelector('#sd-url')?.value || '');
        const currentAuth = preset ? preset.auth : (this.containerEl.querySelector('#sd-auth')?.value || '');
        const currentApiMode = preset ? preset.apiMode : (this.containerEl.querySelector('#sd-api-mode')?.value || 'original');

        return {
            url: currentUrl,
            auth: currentAuth, // [新增]
            apiMode: currentApiMode, // [新增]
            model: this.containerEl.querySelector('#sd-model')?.value || '',
            sampler: this.containerEl.querySelector('#sd-sampler')?.value || '',
            scheduler: this.containerEl.querySelector('#sd-scheduler')?.value || '',
            steps: parseInt(this.containerEl.querySelector('#sd-steps')?.value) || 20,
            cfgScale: parseFloat(this.containerEl.querySelector('#sd-cfg')?.value) || 7,
            seed: parseInt(this.containerEl.querySelector('#sd-seed')?.value) || -1,
            width: parseInt(this.containerEl.querySelector('#sd-width')?.value) || 512,
            height: parseInt(this.containerEl.querySelector('#sd-height')?.value) || 768,
            restoreFaces: this.containerEl.querySelector('#sd-restore-faces')?.checked || false,
            loraWeight: parseFloat(this.containerEl.querySelector('#sd-lora-weight')?.value) || 1,
            enableHr: this.containerEl.querySelector('#sd-enable-hr')?.checked || false,
            hrUpscaler: this.containerEl.querySelector('#sd-hr-upscaler')?.value || '',
            hrScale: parseFloat(this.containerEl.querySelector('#sd-hr-scale')?.value) || 2,
            hrDenoisingStrength: parseFloat(this.containerEl.querySelector('#sd-hr-denoising')?.value) || 0.5,
            hrSecondPassSteps: parseInt(this.containerEl.querySelector('#sd-hr-steps')?.value) || 15,
            adetailerEnabled: this.containerEl.querySelector('#sd-adetailer-enabled')?.checked || false,
            adModel: this.containerEl.querySelector('#sd-ad-model')?.value || 'face_yolov8n.pt',
            adDenoisingStrength: parseFloat(this.containerEl.querySelector('#sd-ad-denoising')?.value) || 0.4,
            adMaskBlur: parseInt(this.containerEl.querySelector('#sd-ad-mask-blur')?.value) || 4,
            adInpaintPadding: parseInt(this.containerEl.querySelector('#sd-ad-inpaint-padding')?.value) || 32,
            controlNetEnabled: this.containerEl.querySelector('#sd-controlnet-enabled')?.checked || false,
            apiPresets: this.apiPresets,
            activeApiPreset: activeApiPresetName,
        };
    }

    /**
     * Fetch JSON helper
     */
    async _fetchJson(url) {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json();
    }
}