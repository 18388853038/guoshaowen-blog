/**
 * skill-registry.js — SkillRegistry 类（轻量技能系统）
 * 
 * 对标 .codex 的 skills/ 设计，提供三级目录管理：
 *   skills/.system/     系统技能（内置）
 *   skills/user/        用户技能（自定义）
 *   skills/marketplace/ 技能市场（下载）
 * 
 * 每个技能标准结构：
 *   skills/<level>/<skill-name>/
 *     SKILL.md            技能说明（必需，含 YAML frontmatter）
 *     skill.js            技能入口（可选，有则执行，无则纯文档）
 *     config.toml         技能配置（可选）
 * 
 * 同时兼容旧 skills-runner/ 中的 skill.js 执行
 * 以及 OpenClaw 内置技能的 SKILL.md 文档发现
 */

const fs = require('fs');
const path = require('path');
const EventEmitter = require('events');

class SkillRegistry extends EventEmitter {
  constructor(options) {
    super();
    this.options = options || {};
    this.skills = new Map();           // id -> SkillInfo
    this.skillModules = new Map();     // id -> loaded module
    this.openclawSkills = [];          // OpenClaw 原生技能（只读）
    
    // 搜索路径优先级：skills-runner > skills/ > workspace > bundled
    this.skillPaths = [
      { path: path.join(__dirname, '..', 'skills-runner'), source: 'runner', priority: 4 },
      { path: path.join(__dirname, '..', 'skills', '.system'), source: 'system', priority: 3 },
      { path: path.join(__dirname, '..', 'skills', 'marketplace'), source: 'marketplace', priority: 2 },
      { path: path.join(__dirname, '..', 'skills', 'user'), source: 'user', priority: 2 },
      // OpenClaw 内置和工作区技能（只读发现）
      { path: path.join(process.env.APPDATA || '', 'npm', 'node_modules', 'openclaw', 'skills'), source: 'bundled', priority: 0, readOnly: true },
      { path: path.join(process.env.HOME || 'C:/Users/Administrator', '.openclaw', 'workspace', 'skills'), source: 'workspace', priority: 1, readOnly: true },
    ];
    
    this.cachedTools = null;
    this.cacheTime = 0;
    this.CACHE_TTL = 60000; // 60s
  }

  // ========== 1. 技能发现与注册 ==========

  /**
   * 扫描所有路径加载技能
   * 同名技能：高优先级覆盖低优先级
   */
  loadSkills() {
    this.skills.clear();
    this.skillModules.clear();
    this.openclawSkills = [];

    for (const sp of this.skillPaths) {
      const found = this._discoverSkills(sp.path);
      for (const skill of found) {
        const existing = this.skills.get(skill.id);
        if (!existing) {
          // 新技能，直接添加
          skill.source = sp.source;
          skill.readOnly = !!sp.readOnly;
          this.skills.set(skill.id, skill);
        } else if (sp.priority > this._getPriority(existing.source)) {
          // 高优先级覆盖，但新技能是 stub（仅 handler.js）而旧技能有真正 skill.js 时不覆盖
          // 同理，低优先级但是真正 skill.js 可以覆盖高优先级的 stub
          if (!(skill.hasHandlerJs && !skill.hasSkillJs && existing.hasSkillJs)) {
            skill.source = sp.source;
            skill.readOnly = !!sp.readOnly;
            this.skills.set(skill.id, skill);
          }
        } else if (sp.priority < this._getPriority(existing.source)) {
          // 低优先级技能有真 skill.js 而现有的是 stub 时，提升
          if (skill.hasSkillJs && !existing.hasSkillJs && existing.hasHandlerJs) {
            skill.source = sp.source;
            skill.readOnly = !!sp.readOnly;
            this.skills.set(skill.id, skill);
          }
        }
      }
    }

    // 尝试加载 skill.js 模块（非 readOnly）
    for (const [id, skill] of this.skills) {
      if (!skill.readOnly) {
        this._tryLoadModule(id, skill);
      }
    }

    this.cacheTime = 0; // 清除工具缓存
    this.emit('loaded', { total: this.skills.size });
    return this.getAllSkills();
  }

