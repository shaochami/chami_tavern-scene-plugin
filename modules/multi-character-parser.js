'use strict';

/**
 * NAI V4+ 多角色场景解析器模块
 * 通过正则表达式解析多角色提示词，构建结构化数据
 * 支持自定义字段头和 {n} 占位符
 */

export class MultiCharacterParser {
    static COLUMN_MAP = { 'a': 0.1, 'b': 0.3, 'c': 0.5, 'd': 0.7, 'e': 0.9 };
    static ROW_MAP = { '1': 0.1, '2': 0.3, '3': 0.5, '4': 0.7, '5': 0.9 };

    static defaultConfig = {
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
    };

    static config = { ...this.defaultConfig };

    static setConfig(newConfig) {
        if (newConfig && typeof newConfig === 'object') {
            this.config = { ...this.defaultConfig, ...newConfig };
            console.log('[MultiCharacterParser] 配置已更新:', this.config);
        }
    }

    static getConfig() {
        return { ...this.config };
    }

    static resetConfig() {
        this.config = { ...this.defaultConfig };
    }

    static _getSceneHeaderBase() {
        const header = this.config.sceneCompositionHeader || this.defaultConfig.sceneCompositionHeader;
        return header;
    }

    static _getPromptHeaderForChar(charNum) {
        const template = this.config.characterPromptTemplate || this.defaultConfig.characterPromptTemplate;
        return template.replace('{n}', String(charNum));
    }

    static _getUCHeaderForChar(charNum) {
        const template = this.config.characterUCTemplate || this.defaultConfig.characterUCTemplate;
        return template.replace('{n}', String(charNum));
    }

    static _getCoordinateMarker(coord) {
        const template = this.config.coordinateTemplate || this.defaultConfig.coordinateTemplate;
        return template.replace('{coord}', coord);
    }

    static gridRefToNormalizedCoords(gridRef) {
        if (!gridRef || typeof gridRef !== 'string') return {};

        const trimmed = gridRef.trim().toLowerCase();
        if (trimmed === 'auto') {
            return { x: 0.5, y: 0.5 };
        }

        const match = trimmed.match(/^([a-e])([1-5])$/);
        if (!match) {
            console.warn(`[MultiCharacterParser] 无效的网格坐标: "${gridRef}"`);
            return {};
        }

        const [, column, row] = match;
        return {
            x: this.COLUMN_MAP[column] || 0.5,
            y: this.ROW_MAP[row] || 0.5,
        };
    }

    static gridRefToBoundingBox(gridRef) {
        const SPREAD_X = 0.25;
        const SPREAD_Y = 0.40;

        const ref = gridRef.trim().toLowerCase();
        const col = ref.charAt(0);
        const row = ref.charAt(1);

        const centerX = this.COLUMN_MAP[col] || 0.5;
        const centerY = this.ROW_MAP[row] || 0.5;

        const x1 = Math.max(0, centerX - SPREAD_X).toFixed(2);
        const x2 = Math.min(1, centerX + SPREAD_X).toFixed(2);
        const y1 = Math.max(0, centerY - SPREAD_Y).toFixed(2);
        const y2 = Math.min(1, centerY + SPREAD_Y).toFixed(2);

        return { x1, x2, y1, y2 };
    }

    static MIN_RESOLUTION = 64;
    static MAX_RESOLUTION = 8192;

    static _isValidResolution(w, h) {
        return Number.isFinite(w) && Number.isFinite(h)
            && w >= this.MIN_RESOLUTION && h >= this.MIN_RESOLUTION
            && w <= this.MAX_RESOLUTION && h <= this.MAX_RESOLUTION;
    }

