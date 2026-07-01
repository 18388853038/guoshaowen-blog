/**
 * rules-engine.js — 规则引擎
 * 
 * 对标 .codex 的 rules/ 设计，提供安全规则 + 执行策略
 * 
 * 当前聚焦：
 *   1. AI 生成文件写入白名单（防止写系统关键路径）
 *   2. 危险命令拦截
 *   3. 敏感路径保护
 * 
 * 规则文件格式（TOML-like）：
 *   # write_rules: 文件写入白名单
 *   [write_allow]
 *   patterns = ["F:\\eCompanyClaw-Release\\**", "C:\\Users\\Administrator\\.openclaw\\workspace\\**"]
 *   
 *   # deny_patterns: 禁止写入路径
 *   [write_deny]
 *   patterns = ["C:\\Windows\\**", "C:\\Program Files\\**", "C:\\ProgramData\\**"]
 *   
 *   [shell_deny]
 *   patterns = ["rm -rf /", "format", "del /f /s", "rd /s", "shutdown"]
 */

const fs = require('fs');
const path = require('path');

class RulesEngine {
  constructor(options) {
    options = options || {};
    this.options = options;
    this.rulesPath = options.rulesPath || path.join(__dirname, '..', 'data', 'rules.json');
    this.rules = {
      write_allow: { patterns: [], enabled: true },
      write_deny: { patterns: [], enabled: true },
      shell_deny: { patterns: [], enabled: true },
      read_deny: { patterns: [], enabled: true }
    };
    this._loaded = false;
  }

  // ========== 加载持久化规则 ==========

  load() {
    try {
      if (fs.existsSync(this.rulesPath)) {
        const content = fs.readFileSync(this.rulesPath, 'utf-8');
        const parsed = JSON.parse(content);
        // 合并保留现有字段
        Object.keys(this.rules).forEach(key => {
          if (parsed[key] && typeof parsed[key] === 'object') {
            if (Array.isArray(parsed[key].patterns)) {
              this.rules[key].patterns = parsed[key].patterns;
            }
            if (typeof parsed[key].enabled === 'boolean') {
              this.rules[key].enabled = parsed[key].enabled;
            }
          }
        });
      }
    } catch(e) {
      // 新安装或无配置
    }

    // 如果没有任何规则，自动添加默认规则
    if (this.rules.write_deny.patterns.length === 0) {
      this._addDefaultRules();
    }

    this._loaded = true;
    return this;
  }

  _addDefaultRules() {
    // 默认禁止写入系统路径
    this.rules.write_deny.patterns = [
      'C:\\Windows\\**',
      'C:\\Windows\\System32\\**',
      'C:\\Program Files\\**',
      'C:\\Program Files (x86)\\**',
      'C:\\ProgramData\\**',
      '**\\AppData\\**',
      'C:\\$Recycle.Bin\\**'
    ];

    // 默认禁止命令
    this.rules.shell_deny.patterns = [
      'rm -rf /',
      'rm -rf /*',
      'format *',
      'format /q *',
      'format c:',
      'del /f /s *',
      'rd /s /q *',
      'shutdown /s',
      'shutdown /r',
      'taskkill /f /im *',
      'reg delete',
      'regedit'
    ];

    // 默认敏感读取禁止
    this.rules.read_deny.patterns = [
      '*.key',
      '*.pem',
      '*.pfx',
      '*password*',
      '*secret*',
      '*token*',
      '**\\.env*',
      '**\\config\\auth*',
      '**\\config\\credentials*',
      '**\\config\\secret*'
    ];

    this.save();
  }

