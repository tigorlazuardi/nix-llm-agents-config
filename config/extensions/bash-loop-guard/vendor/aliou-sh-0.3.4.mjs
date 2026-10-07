/* Vendored @aliou/sh 0.3.4 dist/index.js (self-contained, ESM).
   Upstream: https://www.npmjs.com/package/@aliou/sh — MIT AND BSD-3-Clause.
   Regenerate: npm pack @aliou/sh@<ver> && cp package/dist/index.js here. */
//#region src/ast.ts
/** Sentinel position used when a node is built outside the parser (e.g. test fixtures). */
const NO_POS = {
	offset: 0,
	line: 0,
	col: 0
};

//#endregion
//#region src/dialect.ts
/** Is the current dialect zsh? */
const isZsh = (d) => d === "zsh";
/**
* Throw a LangError-style error if the current dialect doesn't permit
* `feature`. Allowed dialects are listed in `allowedIn`.
*
* Mirrors the contract of mvdan/sh's `Parser.checkLang`: error messages
* follow the form `<feature> is a <allowed> feature`.
*/
function checkLang(current, pos, feature, allowedIn) {
	const effective = current ?? "bash";
	if (allowedIn.includes(effective)) return;
	const allowedDesc = allowedIn.length === 1 ? allowedIn[0] : allowedIn.join("/");
	const where = pos ? ` at ${pos.line}:${pos.col}` : "";
	throw new Error(`${feature} is a ${allowedDesc} feature; tried parsing as ${effective}${where}`);
}

//#endregion
//#region src/tokenizer/cursor.ts
/**
* A read-only cursor over the source string that tracks byte offset, line, and column.
* Lines are 1-indexed; columns are 1-indexed; offset is 0-indexed.
*
* The tokenizer mutates `i` directly for legacy reasons; `posAt(i)` is used to recover
* the (line, col) for any offset on demand.
*/
var SourceMap = class {
	/** Sorted list of offsets where each line starts. lineStarts[0] is always 0. */
	lineStarts;
	constructor(source) {
		this.source = source;
		this.lineStarts = [0];
		for (let i = 0; i < source.length; i++) if (source.charCodeAt(i) === 10) this.lineStarts.push(i + 1);
	}
	posAt(offset) {
		let lo = 0;
		let hi = this.lineStarts.length - 1;
		while (lo < hi) {
			const mid = lo + hi + 1 >>> 1;
			const start = this.lineStarts[mid];
			if (start !== void 0 && start <= offset) lo = mid;
			else hi = mid - 1;
		}
		const lineStart = this.lineStarts[lo] ?? 0;
		return {
			offset,
			line: lo + 1,
			col: offset - lineStart + 1
		};
	}
};

//#endregion
//#region src/tokenizer/charsets.ts
const operatorChars = new Set([
	";",
	"|",
	"&"
]);
const redirChars = new Set([">", "<"]);
const symbolChars = new Set([
	"(",
	")",
	"{",
	"}"
]);
const isDigit = (c) => c >= "0" && c <= "9";
const isAsciiLetter = (c) => c >= "a" && c <= "z" || c >= "A" && c <= "Z";
const isHexDigit = (c) => isDigit(c) || c >= "a" && c <= "f" || c >= "A" && c <= "F";
/** Valid first character of a shell name (`[A-Za-z_]`). */
const isNameStart = (c) => isAsciiLetter(c) || c === "_";
/** Valid character inside a shell name (`[A-Za-z0-9_]`). */
const isNameChar = (c) => isNameStart(c) || isDigit(c);
/** Whether `s` parses as a (signed) integer. */
const isInteger = (s) => {
	if (s.length === 0) return false;
	let i = 0;
	if (s[0] === "+" || s[0] === "-") {
		if (s.length === 1) return false;
		i = 1;
	}
	for (; i < s.length; i++) if (!isDigit(s[i])) return false;
	return true;
};
const specialParams = new Set([
	"@",
	"*",
	"#",
	"?",
	"-",
	"$",
	"!"
]);

//#endregion
//#region src/tokenizer/scan-backtick.ts
function scanBacktick(source, pos, map) {
	let j = pos + 1;
	while (j < source.length && source.charAt(j) !== "`") {
		if (source.charAt(j) === "\\") j++;
		j++;
	}
	return {
		part: {
			type: "backtick",
			raw: source.slice(pos + 1, j),
			innerOffset: pos + 1,
			pos: map.posAt(pos),
			end: map.posAt(j + 1)
		},
		end: j + 1
	};
}

//#endregion
//#region src/tokenizer/scan-expansion.ts
function scanExpansion(source, pos, map, options = {}) {
	if (source.charAt(pos) !== "$") return null;
	const next = source.charAt(pos + 1);
	if (next === "(" && source.charAt(pos + 2) === "(") {
		let j = pos + 3;
		let depth = 0;
		while (j < source.length) {
			if (source.charAt(j) === ")" && source.charAt(j + 1) === ")" && depth === 0) break;
			if (source.charAt(j) === "(") depth++;
			if (source.charAt(j) === ")") depth--;
			j++;
		}
		return {
			part: {
				type: "arith-exp",
				raw: source.slice(pos + 3, j),
				innerOffset: pos + 3,
				pos: map.posAt(pos),
				end: map.posAt(j + 2)
			},
			end: j + 2
		};
	}
	if (next === "(") {
		let j = pos + 2;
		let depth = 1;
		while (j < source.length && depth > 0) {
			if (source.charAt(j) === "(") depth++;
			if (source.charAt(j) === ")") depth--;
			j++;
		}
		return {
			part: {
				type: "cmd-subst",
				raw: source.slice(pos + 2, j - 1),
				innerOffset: pos + 2,
				pos: map.posAt(pos),
				end: map.posAt(j)
			},
			end: j
		};
	}
	if (next === "{") {
		let j = pos + 2;
		let depth = 1;
		while (j < source.length && depth > 0) {
			if (source.charAt(j) === "{") depth++;
			if (source.charAt(j) === "}") depth--;
			j++;
		}
		const inner = source.slice(pos + 2, j - 1);
		if (inner.charAt(0) === "!" && /^![A-Za-z_][A-Za-z0-9_]*[*@]$/.test(inner)) checkLang(options.dialect, map.posAt(pos), "${!name*}", ["bash", "zsh"]);
		return {
			part: parseBracedParam(inner, map.posAt(pos), map.posAt(j)),
			end: j
		};
	}
	if (isNameStart(next)) {
		let j = pos + 2;
		while (j < source.length && isNameChar(source.charAt(j))) j++;
		return shortParam(source.slice(pos + 1, j), pos, j, map);
	}
	if (isDigit(next) || specialParams.has(next)) return shortParam(next, pos, pos + 2, map);
	return null;
}
function shortParam(name, start, end, map) {
	return {
		part: {
			type: "param",
			name,
			braced: false,
			pos: map.posAt(start),
			end: map.posAt(end)
		},
		end
	};
}
/**
* Parse the inner of `${...}` into a structured `param` token.
* Forms supported:
*   - ${name} / ${#name} (length) / ${!name} (indirect)
*   - ${name[index]}
*   - ${name OP word} where OP is `:- - := = :+ + :? ? :?`
*   - ${name#pat} / ${name##pat} / ${name%pat} / ${name%%pat}
*   - ${name^} / ${name^^} / ${name,} / ${name,,}
*   - ${name@OP}
*   - ${name:offset[:length]}
*   - ${name/pat[/with]} / ${name//pat/with} / ${name/#pat/with} / ${name/%pat/with}
*/
function parseBracedParam(inner, pos, end) {
	let i = 0;
	let length = false;
	let excl = false;
	if (inner.charAt(0) === "#") {
		const rest = inner.slice(1);
		if (rest.length > 0 && (isNameStart(rest.charAt(0)) || isDigit(rest.charAt(0)) || specialParams.has(rest.charAt(0)))) {
			length = true;
			i = 1;
		}
	} else if (inner.charAt(0) === "!") {
		const rest = inner.slice(1);
		if (rest.length > 0 && (isNameStart(rest.charAt(0)) || isDigit(rest.charAt(0)))) {
			excl = true;
			i = 1;
		}
	}
	const nameStart = i;
	while (i < inner.length && isNameChar(inner.charAt(i))) i++;
	let name;
	let rest;
	if (i === nameStart) if (i < inner.length && specialParams.has(inner.charAt(i))) {
		name = inner.charAt(i);
		i += 1;
		rest = inner.slice(i);
	} else {
		name = inner;
		rest = "";
		i = inner.length;
	}
	else {
		name = inner.slice(nameStart, i);
		rest = inner.slice(i);
	}
	const part = {
		type: "param",
		name,
		braced: true,
		pos,
		end
	};
	if (length) part.length = true;
	if (excl) part.excl = true;
	if (rest.charAt(0) === "[") {
		const closeIdx = findMatching(rest, 0, "[", "]");
		if (closeIdx > 0) {
			part.index = rest.slice(1, closeIdx);
			rest = rest.slice(closeIdx + 1);
		}
	}
	if (rest.length === 0) return part;
	if (rest.charAt(0) === ":" && rest.charAt(1) !== "-" && rest.charAt(1) !== "=" && rest.charAt(1) !== "+" && rest.charAt(1) !== "?") {
		const after = rest.slice(1);
		const colon = findColonOutsideParens(after);
		if (colon === -1) part.slice = { offset: after.trim() };
		else part.slice = {
			offset: after.slice(0, colon).trim(),
			length: after.slice(colon + 1).trim()
		};
		return part;
	}
	if (rest.charAt(0) === "/") {
		let r = rest.slice(1);
		let all = false;
		let prefix = false;
		let suffix = false;
		if (r.charAt(0) === "/") {
			all = true;
			r = r.slice(1);
		} else if (r.charAt(0) === "#") {
			prefix = true;
			r = r.slice(1);
		} else if (r.charAt(0) === "%") {
			suffix = true;
			r = r.slice(1);
		}
		const slash = findUnescapedSlash(r);
		const replace = { orig: slash === -1 ? r : r.slice(0, slash) };
		if (slash !== -1) replace.with = r.slice(slash + 1);
		if (all) replace.all = true;
		if (prefix) replace.prefix = true;
		if (suffix) replace.suffix = true;
		part.replace = replace;
		return part;
	}
	for (const op of [
		":-",
		":=",
		":+",
		":?",
		"##",
		"%%",
		"^^",
		",,",
		"@U",
		"@u",
		"@L",
		"@Q",
		"@E",
		"@P",
		"@A",
		"@K",
		"@k",
		"@a",
		"-",
		"=",
		"+",
		"?",
		"#",
		"%",
		"^",
		","
	]) if (rest.startsWith(op)) {
		const value = rest.slice(op.length);
		part.exp = value.length > 0 ? {
			op,
			value
		} : { op };
		return part;
	}
	return part;
}
function findMatching(s, from, open, close) {
	let depth = 0;
	for (let i = from; i < s.length; i++) if (s[i] === open) depth++;
	else if (s[i] === close) {
		depth--;
		if (depth === 0) return i;
	}
	return -1;
}
function findColonOutsideParens(s) {
	let depth = 0;
	for (let i = 0; i < s.length; i++) if (s[i] === "(") depth++;
	else if (s[i] === ")") depth--;
	else if (s[i] === ":" && depth === 0) return i;
	return -1;
}
function findUnescapedSlash(s) {
	for (let i = 0; i < s.length; i++) {
		if (s[i] === "\\") {
			i++;
			continue;
		}
		if (s[i] === "/") return i;
	}
	return -1;
}

