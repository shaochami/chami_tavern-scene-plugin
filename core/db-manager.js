'use strict';



export class DBManager {
    constructor() {
        this.DB_NAME = 'tavern_scene_plugin';
        this.DB_VERSION = 2;
        this.db = null;


        this.stores = {

            'custom_tags': { keyPath: 'id' },


            'characters': { keyPath: 'id', autoIncrement: true },
            'classifications': { keyPath: 'name' },


            'presets': { keyPath: 'name' },


            'lora_presets': { keyPath: 'name' },


            'workflows': { keyPath: 'name' },


            'image_cache': { keyPath: 'id' },


            'i2i_cache': { keyPath: 'id' },


            'ai_presets': { keyPath: 'name' },


            'world_books': { keyPath: 'name' },


            'tag_references': { keyPath: 'id', autoIncrement: true },


            'regex_rules': { keyPath: 'id' },


            'danbooru_tags': { keyPath: 'fileName' },


            'settings_backup': { keyPath: 'key' },
        };
    }


    async init() {
        if (this.db) return this.db;

        return new Promise((resolve, reject) => {
            const request = indexedDB.open(this.DB_NAME, this.DB_VERSION);

            request.onerror = () => {
                reject(request.error);
            };

            request.onsuccess = () => {
                this.db = request.result;
                resolve(this.db);
            };

            request.onupgradeneeded = (event) => {
                const db = /** @type {IDBOpenDBRequest} */ (event.target).result;

                for (const [name, config] of Object.entries(this.stores)) {
                    if (!db.objectStoreNames.contains(name)) {
                        const store = db.createObjectStore(name, config);

                        if (name === 'characters') {
                            store.createIndex('classification', 'data.classification', { unique: false });
                            store.createIndex('nameTrigger', 'data.nameTrigger', { unique: false });
                            // [修改] 旧的 enabled 索引不再需要，新的 status 索引更灵活
                            // store.createIndex('enabled', 'data.enabled', { unique: false });
                            store.createIndex('status', 'data.status', { unique: false }); //  为角色状态(启用/禁用)创建索引
                        }

                        if (name === 'ai_presets') {
                            store.createIndex('isActive', 'isActive', { unique: false });
                        }

                        if (name === 'world_books') {
                            store.createIndex('enabled', 'enabled', { unique: false });
                        }

                        if (name === 'regex_rules') {
                            store.createIndex('enabled', 'enabled', { unique: false });
                            store.createIndex('order', 'order', { unique: false });
                        }

                        if (name === 'image_cache') {
                            store.createIndex('timestamp', 'timestamp', { unique: false });
                        }

                        if (name === 'tag_references') {
                            store.createIndex('folderName', 'folderName', { unique: false });
                        }
                    }
                }
            };
        });
    }

    async _ensureDB() {
        if (!this.db) {
            await this.init();
        }
        return this.db;
    }

    /**
     * 获取所有记录
     * @param {string} storeName 存储表名
     * @returns {Promise<Array>}
     */
    async getAll(storeName) {
        const db = await this._ensureDB();
        return new Promise((resolve, reject) => {
            const transaction = db.transaction([storeName], 'readonly');
            const store = transaction.objectStore(storeName);
            const request = store.getAll();

            request.onsuccess = () => resolve(request.result || []);
            request.onerror = () => reject(request.error);
        });
    }

