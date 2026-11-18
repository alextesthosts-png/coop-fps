// Map registry. Each builder returns plain data shared by the server (collision, AI) and the client (rendering).
const MAPS = { arena: require('./maps/arena'), dust: require('./maps/dust'), factory: require('./maps/factory'), mall: require('./maps/mall') };
const cache = {};
function buildMap(id = 'arena') {
  if (!MAPS[id]) id = 'arena';
  return cache[id] || (cache[id] = MAPS[id].build());
}
const MAP_LIST = () => Object.keys(MAPS).map(id => ({ id, name: buildMap(id).name }));
module.exports = { buildMap, MAP_LIST };
