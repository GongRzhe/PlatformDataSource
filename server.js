import express from 'express';
import { createClient } from 'redis';
import axios from 'axios';
import bodyParser from 'body-parser';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
app.use(bodyParser.json());
app.use(express.static('public'));

// Redis 客户端设置（使用懒加载方式）
let redisClient = null;
const getRedisClient = async () => {
    if (!redisClient) {
        redisClient = createClient({
            url: 'redis://10.1.210.223:6379'
        });
        redisClient.on('error', err => console.log('Redis 客户端错误', err));
        try {
            await redisClient.connect();
        } catch (err) {
            console.log('Redis 连接失败:', err);
            redisClient = null;
            throw new Error('Redis 服务不可用');
        }
    }
    return redisClient;
};

/**
 * 根据路径获取对象中的值，支持通配符表达式
 * 示例：
 * - 数据: { users: [{ name: "张三" }, { name: "李四" }] }
 * - 路径: "users.*.name"
 * - 结果: ["张三", "李四"]
 * 
 * @param {Object} obj - 要查询的数据对象
 * @param {string} path - 查询路径，支持通配符，如: "users.*.name" 或 "data.0.value"
 * @returns {*} - 返回查询到的值
 */
function getValueByPath(obj, path) {
    // 处理包含通配符(*)的路径
    if (path.includes('*')) {
        // 将路径按点号分割成数组
        const parts = path.split('.');
        // 找到通配符的位置
        const wildcardIndex = parts.findIndex(p => p === '*');
        
        // 处理通配符在开头的情况
        if (wildcardIndex === 0) {
            // 例如: "*.name" 处理数组中每个元素
            if (Array.isArray(obj)) {
                const remainingPath = parts.slice(1).join('.');
                return obj.map(item => getValueByPath(item, remainingPath));
            }
            return [];
        } else {
            // 处理嵌套通配符的情况
            let current = obj;
            // 遍历到通配符前的路径
            for (let i = 0; i < wildcardIndex; i++) {
                if (current === null || current === undefined) return undefined;
                current = current[parts[i]];
            }
            
            // 如果找到的是数组，继续处理剩余路径
            if (Array.isArray(current)) {
                const remainingPath = parts.slice(wildcardIndex + 1).join('.');
                return current.map(item => getValueByPath(item, remainingPath));
            }
            return [];
        }
    }

    // 处理普通路径（不含通配符）
    const parts = path.split('.');
    let current = obj;
    
    // 逐级查找属性
    for (const part of parts) {
        if (current === null || current === undefined) {
            return undefined;
        }
        
        // 处理数组索引，例如: "users.0.name"
        if (!isNaN(part) && Array.isArray(current)) {
            current = current[parseInt(part)];
        } else {
            current = current[part];
        }
    }
    
    return current;
}

/**
 * 根据映射规则转换数据并应用过滤条件
 * 这个函数可以：
 * 1. 从数据中提取指定字段
 * 2. 重命名字段
 * 3. 过滤数据
 * 4. 排序结果
 * 5. 分页处理
 * 
 * @param {Object|Array} data - 源数据
 * @param {Object} mapping - 映射规则配置
 * @param {Object} filter - 过滤条件配置
 * @returns {Array} - 返回处理后的数据数组
 */
function applyMapping(data, mapping, filter = {}) {
    let result = [];
    
    // 处理数组类型的数据
    if (Array.isArray(data)) {
        // 遍历数组中的每个元素
        data.forEach((item, index) => {
            const row = {};
            // 应用每个映射字段
            mapping.fields.forEach(field => {
                if (field.path === '*') {
                    // 如果路径是 *，则复制整个对象
                    Object.assign(row, item);
                } else {
                    // 否则按照指定路径获取值
                    const value = getValueByPath(data, field.path);
                    if (Array.isArray(value)) {
                        // 处理通配符结果
                        value.forEach((v, i) => {
                            if (v !== undefined) {
                                row[field.alias || `${field.path.replace('*', i)}`] = v;
                            }
                        });
                    } else {
                        // 处理单个值
                        const singleValue = getValueByPath(item, field.path.replace(/^\d+\./, ''));
                        if (singleValue !== undefined) {
                            row[field.alias || field.path] = singleValue;
                        }
                    }
                }
            });
            if (Object.keys(row).length > 0) {
                result.push(row);
            }
        });
    } else {
        // 处理单个对象的数据
        const row = {};
        mapping.fields.forEach(field => {
            if (field.path === '*') {
                // 复制整个对象
                Object.assign(row, data);
            } else {
                // 获取指定路径的值
                const value = getValueByPath(data, field.path);
                if (value !== undefined) {
                    row[field.alias || field.path] = value;
                }
            }
        });
        if (Object.keys(row).length > 0) {
            result.push(row);
        }
    }

    // 应用过滤条件
    if (filter.conditions) {
        result = result.filter(row => {
            return filter.conditions.every(condition => {
                const value = row[condition.field];
                // 支持多种过滤操作
                switch (condition.operator) {
                    case 'eq': return value === condition.value; // 等于
                    case 'neq': return value !== condition.value; // 不等于
                    case 'gt': return value > condition.value; // 大于
                    case 'gte': return value >= condition.value; // 大于等于
                    case 'lt': return value < condition.value; // 小于
                    case 'lte': return value <= condition.value; // 小于等于
                    case 'contains': return String(value).includes(condition.value); // 包含
                    case 'startsWith': return String(value).startsWith(condition.value); // 以...开始
                    case 'endsWith': return String(value).endsWith(condition.value); // 以...结束
                    default: return true;
                }
            });
        });
    }

    // 应用排序
    if (filter.sort && filter.sort.field) {
        result.sort((a, b) => {
            const aVal = a[filter.sort.field];
            const bVal = b[filter.sort.field];
            
            // 数字类型的排序
            if (typeof aVal === 'number' && typeof bVal === 'number') {
                return filter.sort.order === 'desc' ? bVal - aVal : aVal - bVal;
            }
            
            // 字符串类型的排序
            const aStr = String(aVal || '');
            const bStr = String(bVal || '');
            return filter.sort.order === 'desc' ? 
                bStr.localeCompare(aStr) : 
                aStr.localeCompare(bStr);
        });
    }

    // 应用分页
    if (filter.startIndex !== undefined || filter.limit !== undefined) {
        const start = filter.startIndex || 0;
        const end = filter.limit ? start + filter.limit : undefined;
        result = result.slice(start, end);
    }

    return result;
}