  save() {
    try {
      // 确保目录存在
      const dir = path.dirname(this.rulesPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(this.rulesPath, JSON.stringify(this.rules, null, 2), 'utf-8');
    } catch(e) {
      console.error('[rules-engine] 保存规则失败:', e.message);
    }
  }

  // ========== 2. 安全校验接口 ==========

  /**
   * 校验文件写入路径
   * @param {string} filePath - 完整文件路径
   * @returns {{ allowed: boolean, reason?: string }}
   */
  checkWritePath(filePath) {
    if (!this._loaded) this.load();
    
    // 标准化路径（统一使用 /）
    const normalized = filePath.replace(/\\/g, '/');

    // 1. 检查拒绝列表
    for (const pattern of this.rules.write_deny.patterns) {
      const normalizedPattern = pattern.replace(/\\/g, '/');
      if (this._match(normalized, normalizedPattern)) {
        return { allowed: false, reason: `写入路径被拒绝（匹配规则: ${pattern}）` };
      }
    }

    // 2. 如果没有允许列表，默认允许（非拒绝路径）
    if (this.rules.write_allow.patterns.length === 0) {
      return { allowed: true };
    }

    // 3. 检查允许列表
    for (const pattern of this.rules.write_allow.patterns) {
      const normalizedPattern = pattern.replace(/\\/g, '/');
      if (this._match(normalized, normalizedPattern)) {
        return { allowed: true };
      }
    }

    // 默认：不在允许列表也没有拒绝列表时，拒绝
    return { allowed: false, reason: '写入路径不在允许列表中' };
  }

  /**
   * 校验 shell 命令
   * @param {string} command - 命令字符串
   * @returns {{ allowed: boolean, reason?: string }}
   */
  checkShellCommand(command) {
    if (!this._loaded) this.load();
    const lower = command.toLowerCase();

    for (const pattern of this.rules.shell_deny.patterns) {
      if (lower.includes(pattern.toLowerCase())) {
        return { allowed: false, reason: `命令被安全规则拦截（匹配: ${pattern}）` };
      }
    }

    return { allowed: true };
  }

  /**
   * 校验文件读取路径
   */
  checkReadPath(filePath) {
    if (!this._loaded) this.load();
    const normalized = filePath.replace(/\\/g, '/');

    for (const pattern of this.rules.read_deny.patterns) {
      const normalizedPattern = pattern.replace(/\\/g, '/');
      if (this._match(normalized, normalizedPattern)) {
        return { allowed: false, reason: `读取路径被拒绝（匹配规则: ${pattern}）` };
      }
    }

    return { allowed: true };
  }

  /**
   * 统一写入前安全校验（write_file tool 使用）
   */
  validateWrite(args) {
    if (!args || !args.path) {
      return { allowed: false, reason: '缺少写入路径' };
    }
    return this.checkWritePath(args.path);
  }

  // ========== 3. 路径匹配 ==========

  _match(normalizedPath, normalizedPattern) {
    // 简单的 glob-like 匹配
    // 支持 **, *, ?
    try {
      // 使用 RegExp 模拟 glob 
      const regexStr = normalizedPattern
        .replace(/[.+^${}()|[\]\\]/g, '\\$&') // 转义特殊字符
        .replace(/\\\*\\\*/g, '.*')            // ** → 任意多级
        .replace(/\\\*/g, '[^/]*')             // * → 单级任意
        .replace(/\\\?/g, '.');                // ? → 单字符

      return new RegExp('^' + regexStr + '$', 'i').test(normalizedPath);
    } catch(e) {
      // fallback: 简单包含
      return normalizedPath.includes(normalizedPattern.replace(/\*\*/g, ''));
    }
  }

  // ========== 4. 规则管理接口 ==========

  getRules() {
    if (!this._loaded) this.load();
    return JSON.parse(JSON.stringify(this.rules));
  }

  /**
   * 添加规则模式
   * @param {'write_allow'|'write_deny'|'shell_deny'|'read_deny'} category
   * @param {string} pattern
   */
  addPattern(category, pattern) {
    if (!this.rules[category]) return false;
    if (this.rules[category].patterns.includes(pattern)) return true;
    this.rules[category].patterns.push(pattern);
    this.save();
    return true;
  }

  /**
   * 移除规则模式
   */
  removePattern(category, pattern) {
    if (!this.rules[category]) return false;
    const idx = this.rules[category].patterns.indexOf(pattern);
    if (idx < 0) return false;
    this.rules[category].patterns.splice(idx, 1);
    this.save();
    return true;
  }

  /**
   * 启用/禁用规则类别
   */
  setEnabled(category, enabled) {
    if (!this.rules[category]) return false;
    this.rules[category].enabled = enabled;
    this.save();
    return true;
  }

  // ========== 5. 路由注册 ==========

  registerRoutes(registerRoute, parseBody, json) {
    const self = this;

    // 获取规则配置
    registerRoute(['GET'], /^\/api\/rules\/config$/, function(req, res) {
      json(res, { ok: true, rules: self.getRules() });
    });

    // 校验写入路径
    registerRoute(['POST'], /^\/api\/rules\/check\/write$/, function(req, res, _, body) {
      const b = typeof body === 'string' ? JSON.parse(body) : (body || {});
      if (!b.path) return json(res, { ok: false, error: '缺少路径参数' });
      json(res, { ok: true, ...self.checkWritePath(b.path) });
    });

    // 添加规则
    registerRoute(['POST'], /^\/api\/rules\/add$/, function(req, res, _, body) {
      const b = typeof body === 'string' ? JSON.parse(body) : (body || {});
      if (!b.category || !b.pattern) return json(res, { ok: false, error: '缺少 category 或 pattern' });
      const ok = self.addPattern(b.category, b.pattern);
      json(res, { ok, rules: self.getRules() });
    });

    // 移除规则
    registerRoute(['POST'], /^\/api\/rules\/remove$/, function(req, res, _, body) {
      const b = typeof body === 'string' ? JSON.parse(body) : (body || {});
      if (!b.category || !b.pattern) return json(res, { ok: false, error: '缺少 category 或 pattern' });
      const ok = self.removePattern(b.category, b.pattern);
      json(res, { ok, rules: self.getRules() });
    });
  }
}

// ========== 单例 ==========

var _instance = null;

function getInstance(options) {
  if (!_instance) {
    _instance = new RulesEngine(options);
    _instance.load();
  }
  return _instance;
}

module.exports = {
  RulesEngine,
  getInstance
};
