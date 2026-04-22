'use strict';

/**
 * 手机模拟器聊天记录存储管理器
 * 使用IndexedDB存储聊天记录，支持按需加载
 * 聊天记录同时保存到服务器:
 *   - /user/files/tsp-chat-{角色卡名}-contacts.json (联系人)
 *   - /user/files/tsp-chat-{角色卡名}-messages.jsonl (消息，JSONL格式)
 */

import { getRequestHeaders } from '../../../../../../script.js';

export class PhoneChatStorage {
    constructor(context) {
        this.ctx = context;

        this.DB_NAME = 'tavern_phone_emulator';
        this.DB_VERSION = 16;
        this.db = null;

        this.stores = {
            'chat_records': { keyPath: 'id', autoIncrement: true },
            'chat_contacts': { keyPath: 'contactId' },
            'chat_groups': { keyPath: 'groupId' },
            'chat_group_records': { keyPath: 'id', autoIncrement: true },
            'chat_moments': { keyPath: 'id' },
            'chat_private_moments': { keyPath: 'id' },
            'chat_forum': { keyPath: 'id' },
            'chat_livestreaming': { keyPath: 'id' },
            'chat_map': { keyPath: 'mapId' },
            'chat_nearby_characters': { keyPath: 'id' },
            'chat_new_friends': { keyPath: 'id' },
            'api_configs': { keyPath: 'configId' },
            'time_config': { keyPath: 'configId' },
            'character_meme_config': { keyPath: 'configId' },
            'image_mode_config': { keyPath: 'configId' },
            'worldbook_config': { keyPath: 'configId' },
            'message_limit_config': { keyPath: 'configId' },
            'context_config': { keyPath: 'configId' },
            'wallpaper_config': { keyPath: 'configId' },
            'user_settings': { keyPath: 'configId' },
            'tts_config': { keyPath: 'configId' },
            'tts_voice_configs': { keyPath: 'contactId' },
            'novel_config': { keyPath: 'configId' },
            'minutes_config': { keyPath: 'configId' },
            'livestreaming_config': { keyPath: 'configId' },
        };

        this.currentCharacter = null;
        this._loadedContacts = new Set();
        this._loadedMoments = new Set();
        this._loadedPrivateMoments = new Set();
        this._loadedForum = new Set();
        this._loadedLivestreaming = new Set();
        this._loadedGroups = new Set();
        this._loadedMaps = new Set();
        this._loadedNearbyCharacters = new Set();
        this._loadedNewFriends = new Set();

        this.PHONE_CONFIG_FILE = 'tsp-plugin-phone.json';
    }

    async init() {
        this.ctx.log('phone-chat-storage', '初始化手机模拟器聊天存储');
        await this._initDB();
        await this._loadCurrentCharacter();
    }

    async _initDB() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(this.DB_NAME, this.DB_VERSION);

            request.onerror = () => {
                reject(request.error);
            };

            request.onsuccess = () => {
                this.db = request.result;
                resolve();
            };

