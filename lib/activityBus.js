// Process-wide pub/sub for "something a chapter's operational dashboard
// cares about just happened" — the push transport behind the Live Pastoral
// Care & Activity Stream (Phase 2). One EventEmitter, one event name
// ('activity'), payload { chapterId, resource }; SSE subscribers in
// server.js filter by chapterId. Emission is wired into repo.create() (see
// ACTIVITY_RESOURCES there) rather than into each route handler, so every
// creation path is covered without hunting down call sites — the same
// single-chokepoint idiom lib/roles.js uses for chapter scoping.
const { EventEmitter } = require('events');

const bus = new EventEmitter();
// Each open dashboard holds one listener; comfortably above any realistic
// number of admins with the panel open at once, just to keep Node's default
// leak warning from firing on a legitimately busy deployment.
bus.setMaxListeners(200);

module.exports = bus;