//#endregion
//#region src/tokenizer/scan-extglob.ts
const isExtGlobHead = (c) => c === "?" || c === "*" || c === "+" || c === "@" || c === "!";
/**
* If `source[pos]` is the start of an extended glob (`?(`, `*(`, `+(`,
* `@(`, or `!(`), scan to the matching `)` and return an `ext-glob` part.
* Returns null otherwise. Properly handles nested parens.
*/
function scanExtGlob(source, pos, map) {
	const head = source.charAt(pos);
	if (!isExtGlobHead(head)) return null;
	if (source.charAt(pos + 1) !== "(") return null;
	const op = `${head}(`;
	let j = pos + 2;
	let depth = 1;
	while (j < source.length) {
		const ch = source.charAt(j);
		if (ch === "(") depth++;
		else if (ch === ")") {
			depth--;
			if (depth === 0) return {
				part: {
					type: "ext-glob",
					op,
					pattern: source.slice(pos + 2, j),
					pos: map.posAt(pos),
					end: map.posAt(j + 1)
				},
				end: j + 1
			};
		}
		j++;
	}
	return null;
}

//#endregion
//#region src/tokenizer/scan-redir.ts
function tryRedirOp(source, pos) {
	if (source.startsWith("<<<", pos)) return {
		op: "<<<",
		len: 3
	};
	if (source.startsWith("&>>", pos)) return {
		op: "&>>",
		len: 3
	};
	if (source.startsWith("<<-", pos)) return {
		op: "<<-",
		len: 3
	};
	if (source.startsWith(">>", pos)) return {
		op: ">>",
		len: 2
	};
	if (source.startsWith(">&", pos)) return {
		op: ">&",
		len: 2
	};
	if (source.startsWith(">|", pos)) return {
		op: ">|",
		len: 2
	};
	if (source.startsWith("<>", pos)) return {
		op: "<>",
		len: 2
	};
	if (source.startsWith("<&", pos)) return {
		op: "<&",
		len: 2
	};
	if (source.startsWith("&>", pos)) return {
		op: "&>",
		len: 2
	};
	if (source.startsWith("<<", pos)) return {
		op: "<<",
		len: 2
	};
	if (source.charAt(pos) === ">") return {
		op: ">",
		len: 1
	};
	if (source.charAt(pos) === "<") return {
		op: "<",
		len: 1
	};
	return null;
}

//#endregion
//#region src/tokenizer/utils.ts
function tokenPartsText(parts) {
	return parts.map((p) => {
		if (p.type === "lit") return p.value;
		if (p.type === "sgl") return p.value;
		if (p.type === "dbl") return p.parts.map((dp) => dp.type === "lit" ? dp.value : "").join("");
		return "";
	}).join("");
}

//#endregion
//#region src/tokenizer/tokenize.ts
function tokenize(source, options = {}) {
	const map = new SourceMap(source);
	const tokens = [];
	let i = 0;
	let atBoundary = true;
	const heredocQueue = [];
	const supportsTestClause = options.dialect !== "posix";
	let testDepth = 0;
	const isTestOpenToken = (parts) => parts.length === 1 && parts[0]?.type === "lit" && parts[0].value === "[[";
	const isTestCloseToken = (parts) => parts.length === 1 && parts[0]?.type === "lit" && parts[0].value === "]]";
	const canStartTestClause = () => {
		const prev = tokens[tokens.length - 1];
		if (!prev) return true;
		if (prev.type === "op") return true;
		if (prev.type === "symbol" && (prev.value === "(" || prev.value === "{")) return true;
		if (prev.type === "comment" || prev.type === "heredoc-body" || prev.type === "arith-cmd") return true;
		return false;
	};
	const queueHeredocIfPending = () => {
		const last = tokens[tokens.length - 1];
		const prev = tokens[tokens.length - 2];
		if (prev && last && last.type === "word" && prev.type === "redir" && (prev.op === "<<" || prev.op === "<<-")) heredocQueue.push({
			strip: prev.op === "<<-",
			delimiter: tokenPartsText(last.parts)
		});
	};
	while (i < source.length) {
		const ch = source.charAt(i);
		if (ch === " " || ch === "	" || ch === "\r") {
			atBoundary = true;
			i += 1;
			continue;
		}
		if (ch === "\\" && source.charAt(i + 1) === "\n") {
			atBoundary = true;
			i += 2;
			continue;
		}
		if (ch === "\\" && source.charAt(i + 1) === "\r") {
			if (source.charAt(i + 2) === "\n") {
				atBoundary = true;
				i += 3;
				continue;
			}
		}
		if (ch === "\n") {
			tokens.push({
				type: "op",
				value: ";",
				newline: true,
				pos: map.posAt(i),
				end: map.posAt(i + 1)
			});
			atBoundary = true;
			i += 1;
			let delimiterNewline = -1;
			while (heredocQueue.length > 0) {
				const hd = heredocQueue.shift();
				if (!hd) break;
				const bodyStart = i;
				let body = "";
				delimiterNewline = -1;
				while (i < source.length) {
					let lineEnd = source.indexOf("\n", i);
					if (lineEnd === -1) lineEnd = source.length;
					let realLineEnd = lineEnd;
					if (realLineEnd > i && source.charCodeAt(realLineEnd - 1) === 13) realLineEnd -= 1;
					const line = source.slice(i, realLineEnd);
					const processedLine = hd.strip ? line.replace(/^\t+/, "") : line;
					i = lineEnd < source.length ? lineEnd + 1 : lineEnd;
					if (processedLine === hd.delimiter) {
						if (lineEnd < source.length) delimiterNewline = lineEnd;
						break;
					}
					body += `${processedLine}\n`;
				}
				tokens.push({
					type: "heredoc-body",
					content: body,
					pos: map.posAt(bodyStart),
					end: map.posAt(i)
				});
			}
			if (delimiterNewline >= 0) tokens.push({
				type: "op",
				value: ";",
				newline: true,
				pos: map.posAt(delimiterNewline),
				end: map.posAt(delimiterNewline + 1)
			});
			continue;
		}
		if (ch === "#" && atBoundary && testDepth === 0) {
			const startOffset = i;
			const start = i + 1;
			i += 1;
			while (i < source.length && source.charAt(i) !== "\n") i += 1;
			if (options.keepComments) tokens.push({
				type: "comment",
				text: source.slice(start, i),
				pos: map.posAt(startOffset),
				end: map.posAt(i)
			});
			continue;
		}
		if (ch === "!" && atBoundary) {
			const next = source.charAt(i + 1);
			if (next !== "(" && (next === "" || next === " " || next === "	" || next === "\n" || next === "\r")) {
				tokens.push({
					type: "op",
					value: "!",
					pos: map.posAt(i),
					end: map.posAt(i + 1)
				});
				atBoundary = true;
				i += 1;
				continue;
			}
		}
		if (ch === "{" && atBoundary && isNameStart(source.charAt(i + 1))) {
			let j = i + 2;
			while (j < source.length && isNameChar(source.charAt(j))) j += 1;
			if (source.charAt(j) === "}") {
				const redir = tryRedirOp(source, j + 1);
				if (redir) {
					checkLang(options.dialect, map.posAt(i), "`{varname}` redirects", ["bash", "zsh"]);
					tokens.push({
						type: "redir",
						op: redir.op,
						fd: source.slice(i, j + 1),
						pos: map.posAt(i),
						end: map.posAt(j + 1 + redir.len)
					});
					i = j + 1 + redir.len;
					atBoundary = true;
					continue;
				}
			}
		}
		if (isDigit(ch)) {
			let j = i;
			while (j < source.length && isDigit(source.charAt(j))) j += 1;
			const redir = tryRedirOp(source, j);
			if (redir) {
				tokens.push({
					type: "redir",
					op: redir.op,
					fd: source.slice(i, j),
					pos: map.posAt(i),
					end: map.posAt(j + redir.len)
				});
				i = j + redir.len;
				atBoundary = true;
				continue;
			}
		}
		if (ch === "(" && source.charAt(i + 1) === "(" && atBoundary) {
			let j = i + 2;
			let depth = 0;
			while (j < source.length) {
				const c = source.charAt(j);
				if (c === ")" && source.charAt(j + 1) === ")" && depth === 0) break;
				if (c === "(") depth++;
				if (c === ")") depth--;
				j++;
			}
			tokens.push({
				type: "arith-cmd",
				expr: source.slice(i + 2, j),
				innerOffset: i + 2,
				pos: map.posAt(i),
				end: map.posAt(j + 2)
			});
			i = j + 2;
			atBoundary = true;
			continue;
		}
		if ((ch === "<" || ch === ">") && source.charAt(i + 1) === "(" && atBoundary) {
			checkLang(options.dialect, map.posAt(i), "process substitution", [
				"bash",
				"mksh",
				"zsh"
			]);
			const op = ch;
			let j = i + 2;
			let depth = 1;
			while (j < source.length && depth > 0) {
				if (source.charAt(j) === "(") depth++;
				if (source.charAt(j) === ")") depth--;
				j++;
			}
			const raw = source.slice(i + 2, j - 1);
			const partPos = map.posAt(i);
			const partEnd = map.posAt(j);
			tokens.push({
				type: "word",
				parts: [{
					type: "proc-subst",
					op,
					raw,
					innerOffset: i + 2,
					pos: partPos,
					end: partEnd
				}],
				pos: partPos,
				end: partEnd
			});
			i = j;
			atBoundary = false;
			continue;
		}
		{
			const redir = tryRedirOp(source, i);
			if (redir) {
				if (redir.op === "&>" || redir.op === "&>>" || redir.op === "<<<") checkLang(options.dialect, map.posAt(i), redir.op, [
					"bash",
					"mksh",
					"zsh"
				]);
				tokens.push({
					type: "redir",
					op: redir.op,
					pos: map.posAt(i),
					end: map.posAt(i + redir.len)
				});
				i += redir.len;
				atBoundary = true;
				continue;
			}
		}
		if (symbolChars.has(ch)) if (ch === "{") {
			const next = source.charAt(i + 1);
			if (!(atBoundary && (next === "" || next === " " || next === "	" || next === "\n" || next === "\r" || next === ";"))) {} else {
				tokens.push({
					type: "symbol",
					value: "{",
					pos: map.posAt(i),
					end: map.posAt(i + 1)
				});
				atBoundary = true;
				i += 1;
				continue;
			}
		} else {
			tokens.push({
				type: "symbol",
				value: ch,
				pos: map.posAt(i),
				end: map.posAt(i + 1)
			});
			atBoundary = true;
			i += 1;
			continue;
		}
		if (source.startsWith("&&", i)) {
			tokens.push({
				type: "op",
				value: "&&",
				pos: map.posAt(i),
				end: map.posAt(i + 2)
			});
			atBoundary = true;
			i += 2;
			continue;
		}
		if (source.startsWith("||", i)) {
			tokens.push({
				type: "op",
				value: "||",
				pos: map.posAt(i),
				end: map.posAt(i + 2)
			});
			atBoundary = true;
			i += 2;
			continue;
		}
		if (operatorChars.has(ch)) {
			tokens.push({
				type: "op",
				value: ch,
				pos: map.posAt(i),
				end: map.posAt(i + 1)
			});
			atBoundary = true;
			i += 1;
			continue;
		}
		const wordStart = i;
		const parts = [];
		let current = "";
		let litStart = i;
		const flushLit = () => {
			if (current.length > 0) {
				parts.push({
					type: "lit",
					value: current,
					pos: map.posAt(litStart),
					end: map.posAt(i)
				});
				current = "";
			}
			litStart = i;
		};
		while (i < source.length) {
			const currentChar = source.charAt(i);
			if (currentChar === "\\" && source.charAt(i + 1) === "\n") {
				i += 2;
				if (current.length === 0) litStart = i;
				continue;
			}
			if (currentChar === "\\" && source.charAt(i + 1) === "\r") {
				if (source.charAt(i + 2) === "\n") {
					i += 3;
					if (current.length === 0) litStart = i;
					continue;
				}
			}
			if (currentChar === "\\" && i + 1 < source.length) {
				current += source.charAt(i + 1);
				i += 2;
				continue;
			}
			if ((currentChar === "?" || currentChar === "*" || currentChar === "+" || currentChar === "@" || currentChar === "!") && source.charAt(i + 1) === "(") {
				const eg = scanExtGlob(source, i, map);
				if (eg) {
					checkLang(options.dialect, map.posAt(i), "extended globbing", [
						"bash",
						"mksh",
						"zsh"
					]);
					flushLit();
					parts.push(eg.part);
					i = eg.end;
					litStart = i;
					continue;
				}
			}
			if (currentChar === " " || currentChar === "	" || currentChar === "\r" || currentChar === "\n" || operatorChars.has(currentChar) || redirChars.has(currentChar) || currentChar === "(" || currentChar === ")") break;
			if (currentChar === "'") {
				flushLit();
				const sglStart = i;
				i += 1;
				const start = i;
				while (i < source.length && source.charAt(i) !== "'") i += 1;
				if (i >= source.length) throw new Error("Unclosed single quote");
				parts.push({
					type: "sgl",
					value: source.slice(start, i),
					pos: map.posAt(sglStart),
					end: map.posAt(i + 1)
				});
				i += 1;
				litStart = i;
				continue;
			}
			if (currentChar === "\"") {
				flushLit();
				const dblStart = i;
				i += 1;
				const dblParts = [];
				let dblBuf = "";
				let dblLitStart = i;
				const flushDblLit = () => {
					if (dblBuf.length > 0) {
						dblParts.push({
							type: "lit",
							value: dblBuf,
							pos: map.posAt(dblLitStart),
							end: map.posAt(i)
						});
						dblBuf = "";
					}
					dblLitStart = i;
				};
				let closed = false;
				while (i < source.length) {
					const dqChar = source.charAt(i);
					if (dqChar === "\\" && source.charAt(i + 1) === "\n") {
						i += 2;
						continue;
					}
					if (dqChar === "\\" && source.charAt(i + 1) === "\r") {
						if (source.charAt(i + 2) === "\n") {
							i += 3;
							continue;
						}
					}
					if (dqChar === "\\" && i + 1 < source.length) {
						dblBuf += dqChar + source.charAt(i + 1);
						i += 2;
						continue;
					}
					if (dqChar === "$") {
						flushDblLit();
						const exp = scanExpansion(source, i, map, options);
						if (exp) {
							dblParts.push(exp.part);
							i = exp.end;
							dblLitStart = i;
							continue;
						}
						dblBuf += dqChar;
						i += 1;
						continue;
					}
					if (dqChar === "`") {
						flushDblLit();
						const bt = scanBacktick(source, i, map);
						dblParts.push(bt.part);
						i = bt.end;
						dblLitStart = i;
						continue;
					}
					if (dqChar === "\"") {
						i += 1;
						closed = true;
						break;
					}
					dblBuf += dqChar;
					i += 1;
				}
				if (!closed) throw new Error("Unclosed double quote");
				flushDblLit();
				parts.push({
					type: "dbl",
					parts: dblParts,
					pos: map.posAt(dblStart),
					end: map.posAt(i)
				});
				litStart = i;
				continue;
			}
			if (currentChar === "$") {
				const exp = scanExpansion(source, i, map, options);
				if (exp) {
					flushLit();
					parts.push(exp.part);
					i = exp.end;
					litStart = i;
					continue;
				}
				current += currentChar;
				i += 1;
				continue;
			}
			if (currentChar === "`") {
				flushLit();
				const bt = scanBacktick(source, i, map);
				parts.push(bt.part);
				i = bt.end;
				litStart = i;
				continue;
			}
			current += currentChar;
			i += 1;
		}
		flushLit();
		if (parts.length === 0) throw new Error("Unexpected character");
		const canStartTest = canStartTestClause();
		tokens.push({
			type: "word",
			parts,
			pos: map.posAt(wordStart),
			end: map.posAt(i)
		});
		if (supportsTestClause) {
			if (isTestOpenToken(parts) && canStartTest) testDepth++;
			else if (isTestCloseToken(parts) && testDepth > 0) testDepth--;
		}
		queueHeredocIfPending();
		atBoundary = false;
	}
	return tokens;
}

