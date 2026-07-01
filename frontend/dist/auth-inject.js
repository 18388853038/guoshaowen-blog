(function(){
  // Patch fetch
  var _f = window.fetch;
  window.fetch = function(u, o) {
    o = o || {};
    o.headers = o.headers || {};
    var t = localStorage.getItem('token');
    if (t && !o.headers.Authorization && !o.headers.authorization) {
      o.headers.Authorization = 'Bearer ' + t;
    }
    return _f.call(window, u, o);
  };
  // Patch XMLHttpRequest
  var _XHR = window.XMLHttpRequest;
  var _origOpen = _XHR.prototype.open;
  _XHR.prototype.open = function(method, url, async, user, pass) {
    this.__xhrUrl = url;
    this.__xhrMethod = method;
    return _origOpen.call(this, method, url, async !== false, user, pass);
  };
  var _origSend = _XHR.prototype.send;
  _XHR.prototype.send = function(body) {
    var t = localStorage.getItem('token');
    if (t && this.__xhrUrl && this.__xhrUrl.indexOf('/api/') >= 0) {
      this.setRequestHeader('Authorization', 'Bearer ' + t);
    }
    return _origSend.call(this, body);
  };
})();
