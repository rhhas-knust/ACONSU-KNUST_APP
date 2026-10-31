// The script of meet.html, moved out of the page so the browser
// can refuse any script written into a page (lib/securityHeaders.js).
(async function () {
  await initLayout('/meet.html');

  var grid = document.getElementById('roomGrid');
  var callEl = document.getElementById('call');
  var tilesEl = document.getElementById('tiles');
  var statusEl = document.getElementById('callStatus');

  var ICE = [{ urls: ['stun:stun.l.google.com:19302'] }];
  var hasTurn = false;
  var CAPACITY = 4;

  // call state
  var stream = null, source = null, myPeerId = null, roomId = null;
  var peers = {};   // peerId -> { pc, name, tile }

  function tile(id, name, isMe) {
    var d = document.createElement('div');
    d.className = 'tile';
    d.id = 'tile-' + id;
    d.innerHTML = '<div class="initial">' + escapeHtml((name || '?').charAt(0)) + '</div>'
      + '<video autoplay playsinline' + (isMe ? ' muted' : '') + ' hidden></video>'
      + '<span class="nm">' + escapeHtml(isMe ? 'You' : name) + '</span>'
      + '<span class="state" hidden></span>';
    tilesEl.appendChild(d);
    layout();
    return d;
  }
  function layout() {
    var n = tilesEl.children.length;
    tilesEl.className = 'tiles' + (n === 2 ? ' two' : n > 2 ? ' many' : '');
  }
  function setTileStream(id, mediaStream) {
    var t = document.getElementById('tile-' + id);
    if (!t) return;
    var v = t.querySelector('video');
    v.srcObject = mediaStream;
    v.hidden = false;
    t.querySelector('.initial').hidden = true;
  }
  function setTileState(id, text) {
    var t = document.getElementById('tile-' + id);
    if (!t) return;
    var s = t.querySelector('.state');
    s.textContent = text || '';
    s.hidden = !text;
  }
  function dropPeer(peerId) {
    var p = peers[peerId];
    if (!p) return;
    try { p.pc.close(); } catch (e) { /* already closed */ }
    var t = document.getElementById('tile-' + peerId);
    if (t) t.remove();
    delete peers[peerId];
    layout();
    say();
  }
  function say() {
    var n = Object.keys(peers).length + 1;
    statusEl.textContent = n === 1 ? 'Waiting for others…' : n + ' of ' + CAPACITY + ' here';
  }

  async function post(path, body) {
    return fetchJSON(path, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body)
    });
  }

  function makePeer(peerId, name) {
    var pc = new RTCPeerConnection({ iceServers: ICE });
    peers[peerId] = { pc: pc, name: name };
    tile(peerId, name, false);
    stream.getTracks().forEach(function (t) { pc.addTrack(t, stream); });

    pc.ontrack = function (e) { setTileStream(peerId, e.streams[0]); };
    pc.onicecandidate = function (e) {
      if (e.candidate) post('/api/rooms/' + roomId + '/signal',
        { from: myPeerId, to: peerId, data: { candidate: e.candidate } }).catch(function () {});
    };
    pc.onconnectionstatechange = function () {
      var s = pc.connectionState;
      if (s === 'connected') setTileState(peerId, '');
      else if (s === 'connecting') setTileState(peerId, 'connecting');
      else if (s === 'failed') {
        // The honest message. Without a TURN server some networks simply
        // cannot be joined, and saying so beats a frozen black tile.
        setTileState(peerId, hasTurn ? 'lost' : 'no route');
      }
      say();
    };
    return pc;
  }

  async function offerTo(peerId, name) {
    var pc = makePeer(peerId, name);
    var offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    await post('/api/rooms/' + roomId + '/signal', { from: myPeerId, to: peerId, data: { sdp: pc.localDescription } });
  }

  async function onSignal(from, data) {
    var entry = peers[from];
    if (data.sdp) {
      if (!entry) { makePeer(from, 'Member'); entry = peers[from]; }
      await entry.pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
      if (data.sdp.type === 'offer') {
        var answer = await entry.pc.createAnswer();
        await entry.pc.setLocalDescription(answer);
        await post('/api/rooms/' + roomId + '/signal', { from: myPeerId, to: from, data: { sdp: entry.pc.localDescription } });
      }
    } else if (data.candidate && entry) {
      try { await entry.pc.addIceCandidate(new RTCIceCandidate(data.candidate)); } catch (e) { /* late candidate */ }
    }
  }

  async function join(room) {
    roomId = room.id;
    document.getElementById('callTitle').textContent = room.title || 'ACONSU Room';
    callEl.hidden = false;
    statusEl.textContent = 'Asking for your camera…';

    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    } catch (err) {
      // A meeting you can hear is far better than no meeting, so a refused or
      // missing camera falls back to audio rather than ending here.
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: false, audio: true });
        showToast('Joining with audio only, no camera available.', 'error');
      } catch (err2) {
        statusEl.textContent = '';
        callEl.hidden = true;
        showToast('ACONSU Rooms needs permission to use your microphone.', 'error');
        return;
      }
    }

    tilesEl.innerHTML = '';
    var meTile = tile('me', 'You', true);
    setTileStream('me', stream);
    if (!stream.getVideoTracks().length) {
      meTile.querySelector('video').hidden = true;
      meTile.querySelector('.initial').hidden = false;
      setTileState('me', 'audio only');
    }

    try {
      var ice = await fetchJSON('/api/rooms/ice-servers');
      ICE = ice.iceServers; hasTurn = ice.hasTurn;
    } catch (e) { /* the public STUN default stands */ }

    source = new EventSource('/api/rooms/' + roomId + '/events');
    source.onmessage = async function (e) {
      var msg = JSON.parse(e.data);
      if (msg.type === 'welcome') {
        myPeerId = msg.peerId;
        CAPACITY = msg.capacity || CAPACITY;
        // Both sides must not offer at once, or the two offers collide. The
        // lower id offers; the higher waits. No negotiation needed to agree.
        for (var i = 0; i < msg.peers.length; i++) {
          var other = msg.peers[i];
          if (myPeerId < other.peerId) await offerTo(other.peerId, other.name);
          else { makePeer(other.peerId, other.name); }
        }
        say();
      } else if (msg.type === 'peer-joined') {
        if (myPeerId < msg.peer.peerId) await offerTo(msg.peer.peerId, msg.peer.name);
        else makePeer(msg.peer.peerId, msg.peer.name);
        say();
      } else if (msg.type === 'signal') {
        await onSignal(msg.from, msg.data);
      } else if (msg.type === 'peer-left') {
        dropPeer(msg.peerId);
      } else if (msg.type === 'replaced') {
        showToast('You joined this room in another tab.', 'error');
        leave();
      } else if (msg.type === 'room-closed') {
        showToast('The room was closed.', 'error');
        leave();
      }
    };
    source.onerror = function () { statusEl.textContent = 'Reconnecting…'; };
    say();
  }

  function leave() {
    if (source) { source.close(); source = null; }
    Object.keys(peers).forEach(dropPeer);
    if (stream) { stream.getTracks().forEach(function (t) { t.stop(); }); stream = null; }
    callEl.hidden = true;
    tilesEl.innerHTML = '';
    myPeerId = null; roomId = null;
    load();
  }

  document.getElementById('leaveBtn').addEventListener('click', leave);
  document.getElementById('micBtn').addEventListener('click', function () {
    if (!stream) return;
    var on = stream.getAudioTracks().some(function (t) { return t.enabled; });
    stream.getAudioTracks().forEach(function (t) { t.enabled = !on; });
    this.textContent = on ? 'Unmute' : 'Mute';
    this.classList.toggle('off', on);
    setTileState('me', on ? 'muted' : '');
  });
  document.getElementById('camBtn').addEventListener('click', function () {
    if (!stream || !stream.getVideoTracks().length) return;
    var on = stream.getVideoTracks().some(function (t) { return t.enabled; });
    stream.getVideoTracks().forEach(function (t) { t.enabled = !on; });
    this.textContent = on ? 'Camera on' : 'Camera off';
    this.classList.toggle('off', on);
  });
  // Closing the tab should free the seat immediately, not when the connection
  // eventually times out - in a four-seat room a ghost is a real cost.
  window.addEventListener('pagehide', function () { if (source) source.close(); });

  function card(r) {
    var full = r.here >= r.capacity;
    return '<div class="room-card">'
      + '<h3>' + escapeHtml(r.title || 'ACONSU Room') + '</h3>'
      + '<div class="room-meta">' + escapeHtml(r.departmentName ? r.departmentName + ' department' : 'Open to the chapter')
      + (r.createdByName ? ' &middot; opened by ' + escapeHtml(r.createdByName) : '') + '</div>'
      + '<div><span class="seats' + (full ? ' full' : '') + '">' + r.here + ' of ' + r.capacity + ' here</span></div>'
      + '<button class="btn btn-primary btn-sm join-btn" data-id="' + escapeHtml(r.id) + '"' + (full ? ' disabled' : '') + '>'
      + (full ? 'Room is full' : 'Join') + '</button>'
      + '</div>';
  }

  var ROOMS = [];
  async function load() {
    try {
      var data = await fetchJSON('/api/rooms');
      ROOMS = data.items || [];
      CAPACITY = data.capacity || CAPACITY;
      grid.innerHTML = ROOMS.map(card).join('')
        || '<p class="empty-state">No rooms are open right now. A Chapter Admin or your department head opens one when a meeting is due.</p>';
    } catch (err) {
      grid.innerHTML = '<p class="empty-state">' + escapeHtml(err.message || 'Could not load rooms.') + '</p>';
    }
  }

  document.addEventListener('click', function (e) {
    var b = e.target.closest('.join-btn');
    if (!b || b.disabled) return;
    var room = ROOMS.filter(function (r) { return r.id === b.dataset.id; })[0];
    if (room) join(room);
  });

  load();
})();