//#endregion
//#region src/parser/arith-parser.ts
function arithDigitValue(c) {
	if (c >= "0" && c <= "9") return c.charCodeAt(0) - "0".charCodeAt(0);
	if (c >= "A" && c <= "Z") return 10 + c.charCodeAt(0) - "A".charCodeAt(0);
	if (c >= "a" && c <= "z") return 36 + c.charCodeAt(0) - "a".charCodeAt(0);
	if (c === "@") return 62;
	if (c === "_") return 63;
	return -1;
}
function isArithBaseDigit(c, base) {
	const raw = arithDigitValue(c);
	if (base <= 36) {
		const normalized = c >= "a" && c <= "z" ? 10 + c.charCodeAt(0) - "a".charCodeAt(0) : raw;
		return normalized >= 0 && normalized < base;
	}
	return raw >= 0 && raw < base;
}
/**
* Parse a Bash arithmetic expression (the inside of `(( ... ))`,
* `$(( ... ))`, or one clause of a C-style for loop) into an `ArithExpr`
* tree. Returns `undefined` for empty/whitespace-only input.
*/
function parseArithmetic(source, base) {
	const tokens = tokenizeArith(source);
	if (tokens.length === 0) return void 0;
	const ctx = {
		tokens,
		index: 0,
		base,
		map: new SourceMap(source)
	};
	const expr = parseExpr(ctx, 0);
	if (ctx.index < ctx.tokens.length) {
		const tok = ctx.tokens[ctx.index];
		throw new Error(`Unexpected token in arithmetic: ${tokDisplay(tok)}`);
	}
	return expr;
}
function tokDisplay(t) {
	if (!t) return "?";
	if (t.type === "lparen") return "(";
	if (t.type === "rparen") return ")";
	return t.value;
}
/** Operators tried longest-first. */
const OPS = [
	"<<=",
	">>=",
	"**=",
	"&&",
	"||",
	"==",
	"!=",
	"<=",
	">=",
	"<<",
	">>",
	"**",
	"++",
	"--",
	"+=",
	"-=",
	"*=",
	"/=",
	"%=",
	"&=",
	"|=",
	"^=",
	"+",
	"-",
	"*",
	"/",
	"%",
	"<",
	">",
	"&",
	"|",
	"^",
	"~",
	"!",
	"=",
	",",
	"?",
	":"
];
function tokenizeArith(s) {
	const toks = [];
	let i = 0;
	while (i < s.length) {
		const c = s.charAt(i);
		if (c === " " || c === "	" || c === "\n" || c === "\r") {
			i++;
			continue;
		}
		if (c === "(") {
			toks.push({
				type: "lparen",
				offset: i
			});
			i++;
			continue;
		}
		if (c === ")") {
			toks.push({
				type: "rparen",
				offset: i
			});
			i++;
			continue;
		}
		if (c === "$") {
			let j = i + 1;
			const next = s.charAt(j);
			if (j < s.length && isNameStart(next)) {
				while (j < s.length && isNameChar(s.charAt(j))) j++;
				toks.push({
					type: "name",
					value: s.slice(i + 1, j),
					offset: i
				});
				i = j;
				continue;
			}
			if (j < s.length && (isDigit(next) || specialParams.has(next))) {
				toks.push({
					type: "name",
					value: next,
					offset: i
				});
				i += 2;
				continue;
			}
		}
		if (isDigit(c)) {
			let j = i + 1;
			if (c === "0" && (s.charAt(j) === "x" || s.charAt(j) === "X")) {
				j++;
				while (j < s.length && isHexDigit(s.charAt(j))) j++;
			} else {
				while (j < s.length && isDigit(s.charAt(j))) j++;
				if (s.charAt(j) === "#") {
					const base = Number.parseInt(s.slice(i, j), 10);
					if (base >= 2 && base <= 64) {
						const digitsStart = j + 1;
						let k = digitsStart;
						while (k < s.length && isArithBaseDigit(s.charAt(k), base)) k++;
						if (k > digitsStart) {
							toks.push({
								type: "num",
								value: s.slice(i, k),
								offset: i
							});
							i = k;
							continue;
						}
					}
				}
			}
			toks.push({
				type: "num",
				value: s.slice(i, j),
				offset: i
			});
			i = j;
			continue;
		}
		if (isNameStart(c)) {
			let j = i + 1;
			while (j < s.length && isNameChar(s.charAt(j))) j++;
			toks.push({
				type: "name",
				value: s.slice(i, j),
				offset: i
			});
			i = j;
			continue;
		}
		let matched = false;
		for (const op of OPS) if (s.startsWith(op, i)) {
			toks.push({
				type: "op",
				value: op,
				offset: i
			});
			i += op.length;
			matched = true;
			break;
		}
		if (!matched) throw new Error(`Unexpected character ${JSON.stringify(c)} in arithmetic at offset ${i}`);
	}
	return toks;
}
const BIN_INFO = {
	",": { prec: 1 },
	"=": {
		prec: 2,
		rightAssoc: true
	},
	"+=": {
		prec: 2,
		rightAssoc: true
	},
	"-=": {
		prec: 2,
		rightAssoc: true
	},
	"*=": {
		prec: 2,
		rightAssoc: true
	},
	"/=": {
		prec: 2,
		rightAssoc: true
	},
	"%=": {
		prec: 2,
		rightAssoc: true
	},
	"**=": {
		prec: 2,
		rightAssoc: true
	},
	"&=": {
		prec: 2,
		rightAssoc: true
	},
	"|=": {
		prec: 2,
		rightAssoc: true
	},
	"^=": {
		prec: 2,
		rightAssoc: true
	},
	"<<=": {
		prec: 2,
		rightAssoc: true
	},
	">>=": {
		prec: 2,
		rightAssoc: true
	},
	"?": {
		prec: 3,
		rightAssoc: true
	},
	":": {
		prec: 3,
		rightAssoc: true
	},
	"||": { prec: 4 },
	"&&": { prec: 5 },
	"|": { prec: 6 },
	"^": { prec: 7 },
	"&": { prec: 8 },
	"==": { prec: 9 },
	"!=": { prec: 9 },
	"<": { prec: 10 },
	"<=": { prec: 10 },
	">": { prec: 10 },
	">=": { prec: 10 },
	"<<": { prec: 11 },
	">>": { prec: 11 },
	"+": { prec: 12 },
	"-": { prec: 12 },
	"*": { prec: 13 },
	"/": { prec: 13 },
	"%": { prec: 13 },
	"**": {
		prec: 14,
		rightAssoc: true
	}
};
const UNARY_PREFIX = new Set([
	"+",
	"-",
	"!",
	"~",
	"++",
	"--"
]);
const peek = (ctx) => ctx.tokens[ctx.index];
const advance = (ctx) => ctx.tokens[ctx.index++];
/**
* Compute the absolute (pos, end) for a span of arithmetic source.
* Uses the SourceMap's binary-search `posAt` and translates by the base
* anchor. The first line of the inner source is on the same line as the
* containing `(( `, so its column needs the base offset added.
*/
function posOf(ctx, offset, length = 1) {
	return {
		pos: translate(ctx, offset),
		end: translate(ctx, offset + length)
	};
}
function translate(ctx, offset) {
	const inner = ctx.map.posAt(offset);
	const onFirstLine = inner.line === 1;
	return {
		offset: ctx.base.offset + offset,
		line: ctx.base.line + (inner.line - 1),
		col: onFirstLine ? ctx.base.col + (inner.col - 1) : inner.col
	};
}
function parseExpr(ctx, minPrec) {
	let left = parseUnary(ctx);
	while (true) {
		const tok = peek(ctx);
		if (tok?.type !== "op") break;
		const info = BIN_INFO[tok.value];
		if (!info || info.prec < minPrec) break;
		advance(ctx);
		const right = parseExpr(ctx, info.rightAssoc ? info.prec : info.prec + 1);
		left = {
			type: "BinaryArithm",
			op: tok.value,
			x: left,
			y: right,
			pos: left.pos ?? posOf(ctx, tok.offset, tok.value.length).pos,
			end: right.end ?? posOf(ctx, tok.offset, tok.value.length).end
		};
	}
	return left;
}
function parseUnary(ctx) {
	const tok = peek(ctx);
	if (tok && tok.type === "op" && UNARY_PREFIX.has(tok.value)) {
		advance(ctx);
		const operand = parseUnary(ctx);
		return {
			type: "UnaryArithm",
			op: tok.value,
			x: operand,
			...posOf(ctx, tok.offset, tok.value.length)
		};
	}
	return parsePostfix(ctx);
}
function parsePostfix(ctx) {
	const expr = parsePrimary(ctx);
	const tok = peek(ctx);
	if (tok && tok.type === "op" && (tok.value === "++" || tok.value === "--")) {
		advance(ctx);
		return {
			type: "UnaryArithm",
			op: tok.value,
			post: true,
			x: expr,
			pos: expr.pos ?? posOf(ctx, tok.offset, tok.value.length).pos,
			end: posOf(ctx, tok.offset, tok.value.length).end
		};
	}
	return expr;
}
function parsePrimary(ctx) {
	const tok = advance(ctx);
	if (!tok) throw new Error("Unexpected end of arithmetic expression");
	if (tok.type === "num") return {
		type: "ArithLit",
		value: tok.value,
		...posOf(ctx, tok.offset, tok.value.length)
	};
	if (tok.type === "name") return {
		type: "ParamExp",
		short: true,
		param: {
			type: "Literal",
			value: tok.value
		},
		...posOf(ctx, tok.offset, tok.value.length)
	};
	if (tok.type === "lparen") {
		const inner = parseExpr(ctx, 0);
		const next = advance(ctx);
		if (next?.type !== "rparen") throw new Error("Expected closing paren in arithmetic");
		return {
			type: "ParenArithm",
			x: inner,
			...posOf(ctx, tok.offset, next.offset - tok.offset + 1)
		};
	}
	throw new Error(`Unexpected token in arithmetic: ${JSON.stringify(tok)}`);
}

