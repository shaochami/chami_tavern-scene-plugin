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
        // 情绪定义列表
        this.EMOTION_DEFINITIONS = [
            { key: 'neutral', label: '中性', desc: '平静，接近面无表情' },
            { key: 'happy', label: '开心', desc: '嘴角上扬，有时候会张开' },
            { key: 'sad', label: '难过', desc: '会流泪，哭泣' },
            { key: 'angry', label: '愤怒', desc: '皱眉' },
            { key: 'scared', label: '害怕', desc: 'm字嘴' },
            { key: 'surprised', label: '惊讶', desc: '目瞪口呆，眼珠子凸出' },
            { key: 'tired', label: '疲惫', desc: '黑眼圈的烟熏妆' },
            { key: 'excited', label: '兴奋', desc: '有点猥琐的表情' },
            { key: 'nervous', label: '紧张', desc: 'm字嘴暴汗' },
            { key: 'thinking', label: '思考', desc: '迷惑，手部靠近下巴与眯眯眼' },
            { key: 'confused', label: '困惑的', desc: '蚊香眼' },
            { key: 'shy', label: '害羞', desc: '脸颊上腮红' },
            { key: 'disgusted', label: '厌恶', desc: '经典厌恶脸，居高临下' },
            { key: 'smug', label: '得意', desc: '龙王归来耐克嘴' },
            { key: 'bored', label: '无聊', desc: '死鱼眼或眼睛失去焦点发呆' },
            { key: 'laughing', label: '笑出声', desc: '比开心嘴巴张的大，颠婆' },
            { key: 'irritated', label: '恼怒', desc: '类似娇嗔，让你猜' },
            { key: 'aroused', label: '兴奋(极)', desc: '超级发春，直接出蒸汽' },
            { key: 'embarrassed', label: '尴尬', desc: '与害怕差不多但多了腮红' },
            { key: 'worried', label: '担忧', desc: '像娇羞，会出现一滴汗' },
            { key: 'love', label: '爱', desc: '笑，眯眯眼' },
            { key: 'determined', label: '决心', desc: '认真脸' },
            { key: 'hurt', label: '受伤', desc: '流泪，大概率出现伤痕' },
            { key: 'playful', label: '俏皮', desc: '抛媚眼' }
        ];
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
            vibeImages: [],
        };

        this.vibeImages = [];
        // 当前参考模式
        this.referenceMode = 'vibe';

        //  开始
        // 参考预设管理
        this.naiPresets = []; // 保存所有预设
        this.activePresetName = ''; // 当前选中的预设名称
        //  结束
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
        this.loadedEmotions = s.emotions || {}; // <--- 添加这一行代码
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
                            <!--  更新按钮 -->
                            <button type="button" class="tsp-btn tsp-btn-primary" id="nai-api-preset-update" title="覆盖更新当前预设">
                                <i class="fa-solid fa-sync"></i> 更新
                            </button>
                            <button type="button" class="tsp-btn" id="nai-api-preset-save" title="将当前配置另存为新预设">
                                <i class="fa-solid fa-save"></i> 另存
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
                           placeholder="留空默认使用官方链接">
                </div>
                <!-- [修改开始]：增加了眼睛按钮 -->
                <div class="tsp-form-group">
                    <label>密钥 (Key)</label>
                    <div class="tsp-input-group">
                        <input type="password" class="tsp-input" id="nai-token"
                               value="${s.apiKey || ''}"
                               placeholder="API Key 或密钥">
                        <button class="tsp-btn tsp-btn-icon" id="nai-token-toggle" title="显示/隐藏密钥">
                            <i class="fa-solid fa-eye"></i>
                        </button>
                    </div>
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

            <!-- 情绪管理区域 -->
            <div class="tsp-settings-group">
                <!-- [修改] 标题添加点击事件和图标 -->
                <h4 class="tsp-settings-group-title" id="nai-emotion-header" style="cursor: pointer; display: flex; justify-content: space-between; align-items: center; user-select: none;">
                    <span><i class="fa-solid fa-face-smile"></i> 情绪管理</span>
                    <i class="fa-solid fa-chevron-right" id="nai-emotion-icon"></i>
                </h4>

                <!-- [修改] 内容容器，默认隐藏，且初始为空 -->
                <div id="nai-emotion-container" style="display: none;">
                    <p class="tsp-text-muted">当提示词命中触发词时，对生成的图片进行情绪重绘。支持官方渠道和第三方代理。</p>

                    <!-- [修改] 这里移除了原有的 map 循环，改为一个空的容器等待按需注入 -->
                    <div class="tsp-emotion-grid" id="nai-emotion-grid" style="display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 10px;">
                        <!-- 内容将在点击展开时动态生成 -->
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

                <!--  预设管理区域 开始 -->
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
                <!--  预设管理区域 结束 -->


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

                    <div class="tsp-btn-group" style="margin-bottom: 10px;">
                        <button type="button" class="tsp-btn" id="nai-vibe-upload-btn">
                            <i class="fa-solid fa-upload"></i> 上传参考图
                        </button>
                        <button type="button" class="tsp-btn tsp-btn-primary" id="nai-vibe-generate-btn" title="生成.naiv4vibe文件">
                            <i class="fa-solid fa-wand-magic-sparkles"></i> 生成氛围文件
                        </button>
                    </div>
                    <input type="file" id="nai-vibe-upload-input" multiple accept="image/*,.naiv4vibe,.json,.naiv4vibebundle" style="display: none;">

                    <p id="nai-vibe-status" class="tsp-text-muted" style="margin-bottom: 10px;"></p>

                    <div id="nai-vibe-image-list" class="tsp-vibe-list"></div>
                </div>
            </div>
        </div>
        `;
    }
    //  辅助方法：生成情绪卡片 HTML
    _renderEmotionCards() {
        const s = this._getSettings(); // 或者直接使用 this.loadedEmotions
        const currentEmotions = this.loadedEmotions || {};

        return this.EMOTION_DEFINITIONS.map(emo => {
            const saved = currentEmotions[emo.key] || {};
            const triggers = saved.triggers || '';
            const strength = saved.strength !== undefined ? saved.strength : 0; // 默认0(强)

            return `
            <div class="tsp-card" style="padding: 8px; border: 1px solid var(--tsp-border);">
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:5px;">
                    <label style="font-weight:bold; cursor:help;" title="${emo.desc}">${emo.label} (${emo.key})</label>
                    <select class="tsp-input tsp-input-sm emotion-strength" data-key="${emo.key}" style="width:80px;" title="强度: 0(最强) - 5(微弱)">
                        <option value="0" ${strength == 0 ? 'selected' : ''}>0 (强)</option>
                        <option value="1" ${strength == 1 ? 'selected' : ''}>1</option>
                        <option value="2" ${strength == 2 ? 'selected' : ''}>2</option>
                        <option value="3" ${strength == 3 ? 'selected' : ''}>3</option>
                        <option value="4" ${strength == 4 ? 'selected' : ''}>4</option>
                        <option value="5" ${strength == 5 ? 'selected' : ''}>5 (弱)</option>
                    </select>
                </div>
                <input type="text" class="tsp-input tsp-input-sm emotion-triggers"
                       data-key="${emo.key}"
                       value="${triggers}"
                       placeholder="触发词(英文逗号分隔)">
                <div style="font-size:0.75em; color:var(--tsp-text-muted); margin-top:2px;">${emo.desc}</div>
            </div>
            `;
        }).join('');
    }
    /**
     * 绑定事件
     */
    bindEvents(containerEl) {
        this.containerEl = containerEl;
        //  情绪管理折叠逻辑 ============================
        const emoHeader = containerEl.querySelector('#nai-emotion-header');
        const emoContainer = containerEl.querySelector('#nai-emotion-container');
        const emoIcon = containerEl.querySelector('#nai-emotion-icon');
        //  获取网格容器
        const emoGrid = containerEl.querySelector('#nai-emotion-grid');

        if (emoHeader && emoContainer && emoIcon) {
            emoHeader.addEventListener('click', () => {
                const isHidden = emoContainer.style.display === 'none';
                if (isHidden) {
                    // [关键修改] 展开时，检查是否已经渲染。如果为空，则进行渲染
                    if (emoGrid && emoGrid.children.length === 0) {
                        // 使用 requestAnimationFrame 避免界面卡顿
                        requestAnimationFrame(() => {
                            emoGrid.innerHTML = this._renderEmotionCards();
                        });
                    }

                    // 展开
                    emoContainer.style.display = 'block';
                    emoIcon.classList.remove('fa-chevron-right');
                    emoIcon.classList.add('fa-chevron-down');
                } else {
                    // 收缩
                    emoContainer.style.display = 'none';
                    emoIcon.classList.remove('fa-chevron-down');
                    emoIcon.classList.add('fa-chevron-right');
                }
            });
        }
        containerEl.querySelector('#nai-token-toggle')?.addEventListener('click', (e) => {
            e.preventDefault(); // 防止触发表单提交等意外行为
            const input = containerEl.querySelector('#nai-token');
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
        this._renderApiPresetDropdown();
        this._applyActiveApiPresetToUI(); // 使用新名称

        containerEl.querySelector('#nai-api-preset-select')?.addEventListener('change', (e) => {
            this.activeApiPreset = e.target.value;
            this._applyActiveApiPresetToUI(); // 使用新名称
            // 重置修改状态
            if (this.ctx.getModule('settingsPanel')) {
                this.ctx.getModule('settingsPanel').isApiPresetModified.nai = false;
            }
        });
        containerEl.querySelector('#nai-api-preset-update')?.addEventListener('click', async () => {
            await this._updateApiPreset();
            // 重置修改状态
            if (this.ctx.getModule('settingsPanel')) {
                this.ctx.getModule('settingsPanel').isApiPresetModified.nai = false;
            }
        });
        containerEl.querySelector('#nai-api-preset-save')?.addEventListener('click', () => this._saveApiPreset());
        containerEl.querySelector('#nai-api-preset-delete')?.addEventListener('click', () => this._deleteApiPreset());

        // 防傻操作：监听API预设相关输入框变化
        const channelSelect = containerEl.querySelector('#nai-channel');
        const urlInput = containerEl.querySelector('#nai-api-url');
        const tokenInput = containerEl.querySelector('#nai-token');
        const proxyStreamSelect = containerEl.querySelector('#nai-proxy-stream');
        if (channelSelect) {
            channelSelect.addEventListener('change', () => {
                if (this.ctx.getModule('settingsPanel')) {
                    this.ctx.getModule('settingsPanel').isApiPresetModified.nai = true;
                }
            });
        }
        if (urlInput) {
            urlInput.addEventListener('input', () => {
                if (this.ctx.getModule('settingsPanel')) {
                    this.ctx.getModule('settingsPanel').isApiPresetModified.nai = true;
                }
            });
        }
        if (tokenInput) {
            tokenInput.addEventListener('input', () => {
                if (this.ctx.getModule('settingsPanel')) {
                    this.ctx.getModule('settingsPanel').isApiPresetModified.nai = true;
                }
            });
        }
        if (proxyStreamSelect) {
            proxyStreamSelect.addEventListener('change', () => {
                if (this.ctx.getModule('settingsPanel')) {
                    this.ctx.getModule('settingsPanel').isApiPresetModified.nai = true;
                }
            });
        }
        //  渲染预设下拉框
        this._renderPresetDropdown();
        this._applyActivePresetToUI();

        //  预设下拉框切换事件
        containerEl.querySelector('#nai-preset-select')?.addEventListener('change', (e) => {
            this.activePresetName = e.target.value;
            this._applyActivePresetToUI();
        });

        //  预设保存事件
        containerEl.querySelector('#nai-preset-save')?.addEventListener('click', async () => {
            await this._saveAsNewPreset();
        });

        //  预设删除事件
        containerEl.querySelector('#nai-preset-delete')?.addEventListener('click', async () => {
            await this._deleteActivePreset();
        });

        //  触发词输入事件
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

        // Vibe 上传
        containerEl.querySelector('#nai-vibe-upload-btn')?.addEventListener('click', () => {
            containerEl.querySelector('#nai-vibe-upload-input')?.click();
        });

        containerEl.querySelector('#nai-vibe-upload-input')?.addEventListener('change', (e) => {
            this._handleVibeUpload(e.target.files);
        });

        // 生成氛围文件
        containerEl.querySelector('#nai-vibe-generate-btn')?.addEventListener('click', () => {
            this._handleGenerateVibeFiles();
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
                // 优先检查所有基于JSON的格式
                if (file.name.endsWith('.naiv4vibe') || file.name.endsWith('.naiv4vibebundle') || file.name.endsWith('.json')) {
                    const text = await file.text();
                    const data = JSON.parse(text);

                    // 情况 1: 检测到是 Vibe Bundle 文件
                    if (data.identifier === 'novelai-vibe-transfer-bundle' && Array.isArray(data.vibes)) {
                        console.log(`[NAISettings] 检测到 Vibe Bundle 文件，包含 ${data.vibes.length} 个 Vibe。`);
                        for (const vibeData of data.vibes) {
                            if (!vibeData.encodings) continue;
                            
                            // 检查thumbnail是否是有效的图片格式，NAI特殊编码是data:application/binary;base64
                            let thumbnail = '';
                            if (vibeData.thumbnail && vibeData.thumbnail.startsWith('data:')) {
                                // 检查是否是图片格式，排除NAI特殊编码
                                if (vibeData.thumbnail.startsWith('data:image/')) {
                                    thumbnail = vibeData.thumbnail;
                                } else {
                                    console.log('[NAISettings] 跳过NAI特殊编码的thumbnail，使用空缩略图');
                                }
                            }

                            // --- ▼▼▼ 核心修复点 1：优先读取文件内参数 ▼▼▼ ---
                            this._addVibeImage({
                                type: 'vibeFile',
                                vibeData: vibeData,
                                image: thumbnail,
                                thumbnail: thumbnail,
                                strength: vibeData.importInfo?.strength ?? 0.6, // 优先使用文件内的 strength，否则用 0.6
                                infoExtracted: vibeData.importInfo?.information_extracted ?? 1.0, // 优先使用文件内的，否则用 1.0
                                name: vibeData.name || file.name,
                            });
                             // --- ▲▲▲ 核心修复点 1 结束 ▲▲▲ ---
                        }
                        this.ctx.helpers.showToast(`已从Bundle文件加载 ${data.vibes.length} 个参考图`, 'success');

                    // 情况 2: 检测到是单个 Vibe 文件
                    } else if (data.encodings) {
                        const vibeData = data;
                        
                        // 检查thumbnail是否是有效的图片格式，NAI特殊编码是data:application/binary;base64
                        let thumbnail = '';
                        if (vibeData.thumbnail && vibeData.thumbnail.startsWith('data:')) {
                            // 检查是否是图片格式，排除NAI特殊编码
                            if (vibeData.thumbnail.startsWith('data:image/')) {
                                thumbnail = vibeData.thumbnail;
                            } else {
                                console.log('[NAISettings] 跳过NAI特殊编码的thumbnail，使用空缩略图');
                            }
                        }

                        // --- ▼▼▼ 核心修复点 2：同样优先读取文件内参数 ▼▼▼ ---
                        this._addVibeImage({
                            type: 'vibeFile',
                            vibeData: vibeData,
                            image: thumbnail,
                            thumbnail: thumbnail,
                            strength: vibeData.importInfo?.strength ?? 0.6, // 优先使用文件内的 strength，否则用 0.6
                            infoExtracted: vibeData.importInfo?.information_extracted ?? 1.0, // 优先使用文件内的，否则用 1.0
                            name: vibeData.name || file.name,
                        });
                        // --- ▲▲▲ 核心修复点 2 结束 ▲▲▲ ---
                        console.log('[NAISettings] 已加载单个 .naiv4vibe 文件:', vibeData.name || file.name);

                    // 情况 3: 可能是插件导出的普通JSON文件
                    } else {
                        if (Array.isArray(data)) {
                            data.forEach(item => this._addVibeImage(item));
                        } else {
                            this._addVibeImage(data);
                        }
                    }
                // 如果不是JSON类文件，则当作普通图片处理
                } else if (file.type.startsWith('image/')) {
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
                this.ctx.helpers.showToast(`处理文件 ${file.name} 失败: ${error.message}`, 'error');
            }
        }

        // 循环结束后，统一更新UI
        this._renderVibeList();
        this._updateVibeStatus();
        this._updateActivePresetImages();
    }


    _addVibeImage(item) {
        if (this.referenceMode === 'director') {
            if (!item.mode) {
                item.mode = 'character';
            }
            if (item.strength === undefined) {
                item.strength = 1;
            }
            if (item.infoExtracted === undefined) {
                item.infoExtracted = 1;
            }
            if (item.secondaryStrength === undefined) {
                item.secondaryStrength = 0;
            }
            this.vibeImages.push(item);
        } else {
            this.vibeImages.push(item);
        }
    }

    async _handleGenerateVibeFiles() {
        console.log('[NAISettings] 开始生成氛围文件');
        
        const imageGen = this.ctx.getModule('imageGen');
        if (!imageGen) {
            this.ctx.helpers.showToast('无法获取图像生成模块', 'error');
            return;
        }

        const naiSettings = this._getSettings();
        
        if (this.vibeImages.length === 0) {
            this.ctx.helpers.showToast('请先上传参考图片', 'warning');
            return;
        }

        if (naiSettings.channel !== 'official') {
            this.ctx.helpers.showToast('此功能仅支持官方渠道', 'warning');
            return;
        }

        const baseUrl = naiSettings.proxyUrl || this.DEFAULT_OFFICIAL_URL;
        const vibeApiUrl = baseUrl.replace('/generate-image', '/encode-vibe');
        const model = naiSettings.model || 'nai-diffusion-4-5-curated';

        console.log('[NAISettings] 当前预设:', this.activePresetName);
        console.log('[NAISettings] 待处理图片数量:', this.vibeImages.length);
        console.log('[NAISettings] 使用API端点:', vibeApiUrl);

        const generateBtn = this.containerEl.querySelector('#nai-vibe-generate-btn');
        if (generateBtn) {
            generateBtn.disabled = true;
            generateBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> 生成中...';
        }

        let successCount = 0;
        let failCount = 0;

        for (let i = 0; i < this.vibeImages.length; i++) {
            const item = this.vibeImages[i];
            
            if (item.type === 'vibeFile') {
                console.log(`[NAISettings] 跳过已经是.naiv4vibe文件的图片 ${i + 1}`);
                continue;
            }

            const strength = item.strength ?? 0.6;
            const infoExtracted = item.infoExtracted ?? 1.0;
            let imageBase64 = item.image;

            if (!imageBase64) {
                console.warn(`[NAISettings] 图片 ${i + 1} 缺少图片数据，跳过`);
                failCount++;
                continue;
            }

            if (!imageBase64.startsWith('data:')) {
                console.log(`[NAISettings] 图片 ${i + 1} 是服务器路径，正在转换为base64:`, imageBase64);
                try {
                    imageBase64 = await this._convertServerPathToBase64(imageBase64);
                    if (!imageBase64) {
                        console.warn(`[NAISettings] 图片 ${i + 1} 转换失败，跳过`);
                        failCount++;
                        continue;
                    }
                } catch (error) {
                    console.error(`[NAISettings] 图片 ${i + 1} 转换base64失败:`, error);
                    failCount++;
                    continue;
                }
            }

            const imageHash = this._generateImageHash(imageBase64);
            
            if (item._processingHash === imageHash) {
                console.log(`[NAISettings] 图片 ${i + 1} 正在处理中，跳过重复请求`);
                continue;
            }

            item._processingHash = imageHash;

            console.log(`[NAISettings] 开始处理图片 ${i + 1}/${this.vibeImages.length}`);
            console.log('[NAISettings] 请求参数:', {
                model,
                information_extracted: infoExtracted,
                strength,
                imageHash: imageHash.substring(0, 16) + '...'
            });

            try {
                const vibeData = await this._requestVibeFile(vibeApiUrl, naiSettings.apiKey, imageBase64, infoExtracted, model);
                
                console.log(`[NAISettings] 图片 ${i + 1} 请求成功，返回数据:`, vibeData);

                if (vibeData && vibeData.encodings) {
                    // 使用上传时的原始图片作为缩略图，因为API返回的thumbnail是NAI特殊编码不是图片数据
                    this.vibeImages[i] = {
                        type: 'vibeFile',
                        vibeData: vibeData,
                        image: imageBase64,
                        thumbnail: imageBase64,
                        strength: strength,
                        infoExtracted: infoExtracted,
                        name: item.name || `vibe_${Date.now()}.naiv4vibe`,
                        _processingHash: undefined
                    };

                    successCount++;
                    console.log(`[NAISettings] 图片 ${i + 1} 成功转换为.naiv4vibe文件`);
                } else {
                    console.error(`[NAISettings] 图片 ${i + 1} 返回数据格式错误:`, vibeData);
                    failCount++;
                }

            } catch (error) {
                console.error(`[NAISettings] 图片 ${i + 1} 生成失败:`, error);
                failCount++;
                this.vibeImages[i]._processingHash = undefined;
            }
        }

        if (generateBtn) {
            generateBtn.disabled = false;
            generateBtn.innerHTML = '<i class="fa-solid fa-wand-magic-sparkles"></i> 生成氛围文件';
        }

        this._renderVibeList();
        this._updateVibeStatus();

        if (successCount > 0) {
            this._updateActivePresetImages();
            this.ctx.helpers.showToast(`成功生成 ${successCount} 个氛围文件${failCount > 0 ? `，失败 ${failCount} 个` : ''}`, successCount === this.vibeImages.length ? 'success' : 'warning');
        } else {
            this.ctx.helpers.showToast(`生成失败，请查看控制台日志`, 'error');
        }
    }

    async _requestVibeFile(apiUrl, apiKey, imageBase64, infoExtracted, model) {
        // 移除data URL前缀，只保留纯base64数据
        let pureBase64 = imageBase64;
        if (imageBase64.startsWith('data:')) {
            const commaIndex = imageBase64.indexOf(',');
            if (commaIndex > -1) {
                pureBase64 = imageBase64.substring(commaIndex + 1);
            }
        }
        
        const payload = {
            image: pureBase64,
            information_extracted: infoExtracted,
            model: model
        };

        console.log('[NAISettings] 发送氛围文件请求:', {
            url: apiUrl,
            payload: {
                ...payload,
                image: pureBase64.substring(0, 50) + '...'
            }
        });

        const response = await fetch(apiUrl, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(payload),
        });

        console.log('[NAISettings] 收到响应，状态码:', response.status);
        console.log('[NAISettings] 响应Content-Type:', response.headers.get('content-type'));

        if (!response.ok) {
            const errorText = await response.text();
            console.error('[NAISettings] 请求失败，响应内容:', errorText);
            throw new Error(`API 错误 (${response.status}): ${errorText}`);
        }

        // 检查响应类型
        const contentType = response.headers.get('content-type');
        let responseData;
        
        if (contentType && contentType.includes('application/json')) {
            // JSON响应
            responseData = await response.json();
            console.log('[NAISettings] 解析后的JSON响应数据:', responseData);
        } else {
            // 二进制响应
            const blob = await response.blob();
            console.log('[NAISettings] 收到二进制响应，大小:', blob.size, 'bytes');
            console.log('[NAISettings] 响应类型:', blob.type);
            
            // 尝试将二进制数据转换为base64
            const reader = new FileReader();
            responseData = await new Promise((resolve, reject) => {
                reader.onloadend = () => {
                    const base64Data = reader.result;
                    console.log('[NAISettings] 转换后的base64长度:', base64Data ? base64Data.length : 0);
                    resolve({
                        encodings: base64Data,
                        thumbnail: base64Data
                    });
                };
                reader.onerror = reject;
                reader.readAsDataURL(blob);
            });
        }

        return responseData;
    }

    _generateImageHash(base64String) {
        let hash = 0;
        const str = base64String.substring(0, 1000);
        for (let i = 0; i < str.length; i++) {
            const char = str.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash;
        }
        return hash.toString(36);
    }

    async _convertServerPathToBase64(serverPath) {
        try {
            const imageGen = this.ctx.getModule('imageGen');
            if (!imageGen || !imageGen.storageManager) {
                console.warn('[NAISettings] 无法获取storageManager');
                return null;
            }

            console.log('[NAISettings] 正在从服务器加载图片:', serverPath);
            
            const blob = await imageGen.storageManager._loadFromTavern(serverPath);
            if (!blob) {
                console.warn('[NAISettings] 从服务器加载图片失败');
                return null;
            }

            return new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onloadend = () => {
                    resolve(reader.result);
                };
                reader.onerror = reject;
                reader.readAsDataURL(blob);
            });
        } catch (error) {
            console.error('[NAISettings] 转换服务器路径为base64失败:', error);
            return null;
        }
    }

    _renderVibeList() {
        const container = this.containerEl?.querySelector('#nai-vibe-image-list');
        if (!container) return;

        if (this.vibeImages.length === 0) {
            container.innerHTML = '<p class="tsp-text-muted">暂无参考图片</p>';
            return;
        }

        const isDirectorMode = this.referenceMode === 'director';

        container.innerHTML = this.vibeImages.map((item, index) => {
            const isVibeFile = item.type === 'vibeFile';
            const thumbnailSrc = item.image || item.thumbnail || '';
            const typeLabel = isVibeFile ? `<span style="font-size: 0.7em; color: var(--tsp-accent-primary); margin-left: 5px;">.naiv4vibe</span>` : '';
            const nameLabel = item.name ? `<div style="font-size: 0.75em; color: var(--tsp-text-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 150px;">${item.name}</div>` : '';

            const thumbnailHtml = thumbnailSrc
                ? `<img src="${thumbnailSrc}" class="tsp-vibe-thumbnail" style="width: 60px; height: 60px; object-fit: cover; border-radius: 6px;">`
                : (isVibeFile 
                    ? `<div class="tsp-vibe-thumbnail" style="width: 60px; height: 60px; border-radius: 6px; background: rgba(122,162,247,0.2); display: flex; align-items: center; justify-content: center; position: relative; cursor: pointer;" onclick="document.getElementById('vibe-upload-${index}').click()">
                        <i class="fa-solid fa-upload" style="font-size: 1.5em; color: var(--tsp-accent-primary);"></i>
                        <input type="file" id="vibe-upload-${index}" accept="image/*" style="display: none;" data-index="${index}" class="vibe-thumbnail-upload">
                       </div>`
                    : `<div class="tsp-vibe-thumbnail" style="width: 60px; height: 60px; border-radius: 6px; background: rgba(122,162,247,0.2); display: flex; align-items: center; justify-content: center;"><i class="fa-solid fa-file-code" style="font-size: 1.5em; color: var(--tsp-accent-primary);"></i></div>`);

            const showInfoSlider = !isDirectorMode;

            const infoSliderHtml = showInfoSlider ? `
                <div class="tsp-slider-group" style="font-size: 0.85em; margin-bottom: 4px;">
                    <label style="min-width: 50px;">信息量</label>
                    <input type="range" class="tsp-slider vibe-info tsp-slider-desktop" data-index="${index}"
                           min="0.01" max="1" step="0.01" value="${item.infoExtracted ?? 1.0}">
                    <input type="number" class="tsp-input vibe-info-input tsp-slider-mobile" data-index="${index}"
                           min="0.01" max="1" step="0.01" value="${Number(item.infoExtracted ?? 1.0).toFixed(2)}">
                    <span class="tsp-slider-value tsp-slider-desktop">${Number(item.infoExtracted ?? 1.0).toFixed(2)}</span>
                </div>` : '';

            const modeSelectHtml = isDirectorMode ? `
                <div class="tsp-form-group" style="font-size: 0.85em; margin-bottom: 4px;">
                    <label style="min-width: 50px;">模式</label>
                    <select class="tsp-input vibe-mode tsp-slider-desktop" data-index="${index}" style="flex: 1;">
                        <option value="character&style" ${item.mode === 'character&style' ? 'selected' : ''}>角色+风格</option>
                        <option value="character" ${item.mode === 'character' || !item.mode ? 'selected' : ''}>角色</option>
                        <option value="style" ${item.mode === 'style' ? 'selected' : ''}>风格</option>
                    </select>
                    <select class="tsp-input vibe-mode-input tsp-slider-mobile" data-index="${index}" style="flex: 1;">
                        <option value="character&style" ${item.mode === 'character&style' ? 'selected' : ''}>角色+风格</option>
                        <option value="character" ${item.mode === 'character' || !item.mode ? 'selected' : ''}>角色</option>
                        <option value="style" ${item.mode === 'style' ? 'selected' : ''}>风格</option>
                    </select>
                </div>` : '';

            const strengthLabel = isDirectorMode ? '参考强度' : '强度';

            return `
                <div class="tsp-vibe-item" data-index="${index}">
                    ${thumbnailHtml}
                    <div class="tsp-vibe-info" style="flex: 1;">
                        ${nameLabel}
                        ${modeSelectHtml}
                        ${infoSliderHtml}
                        <div class="tsp-slider-group" style="font-size: 0.85em;">
                            <label style="min-width: 50px;">${strengthLabel}${typeLabel}</label>
                            <input type="range" class="tsp-slider vibe-strength tsp-slider-desktop" data-index="${index}"
                                   min="0.01" max="1" step="0.01" value="${item.strength ?? (isDirectorMode ? 1 : 0.6)}">
                            <input type="number" class="tsp-input vibe-strength-input tsp-slider-mobile" data-index="${index}"
                                   min="0.01" max="1" step="0.01" value="${Number(item.strength ?? (isDirectorMode ? 1 : 0.6)).toFixed(2)}">
                            <span class="tsp-slider-value tsp-slider-desktop">${Number(item.strength ?? (isDirectorMode ? 1 : 0.6)).toFixed(2)}</span>
                        </div>
                        ${isDirectorMode ? `
                        <div class="tsp-slider-group" style="font-size: 0.85em;">
                            <label style="min-width: 50px;">保真度</label>
                            <input type="range" class="tsp-slider vibe-fidelity tsp-slider-desktop" data-index="${index}"
                                   min="0.01" max="1" step="0.01" value="${item.infoExtracted ?? 1}">
                            <input type="number" class="tsp-input vibe-fidelity-input tsp-slider-mobile" data-index="${index}"
                                   min="0.01" max="1" step="0.01" value="${Number(item.infoExtracted ?? 1).toFixed(2)}">
                            <span class="tsp-slider-value tsp-slider-desktop">${Number(item.infoExtracted ?? 1).toFixed(2)}</span>
                        </div>` : ''}
                    </div>
                    <button class="tsp-btn tsp-btn-icon tsp-btn-danger vibe-delete" data-index="${index}">
                        <i class="fa-solid fa-trash"></i>
                    </button>
                </div>
            `;
        }).join('');

        container.querySelectorAll('.vibe-strength').forEach(slider => {
            slider.addEventListener('input', (e) => {
                const idx = parseInt(e.target.dataset.index);
                const value = parseFloat(e.target.value);
                this.vibeImages[idx].strength = value;
                const parent = e.target.parentElement;
                parent.querySelector('.vibe-strength-input').value = value.toFixed(2);
                parent.querySelector('.tsp-slider-value').textContent = value.toFixed(2);
                this._updateActivePresetImages();
            });
        });
        container.querySelectorAll('.vibe-strength-input').forEach(input => {
            input.addEventListener('input', (e) => {
                const idx = parseInt(e.target.dataset.index);
                const value = parseFloat(e.target.value);
                if (isNaN(value)) return;
                this.vibeImages[idx].strength = value;
                const parent = e.target.parentElement;
                parent.querySelector('.vibe-strength').value = value;
                parent.querySelector('.tsp-slider-value').textContent = value.toFixed(2);
                this._updateActivePresetImages();
            });
        });

        container.querySelectorAll('.vibe-info').forEach(slider => {
            slider.addEventListener('input', (e) => {
                const idx = parseInt(e.target.dataset.index);
                const value = parseFloat(e.target.value);
                this.vibeImages[idx].infoExtracted = value;
                const parent = e.target.parentElement;
                parent.querySelector('.vibe-info-input').value = value.toFixed(2);
                parent.querySelector('.tsp-slider-value').textContent = value.toFixed(2);
                this._updateActivePresetImages();
            });
        });
        container.querySelectorAll('.vibe-info-input').forEach(input => {
            input.addEventListener('input', (e) => {
                const idx = parseInt(e.target.dataset.index);
                const value = parseFloat(e.target.value);
                if (isNaN(value)) return;
                this.vibeImages[idx].infoExtracted = value;
                const parent = e.target.parentElement;
                parent.querySelector('.vibe-info').value = value;
                parent.querySelector('.tsp-slider-value').textContent = value.toFixed(2);
                this._updateActivePresetImages();
            });
        });

        container.querySelectorAll('.vibe-mode').forEach(select => {
            select.addEventListener('change', (e) => {
                const idx = parseInt(e.target.dataset.index);
                this.vibeImages[idx].mode = e.target.value;
                const parent = e.target.parentElement;
                parent.querySelector('.vibe-mode-input').value = e.target.value;
                this._updateActivePresetImages();
            });
        });
        container.querySelectorAll('.vibe-mode-input').forEach(select => {
            select.addEventListener('change', (e) => {
                const idx = parseInt(e.target.dataset.index);
                this.vibeImages[idx].mode = e.target.value;
                const parent = e.target.parentElement;
                parent.querySelector('.vibe-mode').value = e.target.value;
                this._updateActivePresetImages();
            });
        });

        container.querySelectorAll('.vibe-fidelity').forEach(slider => {
            slider.addEventListener('input', (e) => {
                const idx = parseInt(e.target.dataset.index);
                const value = parseFloat(e.target.value);
                this.vibeImages[idx].infoExtracted = value;
                const parent = e.target.parentElement;
                parent.querySelector('.vibe-fidelity-input').value = value.toFixed(2);
                parent.querySelector('.tsp-slider-value').textContent = value.toFixed(2);
                this._updateActivePresetImages();
            });
        });
        container.querySelectorAll('.vibe-fidelity-input').forEach(input => {
            input.addEventListener('input', (e) => {
                const idx = parseInt(e.target.dataset.index);
                const value = parseFloat(e.target.value);
                if (isNaN(value)) return;
                this.vibeImages[idx].infoExtracted = value;
                const parent = e.target.parentElement;
                parent.querySelector('.vibe-fidelity').value = value;
                parent.querySelector('.tsp-slider-value').textContent = value.toFixed(2);
                this._updateActivePresetImages();
            });
        });

        container.querySelectorAll('.vibe-delete').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const idx = parseInt(e.currentTarget.dataset.index);
                this.vibeImages.splice(idx, 1);
                this._renderVibeList();
                this._updateVibeStatus();
                this._updateActivePresetImages();
            });
        });

        // 处理缩略图上传
        container.querySelectorAll('.vibe-thumbnail-upload').forEach(input => {
            input.addEventListener('change', async (e) => {
                const idx = parseInt(e.target.dataset.index);
                const file = e.target.files[0];
                if (!file) return;

                try {
                    const base64 = await new Promise((resolve, reject) => {
                        const reader = new FileReader();
                        reader.onloadend = () => resolve(reader.result);
                        reader.onerror = reject;
                        reader.readAsDataURL(file);
                    });

                    this.vibeImages[idx].image = base64;
                    this.vibeImages[idx].thumbnail = base64;
                    this._renderVibeList();
                    this._updateActivePresetImages();
                    this.ctx.helpers.showToast('缩略图上传成功', 'success');
                } catch (error) {
                    console.error('[NAISettings] 上传缩略图失败:', error);
                    this.ctx.helpers.showToast('上传缩略图失败', 'error');
                }
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
     *  更新当前 API 预设并同步到文件
     */
    async _updateApiPreset() {
        const imageGen = this.ctx.getModule('imageGen');
        const naiSettings = imageGen.settings.nai;

        if (!this.activeApiPreset) {
            this.ctx.helpers.showToast('请先选择一个预设', 'warning');
            return;
        }

        const presets = naiSettings.apiPresets || [];
        const index = presets.findIndex(p => p.name === this.activeApiPreset);

        if (index === -1) {
            this.ctx.helpers.showToast('预设索引丢失，请刷新面板', 'error');
            return;
        }

        // 1. 获取 UI 值
        const channel = this.containerEl.querySelector('#nai-channel')?.value;
        const proxyUrl = this.containerEl.querySelector('#nai-api-url')?.value.trim();
        const apiKey = this.containerEl.querySelector('#nai-token')?.value.trim();

        // 2. 强制写入主内存
        presets[index] = {
            ...presets[index],
            channel: channel,
            proxyUrl: proxyUrl,
            apiKey: apiKey
        };
        naiSettings.apiPresets = presets;

        try {
            // 3. 保存文件
            await imageGen.saveSettings();

            // 4. 同步本地缓存
            this.apiPresets = JSON.parse(JSON.stringify(presets));
            this.ctx.helpers.showToast(`预设 "${this.activeApiPreset}" 已更新并同步`, 'success');
        } catch (e) {
            this.ctx.helpers.showToast(`保存失败: ${e.message}`, 'error');
        }
    }

    /**
     * 删除当前API预设
     */
    async _deleteApiPreset() {
        if (!this.activeApiPreset) return;

        const confirmed = await this.ctx.helpers.promptConfirm(`确定要删除预设 "${this.activeApiPreset}" 吗?`);
        if (!confirmed) return;

        // --- 新增修改：获取 imageGen 模块，以便调用保存方法 ---
        const imageGen = this.ctx.getModule('imageGen');
        if (!imageGen) {
            this.ctx.helpers.showToast('错误：找不到 imageGen 模块', 'error');
            return;
        }

        // 从内存数组中过滤掉要删除的预设
        this.apiPresets = this.apiPresets.filter(p => p.name !== this.activeApiPreset);

        // --- 新增修改：将更新后的预设数组写回主设置对象 ---
        // 注意这里是 `imageGen.settings.nai`
        if (imageGen.settings.nai) {
            imageGen.settings.nai.apiPresets = this.apiPresets;
        }

        // 重新设置当前激活的预设
        this.activeApiPreset = this.apiPresets.length > 0 ? this.apiPresets[0].name : '';

        // --- 新增修改：立即保存设置以持久化删除操作 ---
        try {
            await imageGen.saveSettings();
            this.ctx.helpers.showToast('API 预设已删除', 'success');
        } catch (e) {
            this.ctx.helpers.showToast('保存设置失败，请在关闭时手动保存', 'error');
            console.error('[NAISettings] 删除预设后保存设置时出错：', e);
        }
        // --- 修改结束 ---

        // 更新 UI 显示
        this._renderApiPresetDropdown();
        this._applyActiveApiPresetToUI();
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
            this.vibeImages = preset.images || [];
            this.referenceMode = preset.referenceMode || 'vibe';

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

    _updateActivePresetImages() {
        if (!this.activePresetName) return;
        const preset = this.naiPresets.find(p => p.name === this.activePresetName);
        if (preset) {
            preset.images = JSON.parse(JSON.stringify(this.vibeImages));
            console.log('[NAISettings] 已更新预设的images数据:', preset.name, '图片数量:', preset.images.length);
            
            const imageGen = this.ctx.getModule('imageGen');
            if (imageGen && imageGen.storageManager) {
                imageGen.settings.nai.naiPresets = this.naiPresets;
                imageGen.saveSettings().catch(err => {
                    console.error('[NAISettings] 保存预设到服务器失败:', err);
                });
            }
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
            images: JSON.parse(JSON.stringify(this.vibeImages)),
        };

        this.naiPresets.push(newPreset);
        this.activePresetName = newName;

        this._renderPresetDropdown();
        
        const imageGen = this.ctx.getModule('imageGen');
        if (imageGen && imageGen.storageManager) {
            imageGen.settings.nai.naiPresets = this.naiPresets;
            try {
                await imageGen.saveSettings();
            } catch (err) {
                console.error('[NAISettings] 保存预设到服务器失败:', err);
            }
        }
        
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

        //  保存当前正在编辑的预设（如果不是 "新建" 状态）
        if (this.activePresetName) {
            const preset = this.naiPresets.find(p => p.name === this.activePresetName);
            if (preset) {
                preset.triggerWords = this.containerEl.querySelector('#nai-preset-triggers')?.value.trim() || '';
                preset.referenceMode = this.referenceMode;
                preset.images = JSON.parse(JSON.stringify(this.vibeImages));
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
            vibeImages: this.vibeImages,
            apiPresets: this.apiPresets,
            activeApiPreset: activeApiPresetName,
            //  收集情绪配置
            emotions: this._collectEmotions(),
        };
    }

    // [修改] 辅助函数：收集情绪配置 (智能判断来源)
    _collectEmotions() {
        // 如果 UI 根本没加载（比如面板还没打开过），直接返回内存中的初始值
        if (!this.containerEl) return this.loadedEmotions || {};

        // 检查情绪网格是否已经渲染（检查是否有 inputs 存在）
        // 这里检查是否有 class 为 emotion-triggers 的元素
        const renderedInputs = this.containerEl.querySelectorAll('.emotion-triggers');

        // [核心安全逻辑] 如果 UI 未渲染 (length 为 0)，则直接返回内存中暂存的配置
        // 这样可以防止覆盖为空数据
        if (renderedInputs.length === 0) {
            return this.loadedEmotions || {};
        }

        // [核心逻辑] 如果 UI 已渲染，则从 UI 收集最新数据，并更新内存缓存
        const emotions = {};
        renderedInputs.forEach(input => {
            const key = input.dataset.key;
            const triggers = input.value.trim();
            const strengthSelect = this.containerEl.querySelector(`.emotion-strength[data-key="${key}"]`);
            const strength = parseInt(strengthSelect?.value || '0');

            if (triggers) {
                emotions[key] = { triggers, strength };
            }
        });

        // 更新内存缓存，供下次使用
        this.loadedEmotions = emotions;
        return emotions;
    }

}