  /**
   * 扫描单个目录发现技能
   */
  _discoverSkills(dirPath) {
    const results = [];
    try {
      if (!fs.existsSync(dirPath)) return results;
      const entries = fs.readdirSync(dirPath);
      for (const entry of entries) {
        const skillDir = path.join(dirPath, entry);
        if (!fs.statSync(skillDir).isDirectory()) continue;
        if (entry.startsWith('.')) continue; // 跳过隐藏目录

        const skMdPath = path.join(skillDir, 'SKILL.md');
        const skillJsPath = path.join(skillDir, 'skill.js');
        const handlerJsPath = path.join(skillDir, 'handler.js');
        
        // SKILL.md 是必需文件
        if (!fs.existsSync(skMdPath)) continue;

        try {
          const content = fs.readFileSync(skMdPath, 'utf-8');
          const meta = this._parseFrontmatter(content);
          const summary = this._extractSummary(content);

          results.push({
            id: entry,
            name: meta.name || entry,
            description: meta.description || summary || `${entry} skill`,
            emoji: (meta.metadata && meta.metadata.openclaw && meta.metadata.openclaw.emoji) || '🔧',
            requires: (meta.metadata && meta.metadata.openclaw && meta.metadata.openclaw.requires) || {},
            install: (meta.metadata && meta.metadata.openclaw && meta.metadata.openclaw.install) || [],
            hasSkillJs: fs.existsSync(skillJsPath),
            hasHandlerJs: fs.existsSync(handlerJsPath),
            dir: skillDir,
            rawContent: content,
            summary: summary,
            homepage: meta.homepage || '',
            config: this._parseToml(path.join(skillDir, 'config.toml')),
            enabled: true
          });
        } catch(e) {
          // 单个技能解析失败不影响其他
        }
      }
    } catch(e) {}
    return results;
  }