            request.onupgradeneeded = (event) => {
                const db = request.result;

                for (const [name, config] of Object.entries(this.stores)) {
                    if (!db.objectStoreNames.contains(name)) {
                        const store = db.createObjectStore(name, config);

                        if (name === 'chat_records') {
                            store.createIndex('characterName', 'characterName', { unique: false });
                            store.createIndex('contactId', 'contactId', { unique: false });
                            store.createIndex('timestamp', 'timestamp', { unique: false });
                        }

                        if (name === 'chat_contacts') {
                            store.createIndex('characterName', 'characterName', { unique: false });
                        }

                        if (name === 'chat_moments') {
                            store.createIndex('characterName', 'characterName', { unique: false });
                            store.createIndex('contactId', 'contactId', { unique: false });
                        }

                        if (name === 'chat_private_moments') {
                            store.createIndex('characterName', 'characterName', { unique: false });
                            store.createIndex('contactId', 'contactId', { unique: false });
                        }

                        if (name === 'chat_forum') {
                            store.createIndex('characterName', 'characterName', { unique: false });
                        }

                        if (name === 'chat_livestreaming') {
                            store.createIndex('characterName', 'characterName', { unique: false });
                        }

                        if (name === 'chat_map') {
                            store.createIndex('characterName', 'characterName', { unique: false });
                        }
                        
                        if (name === 'chat_nearby_characters') {
                            store.createIndex('characterName', 'characterName', { unique: false });
                        }

                        if (name === 'chat_new_friends') {
                            store.createIndex('characterName', 'characterName', { unique: false });
                        }

                        if (name === 'api_configs') {
                            store.createIndex('configId', 'configId', { unique: false });
                        }

                        if (name === 'time_config') {
                            store.createIndex('characterName', 'characterName', { unique: false });
                        }

                        if (name === 'image_mode_config') {
                            store.createIndex('characterName', 'characterName', { unique: false });
                        }

                        if (name === 'worldbook_config') {
                            store.createIndex('characterName', 'characterName', { unique: false });
                        }

                        if (name === 'message_limit_config') {
                            store.createIndex('characterName', 'characterName', { unique: false });
                        }

                        if (name === 'chat_groups') {
                            store.createIndex('characterName', 'characterName', { unique: false });
                        }

                        if (name === 'chat_group_records') {
                            store.createIndex('characterName', 'characterName', { unique: false });
                            store.createIndex('groupId', 'groupId', { unique: false });
                            store.createIndex('timestamp', 'timestamp', { unique: false });
                        }

                        if (name === 'novel_config') {
                            store.createIndex('configId', 'configId', { unique: false });
                        }

                        if (name === 'livestreaming_config') {
                            store.createIndex('configId', 'configId', { unique: false });
                        }
                    }
                }
            };
        });
    }

    _ensureDB() {
        if (!this.db) {
            return this._initDB();
        }
        return Promise.resolve();
    }

    async _loadCurrentCharacter() {
        try {
            const win = window;
            let characterName = null;

            if (typeof win.SillyTavern !== 'undefined' && typeof win.SillyTavern.getContext === 'function') {
                const ctx = win.SillyTavern.getContext();
                if (ctx && ctx.name2 && ctx.name2 !== 'System') {
                    characterName = this._sanitizeCharacterName(ctx.name2);
                }
            }

            if (win.name2 && win.name2 !== 'System') {
                characterName = this._sanitizeCharacterName(win.name2);
            }

            if (characterName) {
                this.currentCharacter = characterName;
                this.ctx.log('phone-chat-storage', `当前角色卡: ${characterName}`);
                await this._loadContactsFromServer(characterName);
                await this._loadMomentsFromServer(characterName);
                await this._loadPrivateMomentsFromServer(characterName);
                await this._loadForumFromServer(characterName);
                await this._loadLivestreamingFromServer(characterName);
                await this._loadGroupsFromServer(characterName);
                await this._loadMapFromServer(characterName);
                await this._loadNearbyCharactersFromServer(characterName);
                await this._loadNewFriendsFromServer(characterName);
            }
        } catch (e) {
            this.ctx.error('phone-chat-storage', '加载当前角色卡失败:', e);
        }
    }

    _sanitizeCharacterName(name) {
        if (!name) return 'default';
        let result = '';
        for (const char of name) {
            if (/[a-zA-Z0-9_\-]/.test(char)) {
                result += char;
            } else if (/[\u4e00-\u9fa5]/.test(char)) {
                result += 'u' + char.charCodeAt(0).toString(16);
            } else {
                result += '_';
            }
        }
        return result.substring(0, 100) || 'default';
    }

    _getChatFileName(characterName) {
        return `tsp-chat-${characterName}.json`;
    }

    _getContactsFileName(characterName) {
        return `tsp-chat-${characterName}-contacts.json`;
    }

    _getMessagesFileName(characterName) {
        return `tsp-chat-${characterName}-messages.jsonl`;
    }

    _getMapFileName(characterName) {
        return `tsp-${characterName}-map.json`;
    }

    async _loadMessagesFromServer(characterName, contactId = null, limit = 500) {
        const fileName = this._getMessagesFileName(characterName);
        this.ctx.log('phone-chat-storage', `从服务器加载消息: ${fileName} (limit: ${limit})`);

        try {
            if (typeof getRequestHeaders !== 'function') {
                this.ctx.warn('phone-chat-storage', 'getRequestHeaders 不可用');
                return [];
            }

            const headers = getRequestHeaders();
            const response = await fetch(`/user/files/${fileName}`, {
                method: 'GET',
                headers: headers,
            });

            if (!response.ok) {
                if (response.status === 404) {
                    this.ctx.log('phone-chat-storage', `消息文件不存在: ${fileName}`);
                    return [];
                }
                throw new Error(`加载失败: ${response.status}`);
            }

            const text = await response.text();
            const lines = text.split('\n').filter(line => line.trim());
            const messages = [];

            for (const line of lines) {
                try {
                    const msg = JSON.parse(line);
                    if (msg.characterName === characterName) {
                        if (!contactId || msg.contactId === contactId) {
                            messages.push(msg);
                        }
                    }
                } catch (e) {
                    this.ctx.warn('phone-chat-storage', `解析消息行失败: ${e.message}`);
                }
            }

            messages.sort((a, b) => a.timestamp - b.timestamp);
            return messages.slice(-limit);
        } catch (e) {
            this.ctx.warn('phone-chat-storage', `加载消息失败: ${e.message}`);
            return [];
        }
    }

    async _appendMessageToServer(message) {
        const fileName = this._getMessagesFileName(this.currentCharacter);

        try {
            let existingContent = '';

            try {
                const headers = getRequestHeaders();
                const response = await fetch(`/user/files/${fileName}`, {
                    method: 'GET',
                    headers: headers,
                });

                if (response.ok) {
                    existingContent = await response.text();
                }
            } catch (e) {
                this.ctx.log('phone-chat-storage', `读取现有消息文件失败: ${e.message}`);
            }

            const jsonLine = JSON.stringify(message);
            const newContent = existingContent + (existingContent && !existingContent.endsWith('\n') ? '\n' : '') + jsonLine + '\n';
            const base64Data = btoa(unescape(encodeURIComponent(newContent)));

            const response = await fetch('/api/files/upload', {
                method: 'POST',
                headers: getRequestHeaders(),
                body: JSON.stringify({
                    name: fileName,
                    data: base64Data,
                }),
            });

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                throw new Error(errorData.error || `追加消息失败: ${response.status}`);
            }

            this.ctx.log('phone-chat-storage', '消息已追加到服务器');
        } catch (e) {
            this.ctx.error('phone-chat-storage', `追加消息到服务器失败: ${e.message}`);
            throw e;
        }
    }

    async _appendMessagesToServer(messages) {
        if (!messages || messages.length === 0) {
            return;
        }

        const fileName = this._getMessagesFileName(this.currentCharacter);

        try {
            let existingContent = '';

            try {
                const headers = getRequestHeaders();
                const response = await fetch(`/user/files/${fileName}`, {
                    method: 'GET',
                    headers: headers,
                });

                if (response.ok) {
                    existingContent = await response.text();
                }
            } catch (e) {
                this.ctx.log('phone-chat-storage', `读取现有消息文件失败: ${e.message}`);
            }

            const newLines = messages.map(msg => JSON.stringify(msg)).join('\n');
            const newContent = existingContent + (existingContent && !existingContent.endsWith('\n') ? '\n' : '') + newLines + '\n';
            const base64Data = btoa(unescape(encodeURIComponent(newContent)));

            const response = await fetch('/api/files/upload', {
                method: 'POST',
                headers: getRequestHeaders(),
                body: JSON.stringify({
                    name: fileName,
                    data: base64Data,
                }),
            });

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                throw new Error(errorData.error || `批量追加消息失败: ${response.status}`);
            }

            this.ctx.log('phone-chat-storage', `已批量追加 ${messages.length} 条消息到服务器`);
        } catch (e) {
            this.ctx.error('phone-chat-storage', `批量追加消息到服务器失败: ${e.message}`);
            throw e;
        }
    }

    async _migrateOldFormat(characterName) {
        const oldFileName = this._getChatFileName(characterName);
        const contactsFileName = this._getContactsFileName(characterName);
        const messagesFileName = this._getMessagesFileName(characterName);

        this.ctx.log('phone-chat-storage', `检查旧格式文件: ${oldFileName}`);

        try {
            if (typeof getRequestHeaders !== 'function') {
                return false;
            }

            const headers = getRequestHeaders();
            const response = await fetch(`/user/files/${oldFileName}`, {
                method: 'GET',
                headers: headers,
            });

            if (!response.ok || response.status === 404) {
                this.ctx.log('phone-chat-storage', '旧格式文件不存在，无需迁移');
                return false;
            }

            const text = await response.text();
            const data = JSON.parse(text);

            if (!data.contacts && !data.messages) {
                this.ctx.log('phone-chat-storage', '旧格式文件不包含有效数据');
                return false;
            }

            this.ctx.log('phone-chat-storage', '开始迁移旧格式数据...');

            if (data.contacts && Array.isArray(data.contacts)) {
                const contactsData = {
                    version: 2,
                    characterName: characterName,
                    contacts: data.contacts,
                    updatedAt: Date.now(),
                };

                const contactsJsonStr = JSON.stringify(contactsData, null, 2);
                const contactsBase64Data = btoa(unescape(encodeURIComponent(contactsJsonStr)));

                const contactsResponse = await fetch('/api/files/upload', {
                    method: 'POST',
                    headers: getRequestHeaders(),
                    body: JSON.stringify({
                        name: contactsFileName,
                        data: contactsBase64Data,
                    }),
                });

                if (contactsResponse.ok) {
                    this.ctx.log('phone-chat-storage', `已迁移 ${data.contacts.length} 个联系人`);
                }
            }

            if (data.messages && Array.isArray(data.messages)) {
                const messagesLines = data.messages.map(msg => JSON.stringify(msg)).join('\n');
                const messagesBase64Data = btoa(unescape(encodeURIComponent(messagesLines + '\n')));

                const messagesResponse = await fetch('/api/files/upload', {
                    method: 'POST',
                    headers: getRequestHeaders(),
                    body: JSON.stringify({
                        name: messagesFileName,
                        data: messagesBase64Data,
                    }),
                });

                if (messagesResponse.ok) {
                    this.ctx.log('phone-chat-storage', `已迁移 ${data.messages.length} 条消息`);
                }
            }

            this.ctx.log('phone-chat-storage', '旧格式数据迁移完成');
            return true;
        } catch (e) {
            this.ctx.error('phone-chat-storage', `迁移旧格式数据失败: ${e.message}`);
            return false;
        }
    }

    async _loadContactsFromServer(characterName) {
        if (this._loadedContacts.has(characterName)) {
            return;
        }

        const fileName = this._getContactsFileName(characterName);
        this.ctx.log('phone-chat-storage', `从服务器加载联系人: ${fileName}`);

        try {
            if (typeof getRequestHeaders !== 'function') {
                this.ctx.warn('phone-chat-storage', 'getRequestHeaders 不可用');
                return;
            }

            await this._clearCharacterData(characterName);

            const headers = getRequestHeaders();
            const response = await fetch(`/user/files/${fileName}`, {
                method: 'GET',
                headers: headers,
            });

            if (response.ok) {
                const text = await response.text();
                const data = JSON.parse(text);

                if (data.contacts && Array.isArray(data.contacts)) {
                    for (const contact of data.contacts) {
                        await this._saveContactToDB(contact);
                    }
                }

                this._loadedContacts.add(characterName);
                this.ctx.log('phone-chat-storage', `已加载 ${data.contacts?.length || 0} 个联系人`);
            } else if (response.status === 404) {
                this.ctx.log('phone-chat-storage', `联系人文件不存在 (404): ${fileName}，检查旧格式`);
                
                const migrated = await this._migrateOldFormat(characterName);
                if (migrated) {
                    await this._loadContactsFromServer(characterName);
                } else {
                    await this._createNewChatFile(characterName);
                    this._loadedContacts.add(characterName);
                }
            }
        } catch (e) {
            this.ctx.warn('phone-chat-storage', `加载联系人失败: ${e.message}`);
            this._loadedContacts.add(characterName);
        }
    }

    async _clearCharacterData(characterName) {
        await this._ensureDB();
        
        const transaction = this.db.transaction(['chat_contacts', 'chat_records', 'chat_moments', 'chat_private_moments', 'chat_map', 'chat_nearby_characters', 'chat_groups', 'chat_group_records', 'chat_new_friends'], 'readwrite');
        
        const contactStore = transaction.objectStore('chat_contacts');
        const contactIndex = contactStore.index('characterName');
        const contactCursorRequest = contactIndex.openCursor(characterName);
        
        contactCursorRequest.onsuccess = (event) => {
            const cursor = event.target.result;
            if (cursor) {
                cursor.delete();
                cursor.continue();
            }
        };

        const recordStore = transaction.objectStore('chat_records');
        const recordIndex = recordStore.index('characterName');
        const recordCursorRequest = recordIndex.openCursor(characterName);
        
        recordCursorRequest.onsuccess = (event) => {
            const cursor = event.target.result;
            if (cursor) {
                cursor.delete();
                cursor.continue();
            }
        };

        const momentsStore = transaction.objectStore('chat_moments');
        const momentsIndex = momentsStore.index('characterName');
        const momentsCursorRequest = momentsIndex.openCursor(characterName);
        
        momentsCursorRequest.onsuccess = (event) => {
            const cursor = event.target.result;
            if (cursor) {
                cursor.delete();
                cursor.continue();
            }
        };

        const mapStore = transaction.objectStore('chat_map');
        const mapIndex = mapStore.index('characterName');
        const mapCursorRequest = mapIndex.openCursor(characterName);
        
        mapCursorRequest.onsuccess = (event) => {
            const cursor = event.target.result;
            if (cursor) {
                cursor.delete();
                cursor.continue();
            }
        };
        
        const nearbyCharactersStore = transaction.objectStore('chat_nearby_characters');
        const nearbyCharactersIndex = nearbyCharactersStore.index('characterName');
        const nearbyCharactersCursorRequest = nearbyCharactersIndex.openCursor(characterName);
        
        nearbyCharactersCursorRequest.onsuccess = (event) => {
            const cursor = event.target.result;
            if (cursor) {
                cursor.delete();
                cursor.continue();
            }
        };

        const privateMomentsStore = transaction.objectStore('chat_private_moments');
        const privateMomentsIndex = privateMomentsStore.index('characterName');
        const privateMomentsCursorRequest = privateMomentsIndex.openCursor(characterName);
        
        privateMomentsCursorRequest.onsuccess = (event) => {
            const cursor = event.target.result;
            if (cursor) {
                cursor.delete();
                cursor.continue();
            }
        };

        const groupsStore = transaction.objectStore('chat_groups');
        const groupsIndex = groupsStore.index('characterName');
        const groupsCursorRequest = groupsIndex.openCursor(characterName);
        
        groupsCursorRequest.onsuccess = (event) => {
            const cursor = event.target.result;
            if (cursor) {
                cursor.delete();
                cursor.continue();
            }
        };

        const groupRecordsStore = transaction.objectStore('chat_group_records');
        const groupRecordsIndex = groupRecordsStore.index('characterName');
        const groupRecordsCursorRequest = groupRecordsIndex.openCursor(characterName);
        
        groupRecordsCursorRequest.onsuccess = (event) => {
            const cursor = event.target.result;
            if (cursor) {
                cursor.delete();
                cursor.continue();
            }
        };

        const newFriendsStore = transaction.objectStore('chat_new_friends');
        const newFriendsIndex = newFriendsStore.index('characterName');
        const newFriendsCursorRequest = newFriendsIndex.openCursor(characterName);
        
        newFriendsCursorRequest.onsuccess = (event) => {
            const cursor = event.target.result;
            if (cursor) {
                cursor.delete();
                cursor.continue();
            }
        };

        return new Promise((resolve) => {
            transaction.oncomplete = () => {
                this.ctx.log('phone-chat-storage', `已清空角色卡 ${characterName} 的旧数据`);
                resolve();
            };
            transaction.onerror = () => resolve();
        });
    }

    async _createNewChatFile(characterName) {
        const fileName = this._getContactsFileName(characterName);
        const data = {
            version: 2,
            characterName: characterName,
            contacts: [],
            updatedAt: Date.now(),
        };

        try {
            const jsonStr = JSON.stringify(data, null, 2);
            const base64Data = btoa(unescape(encodeURIComponent(jsonStr)));

            const response = await fetch('/api/files/upload', {
                method: 'POST',
                headers: getRequestHeaders(),
                body: JSON.stringify({
                    name: fileName,
                    data: base64Data,
                }),
            });

            if (response.ok) {
                this.ctx.log('phone-chat-storage', `已创建新联系人文件: ${fileName}`);
            } else {
                const errorData = await response.json().catch(() => ({}));
                throw new Error(errorData.error || `创建失败: ${response.status}`);
            }
        } catch (e) {
            this.ctx.error('phone-chat-storage', `创建新联系人文件失败: ${e.message}`);
        }
    }

    async _saveContactToDB(contact) {
        await this._ensureDB();
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['chat_contacts', 'tts_voice_configs'], 'readwrite');
            const store = transaction.objectStore('chat_contacts');
            const request = store.put(contact);
            
            // 同时保存音色配置到tts_voice_configs存储
            if (contact.ttsVoiceConfig) {
                const ttsVoiceStore = transaction.objectStore('tts_voice_configs');
                ttsVoiceStore.put(contact.ttsVoiceConfig);
            }
            
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }

    async _saveMessageToDB(message) {
        await this._ensureDB();
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['chat_records'], 'readwrite');
            const store = transaction.objectStore('chat_records');
            const request = store.put(message);
            request.onsuccess = () => {
                message.id = request.result;
                resolve(request.result);
            };
            request.onerror = () => reject(request.error);
        });
    }
    // [新增] 删除指定ID的消息并同步服务器
    async deleteMessage(messageId) {
        await this._ensureDB();
        return new Promise(async (resolve, reject) => {
            const transaction = this.db.transaction(['chat_records'], 'readwrite');
            const store = transaction.objectStore('chat_records');
            const request = store.delete(messageId);

            request.onsuccess = async () => {
                const allMessages = await this._getAllMessages(this.currentCharacter);
                const messagesLines = allMessages.map(msg => JSON.stringify(msg)).join('\n');
                const base64Data = btoa(unescape(encodeURIComponent(messagesLines + '\n')));

                const fileName = this._getMessagesFileName(this.currentCharacter);
                const response = await fetch('/api/files/upload', {
                    method: 'POST',
                    headers: getRequestHeaders(),
                    body: JSON.stringify({
                        name: fileName,
                        data: base64Data,
                    }),
                });

                if (response.ok) {
                    this.ctx.log('phone-chat-storage', '消息已删除并同步到服务器');
                } else {
                    this.ctx.error('phone-chat-storage', '同步服务器失败');
                }
                resolve(true);
            };
            request.onerror = () => reject(request.error);
        });
    }

    async batchDeleteMessages(messageIds) {
        if (!messageIds || messageIds.length === 0) {
            return { success: true, deletedCount: 0 };
        }

        await this._ensureDB();
        return new Promise(async (resolve, reject) => {
            // 转换消息ID为数字类型
            const numericMessageIds = messageIds.map(id => {
                const numericId = parseInt(id, 10);
                this.ctx.log('phone-chat-storage', `转换消息ID: ${id} -> ${numericId}`);
                return numericId;
            });

            // 打印删除前的消息数量
            const beforeMessages = await this._getAllMessages(this.currentCharacter);
            this.ctx.log('phone-chat-storage', `删除前消息数量: ${beforeMessages.length}`);
            this.ctx.log('phone-chat-storage', `准备删除的消息ID: ${numericMessageIds.join(', ')}`);
            this.ctx.log('phone-chat-storage', `当前角色名: ${this.currentCharacter}`);

            // 检查消息是否存在
            for (const messageId of numericMessageIds) {
                const messageExists = await this._getMessageById(messageId);
                this.ctx.log('phone-chat-storage', `消息ID ${messageId} 存在: ${!!messageExists}`);
            }

            const transaction = this.db.transaction(['chat_records'], 'readwrite');
            const store = transaction.objectStore('chat_records');
            
            let deletedCount = 0;

            const deletePromises = numericMessageIds.map(messageId => {
                return new Promise((res, rej) => {
                    const request = store.delete(messageId);
                    request.onsuccess = () => {
                        deletedCount++;
                        this.ctx.log('phone-chat-storage', `成功删除消息ID: ${messageId}`);
                        res();
                    };
                    request.onerror = () => {
                        this.ctx.error('phone-chat-storage', `删除消息ID失败: ${messageId}`, request.error);
                        rej(request.error);
                    };
                });
            });

            try {
                await Promise.all(deletePromises);
                // 等待事务完成
                await new Promise((resolveTx) => {
                    transaction.oncomplete = () => {
                        this.ctx.log('phone-chat-storage', '数据库事务完成');
                        resolveTx();
                    };
                    transaction.onerror = () => {
                        this.ctx.error('phone-chat-storage', '数据库事务失败');
                        resolveTx();
                    };
                });
                this.ctx.log('phone-chat-storage', `数据库删除完成，共删除 ${deletedCount} 条消息`);
            } catch (e) {
                this.ctx.error('phone-chat-storage', `删除消息失败: ${e.message}`);
                reject(e);
                return;
            }

            // 打印删除后的消息数量
            const afterMessages = await this._getAllMessages(this.currentCharacter);
            this.ctx.log('phone-chat-storage', `删除后消息数量: ${afterMessages.length}`);
            this.ctx.log('phone-chat-storage', `实际删除消息数量: ${beforeMessages.length - afterMessages.length}`);

            // 再次检查被删除的消息是否仍然存在
            for (const messageId of numericMessageIds) {
                const messageExists = await this._getMessageById(messageId);
                this.ctx.log('phone-chat-storage', `删除后消息ID ${messageId} 仍然存在: ${!!messageExists}`);
            }

            const messagesLines = afterMessages.map(msg => JSON.stringify(msg)).join('\n');
            const base64Data = btoa(unescape(encodeURIComponent(messagesLines + '\n')));

            const fileName = this._getMessagesFileName(this.currentCharacter);
            this.ctx.log('phone-chat-storage', `准备同步到服务器文件: ${fileName}`);
            
            const response = await fetch('/api/files/upload', {
                method: 'POST',
                headers: getRequestHeaders(),
                body: JSON.stringify({
                    name: fileName,
                    data: base64Data,
                }),
            });

            if (response.ok) {
                this.ctx.log('phone-chat-storage', `批量删除 ${deletedCount} 条消息并同步到服务器成功`);
                this.ctx.log('phone-chat-storage', `服务器同步响应状态: ${response.status}`);
            } else {
                this.ctx.error('phone-chat-storage', `同步服务器失败，响应状态: ${response.status}`);
                const errorText = await response.text().catch(() => '无法获取错误信息');
                this.ctx.error('phone-chat-storage', `同步服务器失败详情: ${errorText}`);
            }
            resolve({ success: true, deletedCount });
        });
    }

    async _getMessageById(messageId) {
        await this._ensureDB();
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['chat_records'], 'readonly');
            const store = transaction.objectStore('chat_records');
            const request = store.get(messageId);
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }

    async deleteGroupMessage(messageId) {
        await this._ensureDB();
        return new Promise(async (resolve, reject) => {
            const transaction = this.db.transaction(['chat_group_records'], 'readwrite');
            const store = transaction.objectStore('chat_group_records');

            const getRequest = store.get(messageId);
            getRequest.onsuccess = async () => {
                const message = getRequest.result;
                if (!message) {
                    reject(new Error('消息不存在'));
                    return;
                }

                const groupId = message.groupId;
                const characterName = message.characterName;

                const deleteRequest = store.delete(messageId);
                deleteRequest.onsuccess = async () => {
                    const allMessages = await this.getGroupMessages(groupId, characterName);
                    const messagesLines = allMessages.map(msg => JSON.stringify(msg)).join('\n');
                    const base64Data = btoa(unescape(encodeURIComponent(messagesLines + '\n')));

                    const fileName = this._getGroupMessagesFileName(characterName, groupId);
                    const response = await fetch('/api/files/upload', {
                        method: 'POST',
                        headers: getRequestHeaders(),
                        body: JSON.stringify({
                            name: fileName,
                            data: base64Data,
                        }),
                    });

                    if (response.ok) {
                        this.ctx.log('phone-chat-storage', '群消息已删除并同步到服务器');
                    } else {
                        this.ctx.error('phone-chat-storage', '同步群消息删除到服务器失败');
                    }
                    resolve(true);
                };
                deleteRequest.onerror = () => reject(deleteRequest.error);
            };
            getRequest.onerror = () => reject(getRequest.error);
        });
    }

    async batchDeleteGroupMessages(messageIds) {
        if (!messageIds || messageIds.length === 0) {
            return { success: true, deletedCount: 0 };
        }

        await this._ensureDB();
        return new Promise(async (resolve, reject) => {
            const transaction = this.db.transaction(['chat_group_records'], 'readwrite');
            const store = transaction.objectStore('chat_group_records');

            const firstMessageId = messageIds[0];
            const getRequest = store.get(firstMessageId);
            
            getRequest.onsuccess = async () => {
                const firstMessage = getRequest.result;
                if (!firstMessage) {
                    reject(new Error('消息不存在'));
                    return;
                }

                const groupId = firstMessage.groupId;
                const characterName = firstMessage.characterName;

                let deletedCount = 0;
                const deletePromises = messageIds.map(messageId => {
                    return new Promise((res, rej) => {
                        const request = store.delete(messageId);
                        request.onsuccess = () => {
                            deletedCount++;
                            res();
                        };
                        request.onerror = () => rej(request.error);
                    });
                });

                try {
                    await Promise.all(deletePromises);
                } catch (e) {
                    reject(e);
                    return;
                }

                const allMessages = await this.getGroupMessages(groupId, characterName);
                const messagesLines = allMessages.map(msg => JSON.stringify(msg)).join('\n');
                const base64Data = btoa(unescape(encodeURIComponent(messagesLines + '\n')));

                const fileName = this._getGroupMessagesFileName(characterName, groupId);
                const response = await fetch('/api/files/upload', {
                    method: 'POST',
                    headers: getRequestHeaders(),
                    body: JSON.stringify({
                        name: fileName,
                        data: base64Data,
                    }),
                });

                if (response.ok) {
                    this.ctx.log('phone-chat-storage', `批量删除 ${deletedCount} 条群消息并同步到服务器`);
                } else {
                    this.ctx.error('phone-chat-storage', '同步群消息删除到服务器失败');
                }
                resolve({ success: true, deletedCount, groupId, characterName });
            };
            getRequest.onerror = () => reject(getRequest.error);
        });
    }

    async deleteAllMessagesForContact(contactId) {
        await this._ensureDB();
        return new Promise(async (resolve, reject) => {
            const transaction = this.db.transaction(['chat_records'], 'readwrite');
            const store = transaction.objectStore('chat_records');
            const index = store.index('contactId');
            const cursorRequest = index.openCursor(contactId);

            const deletedIds = [];
            cursorRequest.onsuccess = async (event) => {
                const cursor = event.target.result;
                if (cursor) {
                    if (cursor.value.characterName === this.currentCharacter) {
                        deletedIds.push(cursor.value.id);
                        cursor.delete();
                    }
                    cursor.continue();
                } else {
                    this.ctx.log('phone-chat-storage', `已从数据库删除 ${deletedIds.length} 条消息`);
                    
                    const allMessages = await this._getAllMessages(this.currentCharacter);
                    const messagesLines = allMessages.map(msg => JSON.stringify(msg)).join('\n');
                    const base64Data = btoa(unescape(encodeURIComponent(messagesLines + '\n')));

                    const fileName = this._getMessagesFileName(this.currentCharacter);
                    const response = await fetch('/api/files/upload', {
                        method: 'POST',
                        headers: getRequestHeaders(),
                        body: JSON.stringify({
                            name: fileName,
                            data: base64Data,
                        }),
                    });

                    if (response.ok) {
                        this.ctx.log('phone-chat-storage', '已同步消息删除到服务器');
                        resolve(true);
                    } else {
                        this.ctx.error('phone-chat-storage', '同步服务器失败');
                        reject(new Error('同步服务器失败'));
                    }
                }
            };
            cursorRequest.onerror = () => reject(cursorRequest.error);
        });
    }

    async updateMessage(messageId, updates) {
        await this._ensureDB();
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['chat_records'], 'readwrite');
            const store = transaction.objectStore('chat_records');
            const getRequest = store.get(messageId);

            getRequest.onsuccess = async () => {
                const message = getRequest.result;
                if (message) {
                    Object.assign(message, updates);
                    const putRequest = store.put(message);
                    putRequest.onsuccess = async () => {
                        const allMessages = await this._getAllMessages(this.currentCharacter);
                        const messagesLines = allMessages.map(msg => JSON.stringify(msg)).join('\n');
                        const base64Data = btoa(unescape(encodeURIComponent(messagesLines + '\n')));

                        const fileName = this._getMessagesFileName(this.currentCharacter);
                        const response = await fetch('/api/files/upload', {
                            method: 'POST',
                            headers: getRequestHeaders(),
                            body: JSON.stringify({
                                name: fileName,
                                data: base64Data,
                            }),
                        });

                        if (response.ok) {
                            this.ctx.log('phone-chat-storage', '消息已更新并同步到服务器');
                        } else {
                            this.ctx.error('phone-chat-storage', '同步服务器失败');
                        }
                        resolve(message);
                    };
                    putRequest.onerror = () => reject(putRequest.error);
                } else {
                    reject(new Error('消息不存在'));
                }
            };
            getRequest.onerror = () => reject(getRequest.error);
        });
    }
    async getContacts(characterName = null) {
        const targetCharacter = characterName || this.currentCharacter;
        if (!targetCharacter) return [];

        await this._ensureDB();
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['chat_contacts'], 'readonly');
            const store = transaction.objectStore('chat_contacts');
            const index = store.index('characterName');
            const request = index.getAll(targetCharacter);
            request.onsuccess = () => resolve(request.result || []);
            request.onerror = () => reject(request.error);
        });
    }

    async getContact(contactId) {
        if (!contactId) return null;

        await this._ensureDB();
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['chat_contacts'], 'readonly');
            const store = transaction.objectStore('chat_contacts');
            const request = store.get(contactId);
            request.onsuccess = () => resolve(request.result || null);
            request.onerror = () => reject(request.error);
        });
    }

    async getMessages(contactId, characterName = null, limit = 500) {
        const targetCharacter = characterName || this.currentCharacter;
        if (!targetCharacter || !contactId) return [];

        await this._ensureDB();
        return new Promise(async (resolve, reject) => {
            const transaction = this.db.transaction(['chat_records'], 'readonly');
            const store = transaction.objectStore('chat_records');
            const contactIndex = store.index('contactId');
            const request = contactIndex.getAll(contactId);

            request.onsuccess = async () => {
                let messages = request.result || [];
                messages = messages.filter(msg => msg.characterName === targetCharacter);
                messages.sort((a, b) => a.timestamp - b.timestamp);

                if (messages.length === 0) {
                    const serverMessages = await this._loadMessagesFromServer(targetCharacter, contactId, limit);
                    const savedMessages = [];
                    for (const msg of serverMessages) {
                        const savedId = await this._saveMessageToDB(msg);
                        savedMessages.push({ ...msg, id: savedId });
                    }
                    resolve(savedMessages);
                } else {
                    resolve(messages.slice(-limit));
                }
            };
            request.onerror = () => reject(request.error);
        });
    }

    async addMessage(message, skipServerSave = false) {
        const characterName = this.currentCharacter;
        if (!characterName) {
            throw new Error('未选择角色卡');
        }

        message.characterName = characterName;
        message.timestamp = message.timestamp || Date.now();
        message.readStatus = message.readStatus !== undefined ? message.readStatus : false;

        await this._saveMessageToDB(message);
        
        if (!skipServerSave) {
            await this._appendMessageToServer(message);
        }

        return message;
    }

    async addMessages(messages) {
        if (!messages || messages.length === 0) {
            return [];
        }

        const characterName = this.currentCharacter;
        if (!characterName) {
            throw new Error('未选择角色卡');
        }

        const savedMessages = [];
        for (const message of messages) {
            message.characterName = characterName;
            message.timestamp = message.timestamp || Date.now();
            message.readStatus = message.readStatus !== undefined ? message.readStatus : false;
            const saved = await this._saveMessageToDB(message);
            message.id = saved;
            savedMessages.push(message);
        }

        await this._appendMessagesToServer(savedMessages);

        return savedMessages;
    }

    async markMessagesAsSummarized(contactId) {
        const characterName = this.currentCharacter;
        if (!characterName || !contactId) {
            throw new Error('参数不完整');
        }

        await this._ensureDB();
        
        const nextSummaryNumber = await this._getNextSummaryNumber(contactId);
        const summaryKey = `summary${nextSummaryNumber}`;

        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['chat_records'], 'readwrite');
            const store = transaction.objectStore('chat_records');
            const contactIndex = store.index('contactId');
            const request = contactIndex.getAll(contactId);

            request.onsuccess = async () => {
                let messages = request.result || [];
                messages = messages.filter(msg => msg.characterName === characterName && !this._hasSummaryMark(msg));

                if (messages.length === 0) {
                    resolve(0);
                    return;
                }

                const updatedMessages = [];
                for (const msg of messages) {
                    msg[summaryKey] = true;
                    const updateRequest = store.put(msg);
                    await new Promise((resolveUpdate, rejectUpdate) => {
                        updateRequest.onsuccess = () => resolveUpdate();
                        updateRequest.onerror = () => rejectUpdate(updateRequest.error);
                    });
                    updatedMessages.push(msg);
                }

                this._updateMessagesInServer(updatedMessages).catch(console.error);

                resolve({ count: updatedMessages.length, summaryNumber: nextSummaryNumber });
            };

            request.onerror = () => reject(request.error);
        });
    }

    _hasSummaryMark(msg) {
        if (msg.summary === true) return true;
        for (let i = 1; i <= 100; i++) {
            if (msg[`summary${i}`] === true) return true;
        }
        return false;
    }

    async _getNextSummaryNumber(contactId) {
        const characterName = this.currentCharacter;
        await this._ensureDB();
        
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['chat_records'], 'readonly');
            const store = transaction.objectStore('chat_records');
            const contactIndex = store.index('contactId');
            const request = contactIndex.getAll(contactId);

            request.onsuccess = () => {
                const messages = request.result || [];
                const characterMessages = messages.filter(msg => msg.characterName === characterName);
                
                let maxNumber = 0;
                for (const msg of characterMessages) {
                    for (let i = 1; i <= 100; i++) {
                        if (msg[`summary${i}`] === true && i > maxNumber) {
                            maxNumber = i;
                        }
                    }
                }
                
                resolve(maxNumber + 1);
            };

            request.onerror = () => reject(request.error);
        });
    }

    async getSummaryMarks(contactId) {
        const characterName = this.currentCharacter;
        if (!characterName || !contactId) {
            return [];
        }

        await this._ensureDB();
        
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['chat_records'], 'readonly');
            const store = transaction.objectStore('chat_records');
            const contactIndex = store.index('contactId');
            const request = contactIndex.getAll(contactId);

            request.onsuccess = () => {
                const messages = request.result || [];
                const characterMessages = messages.filter(msg => msg.characterName === characterName);
                
                const summaryMarks = new Set();
                
                for (const msg of characterMessages) {
                    if (msg.summary === true) {
                        summaryMarks.add(0);
                    }
                    for (let i = 1; i <= 100; i++) {
                        if (msg[`summary${i}`] === true) {
                            summaryMarks.add(i);
                        }
                    }
                }
                
                const result = Array.from(summaryMarks).sort((a, b) => a - b);
                resolve(result);
            };

            request.onerror = () => reject(request.error);
        });
    }

    async clearSummaryMark(contactId, summaryNumber) {
        const characterName = this.currentCharacter;
        if (!characterName || !contactId) {
            throw new Error('参数不完整');
        }

        await this._ensureDB();
        return new Promise(async (resolve, reject) => {
            const transaction = this.db.transaction(['chat_records'], 'readwrite');
            const store = transaction.objectStore('chat_records');
            const contactIndex = store.index('contactId');
            const request = contactIndex.getAll(contactId);

            request.onsuccess = async () => {
                let messages = request.result || [];
                messages = messages.filter(msg => msg.characterName === characterName);

                const summaryKey = summaryNumber === 0 ? 'summary' : `summary${summaryNumber}`;
                const updatedMessages = [];
                
                for (const msg of messages) {
                    if (msg[summaryKey] === true) {
                        delete msg[summaryKey];
                        const updateRequest = store.put(msg);
                        await new Promise((resolveUpdate, rejectUpdate) => {
                            updateRequest.onsuccess = () => resolveUpdate();
                            updateRequest.onerror = () => rejectUpdate(updateRequest.error);
                        });
                        updatedMessages.push(msg);
                    }
                }

                await this._updateMessagesInServer(updatedMessages);

                resolve(updatedMessages.length);
            };

            request.onerror = () => reject(request.error);
        });
    }

    async markMessagesAsRead(contactId) {
        const characterName = this.currentCharacter;
        if (!characterName || !contactId) {
            throw new Error('参数不完整');
        }

        await this._ensureDB();
        return new Promise(async (resolve, reject) => {
            const transaction = this.db.transaction(['chat_records'], 'readwrite');
            const store = transaction.objectStore('chat_records');
            const contactIndex = store.index('contactId');
            const request = contactIndex.getAll(contactId);

            request.onsuccess = async () => {
                let messages = request.result || [];
                messages = messages.filter(msg => msg.characterName === characterName && !msg.readStatus && !msg.isUser);

                if (messages.length === 0) {
                    resolve(0);
                    return;
                }

                const updatedMessages = [];
                for (const msg of messages) {
                    msg.readStatus = true;
                    const updateRequest = store.put(msg);
                    await new Promise((resolveUpdate, rejectUpdate) => {
                        updateRequest.onsuccess = () => resolveUpdate();
                        updateRequest.onerror = () => rejectUpdate(updateRequest.error);
                    });
                    updatedMessages.push(msg);
                }

                this._updateMessagesInServer(updatedMessages).catch(console.error);

                resolve(updatedMessages.length);
            };

            request.onerror = () => reject(request.error);
        });
    }

    async markForumPostsAsRead() {
        const characterName = this.currentCharacter;
        if (!characterName) {
            throw new Error('未选择角色卡');
        }

        await this._ensureDB();
        return new Promise(async (resolve, reject) => {
            const transaction = this.db.transaction(['chat_forum'], 'readwrite');
            const store = transaction.objectStore('chat_forum');
            const request = store.getAll();

            request.onsuccess = async () => {
                let posts = request.result || [];
                posts = posts.filter(post => post.characterName === characterName && !post.readStatus);

                if (posts.length === 0) {
                    resolve(0);
                    return;
                }

                const updatedPosts = [];
                for (const post of posts) {
                    post.readStatus = true;
                    const updateRequest = store.put(post);
                    await new Promise((resolveUpdate, rejectUpdate) => {
                        updateRequest.onsuccess = () => resolveUpdate();
                        updateRequest.onerror = () => rejectUpdate(updateRequest.error);
                    });
                    updatedPosts.push(post);
                }

                // 同步到服务器
                try {
                    await this._saveForumToServer();
                    this.ctx.log('phone-chat-storage', '论坛帖子已更新并同步到服务器');
                } catch (error) {
                    this.ctx.error('phone-chat-storage', '同步论坛帖子到服务器失败:', error);
                }

                resolve(updatedPosts.length);
            };

            request.onerror = () => reject(request.error);
        });
    }

    async _updateMessagesInServer(messages) {
        if (!messages || messages.length === 0) {
            return;
        }

        const fileName = this._getMessagesFileName(this.currentCharacter);

        try {
            let existingContent = '';

            try {
                const headers = getRequestHeaders();
                const response = await fetch(`/user/files/${fileName}`, {
                    method: 'GET',
                    headers: headers,
                });

                if (response.ok) {
                    existingContent = await response.text();
                }
            } catch (e) {
                this.ctx.log('phone-chat-storage', `读取现有消息文件失败: ${e.message}`);
            }

            const lines = existingContent.split('\n').filter(line => line.trim());
            const updatedLines = [];

            const messageMap = new Map();
            for (const msg of messages) {
                messageMap.set(msg.id, msg);
            }

            for (const line of lines) {
                try {
                    const msg = JSON.parse(line);
                    if (messageMap.has(msg.id)) {
                        updatedLines.push(JSON.stringify(messageMap.get(msg.id)));
                    } else {
                        updatedLines.push(line);
                    }
                } catch (e) {
                    updatedLines.push(line);
                }
            }

            const newContent = updatedLines.join('\n') + '\n';
            const base64Data = btoa(unescape(encodeURIComponent(newContent)));

            const response = await fetch('/api/files/upload', {
                method: 'POST',
                headers: getRequestHeaders(),
                body: JSON.stringify({
                    name: fileName,
                    data: base64Data,
                }),
            });

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                throw new Error(errorData.error || `更新消息失败: ${response.status}`);
            }

            this.ctx.log('phone-chat-storage', `已更新 ${messages.length} 条消息的 summary 标记到服务器`);
        } catch (e) {
            this.ctx.error('phone-chat-storage', `更新消息到服务器失败: ${e.message}`);
            throw e;
        }
    }

    async createContact(contact) {
        const characterName = this.currentCharacter;
        if (!characterName) {
            throw new Error('未选择角色卡');
        }

        contact.contactId = contact.contactId || this._generateContactId();
        contact.characterName = characterName;
        contact.createdAt = Date.now();

        await this._saveContactToDB(contact);
        await this._saveToServer();

        return contact;
    }

    async updateContact(contactId, updates) {
        await this._ensureDB();
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['chat_contacts'], 'readwrite');
            const store = transaction.objectStore('chat_contacts');
            const getRequest = store.get(contactId);

            getRequest.onsuccess = () => {
                const contact = getRequest.result;
                if (contact) {
                    Object.assign(contact, updates);
                    const putRequest = store.put(contact);
                    putRequest.onsuccess = () => {
                        this._saveToServer().catch(e => this.ctx.error('phone-chat-storage', '保存失败:', e));
                        resolve(contact);
                    };
                    putRequest.onerror = () => reject(putRequest.error);
                } else {
                    reject(new Error('联系人不存在'));
                }
            };
            getRequest.onerror = () => reject(getRequest.error);
        });
    }

    async deleteContact(contactId) {
        await this._ensureDB();
        return new Promise(async (resolve, reject) => {
            const transaction = this.db.transaction(['chat_contacts', 'chat_records', 'chat_moments', 'chat_private_moments'], 'readwrite');

            const contactStore = transaction.objectStore('chat_contacts');
            contactStore.delete(contactId);

            const recordStore = transaction.objectStore('chat_records');
            const index = recordStore.index('contactId');
            const cursorRequest = index.openCursor(contactId);

            cursorRequest.onsuccess = (event) => {
                const cursor = event.target.result;
                if (cursor) {
                    cursor.delete();
                    cursor.continue();
                }
            };

            const momentsStore = transaction.objectStore('chat_moments');
            const momentsIndex = momentsStore.index('contactId');
            const momentsCursorRequest = momentsIndex.openCursor(contactId);

            momentsCursorRequest.onsuccess = (event) => {
                const cursor = event.target.result;
                if (cursor) {
                    cursor.delete();
                    cursor.continue();
                }
            };

            const privateMomentsStore = transaction.objectStore('chat_private_moments');
            const privateMomentsIndex = privateMomentsStore.index('contactId');
            const privateMomentsCursorRequest = privateMomentsIndex.openCursor(contactId);

            privateMomentsCursorRequest.onsuccess = (event) => {
                const cursor = event.target.result;
                if (cursor) {
                    cursor.delete();
                    cursor.continue();
                }
            };

            transaction.oncomplete = async () => {
                await this._saveToServer();
                await this._saveMomentsToServer();
                await this._savePrivateMomentsToServer();
                
                const allMessages = await this._getAllMessages(this.currentCharacter);
                const messagesLines = allMessages.map(msg => JSON.stringify(msg)).join('\n');
                const base64Data = btoa(unescape(encodeURIComponent(messagesLines + '\n')));

                const fileName = this._getMessagesFileName(this.currentCharacter);
                const response = await fetch('/api/files/upload', {
                    method: 'POST',
                    headers: getRequestHeaders(),
                    body: JSON.stringify({
                        name: fileName,
                        data: base64Data,
                    }),
                });

                if (response.ok) {
                    this.ctx.log('phone-chat-storage', '联系人已删除并同步到服务器');
                } else {
                    this.ctx.error('phone-chat-storage', '同步服务器失败');
                }
                resolve();
            };
            transaction.onerror = () => reject(transaction.error);
        });
    }

    async _saveToServer() {
        if (!this.currentCharacter) return;

        const fileName = this._getContactsFileName(this.currentCharacter);

        try {
            const contacts = await this.getContacts(this.currentCharacter);

            const data = {
                version: 2,
                characterName: this.currentCharacter,
                contacts: contacts,
                updatedAt: Date.now(),
            };

            const jsonStr = JSON.stringify(data, null, 2);
            const base64Data = btoa(unescape(encodeURIComponent(jsonStr)));

            const response = await fetch('/api/files/upload', {
                method: 'POST',
                headers: getRequestHeaders(),
                body: JSON.stringify({
                    name: fileName,
                    data: base64Data,
                }),
            });

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                throw new Error(errorData.error || `上传失败: ${response.status}`);
            }

            this.ctx.log('phone-chat-storage', '联系人已保存到服务器');
        } catch (e) {
            this.ctx.error('phone-chat-storage', '保存联系人到服务器失败:', e);
        }
    }

    async _getAllMessages(characterName) {
        await this._ensureDB();
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['chat_records'], 'readonly');
            const store = transaction.objectStore('chat_records');
            const index = store.index('characterName');
            const request = index.getAll(characterName);
            request.onsuccess = () => resolve(request.result || []);
            request.onerror = () => reject(request.error);
        });
    }

    _generateContactId() {
        return 'contact_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
    }



    async saveAPIConfig(config) {
        await this._ensureDB();
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['api_configs'], 'readwrite');
            const store = transaction.objectStore('api_configs');
            
            const configToSave = {
                ...config,
                configId: config.configId || 'default',
                updatedAt: Date.now(),
            };
            
            const request = store.put(configToSave);
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }

    async getAPIConfig(configId = 'default') {
        await this._ensureDB();
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['api_configs'], 'readonly');
            const store = transaction.objectStore('api_configs');
            const request = store.get(configId);
            request.onsuccess = () => resolve(request.result || null);
            request.onerror = () => reject(request.error);
        });
    }

    async getAllAPIConfigs() {
        await this._ensureDB();
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['api_configs'], 'readonly');
            const store = transaction.objectStore('api_configs');
            const request = store.getAll();
            request.onsuccess = () => resolve(request.result || []);
            request.onerror = () => reject(request.error);
        });
    }

    async deleteAPIConfig(configId) {
        await this._ensureDB();
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['api_configs'], 'readwrite');
            const store = transaction.objectStore('api_configs');
            const request = store.delete(configId);
            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
        });
    }

    async getNovelConfig() {
        await this._ensureDB();
        return new Promise((resolve) => {
            const transaction = this.db.transaction(['novel_config'], 'readonly');
            const store = transaction.objectStore('novel_config');
            const request = store.get('default');
            
            request.onsuccess = () => {
                if (request.result) {
                    resolve(request.result);
                } else {
                    resolve({ configId: 'default', outlineContext: 5, chapterContext: 5, updatedAt: Date.now() });
                }
            };
            
            request.onerror = () => resolve({ configId: 'default', outlineContext: 5, chapterContext: 5, updatedAt: Date.now() });
        });
    }

    async saveNovelConfig(config) {
        await this._ensureDB();
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['novel_config'], 'readwrite');
            const store = transaction.objectStore('novel_config');
            const configToSave = {
                ...config,
                configId: config.configId || 'default',
                updatedAt: Date.now()
            };
            const request = store.put(configToSave);
            
            request.onsuccess = () => {
                this.savePhoneConfigToServer();
                resolve();
            };
            
            request.onerror = () => reject(request.error);
        });
    }

    async getMinutesConfig() {
        await this._ensureDB();
        return new Promise((resolve) => {
            const transaction = this.db.transaction(['minutes_config'], 'readonly');
            const store = transaction.objectStore('minutes_config');
            const request = store.get('default');
            
            request.onsuccess = () => {
                if (request.result) {
                    resolve(request.result);
                } else {
                    resolve({ configId: 'default', floatingBallEnabled: false, activeThemeName: 'xuan', wordingStyle: 'plain', fontFamily: 'system', mappingCharacterRelationships: true, mappingCharacterStatus: true, nsfwFemale: true, nsfwMale: true, updatedAt: Date.now() });
                }
            };
            
            request.onerror = () => resolve({ configId: 'default', floatingBallEnabled: false, activeThemeName: 'xuan', wordingStyle: 'plain', fontFamily: 'system', mappingCharacterRelationships: true, mappingCharacterStatus: true, nsfwFemale: true, nsfwMale: true, updatedAt: Date.now() });
        });
    }

    async saveMinutesConfig(config) {
        await this._ensureDB();
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['minutes_config'], 'readwrite');
            const store = transaction.objectStore('minutes_config');
            
            // 先获取现有配置，保留原有字段
            const getRequest = store.get('default');
            getRequest.onsuccess = () => {
                const existingConfig = getRequest.result || {};
                const configToSave = {
                    ...existingConfig,
                    ...config,
                    configId: config.configId || 'default',
                    updatedAt: Date.now()
                };
                
                const putRequest = store.put(configToSave);
                putRequest.onsuccess = () => {
                    this.savePhoneConfigToServer();
                    resolve();
                };
                putRequest.onerror = () => reject(putRequest.error);
            };
            getRequest.onerror = () => reject(getRequest.error);
        });
    }

    async getLivestreamingConfig() {
        await this._ensureDB();
        return new Promise((resolve) => {
            const transaction = this.db.transaction(['livestreaming_config'], 'readonly');
            const store = transaction.objectStore('livestreaming_config');
            const request = store.get('default');
            
            request.onsuccess = () => {
                if (request.result) {
                    resolve(request.result);
                } else {
                    resolve({ configId: 'default', giftEnabled: true, updatedAt: Date.now() });
                }
            };
            
            request.onerror = () => resolve({ configId: 'default', giftEnabled: true, updatedAt: Date.now() });
        });
    }

    async saveLivestreamingConfig(config) {
        await this._ensureDB();
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['livestreaming_config'], 'readwrite');
            const store = transaction.objectStore('livestreaming_config');
            
            const getRequest = store.get('default');
            getRequest.onsuccess = () => {
                const existingConfig = getRequest.result || {};
                const configToSave = {
                    ...existingConfig,
                    ...config,
                    configId: config.configId || 'default',
                    updatedAt: Date.now()
                };
                
                const putRequest = store.put(configToSave);
                putRequest.onsuccess = () => {
                    this.savePhoneConfigToServer();
                    resolve();
                };
                putRequest.onerror = () => reject(putRequest.error);
            };
            getRequest.onerror = () => reject(getRequest.error);
        });
    }

    async savePhoneConfigToServer() {
        try {
            const apiConfigs = await this.getAllAPIConfigs();
            const activeApiConfigId = await this.getActiveApiConfigId();
            const timeConfig = await this.getTimeConfig('default');
            const characterMemeConfig = await this.getCharacterMemeConfig();
            const imageModeConfig = await this.getImageModeConfig();
            const worldBookConfig = await this.getWorldBookConfig();
            const momentsLimit = await this.getMomentsLimitConfig('default');
            const novelConfig = await this.getNovelConfig();
            const messageLimit = await this.getMessageLimitConfig('default');
            const contextConfig = await this.getContextConfig('default');
            const wallpaperConfig = await this.getWallpaperConfig();
            const userSettings = await this.getUserSettings();
            const ttsConfig = await this.getTTSConfig();
            const featurePresetMapping = await this.getFeaturePresetMapping();
            const forumData = await this.getForumCategories();
            const minutesConfig = await this.getMinutesConfig();
            const livestreamingConfig = await this.getLivestreamingConfig();

            const data = {
                version: '1.0.0',
                updatedAt: Date.now(),
                apiConfigs: apiConfigs,
                activeApiConfigId: activeApiConfigId,
                timeConfig: timeConfig,
                characterMemeConfig: characterMemeConfig,
                imageModeConfig: imageModeConfig,
                worldBookConfig: worldBookConfig,
                momentsLimit: momentsLimit,
                novelConfig: novelConfig,
                messageLimit: messageLimit,
                contextConfig: contextConfig,
                wallpaperConfig: wallpaperConfig,
                userSettings: userSettings,
                ttsConfig: ttsConfig,
                featurePresetMapping: featurePresetMapping,
                forumCategories: forumData.categories,
                extraRules: forumData.extraRules,
                autoPostEnabled: forumData.autoPostEnabled,
                autoPostProbability: forumData.autoPostProbability,
                minutesConfig: minutesConfig,
                livestreamingConfig: livestreamingConfig,
            };

            const jsonStr = JSON.stringify(data, null, 2);
            const encoder = new TextEncoder();
            const uint8Array = encoder.encode(jsonStr);
            const base64Data = this._uint8ArrayToBase64(uint8Array);

            const response = await fetch('/api/files/upload', {
                method: 'POST',
                headers: getRequestHeaders(),
                body: JSON.stringify({
                    name: this.PHONE_CONFIG_FILE,
                    data: base64Data,
                }),
            });

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                throw new Error(errorData.error || `上传失败: ${response.status}`);
            }

            this.ctx.log('phone-chat-storage', '手机配置已保存到服务器');
            return true;
        } catch (e) {
            this.ctx.error('phone-chat-storage', '保存手机配置失败:', e);
            return false;
        }
    }

    _uint8ArrayToBase64(uint8Array) {
        let binary = '';
        const len = uint8Array.byteLength;
        for (let i = 0; i < len; i++) {
            binary += String.fromCharCode(uint8Array[i]);
        }
        return btoa(binary);
    }

    async loadPhoneConfigFromServer() {
        try {
            if (typeof getRequestHeaders !== 'function') {
                this.ctx.warn('phone-chat-storage', 'getRequestHeaders 不可用');
                return null;
            }

            const response = await fetch(`/user/files/${this.PHONE_CONFIG_FILE}`, {
                method: 'GET',
                headers: getRequestHeaders(),
            });

            if (response.ok) {
                const data = await this._parsePhoneConfigData(await response.json());

                if (data.apiConfigs && Array.isArray(data.apiConfigs)) {
                    for (const config of data.apiConfigs) {
                        await this.saveAPIConfig(config);
                    }
                    this.ctx.log('phone-chat-storage', `已加载 ${data.apiConfigs.length} 个API配置`);
                }

                if (data.activeApiConfigId) {
                    await this.saveActiveApiConfigId(data.activeApiConfigId);
                    this.ctx.log('phone-chat-storage', `已设置激活预设: ${data.activeApiConfigId}`);
                }

                if (data.timeConfig) {
                    await this.saveTimeConfig(data.timeConfig);
                    this.ctx.log('phone-chat-storage', '已加载时间配置');
                }

                if (data.characterMemeConfig) {
                    await this.saveCharacterMemeConfig(data.characterMemeConfig);
                    this.ctx.log('phone-chat-storage', '已加载角色表情包配置');
                }

                if (data.imageModeConfig) {
                    await this.saveImageModeConfig(data.imageModeConfig);
                    this.ctx.log('phone-chat-storage', '已加载图片模式配置');
                }

                if (data.worldBookConfig) {
                    await this.saveWorldBookConfig(data.worldBookConfig);
                    this.ctx.log('phone-chat-storage', '已加载世界书配置');
                }

                if (data.momentsLimit) {
                    await this.saveMomentsLimitConfig({ momentsLimit: data.momentsLimit });
                    this.ctx.log('phone-chat-storage', '已加载朋友圈显示数量配置');
                }

                if (data.novelConfig) {
                    await this.saveNovelConfig(data.novelConfig);
                    this.ctx.log('phone-chat-storage', '已加载小说配置');
                }

                if (data.messageLimit) {
                    await this.saveMessageLimitConfig({ messageLimit: data.messageLimit });
                    this.ctx.log('phone-chat-storage', '已加载消息显示数量配置');
                }

                if (data.contextConfig) {
                    await this.saveContextConfig(data.contextConfig);
                    this.ctx.log('phone-chat-storage', '已加载上下文配置');
                }

                if (data.wallpaperConfig) {
                    await this.saveWallpaperConfig(data.wallpaperConfig);
                    this.ctx.log('phone-chat-storage', '已加载壁纸配置');
                }

                if (data.userSettings) {
                    await this.saveUserSettings(data.userSettings);
                    this.ctx.log('phone-chat-storage', '已加载用户设置');
                }

                if (data.ttsConfig) {
                    await this.saveTTSConfig(data.ttsConfig);
                    this.ctx.log('phone-chat-storage', '已加载TTS语音配置');
                }

                if (data.minutesConfig) {
                    await this.saveMinutesConfig(data.minutesConfig);
                    this.ctx.log('phone-chat-storage', '已加载剧情百科配置');
                }

                if (data.featurePresetMapping) {
                    await this.saveFeaturePresetMapping(data.featurePresetMapping);
                    this.ctx.log('phone-chat-storage', '已加载功能预设映射配置');
                }

                if (data.forumCategories && Array.isArray(data.forumCategories)) {
                    await this.saveForumCategories(data.forumCategories, data.extraRules, data.autoPostEnabled, data.autoPostProbability);
                    this.ctx.log('phone-chat-storage', '已加载论坛分类配置');
                }

                return data;
            } else if (response.status === 404) {
                this.ctx.log('phone-chat-storage', '手机配置文件不存在');
                return null;
            }
        } catch (e) {
            this.ctx.warn('phone-chat-storage', '加载手机配置失败:', e);
        }
        return null;
    }

    async _parsePhoneConfigData(data) {
        return data;
    }

    async saveTimeConfig(config) {
        await this._ensureDB();
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['time_config'], 'readwrite');
            const store = transaction.objectStore('time_config');
            
            const configToSave = {
                ...config,
                configId: config.configId || 'default',
                updatedAt: Date.now(),
            };
            
            const request = store.put(configToSave);
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }

    async getTimeConfig(configId = 'default') {
        await this._ensureDB();
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['time_config'], 'readonly');
            const store = transaction.objectStore('time_config');
            const request = store.get(configId);
            request.onsuccess = () => resolve(request.result || null);
            request.onerror = () => reject(request.error);
        });
    }

    async saveCharacterMemeConfig(config) {
        await this._ensureDB();
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['character_meme_config'], 'readwrite');
            const store = transaction.objectStore('character_meme_config');
            
            const configToSave = {
                ...config,
                configId: config.configId || 'default',
                updatedAt: Date.now(),
            };
            
            const request = store.put(configToSave);
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }

    async getCharacterMemeConfig(configId = 'default') {
        await this._ensureDB();
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['character_meme_config'], 'readonly');
            const store = transaction.objectStore('character_meme_config');
            const request = store.get(configId);
            request.onsuccess = () => resolve(request.result || null);
            request.onerror = () => reject(request.error);
        });
    }

    async saveImageModeConfig(config) {
        await this._ensureDB();
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['image_mode_config'], 'readwrite');
            const store = transaction.objectStore('image_mode_config');
            
            // 先获取现有配置，保留原有字段
            const getRequest = store.get(config.configId || 'default');
            getRequest.onsuccess = () => {
                const existingConfig = getRequest.result || {};
                const configToSave = {
                    ...existingConfig,
                    ...config,
                    configId: config.configId || 'default',
                    updatedAt: Date.now(),
                };
                
                const putRequest = store.put(configToSave);
                putRequest.onsuccess = () => resolve(putRequest.result);
                putRequest.onerror = () => reject(putRequest.error);
            };
            getRequest.onerror = () => reject(getRequest.error);
        });
    }

    async getImageModeConfig(configId = 'default') {
        await this._ensureDB();
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['image_mode_config'], 'readonly');
            const store = transaction.objectStore('image_mode_config');
            const request = store.get(configId);
            request.onsuccess = () => resolve(request.result || null);
            request.onerror = () => reject(request.error);
        });
    }

    async saveMomentsLimitConfig(config) {
        await this._ensureDB();
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['image_mode_config'], 'readwrite');
            const store = transaction.objectStore('image_mode_config');
            
            // 先获取现有配置，保留原有字段
            const getRequest = store.get(config.configId || 'default');
            getRequest.onsuccess = () => {
                const existingConfig = getRequest.result || {};
                const configToSave = {
                    ...existingConfig,
                    ...config,
                    configId: config.configId || 'default',
                    updatedAt: Date.now(),
                };
                
                const putRequest = store.put(configToSave);
                putRequest.onsuccess = () => resolve(putRequest.result);
                putRequest.onerror = () => reject(putRequest.error);
            };
            getRequest.onerror = () => reject(getRequest.error);
        });
    }

    async getMomentsLimitConfig(configId = 'default') {
        await this._ensureDB();
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['image_mode_config'], 'readonly');
            const store = transaction.objectStore('image_mode_config');
            const request = store.get(configId);
            request.onsuccess = () => {
                const config = request.result || {};
                resolve(config.momentsLimit || 20);
            };
            request.onerror = () => {
                this.ctx.error('phone-chat-storage', `获取朋友圈显示数量配置失败: ${request.error}`);
                resolve(20);
            };
        });
    }

    async saveHistoryLimitConfig(config) {
        await this._ensureDB();
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['image_mode_config'], 'readwrite');
            const store = transaction.objectStore('image_mode_config');
            
            // 先获取现有配置，保留原有字段
            const getRequest = store.get(config.configId || 'default');
            getRequest.onsuccess = () => {
                const existingConfig = getRequest.result || {};
                const configToSave = {
                    ...existingConfig,
                    ...config,
                    configId: config.configId || 'default',
                    updatedAt: Date.now(),
                };
                
                const putRequest = store.put(configToSave);
                putRequest.onsuccess = () => resolve(putRequest.result);
                putRequest.onerror = () => reject(putRequest.error);
            };
            getRequest.onerror = () => reject(getRequest.error);
        });
    }

    async getHistoryLimitConfig(configId = 'default') {
        await this._ensureDB();
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['image_mode_config'], 'readonly');
            const store = transaction.objectStore('image_mode_config');
            const request = store.get(configId);
            request.onsuccess = () => {
                const config = request.result || {};
                resolve(config.historyLimit || 3);
            };
            request.onerror = () => {
                this.ctx.error('phone-chat-storage', `获取直播历史记录读取配置失败: ${request.error}`);
                resolve(3);
            };
        });
    }

    async saveMessageLimitConfig(config) {
        await this._ensureDB();
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['message_limit_config'], 'readwrite');
            const store = transaction.objectStore('message_limit_config');
            
            const configToSave = {
                ...config,
                configId: config.configId || 'default',
                updatedAt: Date.now(),
            };
            
            const request = store.put(configToSave);
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }

    async getMessageLimitConfig(configId = 'default') {
        await this._ensureDB();
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['message_limit_config'], 'readonly');
            const store = transaction.objectStore('message_limit_config');
            const request = store.get(configId);
            request.onsuccess = () => {
                const config = request.result || {};
                resolve(config.messageLimit || 30);
            };
            request.onerror = () => {
                this.ctx.error('phone-chat-storage', `获取消息显示数量配置失败: ${request.error}`);
                resolve(30);
            };
        });
    }

    async saveContextConfig(config) {
        await this._ensureDB();
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['context_config'], 'readwrite');
            const store = transaction.objectStore('context_config');
            
            const configToSave = {
                ...config,
                configId: config.configId || 'default',
                updatedAt: Date.now(),
            };
            
            const request = store.put(configToSave);
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }

    async getContextConfig(configId = 'default') {
        await this._ensureDB();
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['context_config'], 'readonly');
            const store = transaction.objectStore('context_config');
            const request = store.get(configId);
            request.onsuccess = () => {
                const config = request.result || {};
                resolve({
                    contextDepth: config.contextDepth || 5,
                    includeUserMessages: config.includeUserMessages || false,
                    autoReplyBlockDepth: config.autoReplyBlockDepth || 0
                });
            };
            request.onerror = () => {
                this.ctx.error('phone-chat-storage', `获取上下文配置失败: ${request.error}`);
                resolve({ contextDepth: 5, includeUserMessages: false, autoReplyBlockDepth: 0 });
            };
        });
    }

    async saveWorldBookConfig(config) {
        await this._ensureDB();
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['worldbook_config'], 'readwrite');
            const store = transaction.objectStore('worldbook_config');
            
            const configToSave = {
                ...config,
                configId: config.configId || 'default',
                updatedAt: Date.now(),
            };
            
            const request = store.put(configToSave);
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }

    async getWorldBookConfig(configId = 'default') {
        await this._ensureDB();
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['worldbook_config'], 'readonly');
            const store = transaction.objectStore('worldbook_config');
            const request = store.get(configId);
            request.onsuccess = () => resolve(request.result || null);
            request.onerror = () => reject(request.error);
        });
    }

    async saveWallpaperConfig(config) {
        await this._ensureDB();
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['wallpaper_config'], 'readwrite');
            const store = transaction.objectStore('wallpaper_config');
            
            const getRequest = store.get(config.configId || 'default');
            getRequest.onsuccess = () => {
                const existingConfig = getRequest.result || {};
                const configToSave = {
                    ...existingConfig,
                    ...config,
                    configId: config.configId || 'default',
                    updatedAt: Date.now(),
                };
                
                const putRequest = store.put(configToSave);
                putRequest.onsuccess = () => resolve(putRequest.result);
                putRequest.onerror = () => reject(putRequest.error);
            };
            getRequest.onerror = () => reject(getRequest.error);
        });
    }

    async getWallpaperConfig(configId = 'default') {
        await this._ensureDB();
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['wallpaper_config'], 'readonly');
            const store = transaction.objectStore('wallpaper_config');
            const request = store.get(configId);
            request.onsuccess = () => resolve(request.result || null);
            request.onerror = () => reject(request.error);
        });
    }

    async saveUserSettings(config) {
        await this._ensureDB();
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['user_settings'], 'readwrite');
            const store = transaction.objectStore('user_settings');
            
            const getRequest = store.get(config.configId || 'default');
            getRequest.onsuccess = () => {
                const existingConfig = getRequest.result || {};
                const configToSave = {
                    ...existingConfig,
                    ...config,
                    configId: config.configId || 'default',
                    updatedAt: Date.now(),
                };
                
                const putRequest = store.put(configToSave);
                putRequest.onsuccess = () => resolve(putRequest.result);
                putRequest.onerror = () => reject(putRequest.error);
            };
            getRequest.onerror = () => reject(getRequest.error);
        });
    }

    async getUserSettings(configId = 'default') {
        await this._ensureDB();
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['user_settings'], 'readonly');
            const store = transaction.objectStore('user_settings');
            const request = store.get(configId);
            request.onsuccess = () => resolve(request.result || null);
            request.onerror = () => reject(request.error);
        });
    }

    async saveTTSConfig(config) {
        await this._ensureDB();
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['tts_config'], 'readwrite');
            const store = transaction.objectStore('tts_config');

            const configToSave = {
                ...config,
                configId: config.configId || 'default',
                updatedAt: Date.now(),
            };

            const request = store.put(configToSave);
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }

    async getTTSConfig(configId = 'default') {
        await this._ensureDB();
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['tts_config'], 'readonly');
            const store = transaction.objectStore('tts_config');
            const request = store.get(configId);
            request.onsuccess = () => resolve(request.result || null);
            request.onerror = () => reject(request.error);
        });
    }

    async saveActiveApiConfigId(configId) {
        await this._ensureDB();
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['api_configs'], 'readwrite');
            const store = transaction.objectStore('api_configs');
            
            const configToSave = {
                configId: 'active_preset',
                activeApiConfigId: configId,
                updatedAt: Date.now(),
            };
            
            const request = store.put(configToSave);
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }

    async getActiveApiConfigId() {
        await this._ensureDB();
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['api_configs'], 'readonly');
            const store = transaction.objectStore('api_configs');
            const request = store.get('active_preset');
            request.onsuccess = () => {
                const result = request.result;
                resolve(result ? result.activeApiConfigId : null);
            };
            request.onerror = () => reject(request.error);
        });
    }

    async saveFeaturePresetMapping(mapping) {
        await this._ensureDB();
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['api_configs'], 'readwrite');
            const store = transaction.objectStore('api_configs');

            const configToSave = {
                configId: 'feature_preset_mapping',
                moments: mapping.moments || null,
                forum: mapping.forum || null,
                map: mapping.map || null,
                nearby: mapping.nearby || null,
                chat: mapping.chat || null,
                groupChat: mapping.groupChat || null,
                novel: mapping.novel || null,
                remake: mapping.remake || null,
                relationship: mapping.relationship || null,
                livestreaming: mapping.livestreaming || null,
                updatedAt: Date.now(),
            };

            const request = store.put(configToSave);
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }

    async getFeaturePresetMapping() {
        await this._ensureDB();
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['api_configs'], 'readonly');
            const store = transaction.objectStore('api_configs');
            const request = store.get('feature_preset_mapping');
            request.onsuccess = () => {
                const result = request.result;
                resolve(result || {
                    configId: 'feature_preset_mapping',
                    moments: null,
                    forum: null,
                    map: null,
                    nearby: null,
                    chat: null,
                    groupChat: null,
                    novel: null,
                    remake: null,
                    relationship: null,
                    livestreaming: null,
                });
            };
            request.onerror = () => reject(request.error);
        });
    }

    async getFeaturePreset(featureType) {
        const mapping = await this.getFeaturePresetMapping();
        const presetId = mapping[featureType];
        
        if (presetId) {
            const config = await this.getAPIConfig(presetId);
            if (config) {
                return config;
            }
        }
        
        const activeConfigId = await this.getActiveApiConfigId();
        if (activeConfigId) {
            return await this.getAPIConfig(activeConfigId);
        }
        
        return null;
    }

    _getMomentsFileName(characterName) {
        const sanitized = this._sanitizeCharacterName(characterName);
        return `tsp-chat-${sanitized}-wechat_moments.json`;
    }

    async getMoments(contactId) {
        await this._ensureDB();
        
        return new Promise((resolve) => {
            const transaction = this.db.transaction(['chat_moments'], 'readonly');
            const store = transaction.objectStore('chat_moments');
            const index = store.index('contactId');
            const request = index.getAll(contactId);
            
            request.onsuccess = () => {
                const moments = request.result || [];
                const sortedMoments = this._sortMomentsByTime(moments);
                resolve(sortedMoments);
            };
            request.onerror = () => {
                this.ctx.error('phone-chat-storage', `从IndexedDB加载朋友圈失败: ${request.error}`);
                resolve([]);
            };
        });
    }

    async getAllMoments() {
        await this._ensureDB();
        
        return new Promise((resolve) => {
            const transaction = this.db.transaction(['chat_moments'], 'readonly');
            const store = transaction.objectStore('chat_moments');
            const request = store.getAll();
            
            request.onsuccess = () => {
                const moments = request.result || [];
                const sortedMoments = this._sortMomentsByTime(moments);
                resolve(sortedMoments);
            };
            request.onerror = () => {
                this.ctx.error('phone-chat-storage', `从IndexedDB加载所有朋友圈失败: ${request.error}`);
                resolve([]);
            };
        });
    }

    async getMomentsByCharacter() {
        await this._ensureDB();
        
        const characterName = this.currentCharacter;
        if (!characterName) {
            this.ctx.warn('phone-chat-storage', '未设置当前角色卡，无法加载朋友圈');
            return [];
        }

        return new Promise((resolve) => {
            const transaction = this.db.transaction(['chat_moments'], 'readonly');
            const store = transaction.objectStore('chat_moments');
            const index = store.index('characterName');
            const request = index.getAll(characterName);
            
            request.onsuccess = () => {
                const moments = request.result || [];
                const sortedMoments = this._sortMomentsByTime(moments);
                this.ctx.log('phone-chat-storage', `已加载角色卡 ${characterName} 的 ${moments.length} 条朋友圈`);
                resolve(sortedMoments);
            };
            request.onerror = () => {
                this.ctx.error('phone-chat-storage', `从IndexedDB加载角色卡朋友圈失败: ${request.error}`);
                resolve([]);
            };
        });
    }

    _sortMomentsByTime(moments) {
        return moments.sort((a, b) => {
            const timeA = this._parseTime(a.time);
            const timeB = this._parseTime(b.time);
            return timeB - timeA;
        });
    }

    _parseTime(timeStr) {
        if (!timeStr) return 0;
        
        let match;
        
        match = timeStr.match(/(\d{4})-(\d{1,2})-(\d{1,2})\s+(\d{1,2}):(\d{1,2}):(\d{1,2})/);
        if (match) {
            const year = parseInt(match[1]);
            const month = parseInt(match[2]);
            const day = parseInt(match[3]);
            const hour = parseInt(match[4]);
            const minute = parseInt(match[5]);
            const second = parseInt(match[6]);
            return new Date(year, month - 1, day, hour, minute, second).getTime();
        }
        
        match = timeStr.match(/(\d{4})年(\d{1,2})月(\d{1,2})日\s+(\d{1,2}):(\d{1,2})/);
        if (match) {
            const year = parseInt(match[1]);
            const month = parseInt(match[2]);
            const day = parseInt(match[3]);
            const hour = parseInt(match[4]);
            const minute = parseInt(match[5]);
            return new Date(year, month - 1, day, hour, minute, 0).getTime();
        }
        
        match = timeStr.match(/(\d{4})年(\d{1,2})月(\d{1,2})日/);
        if (match) {
            const year = parseInt(match[1]);
            const month = parseInt(match[2]);
            const day = parseInt(match[3]);
            return new Date(year, month - 1, day).getTime();
        }
        
        return 0;
    }

    async _loadMomentsFromServer(characterName) {
        if (this._loadedMoments.has(characterName)) {
            return;
        }

        const fileName = this._getMomentsFileName(characterName);
        this.ctx.log('phone-chat-storage', `从服务器加载朋友圈: ${fileName}`);

        try {
            if (typeof getRequestHeaders !== 'function') {
                this.ctx.warn('phone-chat-storage', 'getRequestHeaders 不可用');
                return;
            }

            const headers = getRequestHeaders();
            const response = await fetch(`/user/files/${fileName}`, {
                method: 'GET',
                headers: headers,
            });

            if (response.ok) {
                const text = await response.text();
                const data = JSON.parse(text);

                if (data.moments && Array.isArray(data.moments)) {
                    for (const moment of data.moments) {
                        moment.characterName = characterName;
                        await this._saveMomentToDB(moment);
                    }
                }

                this._loadedMoments.add(characterName);
                this.ctx.log('phone-chat-storage', `已加载 ${data.moments?.length || 0} 条朋友圈`);
            } else if (response.status === 404) {
                this.ctx.log('phone-chat-storage', `朋友圈文件不存在 (404): ${fileName}`);
                this._loadedMoments.add(characterName);
            }
        } catch (e) {
            this.ctx.warn('phone-chat-storage', `加载朋友圈失败: ${e.message}`);
            this._loadedMoments.add(characterName);
        }
    }

    async _loadMapFromServer(characterName) {
        if (this._loadedMaps.has(characterName)) {
            return;
        }

        const fileName = this._getMapFileName(characterName);
        this.ctx.log('phone-chat-storage', `从服务器加载地图: ${fileName}`);

        try {
            if (typeof getRequestHeaders !== 'function') {
                this.ctx.warn('phone-chat-storage', 'getRequestHeaders 不可用');
                return;
            }

            const headers = getRequestHeaders();
            const response = await fetch(`/user/files/${fileName}`, {
                method: 'GET',
                headers: headers,
            });

            if (response.ok) {
                const text = await response.text();
                const data = JSON.parse(text);

                if (data) {
                    data.characterName = characterName;
                    await this._saveMapToDB(data);
                }

                this._loadedMaps.add(characterName);
                this.ctx.log('phone-chat-storage', `已加载地图数据: ${fileName}`);
            } else if (response.status === 404) {
                this.ctx.log('phone-chat-storage', `地图文件不存在 (404): ${fileName}`);
                this._loadedMaps.add(characterName);
            }
        } catch (e) {
            this.ctx.warn('phone-chat-storage', `加载地图失败: ${e.message}`);
            this._loadedMaps.add(characterName);
        }
    }

    async _loadPrivateMomentsFromServer(characterName) {
        if (this._loadedPrivateMoments.has(characterName)) {
            return;
        }

        const fileName = this._getPrivateMomentsFileName(characterName);
        this.ctx.log('phone-chat-storage', `从服务器加载隐私朋友圈: ${fileName}`);

        try {
            if (typeof getRequestHeaders !== 'function') {
                this.ctx.warn('phone-chat-storage', 'getRequestHeaders 不可用');
                return;
            }

            const headers = getRequestHeaders();
            const response = await fetch(`/user/files/${fileName}`, {
                method: 'GET',
                headers: headers,
            });

            if (response.ok) {
                const text = await response.text();
                const data = JSON.parse(text);

                if (data.moments && Array.isArray(data.moments)) {
                    for (const moment of data.moments) {
                        moment.characterName = characterName;
                        await this._savePrivateMomentToDB(moment);
                    }
                }

                this._loadedPrivateMoments.add(characterName);
                this.ctx.log('phone-chat-storage', `已加载 ${data.moments?.length || 0} 条隐私朋友圈`);
            } else if (response.status === 404) {
                this.ctx.log('phone-chat-storage', `隐私朋友圈文件不存在 (404): ${fileName}`);
                this._loadedPrivateMoments.add(characterName);
            }
        } catch (e) {
            this.ctx.warn('phone-chat-storage', `加载隐私朋友圈失败: ${e.message}`);
            this._loadedPrivateMoments.add(characterName);
        }
    }

    async _saveMomentToDB(moment) {
        await this._ensureDB();
        
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['chat_moments'], 'readwrite');
            const store = transaction.objectStore('chat_moments');
            const request = store.put(moment);
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }

    async _saveMapToDB(mapData) {
        await this._ensureDB();
        
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['chat_map'], 'readwrite');
            const store = transaction.objectStore('chat_map');
            const request = store.put(mapData);
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }

    async saveMoments(contactId, moments) {
        const characterName = this.currentCharacter;
        if (!characterName) {
            throw new Error('未选择角色卡');
        }

        const fileName = this._getMomentsFileName(characterName);
        
        try {
            const existingMoments = await this.getMoments(contactId);
            const existingIds = new Set(existingMoments.map(m => m.id));

            for (const moment of moments) {
                if (!moment.id || existingIds.has(moment.id)) {
                    moment.id = this._generateMomentId();
                }
                moment.characterName = characterName;
                moment.contactId = contactId;
                // 添加readStatus字段，默认为false表示未读
                if (moment.readStatus === undefined) {
                    moment.readStatus = false;
                }
                await this._saveMomentToDB(moment);
            }

            if (typeof getRequestHeaders !== 'function') {
                throw new Error('getRequestHeaders 不可用');
            }

            const allMoments = await this.getAllMoments();
            const characterMoments = allMoments.filter(m => m.characterName === characterName);

            const data = {
                version: 2,
                characterName: characterName,
                moments: characterMoments,
                updatedAt: Date.now(),
            };

            const jsonStr = JSON.stringify(data, null, 2);
            const base64Data = btoa(unescape(encodeURIComponent(jsonStr)));

            const headers = getRequestHeaders();
            const response = await fetch('/api/files/upload', {
                method: 'POST',
                headers: headers,
                body: JSON.stringify({
                    name: fileName,
                    data: base64Data,
                }),
            });

            if (!response.ok) {
                const errorText = await response.text();
                this.ctx.error('phone-chat-storage', `保存朋友圈失败响应: ${errorText}`);
                const errorData = await response.json().catch(() => ({}));
                throw new Error(errorData.error || `保存朋友圈失败: ${response.status}`);
            }

            this.ctx.log('phone-chat-storage', `已保存 ${moments.length} 条朋友圈`);
        } catch (e) {
            this.ctx.error('phone-chat-storage', `保存朋友圈失败: ${e.message}`);
            throw e;
        }
    }

    _generateMomentId() {
        return 'moment_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
    }

    async addComment(momentId, comment) {
        await this._ensureDB();
        
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['chat_moments'], 'readwrite');
            const store = transaction.objectStore('chat_moments');
            const request = store.get(momentId);
            
            request.onsuccess = () => {
                const moment = request.result;
                if (moment) {
                    if (!moment.comments) {
                        moment.comments = [];
                    }
                    moment.comments.push(comment);
                    
                    const updateRequest = store.put(moment);
                    updateRequest.onsuccess = async () => {
                        await this._saveMomentsToServer();
                        this.ctx.log('phone-chat-storage', '评论已保存');
                        resolve();
                    };
                    updateRequest.onerror = () => reject(updateRequest.error);
                } else {
                    reject(new Error('朋友圈不存在'));
                }
            };
            request.onerror = () => reject(request.error);
        });
    }

    async updateMoment(momentId, updatedMoment) {
        await this._ensureDB();
        
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['chat_moments'], 'readwrite');
            const store = transaction.objectStore('chat_moments');
            const request = store.get(momentId);
            
            request.onsuccess = () => {
                const moment = request.result;
                if (moment) {
                    const updateRequest = store.put(updatedMoment);
                    updateRequest.onsuccess = async () => {
                        await this._saveMomentsToServer();
                        this.ctx.log('phone-chat-storage', '朋友圈已更新');
                        resolve();
                    };
                    updateRequest.onerror = () => reject(updateRequest.error);
                } else {
                    reject(new Error('朋友圈不存在'));
                }
            };
            request.onerror = () => reject(request.error);
        });
    }

    async updatePrivateMoment(momentId, updatedMoment) {
        await this._ensureDB();
        
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['chat_private_moments'], 'readwrite');
            const store = transaction.objectStore('chat_private_moments');
            const request = store.get(momentId);
            
            request.onsuccess = () => {
                const moment = request.result;
                if (moment) {
                    const updateRequest = store.put(updatedMoment);
                    updateRequest.onsuccess = async () => {
                        await this._savePrivateMomentsToServer();
                        this.ctx.log('phone-chat-storage', '隐私朋友圈已更新');
                        resolve();
                    };
                    updateRequest.onerror = () => reject(updateRequest.error);
                } else {
                    reject(new Error('隐私朋友圈不存在'));
                }
            };
            request.onerror = () => reject(request.error);
        });
    }

    async updateMoments(moments) {
        await this._ensureDB();
        
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['chat_moments'], 'readwrite');
            const store = transaction.objectStore('chat_moments');
            
            let completed = 0;
            const total = moments.length;
            
            if (total === 0) {
                resolve();
                return;
            }
            
            for (const moment of moments) {
                const request = store.put(moment);
                request.onsuccess = () => {
                    completed++;
                    if (completed === total) {
                        this._saveMomentsToServer().then(() => {
                            this.ctx.log('phone-chat-storage', `已批量更新 ${total} 条朋友圈`);
                            resolve();
                        }).catch(error => {
                            reject(error);
                        });
                    }
                };
                request.onerror = () => {
                    reject(request.error);
                };
            }
        });
    }

    async updatePrivateMoments(moments) {
        await this._ensureDB();
        
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['chat_private_moments'], 'readwrite');
            const store = transaction.objectStore('chat_private_moments');
            
            let completed = 0;
            const total = moments.length;
            
            if (total === 0) {
                resolve();
                return;
            }
            
            for (const moment of moments) {
                const request = store.put(moment);
                request.onsuccess = () => {
                    completed++;
                    if (completed === total) {
                        this._savePrivateMomentsToServer().then(() => {
                            this.ctx.log('phone-chat-storage', `已批量更新 ${total} 条隐私朋友圈`);
                            resolve();
                        }).catch(error => {
                            reject(error);
                        });
                    }
                };
                request.onerror = () => {
                    reject(request.error);
                };
            }
        });
    }

    async toggleLike(momentId, userName) {
        await this._ensureDB();
        
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['chat_moments'], 'readwrite');
            const store = transaction.objectStore('chat_moments');
            const request = store.get(momentId);
            
            request.onsuccess = () => {
                const moment = request.result;
                if (moment) {
                    if (!moment.likedBy) {
                        moment.likedBy = [];
                    }
                    
                    const userIndex = moment.likedBy.indexOf(userName);
                    if (userIndex > -1) {
                        moment.likedBy.splice(userIndex, 1);
                        moment.likeCount = Math.max(0, (moment.likeCount || 0) - 1);
                    } else {
                        moment.likedBy.push(userName);
                        moment.likeCount = (moment.likeCount || 0) + 1;
                    }
                    
                    const updateRequest = store.put(moment);
                    updateRequest.onsuccess = async () => {
                        await this._saveMomentsToServer();
                        this.ctx.log('phone-chat-storage', '点赞状态已更新');
                        resolve({ liked: userIndex === -1, likeCount: moment.likeCount, likedBy: moment.likedBy });
                    };
                    updateRequest.onerror = () => reject(updateRequest.error);
                } else {
                    reject(new Error('朋友圈不存在'));
                }
            };
            request.onerror = () => reject(request.error);
        });
    }

    async deleteComment(momentId, commentId) {
        await this._ensureDB();
        
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['chat_moments'], 'readwrite');
            const store = transaction.objectStore('chat_moments');
            const request = store.get(momentId);
            
            request.onsuccess = () => {
                const moment = request.result;
                if (moment && moment.comments) {
                    const commentIndex = moment.comments.findIndex(c => c.id === commentId);
                    if (commentIndex > -1) {
                        moment.comments.splice(commentIndex, 1);
                        
                        const updateRequest = store.put(moment);
                        updateRequest.onsuccess = async () => {
                            await this._saveMomentsToServer();
                            this.ctx.log('phone-chat-storage', '评论已删除');
                            resolve();
                        };
                        updateRequest.onerror = () => reject(updateRequest.error);
                    } else {
                        reject(new Error('评论不存在'));
                    }
                } else {
                    reject(new Error('朋友圈或评论不存在'));
                }
            };
            request.onerror = () => reject(request.error);
        });
    }

    async deleteMoment(momentId) {
        await this._ensureDB();
        
        return new Promise(async (resolve, reject) => {
            const transaction = this.db.transaction(['chat_moments'], 'readwrite');
            const store = transaction.objectStore('chat_moments');
            const request = store.delete(momentId);

            request.onsuccess = async () => {
                await this._saveMomentsToServer();
                this.ctx.log('phone-chat-storage', '朋友圈已删除并同步到服务器');
                resolve(true);
            };
            request.onerror = () => reject(request.error);
        });
    }

    async _saveMomentsToServer() {
        if (!this.currentCharacter) return;

        const fileName = this._getMomentsFileName(this.currentCharacter);

        try {
            const allMoments = await this.getAllMoments();
            const characterMoments = allMoments.filter(m => m.characterName === this.currentCharacter);

            const userName = this._getUserName();
            const processedMoments = characterMoments.map(moment => this._replaceUserNameInMoment(moment, userName));

            const data = {
                version: 2,
                characterName: this.currentCharacter,
                moments: processedMoments,
                updatedAt: Date.now(),
            };

            const jsonStr = JSON.stringify(data, null, 2);
            const base64Data = btoa(unescape(encodeURIComponent(jsonStr)));

            const response = await fetch('/api/files/upload', {
                method: 'POST',
                headers: getRequestHeaders(),
                body: JSON.stringify({
                    name: fileName,
                    data: base64Data,
                }),
            });

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                throw new Error(errorData.error || `上传失败: ${response.status}`);
            }

            this.ctx.log('phone-chat-storage', '朋友圈已保存到服务器');
        } catch (e) {
            this.ctx.error('phone-chat-storage', '保存朋友圈到服务器失败:', e);
        }
    }

    _getUserName() {
        const win = window;
        if (typeof win.SillyTavern !== 'undefined' && typeof win.SillyTavern.getContext === 'function') {
            const ctx = win.SillyTavern.getContext();
            if (ctx && ctx.name1) {
                return ctx.name1;
            }
        }
        return win.name1 || 'User';
    }

    _replaceUserNameInMoment(moment, userName) {
        if (!moment) return moment;
        
        const processed = { ...moment };
        
        if (processed.likedBy && Array.isArray(processed.likedBy)) {
            processed.likedBy = processed.likedBy.map(name => 
                name === userName ? '<user>' : name
            );
        }
        
        if (processed.comments && Array.isArray(processed.comments)) {
            processed.comments = processed.comments.map(comment => {
                const processedComment = { ...comment };
                if (processedComment.author === userName) {
                    processedComment.author = '<user>';
                }
                return processedComment;
            });
        }
        
        return processed;
    }

    _restoreUserNameInMoment(moment, userName) {
        if (!moment) return moment;
        
        const processed = { ...moment };
        
        if (processed.likedBy && Array.isArray(processed.likedBy)) {
            processed.likedBy = processed.likedBy.map(name => 
                name === '<user>' ? userName : name
            );
        }
        
        if (processed.comments && Array.isArray(processed.comments)) {
            processed.comments = processed.comments.map(comment => {
                const processedComment = { ...comment };
                if (processedComment.author === '<user>') {
                    processedComment.author = userName;
                }
                return processedComment;
            });
        }
        
        return processed;
    }

    _replaceUserNameInForumPost(post, userName) {
        if (!post) return post;
        
        const processed = { ...post };
        
        if (processed.likedBy && Array.isArray(processed.likedBy)) {
            processed.likedBy = processed.likedBy.map(name => 
                name === userName ? '<user>' : name
            );
        }
        
        if (processed.comments && Array.isArray(processed.comments)) {
            processed.comments = processed.comments.map(comment => {
                const processedComment = { ...comment };
                if (processedComment.author === userName) {
                    processedComment.author = '<user>';
                }
                return processedComment;
            });
        }
        
        return processed;
    }

    _restoreUserNameInForumPost(post, userName) {
        if (!post) return post;
        
        const processed = { ...post };
        
        if (processed.likedBy && Array.isArray(processed.likedBy)) {
            processed.likedBy = processed.likedBy.map(name => 
                name === '<user>' ? userName : name
            );
        }
        
        if (processed.comments && Array.isArray(processed.comments)) {
            processed.comments = processed.comments.map(comment => {
                const processedComment = { ...comment };
                if (processedComment.author === '<user>') {
                    processedComment.author = userName;
                }
                return processedComment;
            });
        }
        
        return processed;
    }

    async getMap(characterName = null) {
        const targetCharacter = characterName || this.currentCharacter;
        if (!targetCharacter) return null;

        await this._ensureDB();
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['chat_map'], 'readonly');
            const store = transaction.objectStore('chat_map');
            const index = store.index('characterName');
            const request = index.getAll(targetCharacter);

            request.onsuccess = () => {
                const maps = request.result || [];
                resolve(maps[0] || null);
            };
            request.onerror = () => reject(request.error);
        });
    }

    async saveMap(mapData) {
        const characterName = this.currentCharacter;
        if (!characterName) {
            throw new Error('未选择角色卡');
        }

        mapData.characterName = characterName;
        mapData.updatedAt = Date.now();

        await this._saveMapToDB(mapData);
        await this._saveMapToServer(mapData);

        return mapData;
    }

    async _saveMapToServer(mapData) {
        const fileName = this._getMapFileName(this.currentCharacter);

        try {
            const jsonStr = JSON.stringify(mapData, null, 2);
            const base64Data = btoa(unescape(encodeURIComponent(jsonStr)));

            const response = await fetch('/api/files/upload', {
                method: 'POST',
                headers: getRequestHeaders(),
                body: JSON.stringify({
                    name: fileName,
                    data: base64Data,
                }),
            });

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                throw new Error(errorData.error || `保存地图失败: ${response.status}`);
            }

            this.ctx.log('phone-chat-storage', '地图已保存到服务器');
        } catch (e) {
            this.ctx.error('phone-chat-storage', `保存地图到服务器失败: ${e.message}`);
            throw e;
        }
    }

    cleanup() {
        if (this.db) {
            this.db.close();
            this.db = null;
        }
    }
    
    _getNearbyCharactersFileName(characterName) {
        const sanitized = this._sanitizeCharacterName(characterName);
        return `tsp-${sanitized}-Nearby-characters.json`;
    }
    
    async _loadNearbyCharactersFromServer(characterName) {
        if (this._loadedNearbyCharacters.has(characterName)) {
            return;
        }

        const fileName = this._getNearbyCharactersFileName(characterName);
        this.ctx.log('phone-chat-storage', `从服务器加载附近的人: ${fileName}`);

        try {
            if (typeof getRequestHeaders !== 'function') {
                this.ctx.warn('phone-chat-storage', 'getRequestHeaders 不可用');
                return;
            }

            const headers = getRequestHeaders();
            const response = await fetch(`/user/files/${fileName}`, {
                method: 'GET',
                headers: headers,
            });

            if (response.ok) {
                const text = await response.text();
                const data = JSON.parse(text);

                if (data.characters && Array.isArray(data.characters)) {
                    for (const char of data.characters) {
                        char.characterName = characterName;
                        await this._saveNearbyCharacterToDB(char);
                    }
                }

                this._loadedNearbyCharacters.add(characterName);
                this.ctx.log('phone-chat-storage', `已加载 ${data.characters?.length || 0} 个附近的人`);
            } else if (response.status === 404) {
                this.ctx.log('phone-chat-storage', `附近的人文件不存在 (404): ${fileName}`);
                this._loadedNearbyCharacters.add(characterName);
            }
        } catch (e) {
            this.ctx.warn('phone-chat-storage', `加载附近的人失败: ${e.message}`);
            this._loadedNearbyCharacters.add(characterName);
        }
    }
    
    async _saveNearbyCharacterToDB(character) {
        await this._ensureDB();
        
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['chat_nearby_characters'], 'readwrite');
            const store = transaction.objectStore('chat_nearby_characters');
            const request = store.put(character);
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }
    
    async getNearbyCharacters(characterName = null) {
        const targetCharacter = characterName || this.currentCharacter;
        if (!targetCharacter) return [];

        await this._ensureDB();
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['chat_nearby_characters'], 'readonly');
            const store = transaction.objectStore('chat_nearby_characters');
            const index = store.index('characterName');
            const request = index.getAll(targetCharacter);

            request.onsuccess = () => {
                const characters = request.result || [];
                resolve(characters);
            };
            request.onerror = () => reject(request.error);
        });
    }
    
    async saveNearbyCharacters(characters) {
        const characterName = this.currentCharacter;
        if (!characterName) {
            throw new Error('未选择角色卡');
        }

        await this._clearNearbyCharactersFromDB(characterName);
        
        for (const char of characters) {
            char.characterName = characterName;
            if (!char.id) {
                char.id = 'nearby_char_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
            }
            await this._saveNearbyCharacterToDB(char);
        }
        
        await this._saveNearbyCharactersToServer(characters);
        return characters;
    }
    
    async _clearNearbyCharactersFromDB(characterName) {
        await this._ensureDB();
        
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['chat_nearby_characters'], 'readwrite');
            const store = transaction.objectStore('chat_nearby_characters');
            const index = store.index('characterName');
            const cursorRequest = index.openCursor(characterName);
            
            cursorRequest.onsuccess = (event) => {
                const cursor = event.target.result;
                if (cursor) {
                    cursor.delete();
                    cursor.continue();
                } else {
                    resolve();
                }
            };
            cursorRequest.onerror = () => reject(cursorRequest.error);
        });
    }
    
    async _saveNearbyCharactersToServer(characters) {
        const fileName = this._getNearbyCharactersFileName(this.currentCharacter);

        try {
            const data = {
                version: 1,
                characterName: this.currentCharacter,
                characters: characters,
                updatedAt: Date.now(),
            };

            const jsonStr = JSON.stringify(data, null, 2);
            const base64Data = btoa(unescape(encodeURIComponent(jsonStr)));

            const headers = getRequestHeaders();
            const response = await fetch('/api/files/upload', {
                method: 'POST',
                headers: headers,
                body: JSON.stringify({
                    name: fileName,
                    data: base64Data,
                }),
            });

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                throw new Error(errorData.error || `保存附近的人失败: ${response.status}`);
            }

            this.ctx.log('phone-chat-storage', '附近的人已保存到服务器');
        } catch (e) {
            this.ctx.error('phone-chat-storage', `保存附近的人到服务器失败: ${e.message}`);
            throw e;
        }
    }

    async getPrivateMoments(contactId) {
        await this._ensureDB();
        
        return new Promise((resolve) => {
            const transaction = this.db.transaction(['chat_private_moments'], 'readonly');
            const store = transaction.objectStore('chat_private_moments');
            const index = store.index('contactId');
            const request = index.getAll(contactId);
            
            request.onsuccess = () => {
                const moments = request.result || [];
                const sortedMoments = this._sortMomentsByTime(moments);
                resolve(sortedMoments);
            };
            request.onerror = () => {
                this.ctx.error('phone-chat-storage', `从IndexedDB加载隐私朋友圈失败: ${request.error}`);
                resolve([]);
            };
        });
    }

    async getAllPrivateMoments() {
        await this._ensureDB();
        
        return new Promise((resolve) => {
            const transaction = this.db.transaction(['chat_private_moments'], 'readonly');
            const store = transaction.objectStore('chat_private_moments');
            const request = store.getAll();
            
            request.onsuccess = () => {
                const moments = request.result || [];
                const sortedMoments = this._sortMomentsByTime(moments);
                resolve(sortedMoments);
            };
            request.onerror = () => {
                this.ctx.error('phone-chat-storage', `从IndexedDB加载所有隐私朋友圈失败: ${request.error}`);
                resolve([]);
            };
        });
    }

    async getPrivateMomentsByCharacter() {
        await this._ensureDB();
        
        const characterName = this.currentCharacter;
        if (!characterName) {
            this.ctx.warn('phone-chat-storage', '未设置当前角色卡，无法加载隐私朋友圈');
            return [];
        }

        return new Promise((resolve) => {
            const transaction = this.db.transaction(['chat_private_moments'], 'readonly');
            const store = transaction.objectStore('chat_private_moments');
            const index = store.index('characterName');
            const request = index.getAll(characterName);
            
            request.onsuccess = () => {
                const moments = request.result || [];
                const sortedMoments = this._sortMomentsByTime(moments);
                this.ctx.log('phone-chat-storage', `已加载角色卡 ${characterName} 的 ${moments.length} 条隐私朋友圈`);
                resolve(sortedMoments);
            };
            request.onerror = () => {
                this.ctx.error('phone-chat-storage', `从IndexedDB加载角色卡隐私朋友圈失败: ${request.error}`);
                resolve([]);
            };
        });
    }

    async savePrivateMoments(contactId, moments) {
        const characterName = this.currentCharacter;
        if (!characterName) {
            throw new Error('未选择角色卡');
        }

        const fileName = this._getPrivateMomentsFileName(characterName);
        
        try {
            const existingMoments = await this.getPrivateMoments(contactId);
            const existingIds = new Set(existingMoments.map(m => m.id));

            for (const moment of moments) {
                if (!moment.id || existingIds.has(moment.id)) {
                    moment.id = this._generateMomentId();
                }
                moment.characterName = characterName;
                moment.contactId = contactId;
                moment.visibility = moment.visibility || 'private';
                moment.visibleTo = moment.visibleTo || [];
                // 添加readStatus字段，默认为false表示未读
                if (moment.readStatus === undefined) {
                    moment.readStatus = false;
                }
                await this._savePrivateMomentToDB(moment);
            }

            if (typeof getRequestHeaders !== 'function') {
                throw new Error('getRequestHeaders 不可用');
            }

            const allPrivateMoments = await this.getAllPrivateMoments();
            const characterPrivateMoments = allPrivateMoments.filter(m => m.characterName === characterName);

            const data = {
                version: 2,
                characterName: characterName,
                moments: characterPrivateMoments,
                updatedAt: Date.now(),
            };

            const jsonStr = JSON.stringify(data, null, 2);
            const base64Data = btoa(unescape(encodeURIComponent(jsonStr)));

            const headers = getRequestHeaders();
            const response = await fetch('/api/files/upload', {
                method: 'POST',
                headers: headers,
                body: JSON.stringify({
                    name: fileName,
                    data: base64Data,
                }),
            });

            if (!response.ok) {
                const errorText = await response.text();
                this.ctx.error('phone-chat-storage', `保存隐私朋友圈失败响应: ${errorText}`);
                const errorData = await response.json().catch(() => ({}));
                throw new Error(errorData.error || `保存隐私朋友圈失败: ${response.status}`);
            }

            this.ctx.log('phone-chat-storage', `已保存 ${moments.length} 条隐私朋友圈`);
        } catch (e) {
            this.ctx.error('phone-chat-storage', `保存隐私朋友圈失败: ${e.message}`);
            throw e;
        }
    }

    async _savePrivateMomentToDB(moment) {
        await this._ensureDB();
        
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['chat_private_moments'], 'readwrite');
            const store = transaction.objectStore('chat_private_moments');
            const request = store.put(moment);
            
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }

    async _savePrivateMomentsToServer() {
        if (!this.currentCharacter) return;

        const fileName = this._getPrivateMomentsFileName(this.currentCharacter);

        try {
            const allPrivateMoments = await this.getAllPrivateMoments();
            const characterPrivateMoments = allPrivateMoments.filter(m => m.characterName === this.currentCharacter);

            const userName = this._getUserName();
            const processedMoments = characterPrivateMoments.map(moment => this._replaceUserNameInMoment(moment, userName));

            const data = {
                version: 2,
                characterName: this.currentCharacter,
                moments: processedMoments,
                updatedAt: Date.now(),
            };

            const jsonStr = JSON.stringify(data, null, 2);
            const base64Data = btoa(unescape(encodeURIComponent(jsonStr)));

            const response = await fetch('/api/files/upload', {
                method: 'POST',
                headers: getRequestHeaders(),
                body: JSON.stringify({
                    name: fileName,
                    data: base64Data,
                }),
            });

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                throw new Error(errorData.error || `上传失败: ${response.status}`);
            }

            this.ctx.log('phone-chat-storage', '隐私朋友圈已保存到服务器');
        } catch (e) {
            this.ctx.error('phone-chat-storage', '保存隐私朋友圈到服务器失败:', e);
        }
    }

    _getPrivateMomentsFileName(characterName) {
        return `tsp-chat-${characterName}-private-moments.json`;
    }

    async togglePrivateLike(momentId, userId) {
        await this._ensureDB();
        
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['chat_private_moments'], 'readwrite');
            const store = transaction.objectStore('chat_private_moments');
            const request = store.get(momentId);
            
            request.onsuccess = async () => {
                const moment = request.result;
                if (moment) {
                    if (!moment.likedBy) {
                        moment.likedBy = [];
                    }
                    
                    const index = moment.likedBy.indexOf(userId);
                    if (index > -1) {
                        moment.likedBy.splice(index, 1);
                        moment.likeCount = Math.max(0, (moment.likeCount || 0) - 1);
                    } else {
                        moment.likedBy.push(userId);
                        moment.likeCount = (moment.likeCount || 0) + 1;
                    }
                    
                    const updateRequest = store.put(moment);
                    updateRequest.onsuccess = async () => {
                        await this._savePrivateMomentsToServer();
                        resolve({
                            liked: index === -1,
                            likeCount: moment.likeCount,
                            likedBy: moment.likedBy
                        });
                    };
                    updateRequest.onerror = () => reject(updateRequest.error);
                } else {
                    reject(new Error('隐私朋友圈不存在'));
                }
            };
            request.onerror = () => reject(request.error);
        });
    }

    async addPrivateComment(momentId, comment) {
        await this._ensureDB();
        
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['chat_private_moments'], 'readwrite');
            const store = transaction.objectStore('chat_private_moments');
            const request = store.get(momentId);
            
            request.onsuccess = async () => {
                const moment = request.result;
                if (moment) {
                    if (!moment.comments) {
                        moment.comments = [];
                    }
                    moment.comments.push(comment);
                    
                    const updateRequest = store.put(moment);
                    updateRequest.onsuccess = async () => {
                        await this._savePrivateMomentsToServer();
                        this.ctx.log('phone-chat-storage', '隐私朋友圈评论已保存');
                        resolve();
                    };
                    updateRequest.onerror = () => reject(updateRequest.error);
                } else {
                    reject(new Error('隐私朋友圈不存在'));
                }
            };
            request.onerror = () => reject(request.error);
        });
    }

    async deletePrivateComment(momentId, commentId) {
        await this._ensureDB();
        
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['chat_private_moments'], 'readwrite');
            const store = transaction.objectStore('chat_private_moments');
            const request = store.get(momentId);
            
            request.onsuccess = async () => {
                const moment = request.result;
                if (moment && moment.comments) {
                    const commentIndex = moment.comments.findIndex(c => c.id === commentId);
                    if (commentIndex > -1) {
                        moment.comments.splice(commentIndex, 1);
                        
                        const updateRequest = store.put(moment);
                        updateRequest.onsuccess = async () => {
                            await this._savePrivateMomentsToServer();
                            this.ctx.log('phone-chat-storage', '隐私朋友圈评论已删除');
                            resolve();
                        };
                        updateRequest.onerror = () => reject(updateRequest.error);
                    } else {
                        reject(new Error('评论不存在'));
                    }
                } else {
                    reject(new Error('隐私朋友圈或评论不存在'));
                }
            };
            request.onerror = () => reject(request.error);
        });
    }

    async deletePrivateMoment(momentId) {
        await this._ensureDB();
        
        return new Promise(async (resolve, reject) => {
            const transaction = this.db.transaction(['chat_private_moments'], 'readwrite');
            const store = transaction.objectStore('chat_private_moments');
            const request = store.delete(momentId);

            request.onsuccess = async () => {
                await this._savePrivateMomentsToServer();
                this.ctx.log('phone-chat-storage', '隐私朋友圈已删除并同步到服务器');
                resolve(true);
            };
            request.onerror = () => reject(request.error);
        });
    }

    _getForumFileName(characterName) {
        const sanitized = this._sanitizeCharacterName(characterName);
        return `tsp-chat-${sanitized}-forum.json`;
    }

    async getForum() {
        await this._ensureDB();

        const characterName = this.currentCharacter;
        if (!characterName) {
            this.ctx.warn('phone-chat-storage', '未设置当前角色卡，无法加载论坛');
            return [];
        }

        return new Promise((resolve) => {
            const transaction = this.db.transaction(['chat_forum'], 'readonly');
            const store = transaction.objectStore('chat_forum');
            const index = store.index('characterName');
            const request = index.getAll(characterName);

            request.onsuccess = () => {
                const posts = request.result || [];
                const sortedPosts = this._sortForumByTime(posts);
                this.ctx.log('phone-chat-storage', `已加载角色卡 ${characterName} 的 ${posts.length} 条论坛帖子`);
                resolve(sortedPosts);
            };
            request.onerror = () => {
                this.ctx.error('phone-chat-storage', `从IndexedDB加载论坛失败: ${request.error}`);
                resolve([]);
            };
        });
    }

    _sortForumByTime(posts) {
        return posts.sort((a, b) => {
            const timeA = this._parseTime(a.time);
            const timeB = this._parseTime(b.time);
            return timeB - timeA;
        });
    }

    async saveForum(posts) {
        const characterName = this.currentCharacter;
        if (!characterName) {
            throw new Error('未选择角色卡');
        }

        await this._ensureDB();

        return new Promise(async (resolve, reject) => {
            const transaction = this.db.transaction(['chat_forum'], 'readwrite');
            const store = transaction.objectStore('chat_forum');
            const index = store.index('characterName');
            const getAllRequest = index.getAll(characterName);

            getAllRequest.onsuccess = async () => {
                const existingPosts = getAllRequest.result || [];
                const existingIds = new Set(existingPosts.map(p => p.id));

                for (const post of posts) {
                    post.characterName = characterName;
                    if (!post.id || existingIds.has(post.id)) {
                        post.id = this._generateForumPostId();
                    }
                    await store.put(post);
                }

                await this._saveForumToServer();
                this.ctx.log('phone-chat-storage', `已追加保存 ${posts.length} 条论坛帖子`);
                resolve(posts);
            };

            getAllRequest.onerror = () => reject(getAllRequest.error);
        });
    }

    async addForumPost(post) {
        await this._ensureDB();

        const characterName = this.currentCharacter;
        if (!characterName) {
            throw new Error('未选择角色卡');
        }

        post.characterName = characterName;
        post.id = post.id || this._generateForumPostId();
        post.readStatus = post.readStatus !== undefined ? post.readStatus : false;

        return new Promise(async (resolve, reject) => {
            const transaction = this.db.transaction(['chat_forum'], 'readwrite');
            const store = transaction.objectStore('chat_forum');
            const request = store.put(post);

            request.onsuccess = async () => {
                await this._saveForumToServer();
                this.ctx.log('phone-chat-storage', '论坛帖子已添加');
                resolve(post);
            };
            request.onerror = () => reject(request.error);
        });
    }

    _generateForumPostId() {
        return 'forum_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
    }

    async addForumComment(postId, comment) {
        await this._ensureDB();

        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['chat_forum'], 'readwrite');
            const store = transaction.objectStore('chat_forum');
            const request = store.get(postId);

            request.onsuccess = async () => {
                const post = request.result;
                if (post) {
                    if (!post.comments) {
                        post.comments = [];
                    }
                    comment.id = comment.id || this._generateCommentId();
                    post.comments.push(comment);
                    post.commentCount = post.comments.length;

                    const updateRequest = store.put(post);
                    updateRequest.onsuccess = async () => {
                        await this._saveForumToServer();
                        this.ctx.log('phone-chat-storage', '论坛评论已保存');
                        resolve();
                    };
                    updateRequest.onerror = () => reject(updateRequest.error);
                } else {
                    reject(new Error('论坛帖子不存在'));
                }
            };
            request.onerror = () => reject(request.error);
        });
    }

    async updateForumPostComments(postId, comments) {
        await this._ensureDB();

        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['chat_forum'], 'readwrite');
            const store = transaction.objectStore('chat_forum');
            const request = store.get(postId);

            request.onsuccess = async () => {
                const post = request.result;
                if (post) {
                    post.comments = comments;
                    post.commentCount = comments.length;

                    const updateRequest = store.put(post);
                    updateRequest.onsuccess = async () => {
                        await this._saveForumToServer();
                        this.ctx.log('phone-chat-storage', '论坛帖子评论已更新');
                        resolve();
                    };
                    updateRequest.onerror = () => reject(updateRequest.error);
                } else {
                    reject(new Error('论坛帖子不存在'));
                }
            };
            request.onerror = () => reject(request.error);
        });
    }

    _generateCommentId() {
        return 'comment_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
    }

    async toggleForumLike(postId, userId) {
        await this._ensureDB();

        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['chat_forum'], 'readwrite');
            const store = transaction.objectStore('chat_forum');
            const request = store.get(postId);

            request.onsuccess = async () => {
                const post = request.result;
                if (post) {
                    if (!post.likedBy) {
                        post.likedBy = [];
                    }

                    const index = post.likedBy.indexOf(userId);
                    if (index > -1) {
                        post.likedBy.splice(index, 1);
                        post.likeCount = Math.max(0, (post.likeCount || 0) - 1);
                    } else {
                        post.likedBy.push(userId);
                        post.likeCount = (post.likeCount || 0) + 1;
                    }

                    const updateRequest = store.put(post);
                    updateRequest.onsuccess = async () => {
                        await this._saveForumToServer();
                        resolve({
                            liked: index === -1,
                            likeCount: post.likeCount,
                            likedBy: post.likedBy
                        });
                    };
                    updateRequest.onerror = () => reject(updateRequest.error);
                } else {
                    reject(new Error('论坛帖子不存在'));
                }
            };
            request.onerror = () => reject(request.error);
        });
    }

    async deleteForumPost(postId) {
        await this._ensureDB();

        return new Promise(async (resolve, reject) => {
            const transaction = this.db.transaction(['chat_forum'], 'readwrite');
            const store = transaction.objectStore('chat_forum');
            const request = store.delete(postId);

            request.onsuccess = async () => {
                await this._saveForumToServer();
                this.ctx.log('phone-chat-storage', '论坛帖子已删除并同步到服务器');
                resolve(true);
            };
            request.onerror = () => reject(request.error);
        });
    }

    async deleteForumComment(postId, commentId) {
        await this._ensureDB();

        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['chat_forum'], 'readwrite');
            const store = transaction.objectStore('chat_forum');
            const request = store.get(postId);

            request.onsuccess = async () => {
                const post = request.result;
                if (post && post.comments) {
                    const commentIndex = post.comments.findIndex(c => c.id === commentId);
                    if (commentIndex > -1) {
                        post.comments.splice(commentIndex, 1);
                        post.commentCount = post.comments.length;

                        const updateRequest = store.put(post);
                        updateRequest.onsuccess = async () => {
                            await this._saveForumToServer();
                            this.ctx.log('phone-chat-storage', '论坛评论已删除');
                            resolve();
                        };
                        updateRequest.onerror = () => reject(updateRequest.error);
                    } else {
                        reject(new Error('评论不存在'));
                    }
                } else {
                    reject(new Error('论坛帖子或评论不存在'));
                }
            };
            request.onerror = () => reject(request.error);
        });
    }

    async _loadForumFromServer(characterName) {
        if (this._loadedForum.has(characterName)) {
            return;
        }

        const fileName = this._getForumFileName(characterName);
        this.ctx.log('phone-chat-storage', `从服务器加载论坛: ${fileName}`);

        try {
            if (typeof getRequestHeaders !== 'function') {
                this.ctx.warn('phone-chat-storage', 'getRequestHeaders 不可用');
                return;
            }

            const headers = getRequestHeaders();
            const response = await fetch(`/user/files/${fileName}`, {
                method: 'GET',
                headers: headers,
            });

            if (response.ok) {
                const text = await response.text();
                const data = JSON.parse(text);

                if (data.posts && Array.isArray(data.posts)) {
                    for (const post of data.posts) {
                        post.characterName = characterName;
                        await this._saveForumPostToDB(post);
                    }
                }

                this._loadedForum.add(characterName);
                this.ctx.log('phone-chat-storage', `已加载 ${data.posts?.length || 0} 条论坛帖子`);
            } else if (response.status === 404) {
                this.ctx.log('phone-chat-storage', `论坛文件不存在 (404): ${fileName}`);
                this._loadedForum.add(characterName);
            }
        } catch (e) {
            this.ctx.warn('phone-chat-storage', `加载论坛失败: ${e.message}`);
            this._loadedForum.add(characterName);
        }
    }

    async _saveForumPostToDB(post) {
        await this._ensureDB();

        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['chat_forum'], 'readwrite');
            const store = transaction.objectStore('chat_forum');
            const request = store.put(post);

            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
        });
    }

    async _saveForumToServer() {
        if (!this.currentCharacter) return;

        const fileName = this._getForumFileName(this.currentCharacter);

        try {
            const allPosts = await this.getForum();
            const characterPosts = allPosts.filter(p => p.characterName === this.currentCharacter);
            const userName = this._getUserName();
            
            const processedPosts = characterPosts.map(post => 
                this._replaceUserNameInForumPost(post, userName)
            );

            const data = {
                version: 1,
                characterName: this.currentCharacter,
                posts: processedPosts,
                updatedAt: Date.now(),
            };

            const jsonStr = JSON.stringify(data, null, 2);
            const base64Data = btoa(unescape(encodeURIComponent(jsonStr)));

            const response = await fetch('/api/files/upload', {
                method: 'POST',
                headers: getRequestHeaders(),
                body: JSON.stringify({
                    name: fileName,
                    data: base64Data,
                }),
            });

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                throw new Error(errorData.error || `上传失败: ${response.status}`);
            }

            this.ctx.log('phone-chat-storage', '论坛已保存到服务器');
        } catch (e) {
            this.ctx.error('phone-chat-storage', '保存论坛到服务器失败:', e);
        }
    }

    _getLivestreamingFileName(characterName) {
        const sanitized = this._sanitizeCharacterName(characterName);
        return `tsp-chat-${sanitized}-livestreaming.json`;
    }

    async getLivestreaming() {
        await this._ensureDB();

        const characterName = this.currentCharacter;
        if (!characterName) {
            this.ctx.warn('phone-chat-storage', '未设置当前角色卡，无法加载直播间');
            return { rooms: [] };
        }

        // 先从本地数据库获取数据
        const localData = await new Promise((resolve) => {
            const transaction = this.db.transaction(['chat_livestreaming'], 'readonly');
            const store = transaction.objectStore('chat_livestreaming');
            const index = store.index('characterName');
            const request = index.getAll(characterName);

            request.onsuccess = () => {
                const data = request.result || [];
                const livestreamingData = data.find(d => d.characterName === characterName);
                resolve(livestreamingData);
            };
            request.onerror = () => resolve(null);
        });

        // 如果本地没有数据，才从服务器加载
        if (!localData) {
            await this._loadLivestreamingFromServer(characterName);
        }

        return new Promise((resolve) => {
            const transaction = this.db.transaction(['chat_livestreaming'], 'readonly');
            const store = transaction.objectStore('chat_livestreaming');
            const index = store.index('characterName');
            const request = index.getAll(characterName);

            request.onsuccess = () => {
                const data = request.result || [];
                const livestreamingData = data.find(d => d.characterName === characterName);
                if (livestreamingData) {
                    this.ctx.log('phone-chat-storage', `已加载角色卡 ${characterName} 的 ${livestreamingData.rooms?.length || 0} 个直播间`);
                    resolve(livestreamingData);
                } else {
                    resolve({ rooms: [] });
                }
            };
            request.onerror = () => {
                this.ctx.error('phone-chat-storage', `从IndexedDB加载直播间失败: ${request.error}`);
                resolve({ rooms: [] });
            };
        });
    }

    async saveLivestreaming(livestreamingData) {
        const characterName = this.currentCharacter;
        if (!characterName) {
            throw new Error('未选择角色卡');
        }

        await this._ensureDB();

        return new Promise(async (resolve, reject) => {
            const transaction = this.db.transaction(['chat_livestreaming'], 'readwrite');
            const store = transaction.objectStore('chat_livestreaming');
            const index = store.index('characterName');
            const getAllRequest = index.getAll(characterName);

            getAllRequest.onsuccess = async () => {
                const existingData = getAllRequest.result || [];
                let dataToSave = {
                    ...livestreamingData,
                    id: existingData[0]?.id || this._generateLivestreamingId(),
                    characterName: characterName,
                    updatedAt: Date.now()
                };

                await store.put(dataToSave);

                await this._saveLivestreamingToServer(dataToSave);
                this.ctx.log('phone-chat-storage', `已保存直播间数据`);
                resolve(dataToSave);
            };

            getAllRequest.onerror = () => reject(getAllRequest.error);
        });
    }

    _generateLivestreamingId() {
        return 'livestreaming_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
    }

    async _loadLivestreamingFromServer(characterName) {
        const fileName = this._getLivestreamingFileName(characterName);
        this.ctx.log('phone-chat-storage', `从服务器加载直播间: ${fileName}`);

        try {
            if (typeof getRequestHeaders !== 'function') {
                this.ctx.warn('phone-chat-storage', 'getRequestHeaders 不可用');
                return;
            }

            const headers = getRequestHeaders();
            const response = await fetch(`/user/files/${fileName}`, {
                method: 'GET',
                headers: headers,
            });

            if (response.ok) {
                const text = await response.text();
                const data = JSON.parse(text);

                if (data.rooms && Array.isArray(data.rooms)) {
                    // 查找现有记录
                    const existingData = await new Promise((resolve) => {
                        const transaction = this.db.transaction(['chat_livestreaming'], 'readonly');
                        const store = transaction.objectStore('chat_livestreaming');
                        const index = store.index('characterName');
                        const request = index.getAll(characterName);
                        request.onsuccess = () => resolve(request.result || []);
                        request.onerror = () => resolve([]);
                    });

                    const dataToSave = {
                        ...data,
                        characterName: characterName,
                        id: existingData[0]?.id || this._generateLivestreamingId(),
                        updatedAt: Date.now()
                    };
                    
                    await this._saveLivestreamingToDB(dataToSave);
                    this.ctx.log('phone-chat-storage', `已从服务器加载并更新 ${data.rooms?.length || 0} 个直播间到本地数据库`);
                }
            } else if (response.status === 404) {
                this.ctx.log('phone-chat-storage', `直播间文件不存在 (404): ${fileName}`);
            }
        } catch (e) {
            this.ctx.warn('phone-chat-storage', `加载直播间失败: ${e.message}`);
        }
    }

    async _saveLivestreamingToDB(data) {
        await this._ensureDB();

        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['chat_livestreaming'], 'readwrite');
            const store = transaction.objectStore('chat_livestreaming');
            const request = store.put(data);

            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
        });
    }

    async _saveLivestreamingToServer(dataToSave) {
        if (!this.currentCharacter) return;

        const fileName = this._getLivestreamingFileName(this.currentCharacter);

        try {
            // 直接使用传入的数据，如果没有则从本地数据库获取
            let livestreamingData;
            if (dataToSave) {
                livestreamingData = dataToSave;
            } else {
                // 从本地数据库获取，而不是从服务器加载
                await this._ensureDB();
                livestreamingData = await new Promise((resolve) => {
                    const transaction = this.db.transaction(['chat_livestreaming'], 'readonly');
                    const store = transaction.objectStore('chat_livestreaming');
                    const index = store.index('characterName');
                    const request = index.getAll(this.currentCharacter);
                    request.onsuccess = () => {
                        const data = request.result || [];
                        const result = data.find(d => d.characterName === this.currentCharacter);
                        resolve(result || { rooms: [] });
                    };
                    request.onerror = () => resolve({ rooms: [] });
                });
            }
            
            const data = {
                version: 1,
                characterName: this.currentCharacter,
                rooms: livestreamingData.rooms || [],
                updatedAt: Date.now(),
            };

            const jsonStr = JSON.stringify(data, null, 2);
            const base64Data = btoa(unescape(encodeURIComponent(jsonStr)));

            const response = await fetch('/api/files/upload', {
                method: 'POST',
                headers: getRequestHeaders(),
                body: JSON.stringify({
                    name: fileName,
                    data: base64Data,
                }),
            });

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                throw new Error(errorData.error || `上传失败: ${response.status}`);
            }

            this.ctx.log('phone-chat-storage', '直播间已保存到服务器');
        } catch (e) {
            this.ctx.error('phone-chat-storage', '保存直播间到服务器失败:', e);
        }
    }

    _getGroupChatFileName(characterName) {
        return `tsp-group-chat-${characterName}-groups.json`;
    }

    _getGroupMessagesFileName(characterName, groupId) {
        return `tsp-group-chat-${characterName}-${groupId}-messages.jsonl`;
    }

    async getGroups() {
        await this._ensureDB();
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['chat_groups'], 'readonly');
            const store = transaction.objectStore('chat_groups');
            const request = store.index('characterName').getAll(this.currentCharacter);

            request.onsuccess = () => resolve(request.result || []);
            request.onerror = () => reject(request.error);
        });
    }

    async createGroup(groupName, members = []) {
        await this._ensureDB();
        const groupId = `group_${Date.now()}`;
        
        const memberConfigs = {};
        members.forEach((memberId, index) => {
            memberConfigs[memberId] = {
                speakProbability: 1.0,
                speakOrder: index + 1
            };
        });

        const group = {
            groupId: groupId,
            name: groupName,
            members: members,
            memberConfigs: memberConfigs,
            speakMode: 'sequential',
            createdAt: Date.now(),
            characterName: this.currentCharacter,
        };

        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['chat_groups', 'chat_group_records'], 'readwrite');
            const groupStore = transaction.objectStore('chat_groups');
            const recordStore = transaction.objectStore('chat_group_records');

            groupStore.put(group);

            const systemMessage = {
                groupId: groupId,
                characterName: this.currentCharacter,
                type: 'system',
                content: `群聊"${groupName}"已创建`,
                timestamp: Date.now(),
            };
            recordStore.put(systemMessage);

            transaction.oncomplete = async () => {
                // 保存群组到服务器文件
                await this._saveGroupsToServer();
                resolve(groupId);
            };
            transaction.onerror = () => reject(transaction.error);
        });
    }

    async updateGroup(groupId, updates) {
        await this._ensureDB();
        const group = await this.getGroup(groupId);
        if (!group) return null;

        const updatedGroup = { ...group, ...updates };
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['chat_groups', 'chat_group_records'], 'readwrite');
            const groupStore = transaction.objectStore('chat_groups');
            const recordStore = transaction.objectStore('chat_group_records');

            groupStore.put(updatedGroup);

            if (updates.name && updates.name !== group.name) {
                const systemMessage = {
                    groupId: groupId,
                    characterName: this.currentCharacter,
                    type: 'system',
                    content: `群名称已更改为"${updates.name}"`,
                    timestamp: Date.now(),
                };
                recordStore.put(systemMessage);
            }

            transaction.oncomplete = async () => {
                // 保存群组到服务器文件
                await this._saveGroupsToServer();
                resolve(updatedGroup);
            };
            transaction.onerror = () => reject(transaction.error);
        });
    }

    async getGroup(groupId) {
        await this._ensureDB();
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['chat_groups'], 'readonly');
            const store = transaction.objectStore('chat_groups');
            const request = store.get(groupId);

            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }

    async deleteGroup(groupId) {
        await this._ensureDB();
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['chat_groups', 'chat_group_records'], 'readwrite');
            const groupStore = transaction.objectStore('chat_groups');
            const recordStore = transaction.objectStore('chat_group_records');

            groupStore.delete(groupId);

            const index = recordStore.index('groupId');
            const request = index.openCursor(IDBKeyRange.only(groupId));
            request.onsuccess = (event) => {
                const cursor = event.target.result;
                if (cursor) {
                    cursor.delete();
                    cursor.continue();
                }
            };

            resolve();
        });
    }

    async addGroupMember(groupId, contactId, contactName) {
        await this._ensureDB();
        const group = await this.getGroup(groupId);
        if (!group) return null;

        if (!group.members.includes(contactId)) {
            group.members.push(contactId);
            // 确保memberConfigs存在并初始化新成员的配置
            if (!group.memberConfigs) {
                group.memberConfigs = {};
            }
            if (!group.memberConfigs[contactId]) {
                group.memberConfigs[contactId] = {
                    speakProbability: 1.0,
                    speakOrder: group.members.length
                };
            }
            return new Promise((resolve, reject) => {
                const transaction = this.db.transaction(['chat_groups', 'chat_group_records'], 'readwrite');
                const groupStore = transaction.objectStore('chat_groups');
                const recordStore = transaction.objectStore('chat_group_records');

                groupStore.put(group);

                const systemMessage = {
                    groupId: groupId,
                    characterName: this.currentCharacter,
                    type: 'system',
                    content: `${contactName} 加入了群聊`,
                    timestamp: Date.now(),
                };
                recordStore.put(systemMessage);

                transaction.oncomplete = async () => {
                    // 保存群组到服务器文件
                    await this._saveGroupsToServer();
                    resolve(group);
                };
                transaction.onerror = () => reject(transaction.error);
            });
        }
        return group;
    }

    async removeGroupMember(groupId, contactId, contactName) {
        await this._ensureDB();
        const group = await this.getGroup(groupId);
        if (!group) return null;

        const index = group.members.indexOf(contactId);
        if (index > -1) {
            group.members.splice(index, 1);
            // 从memberConfigs中移除该成员的配置
            if (group.memberConfigs && group.memberConfigs[contactId]) {
                delete group.memberConfigs[contactId];
            }
            return new Promise((resolve, reject) => {
                const transaction = this.db.transaction(['chat_groups', 'chat_group_records'], 'readwrite');
                const groupStore = transaction.objectStore('chat_groups');
                const recordStore = transaction.objectStore('chat_group_records');

                groupStore.put(group);

                const systemMessage = {
                    groupId: groupId,
                    characterName: this.currentCharacter,
                    type: 'system',
                    content: `${contactName} 被移出了群聊`,
                    timestamp: Date.now(),
                };
                recordStore.put(systemMessage);

                transaction.oncomplete = async () => {
                    // 保存群组到服务器文件
                    await this._saveGroupsToServer();
                    resolve(group);
                };
                transaction.onerror = () => reject(transaction.error);
            });
        }
        return group;
    }

    async getGroupMessages(groupId, characterName = null) {
        const targetCharacter = characterName || this.currentCharacter;
        if (!targetCharacter || !groupId) return [];

        await this._ensureDB();
        return new Promise(async (resolve, reject) => {
            const transaction = this.db.transaction(['chat_group_records'], 'readonly');
            const store = transaction.objectStore('chat_group_records');
            const index = store.index('groupId');
            const request = index.getAll(IDBKeyRange.only(groupId));

            request.onsuccess = async () => {
                let messages = request.result || [];
                messages = messages.filter(msg => msg.characterName === targetCharacter);
                messages.sort((a, b) => a.timestamp - b.timestamp);

                if (messages.length === 0) {
                    await this._loadGroupMessagesFromServer(targetCharacter, groupId);
                    const recheckTransaction = this.db.transaction(['chat_group_records'], 'readonly');
                    const recheckStore = recheckTransaction.objectStore('chat_group_records');
                    const recheckIndex = recheckStore.index('groupId');
                    const recheckRequest = recheckIndex.getAll(IDBKeyRange.only(groupId));
                    
                    recheckRequest.onsuccess = () => {
                        let recheckMessages = recheckRequest.result || [];
                        recheckMessages = recheckMessages.filter(msg => msg.characterName === targetCharacter);
                        recheckMessages.sort((a, b) => a.timestamp - b.timestamp);
                        resolve(recheckMessages);
                    };
                    recheckRequest.onerror = () => reject(recheckRequest.error);
                } else {
                    resolve(messages);
                }
            };
            request.onerror = () => reject(request.error);
        });
    }

    async saveGroupMessage(groupId, message, skipServerSave = false) {
        await this._ensureDB();
        const record = {
            ...message,
            groupId: groupId,
            characterName: this.currentCharacter,
            timestamp: message.timestamp || Date.now(),
        };

        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['chat_group_records'], 'readwrite');
            const store = transaction.objectStore('chat_group_records');
            const request = store.put(record);

            request.onsuccess = async () => {
                if (!skipServerSave) {
                    try {
                        await this._appendGroupMessageToServer(groupId, record);
                    } catch (e) {
                        this.ctx.error('phone-chat-storage', `追加群组消息到服务器失败: ${e.message}`);
                    }
                }
                resolve(record);
            };
            request.onerror = () => reject(request.error);
        });
    }

    async updateGroupMessage(messageId, updates) {
        await this._ensureDB();
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['chat_group_records'], 'readwrite');
            const store = transaction.objectStore('chat_group_records');
            const getRequest = store.get(messageId);

            getRequest.onsuccess = async () => {
                const message = getRequest.result;
                if (message) {
                    Object.assign(message, updates);
                    const putRequest = store.put(message);
                    putRequest.onsuccess = async () => {
                        const allMessages = await this.getGroupMessages(message.groupId, message.characterName);
                        const messagesLines = allMessages.map(msg => JSON.stringify(msg)).join('\n');
                        const base64Data = btoa(unescape(encodeURIComponent(messagesLines + '\n')));

                        const fileName = this._getGroupMessagesFileName(message.characterName, message.groupId);
                        const response = await fetch('/api/files/upload', {
                            method: 'POST',
                            headers: getRequestHeaders(),
                            body: JSON.stringify({
                                name: fileName,
                                data: base64Data,
                            }),
                        });

                        if (response.ok) {
                            this.ctx.log('phone-chat-storage', '群组消息已更新并同步到服务器');
                        } else {
                            this.ctx.warn('phone-chat-storage', '群组消息更新后同步到服务器失败');
                        }
                        resolve(message);
                    };
                    putRequest.onerror = () => reject(putRequest.error);
                } else {
                    reject(new Error('消息不存在'));
                }
            };
            getRequest.onerror = () => reject(getRequest.error);
        });
    }

    async _appendGroupMessageToServer(groupId, message) {
        const fileName = this._getGroupMessagesFileName(this.currentCharacter, groupId);

        try {
            let existingContent = '';

            try {
                const headers = getRequestHeaders();
                const response = await fetch(`/user/files/${fileName}`, {
                    method: 'GET',
                    headers: headers,
                });

                if (response.ok) {
                    existingContent = await response.text();
                }
            } catch (e) {
                this.ctx.log('phone-chat-storage', `读取现有群组消息文件失败: ${e.message}`);
            }

            const jsonLine = JSON.stringify(message);
            const newContent = existingContent + (existingContent && !existingContent.endsWith('\n') ? '\n' : '') + jsonLine + '\n';
            const base64Data = btoa(unescape(encodeURIComponent(newContent)));

            const response = await fetch('/api/files/upload', {
                method: 'POST',
                headers: getRequestHeaders(),
                body: JSON.stringify({
                    name: fileName,
                    data: base64Data,
                }),
            });

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                throw new Error(errorData.error || `追加群组消息失败: ${response.status}`);
            }

            this.ctx.log('phone-chat-storage', '群组消息已追加到服务器');
        } catch (e) {
            this.ctx.error('phone-chat-storage', `追加群组消息到服务器失败: ${e.message}`);
            throw e;
        }
    }

    async _loadGroupMessagesFromServer(characterName, groupId) {
        if (!characterName || !groupId) return;

        const fileName = this._getGroupMessagesFileName(characterName, groupId);
        this.ctx.log('phone-chat-storage', `从服务器加载群组消息: ${fileName}`);

        try {
            if (typeof getRequestHeaders !== 'function') {
                this.ctx.warn('phone-chat-storage', 'getRequestHeaders 不可用');
                return;
            }

            const headers = getRequestHeaders();
            const response = await fetch(`/user/files/${fileName}`, {
                method: 'GET',
                headers: headers,
            });

            if (response.ok) {
                const text = await response.text();
                const lines = text.split('\n').filter(line => line.trim());
                const messages = [];

                for (const line of lines) {
                    try {
                        const msg = JSON.parse(line);
                        if (msg.characterName === characterName && msg.groupId === groupId) {
                            messages.push(msg);
                        }
                    } catch (e) {
                        this.ctx.warn('phone-chat-storage', `解析群组消息行失败: ${e.message}`);
                    }
                }

                for (const message of messages) {
                    await this.saveGroupMessage(groupId, message, true);
                }

                this.ctx.log('phone-chat-storage', `已加载 ${messages.length} 条群组消息`);
            } else if (response.status === 404) {
                this.ctx.log('phone-chat-storage', `群组消息文件不存在 (404): ${fileName}`);
            }
        } catch (e) {
            this.ctx.warn('phone-chat-storage', `加载群组消息失败: ${e.message}`);
        }
    }

    async _loadGroupsFromServer(characterName) {
        const targetCharacter = characterName || this.currentCharacter;
        if (!targetCharacter) return;

        if (this._loadedGroups.has(targetCharacter)) {
            return;
        }

        const fileName = this._getGroupChatFileName(targetCharacter);
        this.ctx.log('phone-chat-storage', `从服务器加载群组: ${fileName}`);

        try {
            if (typeof getRequestHeaders !== 'function') {
                this.ctx.warn('phone-chat-storage', 'getRequestHeaders 不可用');
                this._loadedGroups.add(targetCharacter);
                return;
            }

            const headers = getRequestHeaders();
            const response = await fetch(`/user/files/${fileName}`, {
                method: 'GET',
                headers: headers,
            });

            if (response.ok) {
                const text = await response.text();
                const data = JSON.parse(text);

                if (data.groups && Array.isArray(data.groups)) {
                    for (const group of data.groups) {
                        group.characterName = targetCharacter;
                        await this._saveGroupToDB(group);
                        // 加载每个群组的聊天记录
                        await this._loadGroupMessagesFromServer(targetCharacter, group.groupId);
                    }
                }

                this._loadedGroups.add(targetCharacter);
                this.ctx.log('phone-chat-storage', `已加载 ${data.groups?.length || 0} 个群组`);
            } else if (response.status === 404) {
                this.ctx.log('phone-chat-storage', `群组文件不存在 (404): ${fileName}`);
                this._loadedGroups.add(targetCharacter);
            }
        } catch (e) {
            this.ctx.warn('phone-chat-storage', `加载群组失败: ${e.message}`);
            this._loadedGroups.add(targetCharacter);
        }
    }

    async _saveGroupToDB(group) {
        await this._ensureDB();
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['chat_groups'], 'readwrite');
            const store = transaction.objectStore('chat_groups');
            const request = store.put(group);

            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
        });
    }

    async _saveGroupsToServer() {
        if (!this.currentCharacter) return;

        const fileName = this._getGroupChatFileName(this.currentCharacter);

        try {
            const allGroups = await this.getGroups();
            const characterGroups = allGroups.filter(g => g.characterName === this.currentCharacter);

            const data = {
                version: 1,
                characterName: this.currentCharacter,
                groups: characterGroups,
                updatedAt: Date.now(),
            };

            const jsonStr = JSON.stringify(data, null, 2);
            const base64Data = btoa(unescape(encodeURIComponent(jsonStr)));

            const response = await fetch('/api/files/upload', {
                method: 'POST',
                headers: getRequestHeaders(),
                body: JSON.stringify({
                    name: fileName,
                    data: base64Data,
                }),
            });

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                throw new Error(errorData.error || `上传失败: ${response.status}`);
            }

            this.ctx.log('phone-chat-storage', '群组已保存到服务器');
        } catch (e) {
            this.ctx.error('phone-chat-storage', '保存群组到服务器失败:', e);
        }
    }

    async _saveGroupMessagesToServer(groupId) {
        if (!this.currentCharacter) return;

        const fileName = this._getGroupMessagesFileName(this.currentCharacter, groupId);

        try {
            const allMessages = await this.getGroupMessages(groupId);
            const lines = allMessages.map(m => JSON.stringify(m)).join('\n');
            const base64Data = btoa(unescape(encodeURIComponent(lines)));

            const response = await fetch('/api/files/upload', {
                method: 'POST',
                headers: getRequestHeaders(),
                body: JSON.stringify({
                    name: fileName,
                    data: base64Data,
                }),
            });

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                throw new Error(errorData.error || `上传失败: ${response.status}`);
            }

            this.ctx.log('phone-chat-storage', `群组消息已保存到服务器: ${fileName}`);
        } catch (e) {
            this.ctx.error('phone-chat-storage', `保存群组消息到服务器失败: ${fileName}`, e);
        }
    }

    async switchCharacter(characterName) {
        if (!characterName) {
            this.currentCharacter = null;
            return;
        }

        const sanitized = this._sanitizeCharacterName(characterName);
        if (sanitized === this.currentCharacter) {
            return;
        }

        this.ctx.log('phone-chat-storage', `切换到角色卡: ${sanitized}`);

        const oldCharacter = this.currentCharacter;
        
        if (oldCharacter) {
            await this._saveToServer();
            await this._saveMomentsToServer();
            await this._savePrivateMomentsToServer();
            await this._saveForumToServer();
            await this._saveGroupsToServer();
            await this._saveLivestreamingToServer();

            this._loadedContacts.delete(oldCharacter);
            this._loadedMoments.delete(oldCharacter);
            this._loadedPrivateMoments.delete(oldCharacter);
            this._loadedForum.delete(oldCharacter);
            this._loadedGroups.delete(oldCharacter);
            this._loadedMaps.delete(oldCharacter);
            this._loadedNearbyCharacters.delete(oldCharacter);
            this._loadedLivestreaming.delete(oldCharacter);
        }

        this.currentCharacter = sanitized;

        if (!this._loadedContacts.has(sanitized)) {
            await this._loadContactsFromServer(sanitized);
            this._loadedContacts.add(sanitized);
        }

        if (!this._loadedMoments.has(sanitized)) {
            await this._loadMomentsFromServer(sanitized);
            this._loadedMoments.add(sanitized);
        }

        if (!this._loadedPrivateMoments.has(sanitized)) {
            await this._loadPrivateMomentsFromServer(sanitized);
            this._loadedPrivateMoments.add(sanitized);
        }

        if (!this._loadedForum.has(sanitized)) {
            await this._loadForumFromServer(sanitized);
            this._loadedForum.add(sanitized);
        }

        if (!this._loadedGroups.has(sanitized)) {
            await this._loadGroupsFromServer(sanitized);
            this._loadedGroups.add(sanitized);
        }

        if (!this._loadedMaps.has(sanitized)) {
            await this._loadMapFromServer(sanitized);
            this._loadedMaps.add(sanitized);
        }

        if (!this._loadedNearbyCharacters.has(sanitized)) {
            await this._loadNearbyCharactersFromServer(sanitized);
            this._loadedNearbyCharacters.add(sanitized);
        }

        if (!this._loadedNewFriends.has(sanitized)) {
            await this._loadNewFriendsFromServer(sanitized);
            this._loadedNewFriends.add(sanitized);
        }

        if (!this._loadedLivestreaming.has(sanitized)) {
            await this._loadLivestreamingFromServer(sanitized);
            this._loadedLivestreaming.add(sanitized);
        }
    }

    _getNewFriendsFileName(characterName) {
        const sanitized = this._sanitizeCharacterName(characterName);
        return `tsp-chat-${sanitized}-new-friend.json`;
    }

    async _loadNewFriendsFromServer(characterName) {
        if (this._loadedNewFriends.has(characterName)) {
            return;
        }

        const fileName = this._getNewFriendsFileName(characterName);
        this.ctx.log('phone-chat-storage', `从服务器加载新朋友: ${fileName}`);

        try {
            if (typeof getRequestHeaders !== 'function') {
                this.ctx.warn('phone-chat-storage', 'getRequestHeaders 不可用');
                return;
            }

            const headers = getRequestHeaders();
            const response = await fetch(`/user/files/${fileName}`, {
                method: 'GET',
                headers: headers,
            });

            if (response.ok) {
                const text = await response.text();
                const data = JSON.parse(text);

                if (data.newFriends && Array.isArray(data.newFriends)) {
                    for (const friend of data.newFriends) {
                        friend.characterName = characterName;
                        await this._saveNewFriendToDB(friend);
                    }
                }

                this._loadedNewFriends.add(characterName);
                this.ctx.log('phone-chat-storage', `已加载 ${data.newFriends?.length || 0} 个新朋友`);
            } else if (response.status === 404) {
                this.ctx.log('phone-chat-storage', `新朋友文件不存在 (404): ${fileName}`);
                this._loadedNewFriends.add(characterName);
            }
        } catch (e) {
            this.ctx.warn('phone-chat-storage', `加载新朋友失败: ${e.message}`);
            this._loadedNewFriends.add(characterName);
        }
    }

    async _saveNewFriendToDB(newFriend) {
        await this._ensureDB();
        
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['chat_new_friends'], 'readwrite');
            const store = transaction.objectStore('chat_new_friends');
            const request = store.put(newFriend);
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }

    async getNewFriends(characterName = null) {
        const targetCharacter = characterName || this.currentCharacter;
        if (!targetCharacter) return [];

        await this._ensureDB();
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['chat_new_friends'], 'readonly');
            const store = transaction.objectStore('chat_new_friends');
            const index = store.index('characterName');
            const request = index.getAll(targetCharacter);

            request.onsuccess = () => {
                const newFriends = request.result || [];
                resolve(newFriends);
            };
            request.onerror = () => reject(request.error);
        });
    }

    async saveNewFriends(newFriends) {
        const characterName = this.currentCharacter;
        if (!characterName) {
            throw new Error('未选择角色卡');
        }

        await this._clearNewFriendsFromDB(characterName);
        
        for (const friend of newFriends) {
            friend.characterName = characterName;
            if (!friend.id) {
                friend.id = 'new_friend_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
            }
            await this._saveNewFriendToDB(friend);
        }
        
        await this._saveNewFriendsToServer(newFriends);
        return newFriends;
    }

    async appendNewFriends(newFriends) {
        const characterName = this.currentCharacter;
        if (!characterName) {
            throw new Error('未选择角色卡');
        }

        for (const friend of newFriends) {
            friend.characterName = characterName;
            if (!friend.id) {
                friend.id = 'new_friend_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
            }
            await this._saveNewFriendToDB(friend);
        }
        
        const allNewFriends = await this.getNewFriends(characterName);
        await this._saveNewFriendsToServer(allNewFriends);
        return allNewFriends;
    }

    async _clearNewFriendsFromDB(characterName) {
        await this._ensureDB();
        
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['chat_new_friends'], 'readwrite');
            const store = transaction.objectStore('chat_new_friends');
            const index = store.index('characterName');
            const cursorRequest = index.openCursor(characterName);
            
            cursorRequest.onsuccess = (event) => {
                const cursor = event.target.result;
                if (cursor) {
                    cursor.delete();
                    cursor.continue();
                } else {
                    resolve();
                }
            };
            cursorRequest.onerror = () => reject(cursorRequest.error);
        });
    }

    async _saveNewFriendsToServer(newFriends) {
        const fileName = this._getNewFriendsFileName(this.currentCharacter);

        try {
            const data = {
                version: 1,
                characterName: this.currentCharacter,
                newFriends: newFriends,
                updatedAt: Date.now(),
            };

            const jsonStr = JSON.stringify(data, null, 2);
            const base64Data = btoa(unescape(encodeURIComponent(jsonStr)));

            const headers = getRequestHeaders();
            const response = await fetch('/api/files/upload', {
                method: 'POST',
                headers: headers,
                body: JSON.stringify({
                    name: fileName,
                    data: base64Data,
                }),
            });

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                throw new Error(errorData.error || `保存新朋友失败: ${response.status}`);
            }

            this.ctx.log('phone-chat-storage', '新朋友已保存到服务器');
        } catch (e) {
            this.ctx.error('phone-chat-storage', `保存新朋友到服务器失败: ${e.message}`);
            throw e;
        }
    }

    async deleteNewFriend(friendId) {
        const characterName = this.currentCharacter;
        if (!characterName) {
            throw new Error('未选择角色卡');
        }

        await this._ensureDB();
        
        return new Promise(async (resolve, reject) => {
            const transaction = this.db.transaction(['chat_new_friends'], 'readwrite');
            const store = transaction.objectStore('chat_new_friends');
            const request = store.delete(friendId);

            request.onsuccess = async () => {
                const allNewFriends = await this.getNewFriends(characterName);
                await this._saveNewFriendsToServer(allNewFriends);
                resolve(true);
            };
            request.onerror = () => reject(request.error);
        });
    }

    async acceptNewFriend(friend) {
        const characterName = this.currentCharacter;
        if (!characterName) {
            throw new Error('未选择角色卡');
        }

        const contact = {
            contactId: this._generateContactId(),
            name: friend.name,
            conversationStyle: friend.dialogStyle,
            writingStyle: friend.writingStyle,
            clique: friend.momentsHabit || '',
            privateStyle: friend.clique || friend.momentsHabit,
            deposit: friend.deposit || '',
            transaction: friend.transaction || '',
            avatarUrl: friend.avatarUrl || '',
            characterName: characterName,
            streamNickname: friend.streamNickname || '',
            streamCategory: friend.streamCategory || '',
            privateStreamStyle: friend.privateStreamStyle || '',
            createdAt: Date.now(),
        };

        await this._saveContactToDB(contact);
        await this._saveToServer();
        await this.deleteNewFriend(friend.id);

        return contact;
    }

    // 存储论坛分类
    async saveForumCategories(categories, extraRules, autoPostEnabled, autoPostProbability) {
        try {
            // 先读取现有文件内容
            let existingData = {};
            try {
                const headers = getRequestHeaders();
                const response = await fetch('/user/files/tsp-plugin-phone.json', {
                    method: 'GET',
                    headers: headers,
                });
                if (response.ok) {
                    const text = await response.text();
                    existingData = JSON.parse(text);
                }
            } catch (readError) {
                this.ctx.log('phone-chat-storage', `读取现有文件失败，将创建新文件: ${readError.message}`);
            }

            // 更新论坛分类和额外规则
            existingData.forumCategories = categories;
            if (extraRules !== undefined) {
                existingData.extraRules = extraRules;
            }
            // 更新自动发布设置
            if (autoPostEnabled !== undefined) {
                existingData.autoPostEnabled = autoPostEnabled;
            }
            if (autoPostProbability !== undefined) {
                existingData.autoPostProbability = autoPostProbability;
            }
            existingData.updatedAt = Date.now();

            // 保存更新后的数据
            const jsonStr = JSON.stringify(existingData, null, 2);
            const base64Data = btoa(unescape(encodeURIComponent(jsonStr)));

            const headers = getRequestHeaders();
            const response = await fetch('/api/files/upload', {
                method: 'POST',
                headers: headers,
                body: JSON.stringify({
                    name: 'tsp-plugin-phone.json',
                    data: base64Data,
                }),
            });

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                throw new Error(errorData.error || `保存论坛分类失败: ${response.status}`);
            }

            this.ctx.log('phone-chat-storage', '论坛分类已保存到服务器');
            return true;
        } catch (e) {
            this.ctx.error('phone-chat-storage', `保存论坛分类到服务器失败: ${e.message}`);
            throw e;
        }
    }

    // 加载论坛分类和额外规则
    async getForumCategories() {
        try {
            if (typeof getRequestHeaders !== 'function') {
                this.ctx.warn('phone-chat-storage', 'getRequestHeaders 不可用');
                return { categories: [], extraRules: '', autoPostEnabled: false, autoPostProbability: 0.3 };
            }

            const headers = getRequestHeaders();
            const response = await fetch(`/user/files/tsp-plugin-phone.json`, {
                method: 'GET',
                headers: headers,
            });

            if (response.ok) {
                const text = await response.text();
                const data = JSON.parse(text);
                const categories = data.forumCategories && Array.isArray(data.forumCategories) ? data.forumCategories : [];
                const extraRules = data.extraRules || '';
                const autoPostEnabled = data.autoPostEnabled || false;
                const autoPostProbability = data.autoPostProbability || 0.3;
                return { categories, extraRules, autoPostEnabled, autoPostProbability };
            } else if (response.status === 404) {
                this.ctx.log('phone-chat-storage', `论坛分类文件不存在 (404): tsp-plugin-phone.json`);
            }
        } catch (e) {
            this.ctx.warn('phone-chat-storage', `加载论坛分类失败: ${e.message}`);
        }
        return { categories: [], extraRules: '', autoPostEnabled: false, autoPostProbability: 0.3 };
    }
}
