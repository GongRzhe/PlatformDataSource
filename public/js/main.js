let sourceData = null;
let currentMapping = {
    fields: []
};

// 初始化页面事件监听
document.addEventListener('DOMContentLoaded', () => {
    // 数据源类型切换
    document.querySelectorAll('input[name="sourceType"]').forEach(radio => {
        radio.addEventListener('change', (e) => {
            document.getElementById('urlInput').style.display = e.target.value === 'url' ? 'block' : 'none';
            document.getElementById('redisInput').style.display = e.target.value === 'redis' ? 'block' : 'none';
        });
    });

    // 获取数据按钮
    document.getElementById('fetchData').addEventListener('click', fetchSourceData);

    // 添加字段按钮
    document.getElementById('addField').addEventListener('click', addMappingField);

    // 生成映射按钮
    document.getElementById('generateMapping').addEventListener('click', generateMapping);
});

// 获取数据源数据
async function fetchSourceData() {
    const sourceType = document.querySelector('input[name="sourceType"]:checked').value;
    const endpoint = sourceType === 'url' ? '/api/fetch-url' : '/api/fetch-redis';
    const value = sourceType === 'url' 
        ? document.getElementById('urlValue').value 
        : document.getElementById('redisKey').value;

    if (!value) {
        alert('请输入' + (sourceType === 'url' ? 'URL地址' : 'Redis键'));
        return;
    }

    try {
        const response = await fetch(endpoint, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(sourceType === 'url' ? { url: value } : { key: value })
        });

        const result = await response.json();
        if (!result.success) {
            throw new Error(result.error);
        }

        sourceData = result.data;
        displayJsonPreview(sourceData);
        showMappingSection();
    } catch (error) {
        alert('获取数据失败: ' + error.message);
    }
}

// 显示JSON预览
function displayJsonPreview(data) {
    const previewSection = document.getElementById('previewSection');
    const jsonPreview = document.getElementById('jsonPreview');
    jsonPreview.textContent = JSON.stringify(data, null, 2);
    previewSection.style.display = 'block';
}

// 显示映射部分
function showMappingSection() {
    const mappingSection = document.getElementById('mappingSection');
    mappingSection.style.display = 'block';
    document.getElementById('fieldMappings').innerHTML = '';
    addMappingField(); // 添加第一个映射字段
}

// 添加映射字段行
function addMappingField() {
    const container = document.getElementById('fieldMappings');
    const fieldDiv = document.createElement('div');
    fieldDiv.className = 'mapping-row row g-3 align-items-center';
    
    fieldDiv.innerHTML = `
        <div class="col-5">
            <input type="text" class="form-control field-path" placeholder="JSON路径 (例: data.items.0.name)">
        </div>
        <div class="col-5">
            <input type="text" class="form-control field-alias" placeholder="别名 (可选)">
        </div>
        <div class="col-2">
            <button class="btn btn-danger btn-remove-field">删除</button>
        </div>
    `;

    container.appendChild(fieldDiv);

    // 添加删除按钮事件
    fieldDiv.querySelector('.btn-remove-field').addEventListener('click', () => {
        container.removeChild(fieldDiv);
    });
}

// 生成映射配置
async function generateMapping() {
    const mappingRows = document.querySelectorAll('.mapping-row');
    currentMapping.fields = [];

    mappingRows.forEach(row => {
        const path = row.querySelector('.field-path').value.trim();
        const alias = row.querySelector('.field-alias').value.trim();
        
        if (path) {
            currentMapping.fields.push({
                path,
                alias: alias || undefined
            });
        }
    });

    if (currentMapping.fields.length === 0) {
        alert('请至少添加一个字段映射');
        return;
    }

    try {
        const sourceType = document.querySelector('input[name="sourceType"]:checked').value;
        const sourceValue = sourceType === 'url' 
            ? document.getElementById('urlValue').value 
            : document.getElementById('redisKey').value;

        const response = await fetch('/api/save-mapping', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                source: {
                    type: sourceType,
                    value: sourceValue
                },
                mapping: currentMapping
            })
        });

        const result = await response.json();
        if (!result.success) {
            throw new Error(result.error);
        }

        showResultPreview(result.accessUrl);
    } catch (error) {
        alert('保存映射失败: ' + error.message);
    }
}

// 显示结果预览
async function showResultPreview(accessUrl) {
    try {
        const response = await fetch(accessUrl);
        const result = await response.json();
        if (!result.success) {
            throw new Error(result.error);
        }

        const resultSection = document.getElementById('resultSection');
        resultSection.style.display = 'block';

        // 显示访问URL
        document.getElementById('accessUrl').textContent = window.location.origin + accessUrl;

        // 创建预览表格
        const data = result.data;
        if (data && data.length > 0) {
            const headers = Object.keys(data[0]);
            
            // 表头
            const thead = document.getElementById('previewTableHead');
            thead.innerHTML = `
                <tr>
                    ${headers.map(h => `<th>${h}</th>`).join('')}
                </tr>
            `;

            // 表体
            const tbody = document.getElementById('previewTableBody');
            tbody.innerHTML = data.map(row => `
                <tr>
                    ${headers.map(h => `<td>${row[h] || ''}</td>`).join('')}
                </tr>
            `).join('');
        }
    } catch (error) {
        alert('获取预览数据失败: ' + error.message);
    }
}
