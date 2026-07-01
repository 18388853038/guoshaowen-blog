const fs = require('fs');
const path = require('path');
const https = require('https');

const ILINK_BASE = 'https://ilinkai.weixin.qq.com';
const ACCOUNTS_DIR = path.join(process.env.USERPROFILE, '.openclaw', 'openclaw-weixin', 'accounts');

function httpsGet(urlPath) {
  return new Promise((resolve, reject) => {
    https.get(ILINK_BASE + urlPath, {
      timeout: 20000,
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36', 'Accept': 'application/json' }
    }, res => {
      let d = ''; res.on('data', c => d += c);
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch(e) { resolve({}); } });
    }).on('error', reject);
  });
}

module.exports = {
  async generateQR() {
    try {
      const r = await httpsGet('/ilink/bot/get_bot_qrcode?bot_type=3');
      if (r && r.qrcode) {
        var wxUrl = r.qrcode_img_content || '';
        return { ok: true, qrcode: r.qrcode, wxUrl: wxUrl, qrcodeUrl: r.qrcode_img_content || '' };
      }
      return { ok: false, error: '获取二维码失败: ' + JSON.stringify(r).substring(0, 100) };
    } catch(e) {
      return { ok: false, error: e.message };
    }
  },

  async pollQRStatus(qrcode, timeout = 300000) {
    const start = Date.now();
    let lastStatus = '';
    while (Date.now() - start < timeout) {
      try {
        const r = await httpsGet('/ilink/bot/get_qrcode_status?qrcode=' + encodeURIComponent(qrcode));
        const status = r.status || '';
        if (status !== lastStatus) {
          console.log('[wx-qrcode] 状态变化:', status);
          lastStatus = status;
        }
        if (status === 'confirmed' && r.bot_token) {
          // 保存账户（自动覆盖旧账户）
          try {
            // 1. 清空所有旧账户
            var listPath = path.join(ACCOUNTS_DIR, '..', 'accounts.json');
            var oldList = [];
            try { oldList = JSON.parse(fs.readFileSync(listPath, 'utf8')); } catch(e) {}
            oldList.forEach(function(id) {
              try { fs.unlinkSync(path.join(ACCOUNTS_DIR, id + '.json')); } catch(e) {}
              try { fs.unlinkSync(path.join(ACCOUNTS_DIR, id + '.sync.json')); } catch(e) {}
              try { fs.unlinkSync(path.join(ACCOUNTS_DIR, id + '.context-tokens.json')); } catch(e) {}
            });
            // 2. 保存新账户
            if (!fs.existsSync(ACCOUNTS_DIR)) fs.mkdirSync(ACCOUNTS_DIR, { recursive: true });
            const token = r.bot_token;
            const id = token.substring(0, 12) + '-im-bot';
            fs.writeFileSync(path.join(ACCOUNTS_DIR, id + '.json'), JSON.stringify({
              token, savedAt: new Date().toISOString(),
              baseUrl: ILINK_BASE,
              userId: r.openid || r.userId || ''
            }), 'utf8');
            // 3. 更新列表（只有新账户）
            fs.writeFileSync(listPath, JSON.stringify([id], null, 2), 'utf8');
          } catch(e) { console.log('[wx-qrcode] 保存失败:', e.message); }
          return { ok: true, status: 'bound', userId: r.openid || r.userId || '' };
        }
        if (status === 'expired' || status === 'canceled') {
          return { ok: false, status: status, error: status === 'expired' ? '二维码已过期' : '扫码已取消' };
        }
      } catch(e) {}
      await new Promise(r => setTimeout(r, 1500));
    }
    return { ok: false, status: 'timeout', error: '扫码超时' };
  },

  isBound() {
    try {
      if (!fs.existsSync(ACCOUNTS_DIR)) return false;
      var listPath = path.join(ACCOUNTS_DIR, '..', 'accounts.json');
      if (!fs.existsSync(listPath)) return false;
      return JSON.parse(fs.readFileSync(listPath, 'utf8')).length > 0;
    } catch(e) { return false; }
  },

  getBoundUser() {
    try {
      if (!this.isBound()) return null;
      var listPath = path.join(ACCOUNTS_DIR, '..', 'accounts.json');
      var accounts = JSON.parse(fs.readFileSync(listPath, 'utf8'));
      if (accounts.length === 0) return null;
      var f = path.join(ACCOUNTS_DIR, accounts[0] + '.json');
      return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : null;
    } catch(e) { return null; }
  }
};