//#endregion
//#region src/parser/constants.ts
const DECL_KEYWORDS = new Set([
	"declare",
	"local",
	"export",
	"readonly",
	"typeset",
	"nameref"
]);

//#endregion
//#region src/parser/parser.ts
const ZERO_POS = {
	offset: 0,
	line: 1,
	col: 1
};
const TEST_UNARY_OPS = new Set([
	"-e",
	"-f",
	"-d",
	"-r",
	"-w",
	"-x",
	"-z",
	"-n",
	"-s",
	"-a",
	"-o",
	"-S",
	"-c",
	"-b",
	"-p",
	"-h",
	"-L",
	"-N",
	"-O",
	"-G",
	"-u",
	"-g",
	"-k",
	"-t",
	"-v",
	"-R"
]);
const TEST_BINARY_OPS = new Set([
	"==",
	"!=",
	"<",
	"<=",
	">",
	">=",
	"=~",
	"=",
	"-ef",
	"-nt",
	"-ot"
]);
/**
* Wrap a raw substring (e.g. a slice offset or a replacement pattern) as a
* single-literal Word. The string was extracted from inside `${...}` so it
* has no inner expansions to recurse into.
*/
function strToWord(value) {
	return {
		type: "Word",
		parts: [{
			type: "Literal",
			value
		}]
	};
}
/** Human-readable description of a token, for error messages. */
function describeToken(token) {
	if (!token) return "";
	switch (token.type) {
		case "op": return token.value;
		case "redir": return token.op;
		case "symbol": return token.value;
		case "arith-cmd": return "(( ... ))";
		case "heredoc-body": return "<<heredoc>>";
		case "comment": return `#${token.text}`;
		case "word": return tokenPartsText(token.parts);
	}
}
/** Split `s` on a single-char delimiter, ignoring delimiters in parentheses. */
function splitAtTopLevel(s, delim) {
	const parts = [];
	let depth = 0;
	let start = 0;
	for (let i = 0; i < s.length; i++) {
		const c = s[i];
		if (c === "(") depth++;
		else if (c === ")") depth--;
		else if (c === delim && depth === 0) {
			parts.push(trimmedTopLevelPart(s, start, i));
			start = i + 1;
		}
	}
	parts.push(trimmedTopLevelPart(s, start, s.length));
	return parts;
}
function trimmedTopLevelPart(source, start, end) {
	while (start < end && /\s/.test(source[start])) start++;
	while (end > start && /\s/.test(source[end - 1])) end--;
	return {
		raw: source.slice(start, end),
		offset: start
	};
}
var Parser = class Parser {
	index = 0;
	comments = [];
	/**
	* Redirects that opened a heredoc (`<<`/`<<-`) but whose body token the
	* tokenizer hasn't emitted yet, in opener order. The tokenizer emits one
	* body token per queued heredoc right after the newline that ends the
	* command line, so bodies can arrive after later redirects on the same
	* line or after a trailing separator (`;`, `&&`, `||`, `|`). Bodies drain
	* to their redirects in `skipSeparators`/`skipCaseSeparators`.
	*/
	pendingHeredocs = [];
	/**
	* When true, redirects following a compound command's closing keyword are
	* not attached to that compound node. Set while parsing a `coproc` body or
	* a function-decl block so the enclosing CoprocClause/FunctionDecl captures
	* them instead; cleared again inside nested statement lists.
	*/
	suppressTrailingRedirects = false;
	constructor(tokens, options = {}) {
		this.tokens = tokens;
		this.options = options;
	}
	/** Yield each top-level statement as it's parsed. */
	*statementsSeq() {
		this.skipSeparators();
		while (!this.isEof()) {
			yield this.parseStatement();
			this.skipSeparators();
		}
	}
	/** Yield each word token as a Word, ignoring statement structure. */
	*wordsSeq() {
		while (!this.isEof()) {
			const tok = this.peek();
			if (!tok) break;
			if (tok.type === "op" || tok.type === "redir" || tok.type === "symbol" || tok.type === "heredoc-body" || tok.type === "comment" || tok.type === "arith-cmd") {
				this.consume();
				continue;
			}
			this.consume();
			yield this.wordFromToken(tok);
		}
	}
	/**
	* Like `parseProgram` but never throws: parse errors are collected into
	* the provided array, and the parser advances past the offending token
	* to keep going. Used by the public `recoverErrors` mode.
	*/
	parseProgramRecovering(errors) {
		const body = [];
		this.skipSeparators();
		const startPos = this.peek()?.pos ?? ZERO_POS;
		while (!this.isEof()) {
			const before = this.index;
			try {
				body.push(this.parseStatement());
				this.skipSeparators();
			} catch (e) {
				const tok = this.tokens[before];
				errors.push({
					message: e instanceof Error ? e.message : String(e),
					pos: tok?.pos ?? this.lastEnd() ?? startPos
				});
				if (this.index === before) this.index += 1;
				this.skipSeparators();
			}
		}
		const program = {
			type: "Program",
			body,
			pos: startPos,
			end: this.lastEnd() ?? startPos
		};
		if (this.options.keepComments && this.comments.length > 0) program.comments = this.comments;
		return program;
	}
	parseProgram() {
		const body = [];
		this.skipSeparators();
		const startPos = this.peek()?.pos ?? ZERO_POS;
		while (!this.isEof()) {
			body.push(this.parseStatement());
			this.skipSeparators();
		}
		const program = {
			type: "Program",
			body,
			pos: startPos,
			end: this.lastEnd() ?? startPos
		};
		if (this.options.keepComments && this.comments.length > 0) program.comments = this.comments;
		return program;
	}
	assertEof() {
		if (this.isEof()) return;
		throw new Error(`Unexpected token: ${describeToken(this.peek())}`);
	}
	parseStatement() {
		const startPos = this.peek()?.pos ?? ZERO_POS;
		let negated = false;
		if (this.matchOp("!")) {
			this.consume();
			negated = true;
		}
		const command = this.parseLogical();
		let background = false;
		if (this.matchOp("&")) {
			this.consume();
			background = true;
		}
		const statement = {
			type: "Statement",
			command,
			pos: startPos,
			end: this.lastEnd() ?? startPos
		};
		if (background) statement.background = true;
		if (negated) statement.negated = true;
		return statement;
	}
	parseLogical() {
		let leftCommand = this.parsePipeline();
		while (this.matchOp("&&") || this.matchOp("||")) {
			const opToken = this.consume();
			if (opToken.type !== "op") throw new Error("Expected logical operator");
			this.skipOperatorContinuation();
			const rightCommand = this.parsePipeline();
			const left = this.wrapStatement(leftCommand);
			const right = this.wrapStatement(rightCommand);
			leftCommand = {
				type: "Logical",
				op: opToken.value === "&&" ? "and" : "or",
				left,
				right,
				pos: left.pos ?? ZERO_POS,
				end: right.end ?? ZERO_POS
			};
		}
		return leftCommand;
	}
	parsePipeline() {
		const first = this.parseCommandAtom();
		if (!this.matchOp("|")) return first;
		const firstStmt = this.wrapStatement(first);
		const commands = [firstStmt];
		while (this.matchOp("|")) {
			this.consume();
			this.skipOperatorContinuation();
			const next = this.parseCommandAtom();
			commands.push(this.wrapStatement(next));
		}
		const last = commands[commands.length - 1];
		return {
			type: "Pipeline",
			commands,
			pos: firstStmt.pos ?? ZERO_POS,
			end: last?.end ?? firstStmt.end ?? ZERO_POS
		};
	}
	parseCommandAtom() {
		if (this.matchKeyword("if")) return this.parseIfClause();
		if (this.matchKeyword("while")) return this.parseWhileClause(false);
		if (this.matchKeyword("until")) return this.parseWhileClause(true);
		if (this.matchKeyword("for")) return this.parseForOrCStyleLoop();
		if (this.matchKeyword("select")) return this.parseSelectClause();
		if (this.matchKeyword("case")) return this.parseCaseClause();
		if (this.matchKeyword("time")) return this.parseTimeClause();
		if (this.matchKeyword("coproc")) return this.parseCoprocClause();
		if (this.matchKeyword("[[")) return this.parseTestClause();
		if (this.matchKeyword("function") || this.looksLikeFuncDecl()) return this.parseFunctionDecl();
		if (this.matchArithCmd()) return this.consumeArithCmd();
		if (this.matchSymbol("(")) return this.parseSubshell();
		if (this.matchSymbol("{")) return this.parseBlock();
		if (this.matchDeclKeyword()) return this.parseDeclClause();
		if (this.matchKeyword("let")) return this.parseLetClause();
		return this.parseSimpleCommand();
	}
	parseSubshell() {
		const open = this.consumeSymbol("(");
		const body = this.parseStatementList("(", ")");
		const close = this.consumeSymbol(")");
		const node = {
			type: "Subshell",
			body,
			pos: open.pos,
			end: close.end
		};
		this.parseTrailingRedirects(node);
		return node;
	}
	parseBlock() {
		const open = this.consumeSymbol("{");
		const body = this.parseStatementList("{", "}");
		const close = this.consumeSymbol("}");
		const node = {
			type: "Block",
			body,
			pos: open.pos,
			end: close.end
		};
		this.parseTrailingRedirects(node);
		return node;
	}
	/**
	* Consume any redirects immediately following a compound command's closing
	* keyword (`done`, `fi`, `}`, `)`, `esac`, `]]`, ...) and attach them to
	* the compound node itself, like bash and mvdan/sh do. Heredoc openers
	* queue in `pendingHeredocs`; their bodies drain later as usual. The
	* field stays unset when no redirects follow.
	*/
	parseTrailingRedirects(node) {
		if (this.suppressTrailingRedirects) return;
		if (!this.matchRedir()) return;
		const redirects = [];
		while (this.matchRedir()) redirects.push(this.parseRedirect());
		node.redirects = redirects;
		const end = this.lastEnd();
		if (end) node.end = end;
	}
	/** Run `fn` with trailing-redirect capture disabled (see the field doc). */
	withSuppressedTrailingRedirects(fn) {
		const prev = this.suppressTrailingRedirects;
		this.suppressTrailingRedirects = true;
		try {
			return fn();
		} finally {
			this.suppressTrailingRedirects = prev;
		}
	}
	/**
	* Re-enable trailing-redirect capture while parsing a nested statement
	* list, so redirects inside e.g. a coproc body still attach to the inner
	* compound they close.
	*/
	allowNestedTrailingRedirects(fn) {
		const prev = this.suppressTrailingRedirects;
		this.suppressTrailingRedirects = false;
		try {
			return fn();
		} finally {
			this.suppressTrailingRedirects = prev;
		}
	}
	/**
	* Read an optional `in word1 word2 ...` clause used by `for` and `select`,
	* up to `do`. Returns `undefined` if there's no `in` keyword.
	*/
	collectLoopItems() {
		if (!this.matchKeyword("in")) return void 0;
		this.consumeKeyword("in");
		const items = [];
		while (this.matchWord() && !this.matchKeyword("do")) {
			const tok = this.consume();
			if (tok.type !== "word") throw new Error("Expected loop item word");
			items.push(this.wordFromToken(tok));
		}
		return items.length > 0 ? items : void 0;
	}
	parseStatementList(left, endSymbol) {
		return this.allowNestedTrailingRedirects(() => this.parseStatementListInner(left, endSymbol));
	}
	parseStatementListInner(left, endSymbol) {
		const body = [];
		this.skipSeparators();
		while (!this.matchSymbol(endSymbol)) {
			if (this.isEof()) throw new Error(`Unexpected end of input while looking for ${endSymbol}`);
			body.push(this.parseStatement());
			this.skipSeparators();
		}
		if (body.length === 0 && !isZsh(this.options.dialect)) throw new Error(`"${left}" must be followed by a statement list`);
		return body;
	}
	/**
	* Parse an `if`/`elif` chain starting at the head keyword. The caller has
	* already verified the head is `head` (either `"if"` or `"elif"`). The
	* outermost call consumes the trailing `fi`; recursive elif calls don't.
	*/
	parseIfChain(head) {
		const headTok = this.consumeKeyword(head);
		const cond = this.parseStatementsUntilKeyword(head, ["then"]);
		this.consumeKeyword("then");
		const thenBranch = this.parseStatementsUntilKeyword("then", [
			"else",
			"elif",
			"fi"
		]);
		let elseBranch;
		if (this.matchKeyword("elif")) {
			const inner = this.parseIfChain("elif");
			elseBranch = [this.wrapStatement(inner)];
		} else if (this.matchKeyword("else")) {
			this.consumeKeyword("else");
			elseBranch = this.parseStatementsUntilKeyword("else", ["fi"]);
		}
		const endPos = head === "if" ? this.consumeKeyword("fi").end : this.lastEnd() ?? headTok.end;
		const node = {
			type: "IfClause",
			cond,
			then: thenBranch,
			pos: headTok.pos,
			end: endPos
		};
		if (elseBranch) node.else = elseBranch;
		if (head === "if") this.parseTrailingRedirects(node);
		return node;
	}
	parseIfClause() {
		return this.parseIfChain("if");
	}
	parseWhileClause(until) {
		const head = this.consumeKeyword(until ? "until" : "while");
		const keyword = until ? "until" : "while";
		const cond = this.parseStatementsUntilKeyword(keyword, ["do"]);
		this.consumeKeyword("do");
		const body = this.parseStatementsUntilKeyword("do", ["done"]);
		const done = this.consumeKeyword("done");
		const node = {
			type: "WhileClause",
			cond,
			body,
			pos: head.pos,
			end: done.end
		};
		if (until) node.until = true;
		this.parseTrailingRedirects(node);
		return node;
	}
	parseForOrCStyleLoop() {
		const forTok = this.consumeKeyword("for");
		if (this.matchArithCmd()) return this.parseCStyleLoop(forTok.pos);
		const nameToken = this.consume();
		if (nameToken.type !== "word") throw new Error("Expected loop variable name");
		const name = tokenPartsText(nameToken.parts);
		const items = this.collectLoopItems();
		if (this.matchOp(";")) this.consume();
		this.skipSeparators();
		this.consumeKeyword("do");
		const body = this.parseStatementsUntilKeyword("do", ["done"]);
		const done = this.consumeKeyword("done");
		const node = {
			type: "ForClause",
			name,
			body,
			pos: forTok.pos,
			end: done.end
		};
		if (items) node.items = items;
		this.parseTrailingRedirects(node);
		return node;
	}
	parseCStyleLoop(startPos) {
		const token = this.consume();
		if (token.type !== "arith-cmd") throw new Error("Expected (( )) in c-style for");
		checkLang(this.options.dialect, startPos, "for ((", [
			"bash",
			"mksh",
			"zsh"
		]);
		const base = {
			offset: token.innerOffset,
			line: token.pos.line,
			col: token.pos.col + 2
		};
		const partMap = new SourceMap(token.expr);
		const [initPart, condPart, postPart] = splitAtTopLevel(token.expr, ";");
		const baseFor = (part) => {
			const inner = partMap.posAt(part.offset);
			return {
				offset: base.offset + part.offset,
				line: base.line + inner.line - 1,
				col: inner.line === 1 ? base.col + inner.col - 1 : inner.col
			};
		};
		const init = initPart?.raw ? parseArithmetic(initPart.raw, baseFor(initPart)) : void 0;
		const cond = condPart?.raw ? parseArithmetic(condPart.raw, baseFor(condPart)) : void 0;
		const post = postPart?.raw ? parseArithmetic(postPart.raw, baseFor(postPart)) : void 0;
		if (this.matchOp(";")) this.consume();
		this.skipSeparators();
		this.consumeKeyword("do");
		const loop = {
			type: "CStyleLoop",
			body: this.parseStatementsUntilKeyword("do", ["done"]),
			pos: startPos,
			end: this.consumeKeyword("done").end
		};
		if (init !== void 0) loop.init = init;
		if (cond !== void 0) loop.cond = cond;
		if (post !== void 0) loop.post = post;
		this.parseTrailingRedirects(loop);
		return loop;
	}
	parseSelectClause() {
		const head = this.consumeKeyword("select");
		checkLang(this.options.dialect, head.pos, "select", [
			"bash",
			"mksh",
			"zsh"
		]);
		const nameToken = this.consume();
		if (nameToken.type !== "word") throw new Error("Expected select variable name");
		const name = tokenPartsText(nameToken.parts);
		let items;
		if (this.matchKeyword("in")) {
			this.consumeKeyword("in");
			const collected = [];
			while (this.matchWord() && !this.matchKeyword("do")) {
				const itemToken = this.consume();
				if (itemToken.type !== "word") throw new Error("Expected select item word");
				collected.push(this.wordFromToken(itemToken));
			}
			if (collected.length > 0) items = collected;
		}
		if (this.matchOp(";")) this.consume();
		this.skipSeparators();
		this.consumeKeyword("do");
		const body = this.parseStatementsUntilKeyword("do", ["done"]);
		const done = this.consumeKeyword("done");
		const node = {
			type: "SelectClause",
			name,
			body,
			pos: head.pos,
			end: done.end
		};
		if (items) node.items = items;
		this.parseTrailingRedirects(node);
		return node;
	}
	parseFunctionDecl() {
		let startPos;
		if (this.matchKeyword("function")) {
			const fk = this.consumeKeyword("function");
			checkLang(this.options.dialect, fk.pos, "function", [
				"bash",
				"mksh",
				"zsh"
			]);
			startPos = fk.pos;
		}
		const nameToken = this.consume();
		if (nameToken.type !== "word") throw new Error("Expected function name");
		if (!startPos) startPos = nameToken.pos;
		const name = tokenPartsText(nameToken.parts);
		if (this.matchSymbol("(")) {
			this.consumeSymbol("(");
			this.consumeSymbol(")");
		}
		if (this.matchSymbol("{")) {
			const block = this.withSuppressedTrailingRedirects(() => this.parseBlock());
			const node = {
				type: "FunctionDecl",
				name,
				body: block.body,
				pos: startPos,
				end: block.end ?? startPos
			};
			this.parseTrailingRedirects(node);
			return node;
		}
		throw new Error("Expected function body block");
	}
	parseCaseClause() {
		const head = this.consumeKeyword("case");
		const wordToken = this.consume();
		if (wordToken.type !== "word") throw new Error("Expected case word");
		const word = this.wordFromToken(wordToken);
		this.consumeKeyword("in");
		const items = [];
		this.skipSeparators();
		while (!this.matchKeyword("esac")) {
			const itemStart = this.peek()?.pos ?? head.pos;
			const patterns = [];
			while (!this.matchSymbol(")")) {
				if (this.matchWord()) {
					const patternToken = this.consume();
					if (patternToken.type !== "word") throw new Error("Expected case pattern");
					patterns.push(this.wordFromToken(patternToken));
					continue;
				}
				if (this.matchOp("|")) {
					this.consume();
					continue;
				}
				throw new Error("Expected case pattern or )");
			}
			this.consumeSymbol(")");
			const body = this.parseCaseItemBody();
			const itemEnd = this.lastEnd() ?? itemStart;
			items.push({
				type: "CaseItem",
				patterns,
				body,
				pos: itemStart,
				end: itemEnd
			});
			if (this.matchOp(";") && this.peekOp(";")) {
				this.consume();
				this.consume();
			}
			this.skipSeparators();
		}
		const esac = this.consumeKeyword("esac");
		const node = {
			type: "CaseClause",
			word,
			items,
			pos: head.pos,
			end: esac.end
		};
		this.parseTrailingRedirects(node);
		return node;
	}
	parseTimeClause() {
		const head = this.consumeKeyword("time");
		const command = this.parseStatement();
		return {
			type: "TimeClause",
			command,
			pos: head.pos,
			end: command.end ?? head.end
		};
	}
	parseTestClause() {
		const open = this.consumeKeyword("[[");
		checkLang(this.options.dialect, open.pos, "[[", [
			"bash",
			"mksh",
			"zsh"
		]);
		const x = this.parseTestExpr(0);
		const close = this.consumeKeyword("]]");
		const node = {
			type: "TestClause",
			x,
			pos: open.pos,
			end: close.end
		};
		this.parseTrailingRedirects(node);
		return node;
	}
	parseTestExpr(minPrec) {
		let left = this.parseTestPrimary();
		while (true) {
			const op = this.peekTestBinaryOp();
			if (!op) break;
			const prec = op === "||" ? 1 : op === "&&" ? 2 : 3;
			if (prec < minPrec) break;
			this.consumeTestOp(op);
			const right = this.parseTestExpr(prec + 1);
			left = {
				type: "BinaryTest",
				op,
				x: left,
				y: right,
				pos: left.pos ?? ZERO_POS,
				end: right.end ?? ZERO_POS
			};
		}
		return left;
	}
	parseTestPrimary() {
		if (this.matchOp("!")) {
			const op = this.consume();
			const x = this.parseTestPrimary();
			return {
				type: "UnaryTest",
				op: "!",
				x,
				pos: op.pos,
				end: x.end ?? op.end
			};
		}
		if (this.matchSymbol("(")) {
			const open = this.consumeSymbol("(");
			const x = this.parseTestExpr(0);
			const close = this.consumeSymbol(")");
			return {
				type: "ParenTest",
				x,
				pos: open.pos,
				end: close.end
			};
		}
		const head = this.peek();
		if (head && head.type === "word") {
			const text = tokenPartsText(head.parts);
			if (TEST_UNARY_OPS.has(text)) {
				this.consume();
				const arg = this.parseTestPrimary();
				return {
					type: "UnaryTest",
					op: text,
					x: arg,
					pos: head.pos,
					end: arg.end ?? head.end
				};
			}
		}
		if (this.matchWord()) {
			const tok = this.consume();
			if (tok.type !== "word") throw new Error("expected word in [[ ]]");
			return this.wordFromToken(tok);
		}
		throw new Error("Expected expression inside [[ ]]");
	}
	peekTestBinaryOp() {
		const tok = this.peek();
		if (!tok) return void 0;
		if (tok.type === "op" && (tok.value === "&&" || tok.value === "||")) return tok.value;
		if (tok.type === "word") {
			const text = tokenPartsText(tok.parts);
			if (TEST_BINARY_OPS.has(text)) return text;
		}
	}
	consumeTestOp(op) {
		const tok = this.consume();
		if (tok.type === "op" && tok.value === op) return;
		if (tok.type === "word" && tokenPartsText(tok.parts) === op) return;
		throw new Error(`expected test op ${op}`);
	}
	matchArithCmd() {
		return this.peek()?.type === "arith-cmd";
	}
	consumeArithCmd() {
		const token = this.consume();
		if (token.type !== "arith-cmd") throw new Error("Expected arithmetic command");
		checkLang(this.options.dialect, token.pos, "(( ))", [
			"bash",
			"mksh",
			"zsh"
		]);
		const x = parseArithmetic(token.expr, {
			offset: token.innerOffset,
			line: token.pos.line,
			col: token.pos.col + 2
		});
		const cmd = {
			type: "ArithCmd",
			pos: token.pos,
			end: token.end
		};
		if (x) cmd.x = x;
		return cmd;
	}
	parseCoprocClause() {
		const head = this.consumeKeyword("coproc");
		checkLang(this.options.dialect, head.pos, "coproc", ["bash", "zsh"]);
		if (this.matchWord() && this.peekToken(1)?.type === "symbol") {
			const nameToken = this.peek();
			if (nameToken?.type === "word" && this.peekToken(1)?.type === "symbol" && this.peekToken(1).value === "{") {
				const name = tokenPartsText(nameToken.parts);
				this.consume();
				const body = this.withSuppressedTrailingRedirects(() => this.parseStatement());
				const node = {
					type: "CoprocClause",
					name,
					body,
					pos: head.pos,
					end: body.end ?? head.end
				};
				this.parseTrailingRedirects(node);
				return node;
			}
		}
		const body = this.withSuppressedTrailingRedirects(() => this.parseStatement());
		const node = {
			type: "CoprocClause",
			body,
			pos: head.pos,
			end: body.end ?? head.end
		};
		this.parseTrailingRedirects(node);
		return node;
	}
	parseCaseItemBody() {
		return this.allowNestedTrailingRedirects(() => this.parseCaseItemBodyInner());
	}
	parseCaseItemBodyInner() {
		const body = [];
		this.skipCaseSeparators();
		while (!this.matchKeyword("esac") && !this.isCaseItemEnd()) {
			body.push(this.parseStatement());
			if (this.isCaseItemEnd()) break;
			this.skipCaseSeparators();
		}
		return body;
	}
	isCaseItemEnd() {
		return this.matchOp(";") && this.peekOp(";");
	}
	parseStatementsUntilKeyword(left, endKeywords) {
		return this.allowNestedTrailingRedirects(() => this.parseStatementsUntilKeywordInner(left, endKeywords));
	}
	parseStatementsUntilKeywordInner(left, endKeywords) {
		const body = [];
		this.skipSeparators();
		while (!this.matchKeywordIn(endKeywords)) {
			if (this.isEof()) throw new Error(`Unexpected end of input while looking for ${endKeywords.join(", ")}`);
			body.push(this.parseStatement());
			this.skipSeparators();
		}
		if (body.length === 0 && !isZsh(this.options.dialect)) throw new Error(`"${left}" must be followed by a statement list`);
		return body;
	}
	matchDeclKeyword() {
		const token = this.peek();
		if (token?.type !== "word" || token.parts.length !== 1) return false;
		const part = token.parts[0];
		return part?.type === "lit" && DECL_KEYWORDS.has(part.value);
	}
	parseDeclClause() {
		const variantToken = this.consume();
		if (variantToken.type !== "word") throw new Error("Expected decl keyword");
		const variant = tokenPartsText(variantToken.parts);
		if (variant !== "export" && variant !== "readonly") checkLang(this.options.dialect, variantToken.pos, variant, [
			"bash",
			"mksh",
			"zsh"
		]);
		const args = [];
		const assigns = [];
		const redirects = [];
		while (true) {
			if (this.matchRedir()) {
				redirects.push(this.parseRedirect());
				continue;
			}
			if (this.matchWord()) {
				const token = this.peek();
				if (token?.type !== "word") break;
				const assignment = this.tryParseAssignment(token);
				if (assignment) {
					assigns.push(assignment);
					continue;
				}
				this.consume();
				args.push(this.wordFromToken(token));
				continue;
			}
			break;
		}
		const lastEnd = this.lastEnd() ?? variantToken.end;
		const decl = {
			type: "DeclClause",
			variant,
			pos: variantToken.pos,
			end: lastEnd
		};
		if (args.length > 0) decl.args = args;
		if (assigns.length > 0) decl.assigns = assigns;
		if (redirects.length > 0) decl.redirects = redirects;
		return decl;
	}
	parseLetClause() {
		const letTok = this.consumeKeyword("let");
		checkLang(this.options.dialect, letTok.pos, "let", [
			"bash",
			"mksh",
			"zsh"
		]);
		const exprs = [];
		const redirects = [];
		while (true) {
			if (this.matchRedir()) {
				redirects.push(this.parseRedirect());
				continue;
			}
			if (this.matchWord()) {
				const token = this.consume();
				if (token.type !== "word") break;
				exprs.push(this.wordFromToken(token));
				continue;
			}
			break;
		}
		if (exprs.length === 0) throw new Error("let requires at least one expression");
		const clause = {
			type: "LetClause",
			exprs,
			pos: letTok.pos,
			end: this.lastEnd() ?? letTok.end
		};
		if (redirects.length > 0) clause.redirects = redirects;
		return clause;
	}
	parseSimpleCommand() {
		const startPos = this.peek()?.pos ?? ZERO_POS;
		const words = [];
		const assignments = [];
		const redirects = [];
		let sawWord = false;
		while (true) {
			if (this.matchWord()) {
				const token = this.peek();
				if (token?.type !== "word") throw new Error("Expected word token");
				if (!sawWord) {
					const assignment = this.tryParseAssignment(token);
					if (assignment) {
						assignments.push(assignment);
						continue;
					}
				}
				this.consume();
				sawWord = true;
				words.push(this.wordFromToken(token));
				continue;
			}
			if (this.matchRedir()) {
				redirects.push(this.parseRedirect());
				continue;
			}
			break;
		}
		if (words.length === 0 && assignments.length === 0 && redirects.length === 0) throw new Error("Expected a command word");
		const command = {
			type: "SimpleCommand",
			pos: startPos,
			end: this.lastEnd() ?? startPos
		};
		if (words.length > 0) command.words = words;
		if (assignments.length > 0) command.assignments = assignments;
		if (redirects.length > 0) command.redirects = redirects;
		return command;
	}
	parseRedirect() {
		const token = this.consume();
		if (token.type !== "redir") throw new Error("Expected redirect token");
		const targetToken = this.consume();
		if (targetToken.type !== "word") throw new Error("Redirect must be followed by a word");
		const target = this.wordFromToken(targetToken);
		const redirect = token.fd ? {
			type: "Redirect",
			op: token.op,
			fd: token.fd,
			target,
			pos: token.pos,
			end: target.end ?? targetToken.end
		} : {
			type: "Redirect",
			op: token.op,
			target,
			pos: token.pos,
			end: target.end ?? targetToken.end
		};
		if (token.op === "<<" || token.op === "<<-") this.pendingHeredocs.push(redirect);
		return redirect;
	}
	/**
	* Attach tokenizer-emitted heredoc-body tokens to the redirects that
	* opened them, in opener order. Orphan body tokens (no pending redirect)
	* are left in the stream for the caller to report.
	*/
	drainPendingHeredocs() {
		while (this.peek()?.type === "heredoc-body" && this.pendingHeredocs.length > 0) {
			const redirect = this.pendingHeredocs.shift();
			if (!redirect) break;
			const bodyToken = this.consume();
			if (bodyToken.type !== "heredoc-body") break;
			redirect.heredoc = {
				type: "Word",
				parts: [{
					type: "Literal",
					value: bodyToken.content,
					pos: bodyToken.pos,
					end: bodyToken.end
				}],
				pos: bodyToken.pos,
				end: bodyToken.end
			};
			redirect.end = bodyToken.end;
		}
	}
	convertWordPart(part) {
		switch (part.type) {
			case "lit": return {
				type: "Literal",
				value: part.value,
				pos: part.pos,
				end: part.end
			};
			case "sgl": return {
				type: "SglQuoted",
				value: part.value,
				pos: part.pos,
				end: part.end
			};
			case "dbl": return {
				type: "DblQuoted",
				parts: part.parts.map((p) => this.convertWordPart(p)),
				pos: part.pos,
				end: part.end
			};
			case "param": return this.convertParamExp(part);
			case "cmd-subst": return {
				type: "CmdSubst",
				stmts: new Parser(tokenize(part.raw)).parseProgram().body,
				pos: part.pos,
				end: part.end
			};
			case "arith-exp": {
				const x = parseArithmetic(part.raw, {
					offset: part.innerOffset,
					line: part.pos.line,
					col: part.pos.col + 3
				});
				if (!x) throw new Error("Empty arithmetic expansion");
				return {
					type: "ArithExp",
					x,
					pos: part.pos,
					end: part.end
				};
			}
			case "proc-subst": {
				const prog = new Parser(tokenize(part.raw)).parseProgram();
				return {
					type: "ProcSubst",
					op: part.op,
					stmts: prog.body,
					pos: part.pos,
					end: part.end
				};
			}
			case "backtick": return {
				type: "CmdSubst",
				stmts: new Parser(tokenize(part.raw)).parseProgram().body,
				pos: part.pos,
				end: part.end
			};
			case "ext-glob": return {
				type: "ExtGlob",
				op: part.op,
				pattern: part.pattern,
				pos: part.pos,
				end: part.end
			};
		}
	}
	convertParamExp(part) {
		const out = {
			type: "ParamExp",
			short: !part.braced,
			param: {
				type: "Literal",
				value: part.name
			},
			pos: part.pos,
			end: part.end
		};
		if (part.length) out.length = true;
		if (part.excl) out.excl = true;
		if (part.index !== void 0) out.index = strToWord(part.index);
		if (part.slice) {
			const slice = { offset: strToWord(part.slice.offset) };
			if (part.slice.length !== void 0) slice.length = strToWord(part.slice.length);
			out.slice = slice;
		}
		if (part.replace) {
			const r = { orig: strToWord(part.replace.orig) };
			if (part.replace.with !== void 0) r.with = strToWord(part.replace.with);
			if (part.replace.all) r.all = true;
			if (part.replace.prefix) r.prefix = true;
			if (part.replace.suffix) r.suffix = true;
			out.replace = r;
		}
		if (part.exp) {
			const exp = { op: part.exp.op };
			if (part.exp.value !== void 0) exp.word = strToWord(part.exp.value);
			out.exp = exp;
		}
		return out;
	}
	wordFromToken(token) {
		return {
			type: "Word",
			parts: token.parts.map((part) => this.convertWordPart(part)),
			pos: token.pos,
			end: token.end
		};
	}
	/**
	* Try to parse an assignment from a word token.
	* Consumes tokens itself if it matches; returns undefined otherwise.
	*/
	tryParseAssignment(token) {
		const parts = token.parts;
		if (parts.length !== 1) return void 0;
		const part = parts[0];
		if (part?.type !== "lit") return void 0;
		const raw = part.value;
		let append = false;
		let eqIndex = raw.indexOf("+=");
		if (eqIndex > 0) append = true;
		else eqIndex = raw.indexOf("=");
		if (eqIndex <= 0) return void 0;
		const name = raw.slice(0, eqIndex);
		if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) return void 0;
		const afterEq = raw.slice(eqIndex + (append ? 2 : 1));
		const nextToken = this.peekToken(1);
		if (afterEq === "" && nextToken?.type === "symbol" && nextToken.value === "(") {
			checkLang(this.options.dialect, token.pos, "array assignment", [
				"bash",
				"mksh",
				"zsh"
			]);
			this.consume();
			return this.parseArrayAssignment(name, append, token.pos);
		}
		if (append) checkLang(this.options.dialect, token.pos, "+=", [
			"bash",
			"mksh",
			"zsh"
		]);
		this.consume();
		const assignment = {
			type: "Assignment",
			name,
			pos: token.pos,
			end: token.end
		};
		if (append) assignment.append = true;
		if (afterEq.length > 0) assignment.value = {
			type: "Word",
			parts: [{
				type: "Literal",
				value: afterEq
			}]
		};
		return assignment;
	}
	parseArrayAssignment(name, append, startPos) {
		const open = this.consumeSymbol("(");
		const elems = [];
		while (!this.matchSymbol(")")) {
			if (this.isEof()) throw new Error("Unclosed array expression");
			if (this.matchOp(";")) {
				this.consume();
				continue;
			}
			if (this.matchComment()) {
				this.consumeComment();
				continue;
			}
			const token = this.consume();
			if (token.type !== "word") throw new Error("Expected word in array expression");
			const indexMatch = tokenPartsText(token.parts).match(/^\[([^\]]+)\]=(.*)$/);
			if (indexMatch) {
				const indexStr = indexMatch[1];
				const valStr = indexMatch[2];
				const elem = {
					type: "ArrayElem",
					index: {
						type: "Word",
						parts: [{
							type: "Literal",
							value: indexStr
						}]
					},
					pos: token.pos,
					end: token.end
				};
				if (valStr.length > 0) elem.value = {
					type: "Word",
					parts: [{
						type: "Literal",
						value: valStr
					}]
				};
				elems.push(elem);
			} else elems.push({
				type: "ArrayElem",
				value: this.wordFromToken(token),
				pos: token.pos,
				end: token.end
			});
		}
		const close = this.consumeSymbol(")");
		const assignment = {
			type: "Assignment",
			name,
			array: {
				type: "ArrayExpr",
				elems,
				pos: open.pos,
				end: close.end
			},
			pos: startPos,
			end: close.end
		};
		if (append) assignment.append = true;
		return assignment;
	}
	/**
	* Skip comments and line breaks between a binary operator (`&&`, `||`,
	* `|`) and the command continuing on the next line, e.g. `cmd && # note\n`
	* `next`. Bash accepts comments and blank lines inside an operator
	* continuation. Any heredoc bodies queued before those separators are
	* drained along the way. A literal `;` after the operator is not skipped,
	* so `cmd && ; next` still fails.
	*/
	skipOperatorContinuation() {
		while (true) {
			this.drainPendingHeredocs();
			if (this.matchComment()) {
				this.consumeComment();
				continue;
			}
			const token = this.peek();
			if (token?.type === "op" && token.value === ";" && token.newline) {
				this.consume();
				continue;
			}
			break;
		}
	}
	skipSeparators() {
		while (true) {
			this.drainPendingHeredocs();
			if (this.matchOp(";")) {
				this.consume();
				continue;
			}
			if (this.matchComment()) {
				this.consumeComment();
				continue;
			}
			break;
		}
	}
	skipCaseSeparators() {
		while (true) {
			this.drainPendingHeredocs();
			if (this.matchOp(";") && !this.peekOp(";")) {
				this.consume();
				continue;
			}
			break;
		}
	}
	wrapStatement(command) {
		return {
			type: "Statement",
			command,
			pos: command.pos ?? ZERO_POS,
			end: command.end ?? ZERO_POS
		};
	}
	matchOp(value) {
		const token = this.peek();
		return token?.type === "op" && token.value === value;
	}
	matchWord() {
		return this.peek()?.type === "word";
	}
	matchRedir() {
		return this.peek()?.type === "redir";
	}
	matchKeyword(value) {
		const token = this.peek();
		if (token?.type !== "word" || token.parts.length !== 1) return false;
		const part = token.parts[0];
		return part?.type === "lit" && part.value === value;
	}
	matchKeywordIn(values) {
		return values.some((value) => this.matchKeyword(value));
	}
	looksLikeFuncDecl() {
		const name = this.peek();
		const next = this.peekToken(1);
		const nextNext = this.peekToken(2);
		const after = this.peekToken(3);
		return name?.type === "word" && next?.type === "symbol" && next.value === "(" && nextNext?.type === "symbol" && nextNext.value === ")" && after?.type === "symbol" && after.value === "{";
	}
	matchSymbol(value) {
		const token = this.peek();
		return token?.type === "symbol" && token.value === value;
	}
	consumeSymbol(value) {
		const token = this.consume();
		if (token.type !== "symbol" || token.value !== value) throw new Error(`Expected symbol ${value}`);
		return token;
	}
	consumeKeyword(value) {
		const token = this.consume();
		if (token.type !== "word" || token.parts.length !== 1 || token.parts[0]?.type !== "lit" || token.parts[0].value !== value) throw new Error(`Expected keyword ${value}`);
		return token;
	}
	consume() {
		if (this.isEof()) throw new Error("Unexpected end of input");
		const token = this.tokens[this.index];
		if (!token) throw new Error("Unexpected end of input");
		this.index += 1;
		return token;
	}
	peek() {
		return this.tokens[this.index];
	}
	peekToken(offset) {
		return this.tokens[this.index + offset];
	}
	peekOp(value) {
		const token = this.peekToken(1);
		return token?.type === "op" && token.value === value;
	}
	matchComment() {
		return this.peek()?.type === "comment";
	}
	consumeComment() {
		const token = this.consume();
		if (token.type === "comment") this.comments.push({
			type: "Comment",
			text: token.text,
			pos: token.pos,
			end: token.end
		});
	}
	isEof() {
		return this.index >= this.tokens.length;
	}
	lastEnd() {
		return this.tokens[this.index - 1]?.end;
	}
};

