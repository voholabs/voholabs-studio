export const UPLOAD_WIDGET_URI = 'ui://voholabs/upload';

// The R2 endpoint the browser sends file parts to on presigned URLs. The
// widget's iframe may only reach the hosts its CSP lists, so this one is listed
// next to the backend.
// Presigned URLs name the bucket as a subdomain
// (<bucket>.<account>.r2.cloudflarestorage.com), so that host is the one
// listed; the bare account host is kept for path-style URLs.
export const r2UploadOrigins = () => {
  const account = process.env.CLOUDFLARE_ACCOUNT_ID;
  const bucket = process.env.CLOUDFLARE_BUCKETNAME;
  if (!account) {
    return [];
  }
  return [
    ...(bucket ? [`https://${bucket}.${account}.r2.cloudflarestorage.com`] : []),
    `https://${account}.r2.cloudflarestorage.com`,
  ];
};

// MCP Apps (SEP-1865) widget: one self-contained HTML document the host renders
// in a sandboxed iframe. It can't load our bundles or cookies, so it talks to
// the host over postMessage JSON-RPC and to the backend with a ticket:
// uploadWidgetTool (sessionId) -> uploadWidgetTicketTool (ticket, through the
// host) -> multipart upload: the backend signs each part, the browser PUTs the
// part straight to R2, the backend completes and saves the media -> a media
// that is still being normalised is polled until it is ready -> the media is
// reported back to the model.
// Calls to the backend stay "simple" requests (GET, form-encoded POST) so the
// browser never sends it a CORS preflight; the PUTs to R2 rely on the bucket's
// CORS rule.
export const uploadWidgetHtml = (backendUrl: string) => `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<style>
  :root { color-scheme: light dark; --bg: #ffffff; --fg: #0e0e0e; --muted: #6b6b6b; --border: #d9d9d9; --accent: #20808D; --track: #ececec; --ok: #1a7f37; --bad: #cf222e; }
  @media (prefers-color-scheme: dark) { :root { --bg: #1a1919; --fg: #ffffff; --muted: #9c9c9c; --border: #3a3a3a; --track: #2a2929; --ok: #3fb950; --bad: #f85149; } }
  * { box-sizing: border-box; }
  body { margin: 0; padding: 16px; background: var(--bg); color: var(--fg); font: 14px/1.4 -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; }
  #drop { display: block; border: 2px dashed var(--border); border-radius: 10px; padding: 24px 16px; text-align: center; cursor: pointer; }
  #drop.over { border-color: var(--accent); }
  #drop.disabled { opacity: 0.5; pointer-events: none; }
  #drop strong { display: block; font-weight: 600; }
  #drop small { display: block; color: var(--muted); margin-top: 4px; }
  input[type=file] { display: none; }
  ul { list-style: none; padding: 0; margin: 0; }
  li { padding: 8px 0; }
  li:first-child { margin-top: 12px; }
  .top { display: flex; gap: 8px; align-items: center; }
  .thumb { position: relative; flex: none; width: 40px; height: 40px; border: 1px solid var(--border); border-radius: 6px; overflow: hidden; display: flex; align-items: center; justify-content: center; background: var(--track); color: var(--muted); font-size: 10px; font-weight: 600; }
  .thumb canvas { position: absolute; top: 0; left: 0; width: 100%; height: 100%; }
  .copy { flex: none; border: 1px solid var(--border); border-radius: 6px; padding: 2px 8px; background: transparent; color: var(--fg); font: inherit; font-size: 12px; cursor: pointer; }
  .name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .state { color: var(--muted); font-variant-numeric: tabular-nums; }
  li.ok .state { color: var(--ok); }
  li.bad .state { color: var(--bad); white-space: normal; }
  .bar { height: 4px; border-radius: 2px; background: var(--track); margin-top: 6px; overflow: hidden; }
  .bar span { display: block; height: 100%; width: 0; background: var(--accent); transition: width 0.2s; }
  li.ok .bar, li.bad .bar { display: none; }
  #error { color: var(--bad); margin-top: 12px; }
  #error:empty { display: none; }
</style>
</head>
<body>
  <label id="drop" class="disabled">
    <strong>Choose photos or videos, or drop them here</strong>
    <small>Images up to 10 MB, MP4 or MOV videos up to 1 GB</small>
    <input id="file" type="file" accept="image/jpeg,image/png,image/gif,image/webp,image/avif,image/bmp,image/tiff,video/mp4,video/quicktime,.mov" multiple />
  </label>
  <ul id="files"></ul>
  <div id="error"></div>
<script>
(function () {
  var BACKEND = ${JSON.stringify(backendUrl).replace(/</g, '\\u003c')};
  var PART = 8 * 1024 * 1024;
  var PARALLEL = 3;
  var IMAGE_MAX = 10 * 1024 * 1024;
  var VIDEO_MAX = 1024 * 1024 * 1024;
  var IMAGE_EXT = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'avif', 'bmp', 'tif', 'tiff'];
  var nextId = 1;
  var pending = {};
  var sessionId = null;
  var ticket = null;
  var uploaded = [];
  var busy = false;

  function send(message) { window.parent.postMessage(Object.assign({ jsonrpc: '2.0' }, message), '*'); }
  function request(method, params) {
    return new Promise(function (resolve, reject) {
      var id = nextId++;
      pending[id] = { resolve: resolve, reject: reject };
      send({ id: id, method: method, params: params });
    });
  }
  function notify(method, params) { send({ method: method, params: params }); }
  function resize() { notify('ui/notifications/size-changed', { height: document.body.offsetHeight }); }
  function wait(ms) { return new Promise(function (resolve) { setTimeout(resolve, ms); }); }

  var drop = document.getElementById('drop');
  var list = document.getElementById('files');
  var error = document.getElementById('error');
  function fail(message) { error.textContent = message; resize(); }

  function start(result) {
    var content = (result && result.structuredContent) || {};
    if (!content.sessionId) {
      fail(content.error || 'The upload box could not be opened.');
      return;
    }
    sessionId = content.sessionId;
    drop.className = '';
  }

  window.addEventListener('message', function (event) {
    var data = event.data;
    if (event.source !== window.parent || !data || data.jsonrpc !== '2.0') return;
    if (data.id !== undefined && !data.method) {
      var waiting = pending[data.id];
      if (!waiting) return;
      delete pending[data.id];
      if (data.error) waiting.reject(new Error(data.error.message || 'The app rejected the request'));
      else waiting.resolve(data.result);
      return;
    }
    if (data.method === 'ui/notifications/tool-result') start(data.params);
    // Requests from the host (ui/resource-teardown, ping) need an answer
    if (data.id !== undefined && data.method) send({ id: data.id, result: {} });
  });

  function getTicket() {
    if (ticket) return Promise.resolve(ticket);
    return request('tools/call', { name: 'uploadWidgetTicketTool', arguments: { sessionId: sessionId } }).then(function (result) {
      var content = (result && result.structuredContent) || {};
      if (!content.ticket) throw new Error(content.error || 'Could not get an upload ticket');
      ticket = content.ticket;
      return ticket;
    });
  }

  // One step of the multipart upload on the backend. The body is one
  // form-encoded field, which keeps it a simple request (no preflight).
  function step(name, payload) {
    return getTicket().then(function (t) {
      return fetch(BACKEND + '/media-widget/r2/' + name + '?ticket=' + encodeURIComponent(t), {
        method: 'POST',
        body: new URLSearchParams({ payload: JSON.stringify(payload) }),
      });
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (body) {
        if (res.status === 401) { ticket = null; }
        if (!res.ok) throw new Error(body.message || 'Upload failed (' + res.status + ')');
        return body;
      });
    });
  }

  // Videos and images may be normalised after the upload: poll until they are
  // usable. A backend without the status endpoint answers 404, and the media
  // is then taken as it is.
  function waitUntilReady(media, deadline) {
    if (!media || media.status !== 'processing') return Promise.resolve(media);
    deadline = deadline || Date.now() + 15 * 60 * 1000;
    if (Date.now() > deadline) return Promise.reject(new Error('Processing is taking too long, check the media library later'));
    return wait(3000)
      .then(getTicket)
      .then(function (t) { return fetch(BACKEND + '/media-widget/status?ticket=' + encodeURIComponent(t)).catch(function () { return null; }); })
      .then(function (res) {
        if (!res) return waitUntilReady(media, deadline);
        // the ticket is short lived and a long video can outlive it
        if (res.status === 401) { ticket = null; return waitUntilReady(media, deadline); }
        if (res.status === 404) return media;
        if (!res.ok) throw new Error('Processing check failed (' + res.status + ')');
        return res.json().then(function (all) {
          var current = (all || []).filter(function (p) { return p.id === media.id; })[0] || media;
          return waitUntilReady(current, deadline);
        });
      });
  }

  // The sandbox CSP blocks blob: urls and the uploads domain, so the preview is
  // decoded from the picked file and drawn on a canvas, no image url involved.
  // Anything that can't be decoded that way (videos) keeps the extension label
  function preview(file, box, label) {
    if (file.type.indexOf('image/') !== 0 || !window.createImageBitmap) return;
    window.createImageBitmap(file).then(function (bitmap) {
      var canvas = document.createElement('canvas');
      var side = Math.min(bitmap.width, bitmap.height);
      canvas.width = canvas.height = 80;
      canvas.getContext('2d').drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, 80, 80);
      if (bitmap.close) bitmap.close();
      box.replaceChild(canvas, label);
    }).catch(function () {});
  }

  // navigator.clipboard needs the host to grant clipboard-write to the iframe
  // (requested in the resource permissions); execCommand still works on a
  // click where it doesn't
  function copyText(text) {
    var legacy = function () {
      var area = document.createElement('textarea');
      area.value = text;
      area.style.position = 'fixed';
      area.style.opacity = '0';
      document.body.appendChild(area);
      area.select();
      var ok = document.execCommand('copy');
      document.body.removeChild(area);
      return ok ? Promise.resolve() : Promise.reject(new Error('copy'));
    };
    if (!navigator.clipboard || !navigator.clipboard.writeText) return legacy();
    return navigator.clipboard.writeText(text).catch(legacy);
  }

  // PUT one part straight to the bucket, reporting bytes sent.
  function putPart(url, blob, onProgress) {
    return new Promise(function (resolve, reject) {
      var xhr = new XMLHttpRequest();
      xhr.open('PUT', url);
      xhr.upload.onprogress = function (e) { if (e.lengthComputable) onProgress(e.loaded); };
      xhr.onload = function () {
        var etag = xhr.getResponseHeader('ETag');
        if (xhr.status >= 200 && xhr.status < 300 && etag) resolve(etag);
        else if (xhr.status >= 200 && xhr.status < 300) reject(new Error('Storage did not confirm the upload. Check the storage CORS settings.'));
        else reject(new Error('Storage refused part (' + xhr.status + ')'));
      };
      xhr.onerror = function () { reject(new Error('Network error while uploading')); };
      xhr.send(blob);
    });
  }

  function uploadPart(file, key, uploadId, number, onProgress, attempt) {
    var blob = file.slice((number - 1) * PART, Math.min(number * PART, file.size));
    return step('sign-part', { key: key, uploadId: uploadId, partNumber: number })
      .then(function (signed) { return putPart(signed.url, blob, onProgress); })
      .then(function (etag) { return { PartNumber: number, ETag: etag }; })
      .catch(function (err) {
        attempt = attempt || 1;
        if (attempt >= 4) throw err;
        onProgress(0);
        return wait(1000 * attempt).then(function () { return uploadPart(file, key, uploadId, number, onProgress, attempt + 1); });
      });
  }

  function uploadFile(file, set) {
    var meta = { name: file.name, size: file.size, type: file.type };
    return step('create-multipart-upload', { file: meta, contentType: file.type, fileHash: '' }).then(function (created) {
      var key = created.key;
      var uploadId = created.uploadId;
      // The backend signs each part for its exact size, so use its part size.
      if (created.partSize) PART = created.partSize;
      var count = Math.max(1, Math.ceil(file.size / PART));
      var sent = {};
      var parts = [];
      var next = 1;
      function progress() {
        var total = 0;
        for (var k in sent) total += sent[k];
        set('', Math.min(99, Math.floor((total / Math.max(1, file.size)) * 100)) + '%', total / Math.max(1, file.size));
      }
      function worker() {
        if (next > count) return Promise.resolve();
        var number = next++;
        return uploadPart(file, key, uploadId, number, function (bytes) { sent[number] = bytes; progress(); })
          .then(function (part) { parts.push(part); return worker(); });
      }
      var workers = [];
      for (var i = 0; i < Math.min(PARALLEL, count); i++) workers.push(worker());
      return Promise.all(workers)
        .then(function () {
          set('', 'Saving…', 1);
          parts.sort(function (a, b) { return a.PartNumber - b.PartNumber; });
          return step('complete-multipart-upload', { key: key, uploadId: uploadId, parts: parts, file: meta });
        })
        .catch(function (err) {
          step('abort-multipart-upload', { key: key, uploadId: uploadId }).catch(function () {});
          throw err;
        });
    });
  }

  function check(file) {
    var ext = (file.name.split('.').pop() || '').toLowerCase();
    if (ext === 'mp4' || ext === 'mov') return file.size > VIDEO_MAX ? 'Videos can be up to 1 GB' : '';
    if (IMAGE_EXT.indexOf(ext) > -1) return file.size > IMAGE_MAX ? 'Images can be up to 10 MB' : '';
    if (ext === 'm4v' || ext === 'webm') return 'Videos must be MP4 or MOV. Export as MP4 and try again';
    return 'Only images and MP4 or MOV videos can be uploaded';
  }

  function row(file) {
    var li = document.createElement('li');
    li.innerHTML = '<div class="top"><span class="thumb"><span class="label"></span></span><span class="name"></span><span class="state"></span></div><div class="bar"><span></span></div>';
    li.querySelector('.name').textContent = file.name;
    li.querySelector('.name').title = file.name;
    var label = li.querySelector('.label');
    label.textContent = (file.name.split('.').pop() || 'file').slice(0, 4).toUpperCase();
    preview(file, li.querySelector('.thumb'), label);
    list.appendChild(li);
    var top = li.querySelector('.top');
    var state = li.querySelector('.state');
    var bar = li.querySelector('.bar span');
    return function (kind, text, fraction, path) {
      li.className = kind;
      state.textContent = text;
      if (fraction !== undefined) bar.style.width = Math.floor(fraction * 100) + '%';
      if (path) {
        var copy = document.createElement('button');
        copy.type = 'button';
        copy.className = 'copy';
        copy.textContent = 'Copy link';
        copy.addEventListener('click', function () {
          copyText(path).then(
            function () { copy.textContent = 'Copied'; },
            function () { copy.textContent = 'Copy failed'; }
          ).then(function () { setTimeout(function () { copy.textContent = 'Copy link'; }, 1500); });
        });
        top.appendChild(copy);
      }
      resize();
    };
  }

  // Always the full list of this upload box, not only the last batch: the
  // model acts on the latest message, so a later upload must not drop the
  // earlier ones
  function report() {
    var summary = uploaded.map(function (p) { return p.name + ' (id: ' + p.id + ', path: ' + p.path + ')'; }).join(', ');
    // Silent context first, so the model has the ids even if the host defers
    // the message. A host that never answers it must not hold the message back.
    return Promise.race([
      request('ui/update-model-context', {
        structuredContent: { sessionId: sessionId, media: uploaded },
        content: [{ type: 'text', text: 'Media uploaded with the upload box: ' + summary }],
      }),
      wait(5000),
    ])
      .catch(function () {})
      .then(function () {
        return request('ui/message', {
          role: 'user',
          content: [{ type: 'text', text: 'I uploaded ' + summary + ' to Voholabs Studio.' }],
        });
      })
      .catch(function () {});
  }

  function handle(files) {
    if (busy || !sessionId || !files.length) return;
    busy = true;
    drop.className = 'disabled';
    fail('');
    var done = [];
    files.reduce(function (chain, file) {
      var set = row(file);
      return chain.then(function () {
        var problem = check(file);
        if (problem) { set('bad', problem); return; }
        set('', 'Starting…', 0);
        return uploadFile(file, set)
          .then(function (media) {
            if (media && media.status === 'processing') set('', 'Processing…', 1);
            return waitUntilReady(media);
          })
          .then(function (media) {
            if (media.status === 'failed') throw new Error(media.processingError || 'Processing failed');
            var item = { id: media.id, path: media.path, name: media.originalName || media.name || file.name };
            uploaded.push(item);
            done.push(item);
            set('ok', 'Uploaded', undefined, media.path);
          })
          .catch(function (err) { set('bad', err.message || 'Upload failed'); });
      });
    }, Promise.resolve())
      .then(function () {
        busy = false;
        drop.className = '';
        if (done.length) report();
      });
  }

  document.getElementById('file').addEventListener('change', function (e) {
    handle(Array.prototype.slice.call(e.target.files || []));
    e.target.value = '';
  });
  ['dragenter', 'dragover'].forEach(function (name) {
    drop.addEventListener(name, function (e) { e.preventDefault(); if (!busy && sessionId) drop.className = 'over'; });
  });
  drop.addEventListener('dragleave', function (e) { e.preventDefault(); if (!busy && sessionId) drop.className = ''; });
  drop.addEventListener('drop', function (e) {
    e.preventDefault();
    if (!busy && sessionId) drop.className = '';
    handle(Array.prototype.slice.call((e.dataTransfer && e.dataTransfer.files) || []));
  });
  ['dragover', 'drop'].forEach(function (name) {
    document.addEventListener(name, function (e) { e.preventDefault(); });
  });

  request('ui/initialize', {
    appInfo: { name: 'voholabs-upload', version: '1.0.0' },
    appCapabilities: {},
    protocolVersion: '2026-01-26',
  }).then(
    function () { notify('ui/notifications/initialized', {}); resize(); },
    function () { fail('This app cannot show the upload box.'); }
  );
})();
</script>
</body>
</html>`;
