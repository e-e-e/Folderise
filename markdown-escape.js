/* jshint esnext:true, globalstrict:true */
/* global require, console, __dirname, process, exports, module */

"use strict";

var to_escape = /(\*|#|\(|\)|\[|\]|<|>|_)/g;

module.exports = function escape_markdown(string) {
	return string.replace(to_escape,
		(match) => (match==='>')? '&gt;' : (match==='<')? '&lt;' : '\\'+match );
};