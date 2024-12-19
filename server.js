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

// Redis client setup with lazy connection
let redisClient = null;
const getRedisClient = async () => {
    if (!redisClient) {
        redisClient = createClient({
            url: 'redis://10.1.210.223:6379'
        });
        redisClient.on('error', err => console.log('Redis Client Error', err));
        try {
            await redisClient.connect();
        } catch (err) {
            console.log('Redis connection failed:', err);
            redisClient = null;
            throw new Error('Redis service unavailable');
        }
    }
    return redisClient;
};

// Helper function to get value by path
function getValueByPath(obj, path) {
    const parts = path.split('.');
    let current = obj;
    
    for (const part of parts) {
        if (current === null || current === undefined) {
            return undefined;
        }
        
        // Handle array index
        if (!isNaN(part) && Array.isArray(current)) {
            current = current[parseInt(part)];
        } else {
            current = current[part];
        }
    }
    
    return current;
}

// Helper function to apply mapping to data
function applyMapping(data, mapping, filter = {}) {
    let result = [];
    
    // Handle array data
    if (Array.isArray(data)) {
        // Apply mapping to each item
        data.forEach(item => {
            const row = {};
            mapping.fields.forEach(field => {
                const value = getValueByPath(item, field.path.replace(/^\d+\./, ''));
                if (value !== undefined) {
                    row[field.alias || field.path] = value;
                }
            });
            if (Object.keys(row).length > 0) {
                result.push(row);
            }
        });
    } else {
        // Handle single object data
        const row = {};
        mapping.fields.forEach(field => {
            const value = getValueByPath(data, field.path);
            if (value !== undefined) {
                row[field.alias || field.path] = value;
            }
        });
        if (Object.keys(row).length > 0) {
            result.push(row);
        }
    }

    // Apply sorting if specified
    if (filter.sort && filter.sort.field) {
        result.sort((a, b) => {
            const aVal = a[filter.sort.field] || '';
            const bVal = b[filter.sort.field] || '';
            
            if (typeof aVal === 'number' && typeof bVal === 'number') {
                return filter.sort.order === 'desc' ? bVal - aVal : aVal - bVal;
            }
            
            const aStr = String(aVal);
            const bStr = String(bVal);
            return filter.sort.order === 'desc' ? 
                bStr.localeCompare(aStr) : 
                aStr.localeCompare(bStr);
        });
    }

    // Apply pagination
    const startIndex = filter.startIndex || 0;
    const limit = filter.limit || result.length;
    result = result.slice(startIndex, startIndex + limit);

    return result;
}

// Fetch data from URL
app.post('/api/fetch-url', async (req, res) => {
    try {
        const { url } = req.body;
        const response = await axios.get(url);
        res.json({ success: true, data: response.data });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Fetch data from Redis
app.post('/api/fetch-redis', async (req, res) => {
    try {
        const { key } = req.body;
        const client = await getRedisClient();
        const value = await client.get(key);
        
        if (!value) {
            return res.status(404).json({ success: false, error: 'Key not found' });
        }
        
        res.json({ success: true, data: JSON.parse(value) });
    } catch (error) {
        if (error.message === 'Redis service unavailable') {
            res.status(503).json({ 
                success: false, 
                error: 'Redis service is not available. Please use URL data source instead.' 
            });
        } else {
            res.status(500).json({ success: false, error: error.message });
        }
    }
});

// Save data mapping configuration
app.post('/api/save-mapping', async (req, res) => {
    try {
        const { source, mapping, filter } = req.body;
        const config = {
            source,
            mapping,
            filter,
            created_at: new Date().toISOString()
        };
        
        const configId = `mapping:${Date.now()}`;
        
        // Try to save to Redis if available
        try {
            const client = await getRedisClient();
            await client.set(configId, JSON.stringify(config));
        } catch (error) {
            // If Redis is not available, store in memory
            app.locals[configId] = config;
        }
        
        res.json({ 
            success: true, 
            configId,
            accessUrl: `/api/data/${configId}`
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get data using saved mapping
app.get('/api/data/:configId', async (req, res) => {
    try {
        const { configId } = req.params;
        let config;
        
        // Try to get from Redis first
        try {
            const client = await getRedisClient();
            const configStr = await client.get(configId);
            if (configStr) {
                config = JSON.parse(configStr);
            }
        } catch (error) {
            // If Redis is not available, try memory storage
            config = app.locals[configId];
        }
        
        if (!config) {
            return res.status(404).json({ success: false, error: 'Configuration not found' });
        }
        
        let sourceData;
        if (config.source.type === 'url') {
            const response = await axios.get(config.source.value);
            sourceData = response.data;
        } else if (config.source.type === 'redis') {
            try {
                const client = await getRedisClient();
                const value = await client.get(config.source.value);
                if (!value) {
                    throw new Error('Redis key not found');
                }
                sourceData = JSON.parse(value);
            } catch (error) {
                return res.status(503).json({ 
                    success: false, 
                    error: 'Redis data source is not available. Please use URL data source instead.'
                });
            }
        }
        
        const result = applyMapping(sourceData, config.mapping, config.filter);
        res.json({ success: true, data: result });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
