/**
 * harness-pipeline-spec-registry.js — Spec First 宪章
 * 宪章: const_spec_first
 * 原则: 所有规格必须编码为机器可读文件
 *
 * 功能:
 *   1. 维护 spec-registry.json 注册表
 *   2. 扫描目录检测是否有 Spec 文件但未注册
 *   3. CEO 提出的架构提议必须附带对应 Spec 文件
 */

const fs = require('fs');
const path = require('path');
const BASE = path.join(__dirname, '..');
const REGISTRY_FILE = path.join(BASE, 'spec-registry.json');

/**
 * 获取注册表
 */
function getRegistry() {
  try {
    if (fs.existsSync(REGISTRY_FILE)) {
      return JSON.parse(fs.readFileSync(REGISTRY_FILE, 'utf-8'));
    }
  } catch(e) {}
  return { specs: [], lastScanned: null };
}

/**
 * 保存注册表
 */
function saveRegistry(registry) {
  try {
    fs.writeFileSync(REGISTRY_FILE, JSON.stringify(registry, null, 2), 'utf-8');
  } catch(e) {}
}

/**
 * 注册新 Spec
 */
function registerSpec(spec) {
  if (!spec.id || !spec.name) {
    return { success: false, error: 'Spec 必须包含 id 和 name' };
  }

  var registry = getRegistry();

  // 检查是否已存在
  var existing = registry.specs.find(function(s) { return s.id === spec.id; });
  if (existing) {
    Object.assign(existing, spec, { updatedAt: new Date().toISOString() });
  } else {
    registry.specs.push({
      id: spec.id,
      name: spec.name,
      purpose: spec.purpose || '',
      files: spec.files || [],
      producer: spec.producer || '',
      consumer: spec.consumer || '',
      schema: spec.schema || null,
      format: spec.format || 'markdown',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });
  }

  registry.lastScanned = new Date().toISOString();
  saveRegistry(registry);
  return { success: true, spec: registry.specs.find(function(s) { return s.id === spec.id; }) };
}

/**
 * 扫描目录检测未注册的 Spec 文件
 */
function scanUnregistered(dirs) {
  dirs = dirs || ['.', './modules', './frontend/src'];
  var registry = getRegistry();
  var registeredFiles = [];
  registry.specs.forEach(function(s) {
    if (s.files) s.files.forEach(function(f) { registeredFiles.push(f); });
  });

  var unregistered = [];
  var specPatterns = ['.md', '.json', '.yaml', '.yml', '.toml'];
  var specKeywords = ['spec', 'specification', 'architecture', 'design', 'plan', 'AGENTS'];

  for (var d of dirs) {
    var absDir = path.resolve(BASE, d);
    try {
      if (!fs.existsSync(absDir)) continue;
      var walk = function(dir) {
        var entries;
        try { entries = fs.readdirSync(dir); } catch(e) { return; }
        for (var entry of entries) {
          var full = path.join(dir, entry);
          try {
            var stat = fs.statSync(full);
            if (stat.isDirectory() && !entry.startsWith('.') && entry !== 'node_modules') {
              walk(full);
            } else if (stat.isFile()) {
              var ext = path.extname(entry).toLowerCase();
              var base = path.basename(entry, ext).toLowerCase();
              if (specPatterns.includes(ext) && specKeywords.some(function(k) { return base.includes(k); })) {
                var relPath = path.relative(BASE, full);
                if (!registeredFiles.includes(relPath)) {
                  unregistered.push(relPath);
                }
              }
            }
          } catch(e) {}
        }
      };
      walk(absDir);
    } catch(e) {}
  }

  return {
    unregistered: unregistered,
    total: registry.specs.length,
    unregisteredCount: unregistered.length,
    lastScanned: registry.lastScanned
  };
}

/**
 * 检查架构提议是否附带 Spec
 */
function checkProposalHasSpec(proposal) {
  if (!proposal) return { passed: false, missing: ['未提供方案内容'] };

  var registry = getRegistry();
  var missing = [];

  // 检查方案中的 specReferences 是否存在
  var refs = proposal.specReferences || [];
  if (!refs || refs.length === 0) {
    missing.push('方案必须引用至少一个已注册的 Spec');
  }

  for (var ref of refs) {
    var exists = registry.specs.find(function(s) {
      return s.id === ref || s.name === ref;
    });
    if (!exists) {
      missing.push('Spec "' + ref + '" 未在 spec-registry.json 中注册');
    }
  }

  return {
    passed: missing.length === 0,
    missing: missing,
    referencedSpecs: refs
  };
}

module.exports = {
  getRegistry,
  saveRegistry,
  registerSpec,
  scanUnregistered,
  checkProposalHasSpec
};