    static _extractResolutionFromString(text) {
        if (!this.config.resolutionEnabled) return null;
        if (!text || typeof text !== 'string') return null;
        const resTemplate = this.config.resolutionTemplate || this.defaultConfig.resolutionTemplate;
        if (!resTemplate) return null;

        const resBase = this._escapeRegex(resTemplate);
        const resPattern = new RegExp(`${resBase}\\s*(\\d+)\\s*[xX]\\s*(\\d+)`, 'i');
        const match = text.match(resPattern);

        if (match) {
            const w = parseInt(match[1], 10);
            const h = parseInt(match[2], 10);
            if (this._isValidResolution(w, h)) {
                return { width: w, height: h, rawMatch: match[0] };
            }
        }
        return null;
    }

    static _extractStylePresetFromString(text) {
        if (!this.config.stylePresetEnabled) return null;
        if (!text || typeof text !== 'string') return null;
        const presetTemplate = this.config.stylePresetTemplate || this.defaultConfig.stylePresetTemplate;
        if (!presetTemplate) return null;

        const presetBase = this._escapeRegex(presetTemplate);
        const presetPattern = new RegExp(`${presetBase}\\s*([^;\\s]+(?:\\s+[^;\\s]+)*)`, 'i');
        const match = text.match(presetPattern);

        if (match) {
            const name = (match[1] || '').trim();
            if (name) {
                return { name: name, rawMatch: match[0] };
            }
        }
        return null;
    }

    static extractStylePresetFromPrompt(promptString) {
        if (!promptString || typeof promptString !== 'string') return null;
        const maxChars = this.config.maxCharacters || 4;
        const sceneHeaderBase = this._getSceneHeaderBase();
        const sceneHeaderPattern = this._escapeRegex(sceneHeaderBase);
        const sceneRegex = new RegExp(`(${sceneHeaderPattern})\\s*([^;]+);`, 'gi');
        const sceneMatch = sceneRegex.exec(promptString);

        if (sceneMatch) {
            const extracted = this._extractStylePresetFromString(sceneMatch[2]);
            if (extracted) return extracted;
        }

        const charPromptPatterns = [];
        for (let i = 1; i <= maxChars; i++) {
            charPromptPatterns.push(this._escapeRegex(this._getPromptHeaderForChar(i)));
        }

        for (const promptHeader of charPromptPatterns) {
            const promptRegex = new RegExp(`(${promptHeader})\\s*([^;]+);`, 'gi');
            const promptMatch = promptRegex.exec(promptString);
            if (promptMatch) {
                const extracted = this._extractStylePresetFromString(promptMatch[2]);
                if (extracted) return extracted;
            }
        }

        const extracted = this._extractStylePresetFromString(promptString);
        return extracted;
    }

    static extractResolutionFromPrompt(promptString) {
        if (!promptString || typeof promptString !== 'string') return null;
        const maxChars = this.config.maxCharacters || 4;
        const sceneHeaderBase = this._getSceneHeaderBase();
        const sceneHeaderPattern = this._escapeRegex(sceneHeaderBase);
        const sceneRegex = new RegExp(`(${sceneHeaderPattern})\\s*([^;]+);`, 'gi');
        const sceneMatch = sceneRegex.exec(promptString);

        if (sceneMatch) {
            const extracted = this._extractResolutionFromString(sceneMatch[2]);
            if (extracted) return extracted;
        }

        const charPromptPatterns = [];
        for (let i = 1; i <= maxChars; i++) {
            charPromptPatterns.push(this._escapeRegex(this._getPromptHeaderForChar(i)));
        }

        for (const promptHeader of charPromptPatterns) {
            const promptRegex = new RegExp(`(${promptHeader})\\s*([^;]+);`, 'gi');
            const promptMatch = promptRegex.exec(promptString);
            if (promptMatch) {
                const extracted = this._extractResolutionFromString(promptMatch[2]);
                if (extracted) return extracted;
            }
        }

        const extracted = this._extractResolutionFromString(promptString);
        return extracted;
    }