  /**
   * 解析 SKILL.md YAML frontmatter
   */
  _parseFrontmatter(content) {
    try {
      const match = content.match(/^---\n([\s\S]*?)\n---/);
      if (!match) return {};
      const yaml = match[1];
      const result = {};
      const lines = yaml.split('\n');
      let currentKey = null;
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const kv = line.match(/^(\w+):\s*(.*)/);
        if (kv) {
          currentKey = kv[1];
          let val = kv[2].trim();
          if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1);
          if (val === 'true') val = true;
          else if (val === 'false') val = false;
          if (val.startsWith('{') || val.startsWith('[')) {
            try { val = JSON.parse(val); } catch(e) {}
          }
          result[currentKey] = val;
        } else if (currentKey && line.match(/^\s{2,}/)) {
          if (typeof result[currentKey] === 'string') {
            result[currentKey] += '\n' + line.trim();
          }
        }
      }
      return result;
    } catch(e) { return {}; }
  }

  /**
   * 从 body 提取摘要（第一段）
   */
  _extractSummary(content) {
    const bodyMatch = content.match(/^---[\s\S]*?---\n\n([\s\S]*)/);
    if (!bodyMatch) return '';
    const body = bodyMatch[1].trim();
    const firstPara = body.match(/^(.*?)(?:\n\n|$)/);
    if (firstPara) return firstPara[1].replace(/^#+\s*/, '').trim();
    return '';
  }

  /**
   * 解析简单的 TOML 配置（仅基础键值对）
   */
  _parseToml(filePath) {
    try {
      if (!fs.existsSync(filePath)) return {};
      const content = fs.readFileSync(filePath, 'utf-8');
      const result = {};
      const lines = content.split('\n');
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        // Skip section headers for now
        if (trimmed.startsWith('[')) continue;
        const eq = trimmed.indexOf('=');
        if (eq < 0) continue;
        const key = trimmed.substring(0, eq).trim();
        let val = trimmed.substring(eq + 1).trim();
        if ((val.startsWith('"') && val.endsWith('"')) ||
            (val.startsWith("'") && val.endsWith("'"))) {
          val = val.slice(1, -1);
        }
        result[key] = val;
      }
      return result;
    } catch(e) { return {}; }
  }

  /**
   * 获取技能来源优先级数值
   */
  _getPriority(source) {
    const map = { runner: 4, system: 3, user: 2, marketplace: 2, workspace: 1, bundled: 0 };
    return map[source] || 0;
  }

  /**
   * 尝试加载 skill.js 模块
   */
  _tryLoadModule(id, skill) {
    // 优先 skill.js，其次 handler.js
    let skillJsPath = path.join(skill.dir, 'skill.js');
    if (!fs.existsSync(skillJsPath)) {
      skillJsPath = path.join(skill.dir, 'handler.js');
    }
    if (!fs.existsSync(skillJsPath)) return false;
    
    // 清除旧的 require 缓存
    const resolved = require.resolve(skillJsPath);
    if (require.cache[resolved]) {
      delete require.cache[resolved];
    }

    try {
      const mod = require(skillJsPath);
      this.skillModules.set(id, mod);
      
      // 检查模块是否有标准的 execute 接口
      if (typeof mod.execute !== 'function') {
        // 兼容 handler.js 导出为函数的格式
        if (typeof mod === 'function') {
          mod._legacyHandler = true;
        } else if (typeof mod.default === 'function') {
          mod._legacy = true;
        }
      }
      
      return true;
    } catch(e) {
      // log module load failure
      return false;
    }
  }

  // ========== 2. 技能查询接口 ==========

  /**
   * 获取所有技能列表
   */
  getAllSkills() {
    const result = [];
    for (const [id, skill] of this.skills) {
      result.push({
        id: skill.id,
        name: skill.name,
        description: skill.description,
        summary: skill.summary,
        emoji: skill.emoji,
        source: skill.source,
        readOnly: skill.readOnly,
        hasSkillJs: skill.hasSkillJs,
        enabled: skill.enabled,
        requires: skill.requires,
        install: skill.install,
        homepage: skill.homepage,
        dir: skill.dir
      });
    }
    // 按来源排序：system > user > runner > workspace > bundled
    const sortOrder = { system: 0, user: 1, runner: 2, marketplace: 2, workspace: 3, bundled: 4 };
    result.sort((a, b) => (sortOrder[a.source] || 99) - (sortOrder[b.source] || 99));
    return result;
  }

  /**
   * 按 ID 获取技能
   */
  getSkill(id) {
    return this.skills.get(id) || null;
  }

  /**
   * 搜索技能（按名称和描述）
   */
  searchSkills(query) {
    const q = query.toLowerCase();
    return this.getAllSkills().filter(s => 
      s.id.toLowerCase().includes(q) ||
      s.name.toLowerCase().includes(q) ||
      (s.description && s.description.toLowerCase().includes(q))
    );
  }

  // ========== 3. 工具定义生成 ==========

  /**
   * 生成 DeepSeek function calling 工具定义
   */
  generateToolForSkill(skill) {
    let desc = (skill.description || '') + '\n\n';
    desc += '技能来源: ' + skill.source + '\n';
    desc += '技能路径: ' + skill.dir;
    if (skill.homepage) desc += '\n参考: ' + skill.homepage;
    if (skill.hasSkillJs) desc += '\n(支持直接调用)';
    
    return {
      type: 'function',
      function: {
        name: 'skill_' + skill.id.replace(/[^a-zA-Z0-9_-]/g, '_'),
        description: desc.substring(0, 500),
        parameters: {
          type: 'object',
          properties: {
            task: {
              type: 'string',
              description: '需要该技能执行的具体任务描述'
            }
          },
          required: ['task']
        }
      }
    };
  }

  /**
   * 获取所有技能的工具定义
   */
  getAllSkillTools(forceRefresh) {
    const now = Date.now();
    if (forceRefresh || !this.cachedTools || now - this.cacheTime > this.CACHE_TTL) {
      const skills = this.getAllSkills().filter(s => s.enabled);
      this.cachedTools = skills.map(s => this.generateToolForSkill(s));
      this.cacheTime = now;
    }
    return this.cachedTools;
  }

  // ========== 4. 技能执行 ==========

  /**
   * 执行技能
   * 
   * 优先级：
   *   1. skill.js 有 execute() → 直接调用
   *   2. skill.js 有 handler() → 旧版兼容
   *   3. 仅 SKILL.md → 返回文档内容供 AI 自行处理
   */
  async executeSkill(toolName, args, context) {
    const skillId = toolName.replace(/^skill_/, '');
    const skill = this.skills.get(skillId);
    if (!skill) return { error: `未知技能: ${skillId}` };

    // 尝试加载 skill.js 模块
    const mod = this.skillModules.get(skillId);
    if (mod) {
      try {
        if (typeof mod.execute === 'function') {
          // 标准接口: skill.js 的 execute()
          const result = await mod.execute(args || {}, context || {});
          return { skillId, result };
        } else if (mod._legacyHandler) {
          // 旧式 handler.js: module.exports = async function(args)
          const result = await mod(args || {});
          return { skillId, result };
        } else if (mod._legacy && typeof mod.default === 'function') {
          // 旧式兼容: module.exports = { default: fn }
          return { skillId, result: await mod.default(args, context) };
        }
      } catch(e) {
        return { skillId, error: `执行出错: ${e.message}` };
      }
    }

    // 没有 skill.js，返回 SKILL.md 内容供 AI 自行处理
    try {
      const content = fs.readFileSync(path.join(skill.dir, 'SKILL.md'), 'utf-8');
      return {
        skillId: skill.id,
        skillName: skill.name,
        content: content.substring(0, 8000),
        task: (args && args.task) || '',
        homepage: skill.homepage,
        source: skill.source,
        note: '仅提供参考文档，无执行模块'
      };
    } catch(e) {
      return { error: `读取技能文档失败: ${e.message}` };
    }
  }

  // ========== 5. 技能状态管理 ==========

  /**
   * 启用/禁用技能
   */
  setSkillEnabled(id, enabled) {
    const skill = this.skills.get(id);
    if (!skill) return false;
    if (skill.readOnly) return false; // 不可以禁用内置技能
    skill.enabled = enabled;
    this.cacheTime = 0;
    this.emit('stateChange', { id, enabled });
    return true;
  }

  /**
   * 重新加载技能
   */
  reload() {
    return this.loadSkills();
  }

  // ========== 6. 统计 ==========

  getStats() {
    const skills = this.getAllSkills();
    const bySource = {};
    skills.forEach(s => {
      bySource[s.source] = (bySource[s.source] || 0) + 1;
    });
    return {
      total: skills.length,
      bySource: bySource,
      loadedModules: this.skillModules.size,
      enabled: skills.filter(s => s.enabled).length,
      skillNames: skills.map(s => `${s.emoji} ${s.id} [${s.source}]`).sort(),
      lastReload: new Date().toISOString()
    };
  }

  // ========== 7. 路由注册 ==========

  registerRoutes(registerRoute, parseBody, json) {
    const self = this;

    // 列出所有技能
    registerRoute(['GET'], /^\/api\/skills\/list$/, function(req, res) {
      json(res, { ok: true, skills: self.getAllSkills(), stats: self.getStats() });
    });

    // 搜索技能
    registerRoute(['GET'], /^\/api\/skills\/search\/([^\/]+)$/, function(req, res, m) {
      const q = decodeURIComponent(m[1]);
      json(res, { ok: true, results: self.searchSkills(q) });
    });

    // 获取单个技能详情
    registerRoute(['GET'], /^\/api\/skills\/detail\/([^\/]+)$/, function(req, res, m) {
      const skill = self.getSkill(m[1]);
      if (!skill) return json(res, { ok: false, error: `技能 ${m[1]} 不存在` }, 404);
      try {
        const content = fs.readFileSync(path.join(skill.dir, 'SKILL.md'), 'utf-8');
        json(res, { ok: true, skill, content });
      } catch(e) {
        json(res, { ok: false, error: e.message });
      }
    });

    // 获取所有工具定义（用于注册到 tools-registry）
    registerRoute(['GET'], /^\/api\/skills\/tools$/, function(req, res) {
      json(res, { ok: true, tools: self.getAllSkillTools(true) });
    });

    // 刷新技能缓存
    registerRoute(['POST'], /^\/api\/skills\/reload$/, function(req, res) {
      self.reload();
      json(res, { ok: true, stats: self.getStats() });
    });

    // 启用/禁用
    registerRoute(['POST'], /^\/api\/skills\/toggle$/, function(req, res, _, body) {
      const b = typeof body === 'string' ? JSON.parse(body) : (body || {});
      if (!b.id) return json(res, { ok: false, error: '缺少技能 ID' });
      const ok = self.setSkillEnabled(b.id, b.enabled !== false);
      json(res, { ok, stats: self.getStats() });
    });

    // 统计
    registerRoute(['GET'], /^\/api\/skills\/stats$/, function(req, res) {
      json(res, { ok: true, stats: self.getStats() });
    });
  }
}

// ========== 单例工厂 ==========

var _instance = null;

function getInstance(options) {
  if (!_instance) {
    _instance = new SkillRegistry(options);
    _instance.loadSkills();
  }
  return _instance;
}

module.exports = {
  SkillRegistry,
  getInstance
};
