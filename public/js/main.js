let sourceData = null;
let currentMapping = {
    fields: []
};

// 等待DOM完全加载后再初始化
document.addEventListener('DOMContentLoaded', () => {
    initializeEventListeners();
});

// 初始化所有事件监听器
function initializeEventListeners() {
    // 数据源类型切换
    document.querySelectorAll('input[name="sourceType"]').forEach(radio => {
        radio.addEventListener('change', (e) => {
            document.getElementById('urlInput').style.display = e.target.value === 'url' ? 'block' : 'none';
            document.getElementById('redisInput').style.display = e.target.value === 'redis' ? 'block' : 'none';
        });
    });

    // 获取数据按钮
    const fetchDataBtn = document.getElementById('fetchData');
    if (fetchDataBtn) {
        fetchDataBtn.addEventListener('click', fetchSourceData);
    }

    // 添加字段按钮
    const addFieldBtn = document.getElementById('addField');
    if (addFieldBtn) {
        addFieldBtn.addEventListener('click', () => addMappingField());
    }

    // 生成映射按钮
    const generateMappingBtn = document.getElementById('generateMapping');
    if (generateMappingBtn) {
        generateMappingBtn.addEventListener('click', generateMapping);
    }

    // 选择行按钮
    const selectRowBtn = document.getElementById('selectRow');
    if (selectRowBtn) {
        selectRowBtn.addEventListener('click', selectEntireRow);
    }
}

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
    if (previewSection && jsonPreview) {
        jsonPreview.textContent = JSON.stringify(data, null, 2);
        previewSection.style.display = 'block';
    }
}

// 显示映射部分
function showMappingSection() {
    const mappingSection = document.getElementById('mappingSection');
    const fieldMappings = document.getElementById('fieldMappings');
    if (mappingSection && fieldMappings) {
        mappingSection.style.display = 'block';
        fieldMappings.innerHTML = '';
    }
}

// 选择整行数据
function selectEntireRow() {
    const rowIndexInput = document.getElementById('rowIndex');
    if (!rowIndexInput || !sourceData) {
        alert('请先获取数据');
        return;
    }

    const rowIndex = parseInt(rowIndexInput.value) || 0;
    let targetData = sourceData;
    if (Array.isArray(sourceData)) {
        if (rowIndex >= 0 && rowIndex < sourceData.length) {
            targetData = sourceData[rowIndex];
        } else {
            alert('行索引超出范围');
            return;
        }
    }

    const fieldMappings = document.getElementById('fieldMappings');
    if (fieldMappings) {
        // 清空现有字段
        fieldMappings.innerHTML = '';

        // 为对象中的每个字段创建映射
        Object.keys(targetData).forEach(key => {
            addMappingField(key);
        });
    }
}

// 添加映射字段行
function addMappingField(fieldPath = '') {
    const container = document.getElementById('fieldMappings');
    if (!container) return;

    const fieldDiv = document.createElement('div');
    fieldDiv.className = 'mapping-row row g-3 align-items-center';
    
    fieldDiv.innerHTML = `
        <div class="col-5">
            <input type="text" class="form-control field-path" placeholder="JSON路径 (例: title)" value="${fieldPath}">
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
    const removeBtn = fieldDiv.querySelector('.btn-remove-field');
    if (removeBtn) {
        removeBtn.addEventListener('click', () => {
            container.removeChild(fieldDiv);
        });
    }
}

// 生成映射配置
async function generateMapping() {
    const mappingRows = document.querySelectorAll('.mapping-row');
    currentMapping.fields = [];

    mappingRows.forEach(row => {
        const pathInput = row.querySelector('.field-path');
        const aliasInput = row.querySelector('.field-alias');
        
        if (pathInput && pathInput.value.trim()) {
            currentMapping.fields.push({
                path: pathInput.value.trim(),
                alias: aliasInput && aliasInput.value.trim() || undefined
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
        const accessUrlElement = document.getElementById('accessUrl');
        const previewTableHead = document.getElementById('previewTableHead');
        const previewTableBody = document.getElementById('previewTableBody');

        if (!resultSection || !accessUrlElement || !previewTableHead || !previewTableBody) {
            throw new Error('找不到必要的DOM元素');
        }

        resultSection.style.display = 'block';
        accessUrlElement.textContent = window.location.origin + accessUrl;

        // 创建预览表格
        const data = result.data;
        if (data && data.length > 0) {
            const headers = Object.keys(data[0]);
            
            // 表头
            previewTableHead.innerHTML = `
                <tr>
                    ${headers.map(h => `<th>${h}</th>`).join('')}
                </tr>
            `;

            // 表体
            previewTableBody.innerHTML = data.map(row => `
                <tr>
                    ${headers.map(h => `<td>${row[h] || ''}</td>`).join('')}
                </tr>
            `).join('');
        }
    } catch (error) {
        alert('获取预览数据失败: ' + error.message);
    }
}
