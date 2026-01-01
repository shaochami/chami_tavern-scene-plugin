'use strict';


export class NAISettings {
    constructor(context) {
        this.ctx = context;
        this.containerEl = null;
        this.apiPresets = []; // 保存所有API预设
        this.activeApiPreset = ''; // 当前选中的API预设名
        // 默认 API 地址
        this.DEFAULT_OFFICIAL_URL = 'https://image.novelai.net/ai/generate-image';
        this.DEFAULT_PROXY_URL = '1';

        // 默认设置
        this.defaultSettings = {
            channel: 'proxy',
            proxyUrl: '', // 空时使用默认地址
            apiPresets: [], // API 预设列表
            activeApiPreset: '', // 当前激活的 API 预设名
            apiKey: '',
            proxyStream: true,
            model: 'nai-diffusion-3',
            sampler: 'k_euler_ancestral',
            noiseSchedule: 'native',
            steps: 28,
            scale: 5,
            cfgRescale: 0,
            width: 832,
            height: 1216,
            sm: true,
            dyn: false,
            variety: false,
            decrisper: false,
            multiRoleEnabled: false,
            useCoords: false,
            i2iStrength: 0.7,
            i2iNoise: 0,
            inpaintStrength: 1,
            vibeEnabled: false,
            referenceMode: 'vibe',
            directorStyleAware: false,
            directorStrength: 0.6,
            vibeImages: [],
        };

        this.vibeImages = [];
        // 当前参考模式
        this.referenceMode = 'vibe';

        // [新增] 开始
        // 参考预设管理
        this.naiPresets = []; // 保存所有预设
        this.activePresetName = ''; // 当前选中的预设名称
        // [新增] 结束
    }

    /**
     * 获取当前设置（带默认值）
     */
    _getSettings() {
        try {
            const imageGen = this.ctx?.getModule?.('imageGen');
            const nai = imageGen?.settings?.nai || {};
            // [修改] 同时加载 naiPresets 和 naiTriggersEnabled
            const presets = nai.naiPresets || [];
            const triggersEnabled = nai.naiTriggersEnabled || false;

            return { ...this.defaultSettings, ...nai, naiPresets: presets, naiTriggersEnabled: triggersEnabled };
        } catch (e) {
            console.warn('[NAISettings] 获取设置失败，使用默认值', e);
            return this.defaultSettings;
        }
    }

