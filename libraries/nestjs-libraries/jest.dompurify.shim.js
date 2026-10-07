// isomorphic-dompurify pulls in an ESM-only jsdom that jest's CommonJS runtime
// cannot load. Tests get the same DOMPurify bound to the CommonJS jsdom from
// the root devDependencies instead - real sanitising, not a stub.
const { JSDOM } = require('jsdom');
const createDOMPurify = require('dompurify');

const DOMPurify = createDOMPurify(new JSDOM('').window);

module.exports = DOMPurify;
module.exports.default = DOMPurify;