/**
 * 从指定 URL 获取数据的 API 接口
 * POST /api/fetch-url
 * 请求体格式: { url: "http://example.com/data" }
 * 返回格式: { success: true, data: 获取到的数据 }
 */
app.post('/api/fetch-url', async (req, res) => {
    try {
        const { url } = req.body;
        // 使用 axios 发送 GET 请求获取数据
        const response = await axios.get(url);
        res.json({ success: true, data: response.data });
    } catch (error) {
        // 如果发生错误，返回错误信息
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * 从 Redis 数据库获取数据的 API 接口
 * POST /api/fetch-redis
 * 请求体格式: { key: "redis键名" }
 * 返回格式: { success: true, data: 获取到的数据 }
 */
app.post('/api/fetch-redis', async (req, res) => {
    try {
        const { key } = req.body;
        // 获取 Redis 客户端连接
        const client = await getRedisClient();
        // 从 Redis 获取数据
        const value = await client.get(key);
        
        // 如果键不存在，返回 404 错误
        if (!value) {
            return res.status(404).json({ success: false, error: '未找到指定的键' });
        }
        
        // 返回解析后的 JSON 数据
        res.json({ success: true, data: JSON.parse(value) });
    } catch (error) {
        // 特殊处理 Redis 服务不可用的情况
        if (error.message === 'Redis service unavailable') {
            res.status(503).json({ 
                success: false, 
                error: 'Redis 服务不可用，请使用 URL 数据源替代' 
            });
        } else {
            res.status(500).json({ success: false, error: error.message });
        }
    }
});

/**
 * 保存数据映射配置的 API 接口
 * POST /api/save-mapping
 * 请求体格式: {
 *   source: { 
 *     type: 'url'|'redis',  // 数据源类型
 *     value: string         // URL 或 Redis 键名
 *   },
 *   mapping: {
 *     fields: [            // 字段映射规则
 *       { 
 *         path: string,    // 数据路径
 *         alias?: string   // 可选的别名
 *       }
 *     ]
 *   },
 *   filter: {             // 可选的过滤条件
 *     conditions?: Array<条件>,
 *     sort?: { field: string, order: 'asc'|'desc' },
 *     startIndex?: number,
 *     limit?: number
 *   }
 * }
 */
app.post('/api/save-mapping', async (req, res) => {
    try {
        const { source, mapping, filter } = req.body;
        // 创建配置对象
        const config = {
            source,
            mapping,
            filter,
            created_at: new Date().toISOString()  // 添加创建时间
        };
        
        // 生成唯一的配置 ID
        const configId = `mapping:${Date.now()}`;
        
        // 尝试保存到 Redis
        try {
            const client = await getRedisClient();
            await client.set(configId, JSON.stringify(config));
        } catch (error) {
            // 如果 Redis 不可用，则保存在内存中
            app.locals[configId] = config;
        }
        
        // 返回配置 ID 和访问 URL
        res.json({ 
            success: true, 
            configId,
            accessUrl: `/api/data/${configId}`  // 用于后续获取数据的 URL
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * 使用保存的映射配置获取数据的 API 接口
 * GET /api/data/:configId
 * 参数: configId - 之前保存的配置 ID
 * 返回: 根据配置转换和过滤后的数据
 */
app.get('/api/data/:configId', async (req, res) => {
    try {
        const { configId } = req.params;
        let config;
        
        // 首先尝试从 Redis 获取配置
        try {
            const client = await getRedisClient();
            const configStr = await client.get(configId);
            if (configStr) {
                config = JSON.parse(configStr);
            }
        } catch (error) {
            // 如果 Redis 不可用，尝试从内存中获取
            config = app.locals[configId];
        }
        
        // 如果配置不存在，返回 404 错误
        if (!config) {
            return res.status(404).json({ success: false, error: '未找到配置' });
        }
        
        // 根据配置的数据源类型获取数据
        let sourceData;
        if (config.source.type === 'url') {
            // 从 URL 获取数据
            const response = await axios.get(config.source.value);
            sourceData = response.data;
        } else if (config.source.type === 'redis') {
            // 从 Redis 获取数据
            try {
                const client = await getRedisClient();
                const value = await client.get(config.source.value);
                if (!value) {
                    throw new Error('未找到 Redis 键');
                }
                sourceData = JSON.parse(value);
            } catch (error) {
                return res.status(503).json({ 
                    success: false, 
                    error: 'Redis 数据源不可用，请使用 URL 数据源替代'
                });
            }
        }
        
        // 应用映射和过滤规则处理数据
        const result = applyMapping(sourceData, config.mapping, config.filter);
        res.json({ success: true, data: result });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// 启动服务器
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
    console.log(`服务器已启动，正在监听端口 ${PORT}`);
});