    static parseScene(promptString) {
        const maxChars = this.config.maxCharacters || 4;
        const sceneHeaderBase = this._getSceneHeaderBase();

        const result = {
            'Scene Composition': '',
            'Negative prompt': '',
            'Extracted Resolution': null,
            'Style Preset Name': null,
            'Has Auto Coord': false,
        };

        for (let i = 1; i <= maxChars; i++) {
            result[`Character ${i} Prompt`] = '';
            result[`Character ${i} UC`] = '';
            result[`Character ${i} centers`] = '';
            result[`Character ${i} coordinates`] = {};
        }

        if (!promptString || typeof promptString !== 'string') {
            return result;
        }

        const sceneHeaderPattern = this._escapeRegex(sceneHeaderBase);
        const promptPatterns = [];
        const ucPatterns = [];

        for (let i = 1; i <= maxChars; i++) {
            promptPatterns.push(this._escapeRegex(this._getPromptHeaderForChar(i)));
            ucPatterns.push(this._escapeRegex(this._getUCHeaderForChar(i)));
        }

        const sceneRegex = new RegExp(`(${sceneHeaderPattern})\\s*([^;]+);`, 'gi');
        const sceneMatch = sceneRegex.exec(promptString);
        if (sceneMatch) {
            let sceneContent = sceneMatch[2].trim();
            const resExtracted = this._extractResolutionFromString(sceneContent);
            if (resExtracted) {
                sceneContent = sceneContent.replace(resExtracted.rawMatch, '').trim();
                result['Extracted Resolution'] = { width: resExtracted.width, height: resExtracted.height };
            }
            const presetExtracted = this._extractStylePresetFromString(sceneContent);
            if (presetExtracted) {
                sceneContent = sceneContent.replace(presetExtracted.rawMatch, '').trim();
                result['Style Preset Name'] = presetExtracted.name;
            }
            result['Scene Composition'] = sceneContent;
        }

        if (!result['Extracted Resolution']) {
            const globalRes = this._extractResolutionFromString(promptString);
            if (globalRes) {
                result['Extracted Resolution'] = { width: globalRes.width, height: globalRes.height };
            }
        }

        if (!result['Style Preset Name']) {
            const globalPreset = this.extractStylePresetFromPrompt(promptString);
            if (globalPreset) {
                result['Style Preset Name'] = globalPreset.name;
            }
        }

        for (let i = 1; i <= maxChars; i++) {
            const promptHeader = this._escapeRegex(this._getPromptHeaderForChar(i));
            const ucHeader = this._escapeRegex(this._getUCHeaderForChar(i));

            const promptRegex = new RegExp(`(${promptHeader})\\s*([^;]+);`, 'gi');
            const promptMatch = promptRegex.exec(promptString);
            if (promptMatch) {
                let content = promptMatch[2].trim();
                const coordMarker = this.config.coordinateTemplate || '|centers:{coord}';
                const coordBase = coordMarker.replace('{coord}', '');
                const coordPattern = this._escapeRegex(coordBase) + '\\s*([A-Ea-e][1-5]|auto)';
                const coordRegex = new RegExp(coordPattern, 'i');
                const coordMatch = content.match(coordRegex);

                if (coordMatch) {
                    content = content.replace(coordMatch[0], '').trim();
                    const coordValue = coordMatch[1].trim().toLowerCase();
                    result[`Character ${i} centers`] = coordValue === 'auto' ? 'AUTO' : coordMatch[1].toUpperCase();
                    if (coordValue === 'auto') {
                        result['Has Auto Coord'] = true;
                    }
                    result[`Character ${i} coordinates`] = this.gridRefToNormalizedCoords(coordMatch[1]);
                }

                result[`Character ${i} Prompt`] = content;
            }

            const ucRegex = new RegExp(`(${ucHeader})\\s*([^;]+);`, 'gi');
            const ucMatch = ucRegex.exec(promptString);
            if (ucMatch) {
                result[`Character ${i} UC`] = ucMatch[2].trim();
            }
        }

        const negativeHeader = this.config.negativePromptHeader || 'Negative prompt:';
        const negativeHeaderPattern = this._escapeRegex(negativeHeader);
        const negativeRegex = new RegExp(`(${negativeHeaderPattern})\\s*([^;]+);`, 'gi');
        const negativeMatch = negativeRegex.exec(promptString);
        if (negativeMatch) {
            result['Negative prompt'] = negativeMatch[2].trim();
        }

        const hasCharacters = Array.from({ length: maxChars }, (_, i) => i + 1)
            .some(i => result[`Character ${i} Prompt`]);

        if (!result['Scene Composition'] && !hasCharacters) {
            console.warn('[MultiCharacterParser] 检测到格式不正确的多角色提示词，将使用通用平铺方法');
            result['Scene Composition'] = this.genericFlatten(promptString);
        }

        return result;
    }