//#endregion
//#region src/parse.ts
function parse(source, options = {}) {
	if (options.recoverErrors) return parseRecovering(source, options);
	const parser = new Parser(tokenize(source, options), options);
	const ast = parser.parseProgram();
	parser.assertEof();
	return { ast };
}
function parseRecovering(source, options) {
	const errors = [];
	let tokens;
	try {
		tokens = tokenize(source, options);
	} catch (e) {
		errors.push({
			message: e instanceof Error ? e.message : String(e),
			pos: {
				offset: 0,
				line: 1,
				col: 1
			}
		});
		return {
			ast: {
				type: "Program",
				body: [],
				pos: {
					offset: 0,
					line: 1,
					col: 1
				},
				end: new SourceMap(source).posAt(source.length)
			},
			errors
		};
	}
	const result = new Parser(tokens, options).parseProgramRecovering(errors);
	return errors.length > 0 ? {
		ast: result,
		errors
	} : { ast: result };
}

//#endregion
//#region src/seq.ts
/**
* Lazily parse `source` and yield each top-level statement as it becomes
* available. Useful for streaming consumers (REPLs, progressive analysis
* tools) that don't need the whole `Program` up front.
*
* Mirrors mvdan/sh's `Parser.StmtsSeq`.
*/
function* parseStmtsSeq(source, options = {}) {
	yield* new Parser(tokenize(source, options), options).statementsSeq();
}
/**
* Lazily parse `source` as a sequence of words (no statement structure),
* yielding each one. Useful for argv-style inputs.
*
* Mirrors mvdan/sh's `Parser.WordsSeq`.
*/
function* parseWordsSeq(source, options = {}) {
	yield* new Parser(tokenize(source, options), options).wordsSeq();
}