    /**
     * 根据键获取记录
     * @param {string} storeName 存储表名
     * @param {*} key 键值
     * @returns {Promise<*>}
     */
    async get(storeName, key) {
        const db = await this._ensureDB();
        return new Promise((resolve, reject) => {
            const transaction = db.transaction([storeName], 'readonly');
            const store = transaction.objectStore(storeName);
            const request = store.get(key);

            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }

    /**
     * 添加或更新记录
     * @param {string} storeName 存储表名
     * @param {*} data 数据
     * @returns {Promise<*>} 返回键值
     */
    async put(storeName, data) {
        const db = await this._ensureDB();
        return new Promise((resolve, reject) => {
            const transaction = db.transaction([storeName], 'readwrite');
            const store = transaction.objectStore(storeName);
            const request = store.put(data);

            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }

    /**
     * 添加记录 (不覆盖)
     * @param {string} storeName 存储表名
     * @param {*} data 数据
     * @returns {Promise<*>} 返回键值
     */
    async add(storeName, data) {
        const db = await this._ensureDB();
        return new Promise((resolve, reject) => {
            const transaction = db.transaction([storeName], 'readwrite');
            const store = transaction.objectStore(storeName);
            const request = store.add(data);

            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }

    /**
     * 删除记录
     * @param {string} storeName 存储表名
     * @param {*} key 键值
     * @returns {Promise<void>}
     */
    async delete(storeName, key) {
        const db = await this._ensureDB();
        return new Promise((resolve, reject) => {
            const transaction = db.transaction([storeName], 'readwrite');
            const store = transaction.objectStore(storeName);
            const request = store.delete(key);

            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
        });
    }
    async getAllLight(storeName, excludeFields = []) {
        const db = await this._ensureDB();
        return new Promise((resolve, reject) => {
            const transaction = db.transaction([storeName], 'readonly');
            const store = transaction.objectStore(storeName);
            const request = store.openCursor();
            const results = [];

            request.onsuccess = (event) => {
                const cursor = event.target.result;
                if (cursor) {
                    const record = { ...cursor.value };
                    // 剔除大字段
                    excludeFields.forEach(field => {
                        delete record[field];
                    });
                    results.push(record);
                    cursor.continue();
                } else {
                    resolve(results);
                }
            };

            request.onerror = () => reject(request.error);
        });
    }

    /**
     * 获取图片缓存的轻量级数据（仅 id 和 locationHash）
     * 用于角色卡切换时只加载 id+哈希映射，减少内存占用
     * @returns {Promise<Array<{id: number, locationHash: string}>>}
     */
    async getImageCacheLight() {
        const db = await this._ensureDB();
        return new Promise((resolve, reject) => {
            const transaction = db.transaction(['image_cache'], 'readonly');
            const store = transaction.objectStore('image_cache');
            const request = store.openCursor();
            const results = [];

            request.onsuccess = (event) => {
                const cursor = event.target.result;
                if (cursor) {
                    // 只保留 id 和 locationHash，剔除 imageData 等大字段
                    results.push({
                        id: cursor.value.id,
                        locationHash: cursor.value.locationHash
                    });
                    cursor.continue();
                } else {
                    resolve(results);
                }
            };

            request.onerror = () => reject(request.error);
        });
    }

    /**
     * 根据图片 ID 获取完整图片数据（包含 imageData）
     * 用于按需加载图片数据
     * @param {number} id - 图片 ID
     * @returns {Promise<Object|null>}
     */
    async getImageDataById(id) {
        const db = await this._ensureDB();
        return new Promise((resolve, reject) => {
            const transaction = db.transaction(['image_cache'], 'readonly');
            const store = transaction.objectStore('image_cache');
            const request = store.get(id);

            request.onsuccess = () => resolve(request.result || null);
            request.onerror = () => reject(request.error);
        });
    }

    /**
     * 批量获取图片完整数据（包含 imageData）
     * 用于按需加载多张图片数据
     * @param {Array<number>} ids - 图片 ID 数组
     * @returns {Promise<Array<Object>>}
     */
    async getImageDataBatch(ids) {
        const db = await this._ensureDB();
        return new Promise((resolve, reject) => {
            const transaction = db.transaction(['image_cache'], 'readonly');
            const store = transaction.objectStore('image_cache');
            const results = [];
            let completed = 0;
            const total = ids.length;

            if (total === 0) {
                resolve([]);
                return;
            }

            ids.forEach(id => {
                const request = store.get(id);
                request.onsuccess = () => {
                    if (request.result) {
                        results.push(request.result);
                    }
                    completed++;
                    if (completed === total) {
                        resolve(results);
                    }
                };
                request.onerror = (err) => {
                    completed++;
                    if (completed === total) {
                        reject(err);
                    }
                };
            });
        });
    }
    /**
     * 清空存储表
     * @param {string} storeName 存储表名
     * @returns {Promise<void>}
     */
    async clear(storeName) {
        const db = await this._ensureDB();
        return new Promise((resolve, reject) => {
            const transaction = db.transaction([storeName], 'readwrite');
            const store = transaction.objectStore(storeName);
            const request = store.clear();

            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
        });
    }

    /**
     * 批量写入数据（使用单个事务，显著提升大量数据写入性能）
     * @param {string} storeName 存储表名
     * @param {Array} dataArray 要写入的数据数组
     * @returns {Promise<void>}
     */
    async putBatch(storeName, dataArray) {
        if (!Array.isArray(dataArray) || dataArray.length === 0) {
            return;
        }

        const db = await this._ensureDB();
        return new Promise((resolve, reject) => {
            const transaction = db.transaction([storeName], 'readwrite');
            const store = transaction.objectStore(storeName);

            // 批量写入
            for (const data of dataArray) {
                store.put(data);
            }

            transaction.oncomplete = () => resolve();
            transaction.onerror = () => reject(transaction.error);
        });
    }

    /**
     * 根据索引查询
     * @param {string} storeName 存储表名
     * @param {string} indexName 索引名
     * @param {*} value 查询值
     * @returns {Promise<Array>}
     */
    async getByIndex(storeName, indexName, value) {
        const db = await this._ensureDB();
        return new Promise((resolve, reject) => {
            const transaction = db.transaction([storeName], 'readonly');
            const store = transaction.objectStore(storeName);
            const index = store.index(indexName);
            const request = index.getAll(value);

            request.onsuccess = () => resolve(request.result || []);
            request.onerror = () => reject(request.error);
        });
    }

    /**
     * 使用游标遍历并更新
     * @param {string} storeName 存储表名
     * @param {Function} updateFn 更新函数 (record) => updatedRecord | null
     * @returns {Promise<number>} 更新的记录数
     */
    async updateWithCursor(storeName, updateFn) {
        const db = await this._ensureDB();
        return new Promise((resolve, reject) => {
            const transaction = db.transaction([storeName], 'readwrite');
            const store = transaction.objectStore(storeName);
            const request = store.openCursor();
            let count = 0;

            request.onsuccess = (event) => {
                const cursor = /** @type {IDBRequest<IDBCursorWithValue | null>} */ (event.target).result;
                if (cursor) {
                    const updated = updateFn(cursor.value);
                    if (updated !== null && updated !== undefined) {
                        cursor.update(updated);
                        count++;
                    }
                    cursor.continue();
                } else {
                    resolve(count);
                }
            };

            request.onerror = () => reject(request.error);
        });
    }

    /**
     * 批量操作
     * @param {string} storeName 存储表名
     * @param {Array} operations [{type: 'put'|'delete', data: any}]
     * @returns {Promise<void>}
     */
    async batch(storeName, operations) {
        const db = await this._ensureDB();
        return new Promise((resolve, reject) => {
            const transaction = db.transaction([storeName], 'readwrite');
            const store = transaction.objectStore(storeName);

            transaction.oncomplete = () => resolve();
            transaction.onerror = () => reject(transaction.error);

            for (const op of operations) {
                if (op.type === 'put') {
                    store.put(op.data);
                } else if (op.type === 'delete') {
                    store.delete(op.key);
                } else if (op.type === 'add') {
                    store.add(op.data);
                }
            }
        });
    }

    /**
     * 获取记录数量
     * @param {string} storeName 存储表名
     * @returns {Promise<number>}
     */
    async count(storeName) {
        const db = await this._ensureDB();
        return new Promise((resolve, reject) => {
            const transaction = db.transaction([storeName], 'readonly');
            const store = transaction.objectStore(storeName);
            const request = store.count();

            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }

    /**
     * 导出所有数据 (修改适配 Blob 导出)
     * @returns {Promise<Object>}
     */
    async exportAll() {
        const data = {
            version: this.DB_VERSION,
            exportDate: new Date().toISOString(),
            stores: {},
        };

        // --- 新增辅助函数：检测并转换 Blob ---
        const convertBlobsToBase64 = async (obj) => {
            if (!obj || typeof obj !== 'object') return obj;

            // 如果是 Blob，转 Base64
            if (obj instanceof Blob) {
                return await new Promise((resolve) => {
                    const reader = new FileReader();
                    reader.onloadend = () => resolve(reader.result);
                    reader.readAsDataURL(obj);
                });
            }

            // 如果是数组，遍历处理
            if (Array.isArray(obj)) {
                return Promise.all(obj.map(item => convertBlobsToBase64(item)));
            }

            // 如果是对象，递归处理字段
            const newObj = {};
            for (const key in obj) {
                newObj[key] = await convertBlobsToBase64(obj[key]);
            }
            return newObj;
        };
        // -------------------------------------

        for (const storeName of Object.keys(this.stores)) {
            try {
                const rawRecords = await this.getAll(storeName);
                // 在导出前将 Blob 转换为 Base64 字符串，否则 JSON.stringify 会丢失数据
                data.stores[storeName] = await convertBlobsToBase64(rawRecords);
            } catch (e) {
                console.error(`导出 Store ${storeName} 失败`, e);
                data.stores[storeName] = [];
            }
        }

        return data;
    }

    /**
     * 导入数据
     * @param {Object} data 导出的数据
     * @param {boolean} clearFirst 是否先清空
     * @returns {Promise<Object>} 导入统计
     */
    async importAll(data, clearFirst = false) {
        const stats = { imported: 0, skipped: 0, errors: 0 };

        if (!data || !data.stores) {
            throw new Error('Invalid import data format');
        }

        for (const [storeName, records] of Object.entries(data.stores)) {
            if (!this.stores[storeName]) {
                continue;
            }

            try {
                if (clearFirst) {
                    await this.clear(storeName);
                }

                for (const record of records) {
                    try {
                        await this.put(storeName, record);
                        stats.imported++;
                    } catch (e) {
                        stats.errors++;
                    }
                }
            } catch (e) {
                stats.errors++;
            }
        }

        return stats;
    }

    /**
     * 关闭数据库连接
     */
    close() {
        if (this.db) {
            this.db.close();
            this.db = null;
        }
    }

    /**
     * 删除整个数据库
     * @returns {Promise<void>}
     */
    async deleteDatabase() {
        this.close();
        return new Promise((resolve, reject) => {
            const request = indexedDB.deleteDatabase(this.DB_NAME);
            request.onsuccess = () => {
                resolve();
            };
            request.onerror = () => reject(request.error);
        });
    }
}

export const StoreNames = {
    CUSTOM_TAGS: 'custom_tags',
    DANBOORU_TAGS: 'danbooru_tags',

    CHARACTERS: 'characters',
    CLASSIFICATIONS: 'classifications',

    PRESETS: 'presets',
    LORA_PRESETS: 'lora_presets',
    WORKFLOWS: 'workflows',

    IMAGE_CACHE: 'image_cache',
    I2I_CACHE: 'i2i_cache',

    AI_PRESETS: 'ai_presets',
    WORLD_BOOKS: 'world_books',
    TAG_REFERENCES: 'tag_references',
    REGEX_RULES: 'regex_rules',

    SETTINGS_BACKUP: 'settings_backup',
};

