/**
 * harness-pipeline-validator.js — 自我验证宪章
 * 宪章: const_self_validation
 * 原则: Linter + JSON Schema 校验替代人工 Review
 *
 * 功能:
 *   1. 文件结构检查（命名约定、目录结构）
 *   2. JSON Schema 校验
 *   3. 导入规则检查
 */

const fs = require('fs');
const path = require('path');
const BASE = path.join(__dirname, '..');

const VALIDATOR_CONFIG_FILE = path.join(BASE, 'harness-validator-config.json');

// 默认校验规则
var defaultRules = {
  naming: {
    // 文件名必须是小写 + 连字符
    'enforce_lowercase_hyphen': true,
    'blocked_patterns': [' ', '_'],
    'allowed_suffixes': ['.js', '.json', '.vue', '.md', '.txt', '.yaml', '.yml', '.toml', '.css', '.html']
  },
  structure: {
    'required_dirs': ['modules', 'frontend/src/views'],
    'blocked_dirs': ['node_modules', '.git', 'dist', '.openclaw']
  },
  schema: {
    // 哪些 .json 文件需要 schema 校验
    'schema_check_patterns': ['backend/*.json', 'backend/modules/*.json']
  },
  imports: {
    'blocked_imports': ['eval', 'exec', 'child_process'],
    'allow_relative_only': false
  }
};

/**
 * 获取校验配置
 */
function getValidatorConfig() {
  try {
    if (fs.existsSync(VALIDATOR_CONFIG_FILE)) {
      return JSON.parse(fs.readFileSync(VALIDATOR_CONFIG_FILE, 'utf-8'));
    }
  } catch(e) {}
  return defaultRules;
}

/**
 * 运行全部校验
 * @param {Array} targets - 要校验的文件或目录（相对于 BASE）
 * @returns {Object} { passed, total, errors, warnings, results }
 */
function validateAll(targets) {
  targets = targets || ['.'];
  var config = getValidatorConfig();
  var results = [];
  var errors = [];
  var warnings = [];

  for (var t of targets) {
    var absTarget = path.resolve(BASE, t);
    if (!fs.existsSync(absTarget)) {
      errors.push({ type: 'target', file: t, message: '目标不存在' });
      continue;
    }

    var stat = fs.statSync(absTarget);
    if (stat.isDirectory()) {
      var dirResults = validateDirectory(absTarget, config, t);
      results = results.concat(dirResults.results || []);
      errors = errors.concat(dirResults.errors || []);
      warnings = warnings.concat(dirResults.warnings || []);
    } else {
      var fileResult = validateFile(absTarget, config);
      results.push(fileResult);
      if (fileResult.errors.length > 0) errors = errors.concat(fileResult.errors);
      if (fileResult.warnings.length > 0) warnings = warnings.concat(fileResult.warnings);
    }
  }

  return {
    passed: errors.length === 0,
    total: results.length,
    errorCount: errors.length,
    warningCount: warnings.length,
    errors: errors,
    warnings: warnings,
    results: results
  };
}

/**
 * 校验目录
 */
function validateDirectory(dirPath, config, prefix) {
  var results = [];
  var errors = [];
  var warnings = [];

  try {
    var entries = fs.readdirSync(dirPath);
    for (var entry of entries) {
      var full = path.join(dirPath, entry);
      var stat;
      try { stat = fs.statSync(full); } catch(e) { continue; }

      // 跳过禁止目录
      if (stat.isDirectory()) {
        if (config.structure.blocked_dirs.includes(entry)) continue;
        if (entry.startsWith('.')) continue;
        // 递归校验子目录
        var subPrefix = prefix ? prefix + '/' + entry : entry;
        var subResults = validateDirectory(full, config, subPrefix);
        results = results.concat(subResults.results || []);
        errors = errors.concat(subResults.errors || []);
        warnings = warnings.concat(subResults.warnings || []);
        continue;
      }

      var fileResult = validateFile(full, config);
      results.push(fileResult);
      if (fileResult.errors.length > 0) errors = errors.concat(fileResult.errors);
      if (fileResult.warnings.length > 0) warnings = warnings.concat(fileResult.warnings);
    }

    // 检查必须包含的目录
    if (prefix === '.') {
      for (var requiredDir of config.structure.required_dirs) {
        if (!fs.existsSync(path.join(dirPath, requiredDir))) {
          warnings.push({
            type: 'structure',
            file: requiredDir,
            message: '必需的目录缺失: ' + requiredDir
          });
        }
      }
    }
  } catch(e) {
    errors.push({ type: 'scan', file: prefix, message: e.message });
  }

  return { results: results, errors: errors, warnings: warnings };
}

/**
 * 校验单个文件
 */
function validateFile(filePath, config) {
  var ext = path.extname(filePath).toLowerCase();
  var baseName = path.basename(filePath);
  var fileName = path.basename(filePath, ext);
  var errors = [];
  var warnings = [];

  // 1. 后缀检查
  if (!config.naming.allowed_suffixes.includes(ext)) {
    warnings.push({
      type: 'suffix',
      file: filePath,
      message: '非标准后缀: ' + ext + '（允许: ' + config.naming.allowed_suffixes.join(', ') + '）'
    });
  }

  // 2. 命名检查
  if (config.naming.enforce_lowercase_hyphen) {
    var validName = /^[a-z0-9][a-z0-9.-]*[a-z0-9]$/;
    if (!validName.test(fileName) && !fileName.startsWith('.')) {
      errors.push({
        type: 'naming',
        file: filePath,
        message: '文件名不符合小写连字符约定: ' + baseName
      });
    }

    // 检查禁止的命名模式
    for (var pattern of (config.naming.blocked_patterns || [])) {
      if (fileName.includes(pattern)) {
        errors.push({
          type: 'naming',
          file: filePath,
          message: '文件名包含禁止字符 "' + pattern + '": ' + baseName
        });
      }
    }
  }

  // 3. JSON Schema 校验
  if (ext === '.json') {
    try {
      var content = fs.readFileSync(filePath, 'utf-8');
      JSON.parse(content);
    } catch(e) {
      errors.push({
        type: 'syntax',
        file: filePath,
        message: 'JSON 语法错误: ' + e.message
      });
    }
  }

  // 4. 导入检查（.js 文件）
  if (ext === '.js' || ext === '.vue') {
    try {
      var jsContent = fs.readFileSync(filePath, 'utf-8');
      for (var blocked of (config.imports.blocked_imports || [])) {
        var importPattern = new RegExp("require\(['\"]" + blocked, 'i');
        if (importPattern.test(jsContent)) {
          warnings.push({
            type: 'import',
            file: filePath,
            message: '使用了可能不安全的模块: ' + blocked
          });
        }
      }

      // JavaScript 语法检查
      try {
        require('child_process').execFileSync('node', ['--check', filePath], { encoding: 'utf-8', timeout: 5000 });
      } catch(e) {
        errors.push({
          type: 'syntax',
          file: filePath,
          message: 'JavaScript 语法错误: ' + (e.stderr || e.message).substring(0, 200)
        });
      }
    } catch(e) {}
  }

  return {
    file: path.relative(BASE, filePath),
    passed: errors.length === 0,
    errors: errors,
    warnings: warnings
  };
}

module.exports = {
  validateAll,
  validateFile,
  validateDirectory,
  getValidatorConfig
};
