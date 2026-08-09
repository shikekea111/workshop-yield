// 通用 UI 组件：toast / modal / sheet / confirm
window.UI = (function () {
  'use strict';
  var root = function () { return document.getElementById('modalRoot'); };

  function toast(msg, isErr) {
    var t = document.createElement('div');
    t.className = 'toast' + (isErr ? ' err' : '');
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(function () { t.remove(); }, 2200);
  }

  function close() { root().innerHTML = ''; }

  // 通用弹层；center=true 为居中对话框，否则为底部上滑 sheet
  function modal(title, bodyHtml, opts) {
    opts = opts || {};
    var center = !!opts.center;
    var m = document.createElement('div');
    m.className = 'modal-mask' + (center ? ' center' : '');
    m.innerHTML =
      '<div class="modal' + (center ? ' center' : '') + '">' +
        '<h2>' + title + '</h2>' +
        '<div class="modal-body">' + bodyHtml + '</div>' +
        (opts.hideActions ? '' :
          '<div class="modal-actions">' +
            '<button class="btn ghost" data-act="cancel">取消</button>' +
            (opts.okText ? '<button class="btn" data-act="ok">' + opts.okText + '</button>' : '') +
          '</div>') +
      '</div>';
    m.addEventListener('click', function (e) {
      if (e.target === m && !opts.noMaskClose) close();
      var act = e.target.getAttribute && e.target.getAttribute('data-act');
      if (act === 'cancel') close();
      if (act === 'ok' && opts.onOk) opts.onOk();
    });
    root().innerHTML = '';
    root().appendChild(m);
    if (opts.onReady) opts.onReady(m.querySelector('.modal-body'), close);
    return { el: m, close: close, body: m.querySelector('.modal-body') };
  }

  // 底部 sheet（常用于选择列表）
  function sheet(title, bodyHtml, onReady) { return modal(title, bodyHtml, { onReady: onReady }); }

  function confirm(msg, okText) {
    return new Promise(function (res) {
      var m = modal('请确认', '<p>' + msg + '</p>', {
        center: true, okText: okText || '确定',
        onOk: function () { close(); res(true); }
      });
      // 取消按钮 / 点遮罩 都视为否定
      var mask = m.el;
      if (mask) {
        mask.addEventListener('click', function (e) {
          var act = e.target.getAttribute && e.target.getAttribute('data-act');
          if (act === 'cancel' || e.target === mask) { close(); res(false); }
        });
      }
    });
  }

  return { toast: toast, modal: modal, sheet: sheet, confirm: confirm, close: close };
})();
