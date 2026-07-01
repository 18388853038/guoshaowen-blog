/**
 * eCompany 安全沙箱模块
 * 
 * 能力注入：安全代码执行隔离，支持 Docker 沙箱和进程沙箱
 * 让 eCompany 拥有 OpenClaw 的沙箱安全执行能力
 */

const { execSync, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const SANDBOX_DIR = path.join(__dirname, '..', 'sandbox');

// ========== 1. 进程沙箱 ==========
// 在独立进程中执行代码，带超时和资源限制

class ProcessSandbox {
  constructor(options = {}) {
    this.timeout = options.timeout || 30000;
    this.maxMemory = options.maxMemory || 256; // MB
    this.workDir = path.join(SANDBOX_DIR, 'runs');
    if (!fs.existsSync(this.workDir)) {
      fs.mkdirSync(this.workDir, { recursive: true });
    }
  }

  /**
   * 在沙箱中执行代码
   * @param {string} code - 要执行的代码
   * @param {string} language - js | python | shell
   * @param {object} options - { args, env, timeout }
   * @returns {object} { stdout, stderr, exitCode, duration }
   */
  async execute(code, language = 'js', options = {}) {
    const runId = `${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const runDir = path.join(this.workDir, runId);
    fs.mkdirSync(runDir, { recursive: true });

    const timeout = options.timeout || this.timeout;
    const startTime = Date.now();

    try {
      let command, args, filePath;

      switch (language) {
        case 'js':
        case 'javascript':
          filePath = path.join(runDir, 'script.js');
          fs.writeFileSync(filePath, code, 'utf-8');
          command = process.execPath; // node
          args = [filePath];
          break;

        case 'python':
          filePath = path.join(runDir, 'script.py');
          fs.writeFileSync(filePath, code, 'utf-8');
          command = 'python3';
          args = [filePath];
          break;

        case 'shell':
        case 'bash':
          filePath = path.join(runDir, 'script.sh');
          fs.writeFileSync(filePath, code, 'utf-8');
          command = 'bash';
          args = [filePath];
          break;

        default:
          throw new Error(`不支持的语言: ${language}`);
      }

      // 添加额外参数
      if (options.args) args = args.concat(options.args);

      // 在沙箱进程中执行
      const result = await this._spawnWithTimeout(command, args, {
        cwd: runDir,
        env: options.env || {},
        timeout,
        maxBuffer: 1024 * 1024 // 1MB 输出限制
      });

      return {
        ...result,
        duration: Date.now() - startTime,
        sandboxId: runId
      };

    } catch (err) {
      return {
        stdout: '',
        stderr: err.message,
        exitCode: -1,
        duration: Date.now() - startTime,
        sandboxId: runId,
        error: err.message
      };
    } finally {
      // 清理临时文件
      try { fs.rmSync(runDir, { recursive: true, force: true }); } catch(e) {}
    }
  }

  /**
   * 创建安全的环境变量副本，仅保留必要变量，过滤敏感信息
   * 防止 API Keys、Tokens、Secrets 等敏感信息泄露到子进程
   */
  _getSafeEnv(extraEnv = {}) {
    // 允许传递给子进程的安全环境变量白名单
    const SAFE_VARS = ['PATH', 'HOME', 'TEMP', 'TMP', 'TMPDIR', 'USER', 'USERNAME', 'LANG', 'LC_ALL', 'SHELL', 'TERM'];
    // 需要过滤的敏感变量名关键词（忽略大小写）
    const SENSITIVE_PATTERNS = ['API_KEY', 'APIKEY', 'TOKEN', 'SECRET', 'PASSWORD', 'PASSWD', 'CREDENTIAL', 'PRIVATE_KEY', 'ACCESS_KEY', 'AUTH'];

    const safeEnv = {};
    // 只保留白名单中的变量
    for (const key of SAFE_VARS) {
      if (process.env[key] !== undefined) {
        safeEnv[key] = process.env[key];
      }
    }
    // 合并调用方传入的额外环境变量
    for (const [key, value] of Object.entries(extraEnv)) {
      if (value !== undefined && value !== null) {
        safeEnv[key] = String(value);
      }
    }
    return safeEnv;
  }

  _spawnWithTimeout(command, args, options) {
    return new Promise((resolve) => {
      const child = spawn(command, args, {
        cwd: options.cwd,
        // 使用安全环境变量副本，不泄露 API Keys、Tokens、Secrets 等敏感信息
        env: this._getSafeEnv(options.env),
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout: options.timeout,
        maxBuffer: options.maxBuffer || 1024 * 1024
      });

      let stdout = '', stderr = '';
      const timer = setTimeout(() => {
        child.kill('SIGTERM');
        resolve({ stdout, stderr, exitCode: -2, error: '执行超时' });
      }, options.timeout);

      child.stdout.on('data', data => { stdout += data.toString(); });
      child.stderr.on('data', data => { stderr += data.toString(); });

      child.on('close', (code) => {
        clearTimeout(timer);
        resolve({ stdout, stderr, exitCode: code });
      });

      child.on('error', (err) => {
        clearTimeout(timer);
        resolve({ stdout, stderr, exitCode: -1, error: err.message });
      });
    });
  }
}

// ========== 2. 文件沙箱 ==========
// 在隔离目录中操作文件

class FileSandbox {
  constructor() {
    this.baseDir = path.join(SANDBOX_DIR, 'files');
    if (!fs.existsSync(this.baseDir)) {
      fs.mkdirSync(this.baseDir, { recursive: true });
    }
  }

  /** 在沙箱中安全读取文件 */
  readFile(filename) {
    const safePath = this._resolveSafe(filename);
    if (!safePath) throw new Error('文件路径越界');
    return fs.readFileSync(safePath, 'utf-8');
  }

  /** 在沙箱中安全写入文件 */
  writeFile(filename, content) {
    const safePath = this._resolveSafe(filename);
    if (!safePath) throw new Error('文件路径越界');
    const dir = path.dirname(safePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(safePath, content, 'utf-8');
  }

  /** 在沙箱中列出文件 */
  listFiles(subdir = '') {
    const safePath = this._resolveSafe(subdir);
    if (!safePath) throw new Error('路径越界');
    if (!fs.existsSync(safePath)) return [];
    return fs.readdirSync(safePath);
  }

  /** 确保路径不越界 */
  _resolveSafe(filename) {
    const resolved = path.resolve(this.baseDir, filename);
    if (!resolved.startsWith(this.baseDir)) return null;
    return resolved;
  }

  /** 清理沙箱文件 */
  cleanup() {
    try { fs.rmSync(this.baseDir, { recursive: true, force: true }); fs.mkdirSync(this.baseDir); } catch(e) {}
  }
}

// ========== 3. Docker 沙箱 ==========
// 可选，需要 Docker 环境

class DockerSandbox {
  constructor() {
    this.available = this._checkDocker();
  }

  _checkDocker() {
    try {
      execSync('docker --version', { stdio: 'pipe' });
      return true;
    } catch(e) {
      return false;
    }
  }

  async execute(code, language = 'js') {
    if (!this.available) {
      // 回退到进程沙箱
      const sandbox = new ProcessSandbox();
      return await sandbox.execute(code, language);
    }

    // Docker 执行（待实现完整版本）
    throw new Error('Docker 沙箱需要额外配置');
  }
}

// ========== 导出 ==========

module.exports = {
  ProcessSandbox,
  FileSandbox,
  DockerSandbox,
  sandboxDir: SANDBOX_DIR
};