    /**
     * 渲染 NAI 设置面板
     */
    render() {
        const s = this._getSettings();
        // [修改] 初始化预设和触发器状态
        this.naiPresets = s.naiPresets || [];
        this.activePresetName = this.naiPresets.length > 0 ? this.naiPresets[0].name : '';
    
        this.vibeImages = s.vibeImages || [];
        this.referenceMode = s.referenceMode || 'vibe';

        // 根据渠道显示对应的默认地址（如果用户没有填写）
        const defaultUrl = s.channel === 'official' ? this.DEFAULT_OFFICIAL_URL : this.DEFAULT_PROXY_URL;
        const displayUrl = s.proxyUrl || defaultUrl;

        return `
        <div class="tsp-settings-pane-inner">
            <!-- API 设置 -->
            <div class="tsp-settings-group">
                <h4 class="tsp-settings-group-title">
                    <i class="fa-solid fa-key"></i> API 设置
                </h4>
                <div class="tsp-settings-group" style="padding: 12px; background: var(--tsp-bg-tertiary); border-radius:8px; margin-bottom:15px;">
                    <h5 style="margin-top:0; font-size:0.9em; color:var(--tsp-text-secondary);">API 预设管理</h5>
                    <div class="tsp-form-row">
                        <div class="tsp-form-group" style="flex:2;">
                            <label>选择预设</label>
                            <select class="tsp-input" id="nai-api-preset-select">
                                <option value="">-- 新建预设 --</option>
                            </select>
                        </div>
                        <div class="tsp-btn-group" style="flex:1; align-self: flex-end; justify-content: flex-end;">
                            <button type="button" class="tsp-btn" id="nai-api-preset-save" title="将当前配置另存为新预设">
                                <i class="fa-solid fa-save"></i> 保存
                            </button>
                            <button type="button" class="tsp-btn tsp-btn-danger" id="nai-api-preset-delete" title="删除当前预设">
                                <i class="fa-solid fa-trash"></i> 删除
                            </button>
                        </div>
                    </div>
                </div>
                <div class="tsp-form-group">
                    <label>渠道</label>
                    <select class="tsp-input" id="nai-channel">
                        <option value="proxy" ${s.channel === 'proxy' ? 'selected' : ''}>第三方代理</option>
                        <option value="official" ${s.channel === 'official' ? 'selected' : ''}>官方 (Official)</option>
                    </select>
                </div>
                <div class="tsp-form-group">
                    <label>API 地址 (URL)</label>
                    <input type="text" class="tsp-input" id="nai-api-url"
                           value="${displayUrl}"
                           placeholder="默认: ${defaultUrl}">
                </div>
                <div class="tsp-form-group">
                    <label>密钥 (Key)</label>
                    <input type="password" class="tsp-input" id="nai-token"
                           value="${s.apiKey || ''}"
                           placeholder="API Key 或密钥">
                </div>
                <div class="tsp-form-group" id="nai-proxy-stream-group" style="${s.channel === 'official' ? 'display:none;' : ''}">
                    <label>第三方代理流式传输</label>
                    <select class="tsp-input" id="nai-proxy-stream">
                        <option value="true" ${s.proxyStream === true ? 'selected' : ''}>启用 (Stream)</option>
                        <option value="false" ${s.proxyStream === false ? 'selected' : ''}>禁用 (Direct Image)</option>
                    </select>
                    <small class="tsp-text-muted">如果代理直接返回图片而不是 URL，请选择"禁用"</small>
                </div>
            </div>

            <!-- 模型与采样 -->
            <div class="tsp-settings-group">
                <h4 class="tsp-settings-group-title">
                    <i class="fa-solid fa-cube"></i> 模型与采样
                </h4>
                <div class="tsp-form-row">
                    <div class="tsp-form-group">
                        <label>模型 (Model)</label>
                        <select class="tsp-input" id="nai-model">
                            <option value="nai-diffusion-3" ${s.model === 'nai-diffusion-3' ? 'selected' : ''}>NAI Diffusion 3</option>
                            <option value="nai-diffusion-furry-3" ${s.model === 'nai-diffusion-furry-3' ? 'selected' : ''}>NAI Diffusion Furry 3</option>
                            <option value="nai-diffusion-4-full" ${s.model === 'nai-diffusion-4-full' ? 'selected' : ''}>NAI Diffusion 4 Full</option>
                            <option value="nai-diffusion-4-curated-preview" ${s.model === 'nai-diffusion-4-curated-preview' ? 'selected' : ''}>NAI Diffusion 4 Curated</option>
                            <option value="nai-diffusion-4-5-full" ${s.model === 'nai-diffusion-4-5-full' ? 'selected' : ''}>NAI Diffusion 4.5 Full</option>
                            <option value="nai-diffusion-4-5-curated" ${s.model === 'nai-diffusion-4-5-curated' ? 'selected' : ''}>NAI Diffusion 4.5 Curated</option>
                        </select>
                    </div>
                    <div class="tsp-form-group">
                        <label>采样器 (Sampler)</label>
                        <select class="tsp-input" id="nai-sampler">
                            <option value="k_euler" ${s.sampler === 'k_euler' ? 'selected' : ''}>Euler</option>
                            <option value="k_euler_ancestral" ${s.sampler === 'k_euler_ancestral' ? 'selected' : ''}>Euler Ancestral</option>
                            <option value="k_dpmpp_2s_ancestral" ${s.sampler === 'k_dpmpp_2s_ancestral' ? 'selected' : ''}>DPM++ 2S Ancestral</option>
                            <option value="k_dpmpp_2m_sde" ${s.sampler === 'k_dpmpp_2m_sde' ? 'selected' : ''}>DPM++ 2M SDE</option>
                            <option value="k_dpmpp_2m" ${s.sampler === 'k_dpmpp_2m' ? 'selected' : ''}>DPM++ 2M</option>
                            <option value="k_dpmpp_sde" ${s.sampler === 'k_dpmpp_sde' ? 'selected' : ''}>DPM++ SDE</option>
                        </select>
                    </div>
                </div>
                <div class="tsp-form-group">
                    <label>噪点调度 (Noise Schedule)</label>
                    <select class="tsp-input" id="nai-noise-schedule">
                        <option value="native" ${s.noiseSchedule === 'native' ? 'selected' : ''}>native</option>
                        <option value="exponential" ${s.noiseSchedule === 'exponential' ? 'selected' : ''}>exponential</option>
                        <option value="polyexponential" ${s.noiseSchedule === 'polyexponential' ? 'selected' : ''}>polyexponential</option>
                        <option value="karras" ${s.noiseSchedule === 'karras' ? 'selected' : ''}>karras</option>
                    </select>
                </div>
                <div class="tsp-form-row">
                    <div class="tsp-form-group">
                        <label>步数 (Steps)</label>
                        <input type="number" class="tsp-input" id="nai-steps"
                               value="${s.steps}" min="1" max="50">
                    </div>
                    <div class="tsp-form-group">
                        <label>Scale</label>
                        <input type="number" class="tsp-input" id="nai-scale"
                               value="${s.scale}" min="1" max="30" step="0.5">
                    </div>
                    <div class="tsp-form-group">
                        <label>CFG Rescale</label>
                        <input type="number" class="tsp-input" id="nai-cfg-rescale"
                               value="${s.cfgRescale}" min="0" max="1" step="0.05">
                    </div>
                </div>
                <div class="tsp-form-row">
                    <div class="tsp-form-group">
                        <label>宽度</label>
                        <input type="number" class="tsp-input" id="nai-width"
                               value="${s.width}" min="64" step="64">
                    </div>
                    <div class="tsp-form-group">
                        <label>高度</label>
                        <input type="number" class="tsp-input" id="nai-height"
                               value="${s.height}" min="64" step="64">
                    </div>
                </div>
            </div>

            <!-- 高级参数 -->
            <div class="tsp-settings-group">
                <h4 class="tsp-settings-group-title">
                    <i class="fa-solid fa-sliders"></i> 高级参数
                </h4>
                <div class="tsp-form-row">
                    <div class="tsp-form-group">
                        <label>SM (V3)</label>
                        <select class="tsp-input" id="nai-sm">
                            <option value="true" ${s.sm === true ? 'selected' : ''}>True</option>
                            <option value="false" ${s.sm !== true ? 'selected' : ''}>False</option>
                        </select>
                    </div>
                    <div class="tsp-form-group">
                        <label>SMEA+DYN (V3)</label>
                        <select class="tsp-input" id="nai-dyn">
                            <option value="true" ${s.dyn === true ? 'selected' : ''}>True</option>
                            <option value="false" ${s.dyn !== true ? 'selected' : ''}>False</option>
                        </select>
                    </div>
                </div>
                <div class="tsp-form-row">
                    <div class="tsp-form-group">
                        <label>多样性 (Variety)</label>
                        <select class="tsp-input" id="nai-variety">
                            <option value="true" ${s.variety === true ? 'selected' : ''}>True</option>
                            <option value="false" ${s.variety !== true ? 'selected' : ''}>False</option>
                        </select>
                    </div>
                    <div class="tsp-form-group">
                        <label>Decrisper</label>
                        <select class="tsp-input" id="nai-decrisper">
                            <option value="true" ${s.decrisper === true ? 'selected' : ''}>True</option>
                            <option value="false" ${s.decrisper !== true ? 'selected' : ''}>False</option>
                        </select>
                    </div>
                </div>
                <div class="tsp-form-row">
                    <div class="tsp-form-group" style="display: flex; align-items: center; padding-top: 25px;">
                        <label class="tsp-switch-label">
                            <input type="checkbox" class="tsp-switch" id="nai-multi-role" ${s.multiRoleEnabled ? 'checked' : ''}>
                            <span class="tsp-switch-slider"></span>
                            <span>启用多角色模式</span>
                        </label>
                    </div>
                    <div class="tsp-form-group">
                        <label>角色位置 (V4+)</label>
                        <select class="tsp-input" id="nai-use-coords">
                            <option value="true" ${s.useCoords === true ? 'selected' : ''}>True</option>
                            <option value="false" ${s.useCoords !== true ? 'selected' : ''}>False</option>
                        </select>
                    </div>
                </div>
            </div>

            <!-- 图生图 -->
            <div class="tsp-settings-group">
                <h4 class="tsp-settings-group-title">
                    <i class="fa-solid fa-image"></i> 图生图 (Image to Image)
                </h4>
                <p class="tsp-text-muted" style="margin-top: -10px;">在聊天记录中长按生成的图片，可上传图生图底图。</p>
                <div class="tsp-form-row">
                    <div class="tsp-form-group">
                        <label>重绘强度 (Strength)</label>
                        <input type="number" class="tsp-input" id="nai-strength"
                               value="${s.i2iStrength}" min="0" max="0.99" step="0.01">
                    </div>
                    <div class="tsp-form-group">
                        <label>重绘噪声 (Noise)</label>
                        <input type="number" class="tsp-input" id="nai-noise"
                               value="${s.i2iNoise}" min="0" max="0.99" step="0.01">
                    </div>
                    <div class="tsp-form-group">
                        <label>蒙版重绘幅度</label>
                        <input type="number" class="tsp-input" id="nai-inpaint-strength"
                               value="${s.inpaintStrength}" min="0.01" max="1" step="0.01">
                    </div>
                </div>
            </div>

            <!-- 参考模式 -->
            <div class="tsp-settings-group">
                <h4 class="tsp-settings-group-title">
                    <i class="fa-solid fa-wand-magic-sparkles"></i> 参考模式 (Reference)
                </h4>

                <!-- [新增] 预设管理区域 开始 -->
                <div class="tsp-settings-group" style="padding: 12px; background: rgba(0,0,0,0.1); border-radius:8px;">
                    <h5 style="margin-top:0; font-size:0.9em; color:var(--tsp-text-secondary);">预设管理</h5>
                    <div class="tsp-form-row">
                        <div class="tsp-form-group" style="flex:2;">
                            <label>选择预设</label>
                            <select class="tsp-input" id="nai-preset-select">
                                <option value="">-- 新建预设 --</option>
                            </select>
                        </div>
                        <div class="tsp-btn-group" style="flex:1; align-self: flex-end; justify-content: flex-end;">
                            <button type="button" class="tsp-btn" id="nai-preset-save" title="将当前配置另存为新预设">
                                <i class="fa-solid fa-save"></i> 保存
                            </button>
                            <button type="button" class="tsp-btn tsp-btn-danger" id="nai-preset-delete" title="删除当前预设">
                                <i class="fa-solid fa-trash"></i> 删除
                            </button>
                        </div>
                    </div>
                    <div class="tsp-form-group">
                        <label>触发词 (用 , 分隔)</label>
                        <input type="text" class="tsp-input" id="nai-preset-triggers" placeholder="例如: 街拍, cyberpunk, neon">
                    </div>
                </div>
                <!-- [新增] 预设管理区域 结束 -->


                <div class="tsp-form-group" style="margin-top: 15px;">
                    <label class="tsp-switch-label">
                        <input type="checkbox" class="tsp-switch" id="nai-triggers-enabled" ${s.naiTriggersEnabled ? 'checked' : ''}>
                        <span class="tsp-switch-slider"></span>
                        <span>启用触发词模式 (与手动开启参考模式互斥)</span>
                    </label>
                </div>
                <div class="tsp-form-group">
                    <label class="tsp-switch-label">
                        <input type="checkbox" class="tsp-switch" id="nai-vibe-enabled" ${s.vibeEnabled ? 'checked' : ''}>
                        <span class="tsp-switch-slider"></span>
                        <span>手动开启参考模式</span>
                    </label>
                </div>

                <div id="nai-ref-controls" style="${s.vibeEnabled ? '' : 'opacity: 0.5; pointer-events: none;'}">
                    <div class="tsp-btn-group" id="nai-ref-mode-buttons" style="margin-bottom: 15px;">
                        <button type="button" class="tsp-btn ${this.referenceMode === 'vibe' ? 'tsp-btn-primary' : ''}"
                                data-mode="vibe">氛围模式 (Vibe)</button>
                        <button type="button" class="tsp-btn ${this.referenceMode === 'director' ? 'tsp-btn-primary' : ''}"
                                data-mode="director">人物参考 (Character)</button>
                    </div>

                    <div id="nai-director-controls" style="display: ${this.referenceMode === 'director' ? 'block' : 'none'}; background: rgba(0,0,0,0.2); padding: 12px; border-radius: 8px; margin-bottom: 15px;">
                        <label style="display: flex; align-items: center; gap: 8px; margin-bottom: 10px;">
                            <input type="checkbox" id="nai-director-style-aware" ${s.directorStyleAware ? 'checked' : ''}>
                            <span><strong style="color: var(--tsp-accent-primary);">Style Aware:</strong> 同时参考"角色"与"风格"</span>
                        </label>
                        <div class="tsp-slider-group">
                            <label>参考强度</label>
                            <input type="range" class="tsp-slider" id="nai-director-strength"
                                   min="0.01" max="1" step="0.01" value="${s.directorStrength}">
                            <span class="tsp-slider-value" id="nai-director-strength-value">${Number(s.directorStrength).toFixed(2)}</span>
                        </div>
                    </div>

                    <button type="button" class="tsp-btn" id="nai-vibe-upload-btn" style="margin-bottom: 10px;">
                        <i class="fa-solid fa-upload"></i> 上传参考图
                    </button>
                    <input type="file" id="nai-vibe-upload-input" multiple accept="image/*,.naiv4vibe,.json,.naiv4vibebundle" style="display: none;">

                    <p id="nai-vibe-status" class="tsp-text-muted" style="margin-bottom: 10px;"></p>

                    <div id="nai-vibe-image-list" class="tsp-vibe-list"></div>
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
        this._applyActiveApiPresetToUI(); // 使用新名称

        containerEl.querySelector('#nai-api-preset-select')?.addEventListener('change', (e) => {
            this.activeApiPreset = e.target.value;
            this._applyActiveApiPresetToUI(); // 使用新名称
        });

        containerEl.querySelector('#nai-api-preset-save')?.addEventListener('click', () => this._saveApiPreset());
        containerEl.querySelector('#nai-api-preset-delete')?.addEventListener('click', () => this._deleteApiPreset());
        // [新增] 渲染预设下拉框
        this._renderPresetDropdown();
        this._applyActivePresetToUI();

        // [新增] 预设下拉框切换事件
        containerEl.querySelector('#nai-preset-select')?.addEventListener('change', (e) => {
            this.activePresetName = e.target.value;
            this._applyActivePresetToUI();
        });

        // [新增] 预设保存事件
        containerEl.querySelector('#nai-preset-save')?.addEventListener('click', async () => {
            await this._saveAsNewPreset();
        });

        // [新增] 预设删除事件
        containerEl.querySelector('#nai-preset-delete')?.addEventListener('click', async () => {
            await this._deleteActivePreset();
        });

        // [新增] 触发词输入事件
        containerEl.querySelector('#nai-preset-triggers')?.addEventListener('input', (e) => {
            this._updateActivePresetTriggerWords(e.target.value);
        });

        // 渲染 Vibe 列表
        this._renderVibeList();
        this._updateVibeStatus();

        // 渠道切换 - 只更新流式传输选项的显示，不自动替换 URL
        containerEl.querySelector('#nai-channel')?.addEventListener('change', (e) => {
            const isOfficial = e.target.value === 'official';
            const streamGroup = containerEl.querySelector('#nai-proxy-stream-group');

            if (streamGroup) {
                streamGroup.style.display = isOfficial ? 'none' : 'block';
            }
        });

        // Vibe 开关
        containerEl.querySelector('#nai-vibe-enabled')?.addEventListener('change', (e) => {
            const controls = containerEl.querySelector('#nai-ref-controls');
            if (controls) {
                controls.style.cssText = e.target.checked ? '' : 'opacity: 0.5; pointer-events: none;';
            }
        });

        // 参考模式切换
        const refModeButtons = containerEl.querySelectorAll('#nai-ref-mode-buttons button');
        console.log('[NAISettings] 找到参考模式按钮数量:', refModeButtons.length);
        refModeButtons.forEach((btn) => {
            console.log('[NAISettings] 绑定按钮事件:', btn.dataset.mode);
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                console.log('[NAISettings] 点击参考模式按钮:', btn.dataset.mode);
                this.referenceMode = btn.dataset.mode;
                this._updateRefModeUI();
            });
        });

        // Director 强度滑块
        const directorSlider = containerEl.querySelector('#nai-director-strength');
        const directorValue = containerEl.querySelector('#nai-director-strength-value');
        if (directorSlider && directorValue) {
            directorSlider.addEventListener('input', () => {
                directorValue.textContent = parseFloat(directorSlider.value).toFixed(2);
            });
        }

        // Vibe 上传
        containerEl.querySelector('#nai-vibe-upload-btn')?.addEventListener('click', () => {
            containerEl.querySelector('#nai-vibe-upload-input')?.click();
        });

        containerEl.querySelector('#nai-vibe-upload-input')?.addEventListener('change', (e) => {
            this._handleVibeUpload(e.target.files);
        });
    }

    /**
     * 更新参考模式 UI
     */
    _updateRefModeUI() {
        console.log('[NAISettings] _updateRefModeUI 被调用, referenceMode:', this.referenceMode);
        if (!this.containerEl) {
            console.log('[NAISettings] containerEl 为空，退出');
            return;
        }

        this.containerEl.querySelectorAll('#nai-ref-mode-buttons button').forEach((btn) => {
            const shouldBeActive = btn.dataset.mode === this.referenceMode;
            console.log('[NAISettings] 按钮', btn.dataset.mode, '应该激活:', shouldBeActive, '当前有 tsp-btn-primary:', btn.classList.contains('tsp-btn-primary'));
            btn.classList.toggle('tsp-btn-primary', shouldBeActive);
        });

        const directorControls = this.containerEl.querySelector('#nai-director-controls');
        if (directorControls) {
            directorControls.style.display = this.referenceMode === 'director' ? 'block' : 'none';
        }
        this._renderVibeList();

        this._updateVibeStatus();
    }

    /**
     * 处理 Vibe 图片上传
     */
    async _handleVibeUpload(files) {
        if (!files || files.length === 0) return;

        for (const file of files) {
            try {
                if (file.name.endsWith('.naiv4vibe') || file.name.endsWith('.naiv4vibebundle')) {
                    // .naiv4vibe 文件 - NAI V4+ 专用 vibe 编码文件
                    const text = await file.text();
                    const vibeData = JSON.parse(text);

                    // 验证 vibe 文件结构
                    if (!vibeData.encodings) {
                        console.warn('[NAISettings] 无效的 .naiv4vibe 文件：缺少 encodings 字段');
                        continue;
                    }

                    // 尝试获取缩略图
                    let thumbnail = '';
                    if (vibeData.thumbnail) {
                        thumbnail = vibeData.thumbnail.startsWith('data:')
                            ? vibeData.thumbnail
                            : `data:image/png;base64,${vibeData.thumbnail}`;
                    }

                    this._addVibeImage({
                        type: 'vibeFile',
                        vibeData: vibeData,
                        image: thumbnail,
                        thumbnail: thumbnail,
                        strength: 0.6,
                        infoExtracted: 1.0,
                        name: vibeData.name || file.name,
                    });

                    console.log('[NAISettings] 已加载 .naiv4vibe 文件:', vibeData.name || file.name);
                } else if (file.name.endsWith('.json')) {
                    // 普通 JSON 文件 - 可能是导出的配置
                    const text = await file.text();
                    const data = JSON.parse(text);
                    if (Array.isArray(data)) {
                        data.forEach(item => this._addVibeImage(item));
                    } else {
                        this._addVibeImage(data);
                    }
                } else {
                    // 普通图片文件
                    const base64 = await this._readFileAsDataURL(file);
                    this._addVibeImage({
                        type: 'image',
                        image: base64,
                        strength: 0.6,
                        infoExtracted: 1.0,
                    });
                }
            } catch (error) {
                console.error('[NAISettings] 处理文件失败:', error);
            }
        }

        this._renderVibeList();
        this._updateVibeStatus();
    }

    _addVibeImage(item) {
        if (this.referenceMode === 'director') {
            this.vibeImages = [item];
        } else {
            this.vibeImages.push(item);
        }
    }

    _renderVibeList() {
        const container = this.containerEl?.querySelector('#nai-vibe-image-list');
        if (!container) return;

        if (this.vibeImages.length === 0) {
            container.innerHTML = '<p class="tsp-text-muted">暂无参考图片</p>';
            return;
        }

        container.innerHTML = this.vibeImages.map((item, index) => {
            const isVibeFile = item.type === 'vibeFile';
            const thumbnailSrc = item.image || item.thumbnail || '';
            const typeLabel = isVibeFile ? `<span style="font-size: 0.7em; color: var(--tsp-accent-primary); margin-left: 5px;">.naiv4vibe</span>` : '';
            const nameLabel = item.name ? `<div style="font-size: 0.75em; color: var(--tsp-text-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 150px;">${item.name}</div>` : '';

            // 如果没有缩略图，显示占位符
            const thumbnailHtml = thumbnailSrc
                ? `<img src="${thumbnailSrc}" class="tsp-vibe-thumbnail" style="width: 60px; height: 60px; object-fit: cover; border-radius: 6px;">`
                : `<div class="tsp-vibe-thumbnail" style="width: 60px; height: 60px; border-radius: 6px; background: rgba(122,162,247,0.2); display: flex; align-items: center; justify-content: center;"><i class="fa-solid fa-file-code" style="font-size: 1.5em; color: var(--tsp-accent-primary);"></i></div>`;

                const showInfoSlider = this.referenceMode !== 'director';

                const infoSliderHtml = showInfoSlider ? `
                    <div class="tsp-slider-group" style="font-size: 0.85em; margin-bottom: 4px;">
                        <label style="min-width: 50px;">信息量</label>
                        <input type="range" class="tsp-slider vibe-info" data-index="${index}"
                               min="0.01" max="1" step="0.01" value="${item.infoExtracted ?? 1.0}">
                        <span class="tsp-slider-value">${Number(item.infoExtracted ?? 1.0).toFixed(2)}</span>
                    </div>` : '';
    
                return `
                <div class="tsp-vibe-item" data-index="${index}">
                    ${thumbnailHtml}
                    <div class="tsp-vibe-info" style="flex: 1;">
                        ${nameLabel}
                        ${infoSliderHtml}
                        <div class="tsp-slider-group" style="font-size: 0.85em;">
                            <label style="min-width: 50px;">强度${typeLabel}</label>
                            <input type="range" class="tsp-slider vibe-strength" data-index="${index}"
                                   min="0.01" max="1" step="0.01" value="${item.strength ?? 0.6}">
                            <span class="tsp-slider-value">${Number(item.strength ?? 0.6).toFixed(2)}</span>
                        </div>
                    </div>
                    <button class="tsp-btn tsp-btn-icon tsp-btn-danger vibe-delete" data-index="${index}">
                        <i class="fa-solid fa-trash"></i>
                    </button>
                </div>
            `;
            // --- [修改结束] ---
            }).join('');

        // 绑定滑块事件
        container.querySelectorAll('.vibe-strength').forEach(slider => {
            slider.addEventListener('input', (e) => {
                const idx = parseInt(e.target.dataset.index);
                this.vibeImages[idx].strength = parseFloat(e.target.value);
                e.target.nextElementSibling.textContent = parseFloat(e.target.value).toFixed(2);
            });
        });

        // --- [新增] 绑定信息提取度滑块事件 ---
        container.querySelectorAll('.vibe-info').forEach(slider => {
            slider.addEventListener('input', (e) => {
                const idx = parseInt(e.target.dataset.index);
                this.vibeImages[idx].infoExtracted = parseFloat(e.target.value);
                e.target.nextElementSibling.textContent = parseFloat(e.target.value).toFixed(2);
            });
        });

        // 绑定删除按钮
        container.querySelectorAll('.vibe-delete').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const idx = parseInt(e.currentTarget.dataset.index);
                this.vibeImages.splice(idx, 1);
                this._renderVibeList();
                this._updateVibeStatus();
            });
        });
    }
    /**
     * 渲染API预设下拉框
     */
    _renderApiPresetDropdown() {
        const select = this.containerEl.querySelector('#nai-api-preset-select');
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
     * [修改] 将当前选中的预设数据应用到UI (已重命名并修复联动)
     */
    _applyActiveApiPresetToUI() {
        const preset = this.apiPresets.find(p => p.name === this.activeApiPreset);
        const channelSelect = this.containerEl.querySelector('#nai-channel');
        const urlInput = this.containerEl.querySelector('#nai-api-url');
        const keyInput = this.containerEl.querySelector('#nai-token');
        const deleteBtn = this.containerEl.querySelector('#nai-api-preset-delete');

        if (preset) {
            if (channelSelect) channelSelect.value = preset.channel || 'proxy';
            if (urlInput) urlInput.value = preset.proxyUrl || '';
            if (keyInput) keyInput.value = preset.apiKey || '';
            if (deleteBtn) deleteBtn.disabled = false;
        } else {
            // “新建预设”状态
            if (channelSelect) channelSelect.value = 'proxy';
            if (urlInput) urlInput.value = '';
            if (keyInput) keyInput.value = '';
            if (deleteBtn) deleteBtn.disabled = true;
        }

        // [关键修复] 手动触发 change 事件，确保 UI 联动（例如显示/隐藏代理流式传输选项）
        channelSelect?.dispatchEvent(new Event('change'));
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
            channel: this.containerEl.querySelector('#nai-channel')?.value || 'proxy',
            proxyUrl: this.containerEl.querySelector('#nai-api-url')?.value.trim() || '',
            apiKey: this.containerEl.querySelector('#nai-token')?.value.trim() || '',
        };

        this.apiPresets.push(newPreset);
        this.activeApiPreset = newName;
        this._renderApiPresetDropdown();
        this._applyActiveApiPresetToUI();
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
        this._applyActiveApiPresetToUI();
        this.ctx.helpers.showToast('API 预设已删除', 'success');
    }
    /**
     * 渲染预设下拉框
     */
    _renderPresetDropdown() {
        const select = this.containerEl.querySelector('#nai-preset-select');
        if (!select) return;

        select.innerHTML = '<option value="">-- 新建预设 --</option>';
        this.naiPresets.forEach(preset => {
            const option = document.createElement('option');
            option.value = preset.name;
            option.textContent = preset.name;
            option.selected = preset.name === this.activePresetName;
            select.appendChild(option);
        });
    }

    /**
     * 将当前选中的预设数据应用到 UI
     */
    _applyActivePresetToUI() {
        const preset = this.naiPresets.find(p => p.name === this.activePresetName);
        const triggerInput = this.containerEl.querySelector('#nai-preset-triggers');
        const deleteBtn = this.containerEl.querySelector('#nai-preset-delete');

        if (preset) {
            // 加载预设数据
            this.vibeImages = preset.images || [];
            this.referenceMode = preset.referenceMode || 'vibe';

            // 更新 Director 模式相关 UI
            const directorAwareCheck = this.containerEl.querySelector('#nai-director-style-aware');
            if (directorAwareCheck) directorAwareCheck.checked = preset.directorStyleAware || false;

            const directorStrengthSlider = this.containerEl.querySelector('#nai-director-strength');
            if (directorStrengthSlider) directorStrengthSlider.value = preset.directorStrength || 0.6;

            const directorStrengthValue = this.containerEl.querySelector('#nai-director-strength-value');
            if (directorStrengthValue) directorStrengthValue.textContent = Number(preset.directorStrength || 0.6).toFixed(2);

            if (triggerInput) triggerInput.value = preset.triggerWords || '';
            if (deleteBtn) deleteBtn.disabled = false;

        } else {
            // “新建预设”状态
            this.vibeImages = [];
            this.referenceMode = 'vibe';
            if (triggerInput) triggerInput.value = '';
            if (deleteBtn) deleteBtn.disabled = true;
        }

        // 刷新 UI
        this._updateRefModeUI();
    }

    /**
     * 更新当前激活预设的触发词
     */
    _updateActivePresetTriggerWords(words) {
        if (!this.activePresetName) return;
        const preset = this.naiPresets.find(p => p.name === this.activePresetName);
        if (preset) {
            preset.triggerWords = words.trim();
        }
    }

    /**
     * 保存为新预设
     */
    async _saveAsNewPreset() {
        const newName = await this.ctx.helpers.promptInput('输入预设名称');
        if (!newName || !newName.trim()) return;

        if (this.naiPresets.some(p => p.name === newName)) {
            this.ctx.helpers.showToast('预设名称已存在', 'error');
            return;
        }

        const newPreset = {
            name: newName,
            triggerWords: this.containerEl.querySelector('#nai-preset-triggers')?.value.trim() || '',
            referenceMode: this.referenceMode,
            images: JSON.parse(JSON.stringify(this.vibeImages)), // 深拷贝
            directorStyleAware: this.containerEl.querySelector('#nai-director-style-aware')?.checked || false,
            directorStrength: parseFloat(this.containerEl.querySelector('#nai-director-strength')?.value) || 0.6,
        };

        this.naiPresets.push(newPreset);
        this.activePresetName = newName;

        this._renderPresetDropdown();
        this.ctx.helpers.showToast('预设已保存', 'success');
    }

    /**
     * 删除当前预设
     */
    async _deleteActivePreset() {
        if (!this.activePresetName) return;

        const confirmed = await this.ctx.helpers.promptConfirm(`确定要删除预设 "${this.activePresetName}" 吗?`);
        if (!confirmed) return;

        // ==================== 修改开始 ====================
        // 1. 在从数组中移除预设之前，先找到它
        const presetToDelete = this.naiPresets.find(p => p.name === this.activePresetName);

        if (presetToDelete) {
            // 2. 获取 ImageGenerator 模块，并通过它访问 storageManager
            const imageGen = this.ctx.getModule('imageGen');
            if (imageGen && imageGen.storageManager) {
                this.ctx.helpers.showToast('正在删除服务器上的关联图片...', 'info');
                try {
                    // 3. 调用新的删除方法，并等待其完成
                    await imageGen.storageManager.deleteNaiPresetFiles(presetToDelete);
                } catch (e) {
                    this.ctx.helpers.showToast('删除服务器图片时出错，部分文件可能残留', 'error');
                    console.error('[NAISettings] 删除预设图片失败:', e);
                }
            }
        }
        // ==================== 修改结束 ====================

        // 原有的本地数据删除逻辑
        this.naiPresets = this.naiPresets.filter(p => p.name !== this.activePresetName);
        this.activePresetName = this.naiPresets.length > 0 ? this.naiPresets[0].name : '';

        this._renderPresetDropdown();
        this._applyActivePresetToUI();
        this.ctx.helpers.showToast('预设已删除', 'success');
    }
    _updateVibeStatus() {
        const status = this.containerEl?.querySelector('#nai-vibe-status');
        if (!status) return;

        if (this.vibeImages.length === 0) {
            status.textContent = '';
            return;
        }

        const modeText = this.referenceMode === 'vibe' ? '氛围模式' : '人物参考模式';
        status.textContent = `当前: ${modeText}，${this.vibeImages.length} 张参考图`;
    }

    _readFileAsDataURL(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = reject;
            reader.readAsDataURL(file);
        });
    }

    /**
     * 根据宽高计算尺寸预设
     */
    _getSizePreset() {
        const width = parseInt(this.containerEl?.querySelector('#nai-width')?.value) || 832;
        const height = parseInt(this.containerEl?.querySelector('#nai-height')?.value) || 1216;

        // 标准预设尺寸
        if (width === 832 && height === 1216) return '竖图';
        if (width === 1216 && height === 832) return '横图';
        if (width === 1024 && height === 1024) return '方图';

        // 自定义尺寸
        return 'Custom';
    }

    /**
     * 收集表单数据
     */
    collectSettings() {
        if (!this.containerEl) return null;

        // [新增] 保存当前正在编辑的预设（如果不是 "新建" 状态）
        if (this.activePresetName) {
            const preset = this.naiPresets.find(p => p.name === this.activePresetName);
            if (preset) {
                preset.triggerWords = this.containerEl.querySelector('#nai-preset-triggers')?.value.trim() || '';
                preset.referenceMode = this.referenceMode;
                preset.images = JSON.parse(JSON.stringify(this.vibeImages));
                preset.directorStyleAware = this.containerEl.querySelector('#nai-director-style-aware')?.checked || false;
                preset.directorStrength = parseFloat(this.containerEl.querySelector('#nai-director-strength')?.value) || 0.6;
            }
        }
        const activeApiPresetName = this.containerEl.querySelector('#nai-api-preset-select')?.value || '';
        const preset = this.apiPresets.find(p => p.name === activeApiPresetName);

        // 如果当前选中了一个预设，就用预设的值；否则用输入框的值
        const currentChannel = preset ? preset.channel : (this.containerEl.querySelector('#nai-channel')?.value || 'proxy');
        const currentUrl = preset ? preset.proxyUrl : (this.containerEl.querySelector('#nai-api-url')?.value || '');
        const currentApiKey = preset ? preset.apiKey : (this.containerEl.querySelector('#nai-token')?.value || '');

        return {
            channel: currentChannel,
            proxyUrl: currentUrl,
            apiKey: currentApiKey,
            proxyStream: this.containerEl.querySelector('#nai-proxy-stream')?.value === 'true',
            model: this.containerEl.querySelector('#nai-model')?.value || 'nai-diffusion-3',
            sampler: this.containerEl.querySelector('#nai-sampler')?.value || 'k_euler_ancestral',
            noiseSchedule: this.containerEl.querySelector('#nai-noise-schedule')?.value || 'karras',
            steps: parseInt(this.containerEl.querySelector('#nai-steps')?.value) || 28,
            scale: parseFloat(this.containerEl.querySelector('#nai-scale')?.value) || 5,
            cfgRescale: parseFloat(this.containerEl.querySelector('#nai-cfg-rescale')?.value) || 0,
            width: parseInt(this.containerEl.querySelector('#nai-width')?.value) || 832,
            height: parseInt(this.containerEl.querySelector('#nai-height')?.value) || 1216,
            sizePreset: this._getSizePreset(),
            sm: this.containerEl.querySelector('#nai-sm')?.value === 'true',
            dyn: this.containerEl.querySelector('#nai-dyn')?.value === 'true',
            variety: this.containerEl.querySelector('#nai-variety')?.value === 'true',
            decrisper: this.containerEl.querySelector('#nai-decrisper')?.value === 'true',
            multiRoleEnabled: this.containerEl.querySelector('#nai-multi-role')?.checked || false,
            useCoords: this.containerEl.querySelector('#nai-use-coords')?.value === 'true',
            i2iStrength: parseFloat(this.containerEl.querySelector('#nai-strength')?.value) || 0.7,
            i2iNoise: parseFloat(this.containerEl.querySelector('#nai-noise')?.value) || 0,
            inpaintStrength: parseFloat(this.containerEl.querySelector('#nai-inpaint-strength')?.value) || 1,
            vibeEnabled: this.containerEl.querySelector('#nai-vibe-enabled')?.checked || false,
            naiTriggersEnabled: this.containerEl.querySelector('#nai-triggers-enabled')?.checked || false,
            naiPresets: this.naiPresets,
            referenceMode: this.referenceMode,
            directorStyleAware: this.containerEl.querySelector('#nai-director-style-aware')?.checked || false,
            directorStrength: parseFloat(this.containerEl.querySelector('#nai-director-strength')?.value) || 0.6,
            vibeImages: this.vibeImages,
            apiPresets: this.apiPresets,
            activeApiPreset: activeApiPresetName,
        };
    }
}