//#endregion
//#region src/split-braces.ts
/**
* Parse Bash brace expansions inside a word's literal parts, replacing them
* with `BraceExp` nodes. Mutates the word in place. Returns true if the word
* was modified.
*
* Mirrors the contract of mvdan/sh's `syntax.SplitBraces`: malformed brace
* expressions are left as plain literals rather than producing errors.
*/
function splitBraces(word) {
	if (!word.parts.some((p) => p.type === "Literal" && p.value.includes("{"))) return false;
	const top = {
		type: "Word",
		parts: []
	};
	let acc = top;
	let cur;
	const open = [];
	const fixedLit = (value) => ({
		type: "Literal",
		value
	});
	const addLit = (l) => {
		acc.parts.push(l);
	};
	const pop = () => {
		const old = cur;
		open.pop();
		if (open.length === 0) {
			cur = void 0;
			acc = top;
		} else {
			cur = open[open.length - 1];
			const lastElem = cur?.elems[cur.elems.length - 1];
			if (lastElem) acc = lastElem;
		}
		if (!old) throw new Error("invariant: pop called with no current brace");
		return old;
	};
	for (const wp of word.parts) {
		if (wp.type !== "Literal") {
			acc.parts.push(wp);
			continue;
		}
		const value = wp.value;
		let last = 0;
		const flushSlice = (j) => {
			if (last === j) return;
			addLit({
				type: "Literal",
				value: value.slice(last, j)
			});
		};
		let j = 0;
		while (j < value.length) {
			switch (value[j]) {
				case "\\":
					j += 2;
					continue;
				case "{": {
					flushSlice(j);
					const inner = {
						type: "Word",
						parts: []
					};
					const next = {
						type: "BraceExp",
						elems: [inner]
					};
					acc = inner;
					cur = next;
					open.push(next);
					break;
				}
				case ",": {
					if (!cur) {
						j += 1;
						continue;
					}
					flushSlice(j);
					const inner = {
						type: "Word",
						parts: []
					};
					cur.elems.push(inner);
					acc = inner;
					break;
				}
				case ".": {
					if (!cur || value[j + 1] !== ".") {
						j += 1;
						continue;
					}
					flushSlice(j);
					cur.sequence = true;
					const inner = {
						type: "Word",
						parts: []
					};
					cur.elems.push(inner);
					acc = inner;
					j += 1;
					break;
				}
				case "}": {
					if (!cur) {
						j += 1;
						continue;
					}
					flushSlice(j);
					const br = pop();
					if (br.elems.length === 1) {
						addLit(fixedLit("{"));
						const only = br.elems[0];
						if (only) acc.parts.push(...only.parts);
						addLit(fixedLit("}"));
						break;
					}
					if (!br.sequence) {
						acc.parts.push(br);
						break;
					}
					if (validSequence(br)) {
						acc.parts.push(br);
						break;
					}
					addLit(fixedLit("{"));
					for (let i = 0; i < br.elems.length; i++) {
						if (i > 0) addLit(fixedLit(".."));
						const e = br.elems[i];
						if (e) acc.parts.push(...e.parts);
					}
					addLit(fixedLit("}"));
					break;
				}
				default:
					j += 1;
					continue;
			}
			last = j + 1;
			j += 1;
		}
		if (last === 0) addLit(wp);
		else if (last < value.length) addLit({
			type: "Literal",
			value: value.slice(last)
		});
	}
	while (acc !== top) {
		const br = pop();
		addLit(fixedLit("{"));
		for (let i = 0; i < br.elems.length; i++) {
			if (i > 0) addLit(br.sequence ? fixedLit("..") : fixedLit(","));
			const e = br.elems[i];
			if (e) acc.parts.push(...e.parts);
		}
	}
	word.parts = top.parts;
	return true;
}
function validSequence(br) {
	if (br.elems.length < 2 || br.elems.length > 3) return false;
	const a = wordLiteralValue(br.elems[0]);
	const b = wordLiteralValue(br.elems[1]);
	if (a === void 0 || b === void 0) return false;
	const aIsChar = a.length === 1 && isAsciiLetter(a);
	const bIsChar = b.length === 1 && isAsciiLetter(b);
	if (!(aIsChar && bIsChar || isInteger(a) && isInteger(b))) return false;
	if (br.elems.length === 3) {
		const c = wordLiteralValue(br.elems[2]);
		if (c === void 0 || !isInteger(c)) return false;
	}
	return true;
}
function wordLiteralValue(w) {
	if (!w) return void 0;
	let out = "";
	for (const p of w.parts) {
		if (p.type !== "Literal") return void 0;
		out += p.value;
	}
	return out;
}

//#endregion
export { NO_POS, parse, parseStmtsSeq, parseWordsSeq, splitBraces };
//# sourceMappingURL=index.js.map