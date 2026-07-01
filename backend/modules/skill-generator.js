/**
 * skill-generator.js — 技能生成引擎
 * 
 * 通过 AI 根据用户自然语言描述，自动生成完整的 SKILL.md
 * 
 * API: POST /api/skills/generate
 *   body: { name: "skill-name", description: "用户用自然语言描述需求", type?: "basic|code-review|tool|api" }
 *   response: { ok: true, skill: { name, path, content } }
 */

const fs = require('fs');
const path = require('path');

const SKILLS_DIR = path.join(__dirname, '..', 'skills');

/**
 * 用 AI 生成技能内容
 * 通过调用 ai-engine.js 的 aiChat 完成
 */
async function generateSkillContent(name, description, type) {
  const aiEngine = require('./ai-engine');
  
  var typeGuide = '';
  switch (type) {
    case 'code-review':
      typeGuide = '这是一个代码审查类技能，需要包含审查流程、问题分级标准。';
      break;
    case 'tool':
      typeGuide = '这是一个工具调用类技能，需要包含 API 端点定义和调用流程。';
      break;
    case 'api':
      typeGuide = '这是一个外部 API 集成类技能，需要包含 API 信息、认证方式和数据流。';
      break;
    default:
      typeGuide = '这是一个通用技能，需要清晰描述使用场景和执行步骤。';
  }

  // 使用 aiChat 生成
  var response = await aiEngine.aiChat([
    { role: 'system', content: '你是 eCompany 技能系统生成器。根据用户需求生成一个完整的 SKILL.md 内容。只返回 SKILL.md 内容，不要解释。SKILL.md 格式必须是标准的 frontmatter + markdown 格式。' },
    { role: 'user', content: `生成一个名为 "${name}" 的技能。${typeGuide}\n\n用户需求描述：${description}\n\n生成完整的 SKILL.md 内容，包括 frontmatter (name, description, emoji, user-invocable) 和 markdown 指令。` }
  ], {
    provider: 'deepseek',
    model: 'deepseek-chat',
    temperature: 0.3,
    maxTokens: 3000,
    timeout: 45000
  });

  var content = response.choices?.[0]?.message?.content || '';
  
  // 清理可能的多余标记
  content = content.replace(/^```(?:markdown)?\n?/i, '').replace(/\n?```\s*$/i, '');
  
  // 确保有 frontmatter
  if (!content.startsWith('---')) {
    content = `---
name: ${name}
description: ${description}
emoji: ⚡
user-invocable: true
---

${content}
`;
  }

  return content;
}

/**
 * 用本地模板生成（不调用 AI，纯模板填充）
 */
function generateFromTemplate(name, description, type) {
  if (!type) type = 'basic';
  
  var templatePath = path.join(__dirname, '..', 'skill-scaffold-cli.js');
  if (!fs.existsSync(templatePath)) {
    throw new Error('模板引擎文件不存在');
  }
  
  // 重新定义模板——直接复制 scaffold 中的逻辑
  const TEMPLATES = {
    basic: function(n, d) { return `---
name: ${n}
description: ${d || '通用技能'}
emoji: 📋
user-invocable: true
---

## 技能描述

${d || ''}

## 使用方式

当用户触发此技能时，按以下步骤执行：

1. 理解用户需求
2. 根据需求执行对应操作
3. 返回处理结果

## 注意事项

- 确保输出清晰、结构化
`; },
    'code-review': function(n, d) { return `---
name: ${n}
description: ${d || '代码审查'}
emoji: 🔍
user-invocable: true
metadata: {"category":"code"}
---

## 技能描述

${d || ''}

## 审查流程

1. 逐行阅读代码，关注：逻辑错误、安全漏洞、性能问题
2. 检查是否符合最佳实践
3. 提供具体改进建议和代码示例
4. 按严重程度标注：🔴 严重 / 🟡 中等 / 🔵 轻微
`; },
    tool: function(n, d) { return `---
name: ${n}
description: ${d || '工具类技能'}
emoji: 🔧
user-invocable: true
metadata: {"category":"tool"}
---

## 技能描述

${d || ''}

## 流程

1. 解析用户意图
2. 调用系统功能
3. 返回处理结果
`; },
    api: function(n, d) { return `---
name: ${n}
description: ${d || 'API 集成'}
emoji: 🔗
user-invocable: true
metadata: {"category":"integration"}
---

## 技能描述

${d || ''}

## 流程

1. 获取参数
2. 调用外部 API
3. 呈现结果
`; }
  };
  
  var tpl = TEMPLATES[type] || TEMPLATES.basic;
  return tpl(name, description || '');
}

/**
 * 保存技能到文件并热加载
 */
function saveSkill(name, content) {
  var skillDir = path.join(SKILLS_DIR, name);
  var skillFile = path.join(skillDir, 'SKILL.md');
  
  if (!fs.existsSync(skillDir)) fs.mkdirSync(skillDir, { recursive: true });
  fs.writeFileSync(skillFile, content, 'utf-8');
  
  // 热加载：通知 skills 模块重新加载
  try {
    var skillsModule = require('./skills');
    skillsModule.skillSystem.loadAll();
  } catch(e) {
    // 静默失败
  }
  
  return { name: name, file: skillFile, bytes: content.length };
}

/**
 * AI 生成 + 保存
 */
async function generateAndSave(name, description, type) {
  var content;
  try {
    // 优先用 AI 生成
    content = await generateSkillContent(name, description, type);
  } catch(e) {
    // AI 失败则回退到本地模板
    console.log('[SkillGen] AI 生成失败，回退到模板: ' + e.message);
    content = generateFromTemplate(name, description, type);
  }
  
  return saveSkill(name, content);
}

/**
 * 路由处理器
 */
async function handleGenerate(req, res, json) {
  var body;
  try {
    body = JSON.parse(await new Promise(function(r) { 
      var d = ''; req.on('data', function(c) { d += c; }); req.on('end', function() { r(d); }); 
    }));
  } catch(e) {
    json(res, { ok: false, error: '请求体解析失败' });
    return;
  }
  
  var name = body.name;
  var desc = body.description || body.desc || '';
  var type = body.type || 'basic';
  
  if (!name || !/^[a-z0-9_-]+$/i.test(name)) {
    json(res, { ok: false, error: '技能名称只能包含字母、数字、下划线和连字符' });
    return;
  }
  
  var existingPath = path.join(SKILLS_DIR, name, 'SKILL.md');
  if (fs.existsSync(existingPath)) {
    json(res, { ok: false, error: '技能 "' + name + '" 已存在' });
    return;
  }
  
  try {
    var result = await generateAndSave(name, desc, type);
    json(res, { ok: true, data: result });
  } catch(e) {
    json(res, { ok: false, error: e.message });
  }
}

module.exports = {
  generateSkillContent,
  generateFromTemplate,
  saveSkill,
  generateAndSave,
  handleGenerate
};
