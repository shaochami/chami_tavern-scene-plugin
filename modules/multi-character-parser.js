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
        sceneCompositionHeader: 'Scene Composition:(通用),(背景),(构图)',
        characterPromptTemplate: 'Character {n} Prompt:',
        characterUCTemplate: 'Character {n} UC:',
        negativePromptHeader: 'Negative prompt:',
        coordinateTemplate: '|centers:{coord}',
        maxCharacters: 4
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
        const colonIndex = header.indexOf(':');
        return colonIndex !== -1 ? header.substring(0, colonIndex) : header;
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

        const match = gridRef.trim().toLowerCase().match(/^([a-e])([1-5])$/);
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

    static parseScene(promptString) {
        const maxChars = this.config.maxCharacters || 4;
        const sceneHeaderBase = this._getSceneHeaderBase();
        
        const result = {
            'Scene Composition': '',
            'Negative prompt': '',
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
            result['Scene Composition'] = sceneMatch[2].trim();
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
                const coordPattern = this._escapeRegex(coordBase) + '\\s*([A-Ea-e][1-5])';
                const coordRegex = new RegExp(coordPattern, 'i');
                const coordMatch = content.match(coordRegex);
                
                if (coordMatch) {
                    content = content.replace(coordMatch[0], '').trim();
                    result[`Character ${i} centers`] = coordMatch[1].toUpperCase();
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

        const sceneHeaderBase = this._getSceneHeaderBase();
        result = result.replace(new RegExp(this._escapeRegex(sceneHeaderBase), 'gi'), ',');

        for (let i = 1; i <= maxChars; i++) {
            const promptHeader = this._escapeRegex(this._getPromptHeaderForChar(i));
            result = result.replace(new RegExp(promptHeader, 'gi'), ',');
        }

        const coordMarker = this.config.coordinateTemplate || '|centers:{coord}';
        const coordBase = coordMarker.replace('{coord}', '');
        result = result.replace(new RegExp(this._escapeRegex(coordBase) + '\\s*[A-Ea-e][1-5]', 'gi'), '');

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

        for (let i = 1; i <= maxChars; i++) {
            const charPrompt = parsedData[`Character ${i} Prompt`];
            if (charPrompt) {
                const coordinates = parsedData[`Character ${i} coordinates`];
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
                use_coords: useCoords,
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

        const sceneHeaderBase = this._getSceneHeaderBase();
        result = result.replace(new RegExp(this._escapeRegex(sceneHeaderBase), 'gi'), ',');

        for (let i = 1; i <= maxChars; i++) {
            const promptHeader = this._escapeRegex(this._getPromptHeaderForChar(i));
            result = result.replace(new RegExp(promptHeader, 'gi'), ',');
        }

        const coordMarker = this.config.coordinateTemplate || '|centers:{coord}';
        const coordBase = coordMarker.replace('{coord}', '');
        result = result.replace(new RegExp(this._escapeRegex(coordBase) + '\\s*[A-Ea-e][1-5]', 'gi'), '');

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
        
        let template = `${sceneHeader}场景描述内容;\n\n`;
        
        const defaultCoords = ['C3', 'A2', 'E2', 'C4', 'B3', 'D3'];
        
        for (let i = 1; i <= numCharacters; i++) {
            const promptHeader = this._getPromptHeaderForChar(i);
            const ucHeader = this._getUCHeaderForChar(i);
            const coord = includeCoords ? ' ' + coordTemplate.replace('{coord}', defaultCoords[i - 1] || 'C3') : '';
            
            template += `${promptHeader}角色${i}描述${coord};\n`;
            template += `${ucHeader}角色${i}负面词;\n\n`;
        }
        
        template += `${negativeHeader}全局负面提示词;`;
        
        return template;
    }
}
