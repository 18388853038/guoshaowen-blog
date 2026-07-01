'use strict';

/**
 * modules/credential-vault.js — 加密凭证存储
 * 
 * 集成 key-vault AES-256-GCM 加密，管理敏感凭证
 * 支持：密码、API Key、Token 的加密存储/读取
 */

const fs = require('fs');
const path = require('path');

const BASE = path.resolve(__dirname, '..');

// ===== 加密引擎 =====
let _kv = null;
function _getKV() {
  if (!_kv) {
    try {
      _kv = require('./key-vault');
    } catch(e) {
      console.error('[credential-vault] key-vault 加载失败:', e.message);
      return null;
    }
  }
  return _kv;
}

// ===== 凭证文件路径 =====
function _credsPath() {
  return path.join(BASE, 'data', 'credentials.enc.json');
}

// ===== 读取所有加密凭证 =====
function _readCreds() {
  const cp = _credsPath();
  try {
    if (!fs.existsSync(cp)) return {};
    const raw = JSON.parse(fs.readFileSync(cp, 'utf-8'));
    const kv = _getKV();
    if (!kv) return raw;
    return kv.decryptApiKeys(raw, ['password', 'apiKey', 'token', 'secret']);
  } catch(e) {
    console.error('[credential-vault] 读取凭证失败:', e.message);
    return {};
  }
}

// ===== 写入加密凭证 =====
function _writeCreds(creds) {
  const kv = _getKV();
  let toSave = creds;
  if (kv) {
    toSave = kv.encryptApiKeys(creds, ['password', 'apiKey', 'token', 'secret']);
  }
  try {
    fs.mkdirSync(path.dirname(_credsPath()), { recursive: true });
    fs.writeFileSync(_credsPath(), JSON.stringify(toSave, null, 2), { mode: 0o600 });
    return true;
  } catch(e) {
    console.error('[credential-vault] 写入凭证失败:', e.message);
    return false;
  }
}

// ===== 公开API =====

// 验证管理员密码
function verifyAdminPassword(inputPwd) {
  const creds = _readCreds();
  const stored = creds.adminPassword || process.env.ADMIN_PASSWORD || '';
  if (!stored) {
    // 首次使用：将 ADMIN_PASSWORD 环境变量（或默认）加密存储
    const envPwd = process.env.ADMIN_PASSWORD || '';
    if (envPwd) {
      _writeCreds({ adminPassword: envPwd });
      return inputPwd === envPwd;
    }
    // 完全无配置时，比对默认值（仅首次）
    return inputPwd === 'admin123';
  }
  return inputPwd === stored;
}

// 获取凭证（解密后）
function getCredential(key) {
  const creds = _readCreds();
  if (creds[key] !== undefined) return creds[key];
  // fallback 到环境变量
  const envKey = 'CRED_' + key.toUpperCase().replace(/[^A-Z0-9_]/g, '');
  return process.env[envKey] || '';
}

// 设置凭证
function setCredential(key, value) {
  const creds = _readCreds();
  creds[key] = value;
  return _writeCreds(creds);
}

// 检查是否已初始化（有密码配置）
function isInitialized() {
  const creds = _readCreds();
  if (creds.adminPassword) return true;
  if (process.env.ADMIN_PASSWORD) return true;
  return false;
}

module.exports = {
  verifyAdminPassword,
  getCredential,
  setCredential,
  isInitialized
};
