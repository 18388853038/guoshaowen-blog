// 路径操作缓存模块
// 用于缓存 list_directory 等操作的结果，避免短时间内重复查询

const cache = new Map();
const CACHE_TTL = 5 * 60 * 1000; // 5分钟缓存

function getCacheKey(funcName, args) {
  return funcName + ':' + JSON.stringify(args);
}

function getFromCache(funcName, args) {
  const key = getCacheKey(funcName, args);
  const cached = cache.get(key);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    console.log('[Cache] 命中缓存:', key);
    return cached.result;
  }
  return null;
}

function setToCache(funcName, args, result) {
  const key = getCacheKey(funcName, args);
  cache.set(key, {
    result: result,
    timestamp: Date.now()
  });
  console.log('[Cache] 已缓存:', key);
  
  // 清理过期缓存
  if (cache.size > 100) {
    const now = Date.now();
    for (const [k, v] of cache.entries()) {
      if (now - v.timestamp > CACHE_TTL) {
        cache.delete(k);
      }
    }
  }
}

module.exports = {
  getFromCache,
  setToCache,
  CACHE_TTL
};
