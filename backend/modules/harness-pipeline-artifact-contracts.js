/**
 * harness-pipeline-artifact-contracts.js — 产物契约宪章
 * 宪章: const_artifact_contract
 * 原则: Agent 间必须通过文件传递信息，格式预先约定
 *
 * 功能:
 *   1. 维护 artifact-contract-registry.json 注册表
 *   2. 跨 Agent 调用前校验产物格式
 *   3. 记录违规
 */

const fs = require('fs');
const path = require('path');
const BASE = path.join(__dirname, '..');
const CONTRACT_FILE = path.join(BASE, 'artifact-contract-registry.json');

/**
 * 获取注册表
 */
function getRegistry() {
  try {
    if (fs.existsSync(CONTRACT_FILE)) {
      return JSON.parse(fs.readFileSync(CONTRACT_FILE, 'utf-8'));
    }
  } catch(e) {}
  return { contracts: [] };
}

/**
 * 保存注册表
 */
function saveRegistry(registry) {
  try {
    fs.writeFileSync(CONTRACT_FILE, JSON.stringify(registry, null, 2), 'utf-8');
  } catch(e) {}
}

/**
 * 注册产物契约
 */
function registerContract(contract) {
  if (!contract.id || !contract.purpose) {
    return { success: false, error: '契约必须包含 id 和 purpose' };
  }

  var registry = getRegistry();
  var existing = registry.contracts.find(function(c) { return c.id === contract.id; });

  var entry = {
    id: contract.id,
    purpose: contract.purpose,
    format: contract.format || 'markdown',
    schema: contract.schema || null,
    producer: contract.producer || '',
    consumer: contract.consumer || '',
    requiredFields: contract.requiredFields || [],
    createdAt: existing ? existing.createdAt : new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  if (existing) {
    Object.assign(existing, entry);
  } else {
    registry.contracts.push(entry);
  }
  saveRegistry(registry);
  return { success: true, contract: entry };
}

/**
 * 校验跨 Agent 调用是否携带正确的产物文件
 * @param {Object} call - { sourceAgent, targetAgent, artifactFile, artifactData }
 * @returns {Object} { passed, missingFields, contract, violations }
 */
function checkArtifactContract(call) {
  if (!call || !call.sourceAgent || !call.targetAgent) {
    return { passed: false, violations: ['缺少 sourceAgent 或 targetAgent'] };
  }

  var registry = getRegistry();

  // 查找匹配的契约
  var contract = registry.contracts.find(function(c) {
    return c.producer === call.sourceAgent && c.consumer === call.targetAgent;
  });

  if (!contract) {
    // 没有注册契约——记录警告但允许通过（新系统逐步引入）
    return {
      passed: true,
      warn: 'Agent "' + call.sourceAgent + '" → "' + call.targetAgent + '" 未注册产物契约。建议在 artifact-contract-registry.json 中注册。',
      contract: null,
      violations: []
    };
  }

  var violations = [];

  // 如果契约要求文件传递但没有 artifactFile
  if (contract.format !== 'inline' && !call.artifactFile) {
    violations.push('缺少产物文件。契约 "' + contract.id + '" 要求通过文件传递（格式: ' + contract.format + '）');
  }

  // 检查必需字段
  if (contract.requiredFields && contract.requiredFields.length > 0 && call.artifactData) {
    var data = call.artifactData;
    if (typeof data === 'string') {
      try { data = JSON.parse(data); } catch(e) { data = {}; }
    }
    for (var field of contract.requiredFields) {
      if (data[field] === undefined || data[field] === null || data[field] === '') {
        violations.push('产物缺少必需字段 "' + field + '"（契约: ' + contract.id + '）');
      }
    }
  }

  // Schema 校验（JSON Schema 格式）
  if (contract.schema && call.artifactData) {
    try {
      var schemaCheck = validateSchema(call.artifactData, contract.schema);
      if (!schemaCheck.valid) {
        violations.push('产物格式不符合 Schema 要求: ' + schemaCheck.errors.join('; '));
      }
    } catch(e) {
      violations.push('Schema 校验出错: ' + e.message);
    }
  }

  return {
    passed: violations.length === 0,
    violations: violations,
    contract: contract,
    missingFields: violations.filter(function(v) { return v.includes('缺少'); })
  };
}

/**
 * 简易 Schema 校验（支持 required fields + type check）
 */
function validateSchema(data, schema) {
  if (typeof data === 'string') {
    try { data = JSON.parse(data); } catch(e) { return { valid: false, errors: ['无法解析为 JSON'] }; }
  }

  var errors = [];

  if (schema.required && Array.isArray(schema.required)) {
    for (var field of schema.required) {
      if (data[field] === undefined) {
        errors.push('缺少必需字段: ' + field);
      }
    }
  }

  if (schema.properties && typeof data === 'object') {
    for (var propName of Object.keys(schema.properties)) {
      var propSchema = schema.properties[propName];
      var value = data[propName];

      if (value === undefined) continue;

      if (propSchema.type && typeof value !== propSchema.type) {
        if (propSchema.type === 'array' && !Array.isArray(value)) {
          errors.push('字段 "' + propName + '" 期望类型 ' + propSchema.type + '，实际 ' + typeof value);
        } else if (propSchema.type !== 'array') {
          var actualType = Array.isArray(value) ? 'array' : typeof value;
          if (actualType !== propSchema.type) {
            errors.push('字段 "' + propName + '" 期望类型 ' + propSchema.type + '，实际 ' + actualType);
          }
        }
      }

      if (propSchema.enum && !propSchema.enum.includes(value)) {
        errors.push('字段 "' + propName + '" 值 "' + value + '" 不在允许列表中: ' + propSchema.enum.join(', '));
      }
    }
  }

  return { valid: errors.length === 0, errors: errors };
}

module.exports = {
  getRegistry,
  saveRegistry,
  registerContract,
  checkArtifactContract,
  validateSchema
};