    static _escapeRegex(str) {
        return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    static isMultiCharacterPrompt(promptString) {
        if (!promptString || typeof promptString !== 'string') return false;

        const sceneHeaderBase = this._getSceneHeaderBase();
        const sceneHeaderPattern = this._escapeRegex(sceneHeaderBase);

        if (new RegExp(`(${sceneHeaderPattern})`, 'i').test(promptString)) {
            return true;
        }

        const promptTemplate = this.config.characterPromptTemplate || this.defaultConfig.characterPromptTemplate;
        const promptPatternBase = promptTemplate.replace('{n}', '\\d+');
        const promptPattern = this._escapeRegex(promptPatternBase).replace('\\\\d\\+', '\\d+');

        return new RegExp(`(${promptPattern})`, 'i').test(promptString);
    }

    static flattenMultiCharacterPrompt(promptString) {
        if (!this.isMultiCharacterPrompt(promptString)) {
            return promptString;
        }

        console.log('[MultiCharacterParser] 检测到多角色语法，将平铺为普通 Tags');

        const maxChars = this.config.maxCharacters || 4;
        let result = promptString;

        for (let i = 1; i <= maxChars; i++) {
            const ucHeader = this._escapeRegex(this._getUCHeaderForChar(i));
            const ucRegex = new RegExp(`${ucHeader}.*?(;|BREAK|$)`, 'gis');
            result = result.replace(ucRegex, '');
        }

        // 移除全局 negative prompt 段落（与角色 UC 同样处理：从头部分隔符开始，直到 ; / BREAK / 结尾）
        const globalNegHeader = this.config.negativePromptHeader || this.defaultConfig.negativePromptHeader;
        const globalNegEscaped = this._escapeRegex(globalNegHeader);
        result = result.replace(new RegExp(`${globalNegEscaped}.*?(;|BREAK|$)`, 'gis'), '');

        const sceneHeaderBase = this._getSceneHeaderBase();
        result = result.replace(new RegExp(this._escapeRegex(sceneHeaderBase), 'gi'), '');
        result = result.replace(/^\s*,\s*/, '');
        result = result.replace(/\s*;\s*/g, ',');

        for (let i = 1; i <= maxChars; i++) {
            const promptHeader = this._escapeRegex(this._getPromptHeaderForChar(i));
            result = result.replace(new RegExp(promptHeader, 'gi'), ',');
        }

        const coordMarker = this.config.coordinateTemplate || '|centers:{coord}';
        const coordBase = coordMarker.replace('{coord}', '');
        result = result.replace(new RegExp(this._escapeRegex(coordBase) + '\\s*([A-Ea-e][1-5]|auto)', 'gi'), '');

        const resMarker = this.config.resolutionTemplate || this.defaultConfig.resolutionTemplate;
        if (this.config.resolutionEnabled && resMarker) {
            const resBase = this._escapeRegex(resMarker);
            result = result.replace(new RegExp(`${resBase}\\s*\\d+\\s*[xX]\\s*\\d+`, 'gi'), '');
        }

        const presetMarker = this.config.stylePresetTemplate || this.defaultConfig.stylePresetTemplate;
        if (this.config.stylePresetEnabled && presetMarker) {
            const presetBase = this._escapeRegex(presetMarker);
            result = result.replace(new RegExp(`${presetBase}\\s*[^;,]*(?=;|,|$)`, 'gi'), '');
        }

        result = result
            .replace(/[|;]/g, ',')
            .replace(/BREAK/gi, ',')
            .replace(/,\s*,/g, ',')
            .replace(/^\s*,\s*/, '')
            .replace(/\s*,\s*$/, '')
            .replace(/\s+/g, ' ')
            .trim();

        return result;
    }

    static buildV4MultiCharacterPrompt(parsedData, basePrompt, negativePrompt, useCoords = false) {
        const charCaptionsPrompt = [];
        const charCaptionsUC = [];
        const maxChars = this.config.maxCharacters || 4;

        const hasAutoCoord = parsedData['Has Auto Coord'] === true;
        const finalUseCoords = hasAutoCoord ? false : useCoords;
        const defaultCenter = { x: 0.5, y: 0.5 };

        for (let i = 1; i <= maxChars; i++) {
            const charPrompt = parsedData[`Character ${i} Prompt`];
            if (charPrompt) {
                const coordinates = hasAutoCoord ? defaultCenter : (parsedData[`Character ${i} coordinates`] || defaultCenter);
                const charUC = parsedData[`Character ${i} UC`] || '';

                charCaptionsPrompt.push({
                    char_caption: charPrompt,
                    centers: [coordinates],
                });

                charCaptionsUC.push({
                    char_caption: charUC,
                    centers: [coordinates],
                });
            }
        }

        return {
            v4_prompt: {
                caption: {
                    base_caption: basePrompt,
                    char_captions: charCaptionsPrompt,
                },
                use_coords: finalUseCoords,
                use_order: true,
            },
            v4_negative_prompt: {
                caption: {
                    base_caption: negativePrompt,
                    char_captions: charCaptionsUC,
                },
            },
        };
    }

    static flattenAndExtractUC(promptString) {
        if (!this.isMultiCharacterPrompt(promptString)) {
            return { positive: promptString, negative: '' };
        }

        const parsedData = this.parseScene(promptString);
        const maxChars = this.config.maxCharacters || 4;

        const positiveParts = [];
        if (parsedData['Scene Composition']) {
            positiveParts.push(parsedData['Scene Composition'].trim());
        }

        for (let i = 1; i <= maxChars; i++) {
            const charPrompt = parsedData[`Character ${i} Prompt`];
            if (charPrompt) {
                const coordMarker = this.config.coordinateTemplate || '|centers:{coord}';
                const coordBase = coordMarker.replace('{coord}', '');
                const cleanPrompt = charPrompt.replace(new RegExp(this._escapeRegex(coordBase) + '\\s*[A-Ea-e][1-5]', 'gi'), '').trim();
                positiveParts.push(cleanPrompt);
            }
        }

        const negativeParts = [];
        for (let i = 1; i <= maxChars; i++) {
            const charUC = parsedData[`Character ${i} UC`];
            if (charUC) {
                negativeParts.push(charUC.trim());
            }
        }
        // 同时包含全局负面提示词
        if (parsedData['Negative prompt']) {
            negativeParts.push(parsedData['Negative prompt'].trim());
        }

        return {
            positive: positiveParts.join(', '),
            negative: negativeParts.join(', '),
        };
    }

    static genericFlatten(promptString) {
        if (!this.isMultiCharacterPrompt(promptString)) {
            return promptString;
        }

        console.log('[MultiCharacterParser] genericFlatten: 执行通用平铺...');

        const maxChars = this.config.maxCharacters || 4;
        let result = promptString;

        for (let i = 1; i <= maxChars; i++) {
            const ucHeader = this._escapeRegex(this._getUCHeaderForChar(i));
            result = result.replace(new RegExp(`${ucHeader}.*?(;|BREAK|$)`, 'gis'), '');
        }

        // 移除全局 negative prompt 段落（与角色 UC 同样处理）
        const globalNegHeaderG = this.config.negativePromptHeader || this.defaultConfig.negativePromptHeader;
        const globalNegEscapedG = this._escapeRegex(globalNegHeaderG);
        result = result.replace(new RegExp(`${globalNegEscapedG}.*?(;|BREAK|$)`, 'gis'), '');

        const sceneHeaderBase = this._getSceneHeaderBase();
        result = result.replace(new RegExp(this._escapeRegex(sceneHeaderBase), 'gi'), '');
        result = result.replace(/^\s*,\s*/, '');
        result = result.replace(/\s*;\s*/g, ',');

        for (let i = 1; i <= maxChars; i++) {
            const promptHeader = this._escapeRegex(this._getPromptHeaderForChar(i));
            result = result.replace(new RegExp(promptHeader, 'gi'), ',');
        }

        const coordMarker = this.config.coordinateTemplate || '|centers:{coord}';
        const coordBase = coordMarker.replace('{coord}', '');
        result = result.replace(new RegExp(this._escapeRegex(coordBase) + '\\s*([A-Ea-e][1-5]|auto)', 'gi'), '');

        const resMarker = this.config.resolutionTemplate || this.defaultConfig.resolutionTemplate;
        if (this.config.resolutionEnabled && resMarker) {
            const resBase = this._escapeRegex(resMarker);
            result = result.replace(new RegExp(`${resBase}\\s*\\d+\\s*[xX]\\s*\\d+`, 'gi'), '');
        }

        const presetMarker = this.config.stylePresetTemplate || this.defaultConfig.stylePresetTemplate;
        if (this.config.stylePresetEnabled && presetMarker) {
            const presetBase = this._escapeRegex(presetMarker);
            result = result.replace(new RegExp(`${presetBase}\\s*[^;,]*(?=;|,|$)`, 'gi'), '');
        }

        result = result
            .replace(/BREAK|\n/gi, ',')
            .replace(/[|;]/g, ',')
            .replace(/,\s*,/g, ',')
            .replace(/,+/g, ',')
            .replace(/^\s*,\s*|\s*,\s*$/g, '')
            .replace(/\s+/g, ' ')
            .trim();

        return result;
    }

    static generatePromptTemplate(numCharacters, includeCoords = true) {
        const sceneHeader = this.config.sceneCompositionHeader || this.defaultConfig.sceneCompositionHeader;
        const negativeHeader = this.config.negativePromptHeader || this.defaultConfig.negativePromptHeader;
        const coordTemplate = this.config.coordinateTemplate || this.defaultConfig.coordinateTemplate;
        const resolutionTemplate = this.config.resolutionTemplate || this.defaultConfig.resolutionTemplate;

        let template = `${sceneHeader}场景描述内容;\n\n`;

        const defaultCoords = ['C3', 'A2', 'E2', 'C4', 'B3', 'D3'];

        for (let i = 1; i <= numCharacters; i++) {
            const promptHeader = this._getPromptHeaderForChar(i);
            const ucHeader = this._getUCHeaderForChar(i);
            const coord = includeCoords ? ' ' + coordTemplate.replace('{coord}', defaultCoords[i - 1] || 'C3') : '';

            template += `${promptHeader}角色${i}描述${coord};\n`;
            template += `${ucHeader}角色${i}负面词;\n\n`;
        }

        template += `${negativeHeader}全局负面提示词;\n\n`;
        if (this.config.resolutionEnabled && resolutionTemplate) {
            template += `${resolutionTemplate}832x1216;\n`;
        }
        if (this.config.stylePresetEnabled) {
            const stylePresetTemplate = this.config.stylePresetTemplate || this.defaultConfig.stylePresetTemplate;
            template += `${stylePresetTemplate}动漫;`;
        }

        return template;
    }
}
