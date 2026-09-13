/**
 * A JSON5 subset parser, sufficient for the OS config fragments in `os/config.d/*.json5`.
 *
 * The `gkos` binary is deliberately dependency-free (plan §9 Phase 1: it is installed globally from a packed
 * tarball on a host that has nothing but Node), so it cannot pull in a JSON5 package. This parser accepts the
 * subset the fragment templates and operator overrides actually use and rejects everything else loudly, rather
 * than guessing: line and block comments, trailing commas, unquoted identifier keys, single-quoted strings.
 *
 * It is a parser only. Serialisation always goes out as strict JSON via `JSON.stringify`.
 */

/** A parsed JSON5 value. Fragments are always objects at the top level, but nested values may be anything. */
export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

/** Thrown with a line/column when a fragment cannot be parsed. Carries no fragment content, only a position. */
export class Json5Error extends Error {
  constructor(message: string, readonly line: number, readonly column: number, readonly file?: string) {
    super(`${file ? `${file}:` : ""}${line}:${column}: ${message}`);
    this.name = "Json5Error";
  }
}

const IDENT_START = /[A-Za-z_$]/;
const IDENT_PART = /[A-Za-z0-9_$]/;

/**
 * Parse a JSON5 fragment into a plain JavaScript value.
 *
 * @param text  fragment source
 * @param file  optional filename, used only to make error messages locatable
 */
export function parseJson5(text: string, file?: string): Json {
  let i = 0;

  const posOf = (at: number): [number, number] => {
    let line = 1;
    let lineStart = 0;
    for (let k = 0; k < at && k < text.length; k++) {
      if (text[k] === "\n") {
        line++;
        lineStart = k + 1;
      }
    }
    return [line, at - lineStart + 1];
  };
  const fail = (message: string, at = i): never => {
    const [line, column] = posOf(at);
    throw new Json5Error(message, line, column, file);
  };

  /** Consume whitespace and both comment forms. An unterminated block comment is an error, not EOF. */
  const skip = (): void => {
    for (;;) {
      while (i < text.length && /\s/.test(text[i]!)) i++;
      if (text[i] === "/" && text[i + 1] === "/") {
        while (i < text.length && text[i] !== "\n") i++;
        continue;
      }
      if (text[i] === "/" && text[i + 1] === "*") {
        const start = i;
        const end = text.indexOf("*/", i + 2);
        if (end === -1) fail("unterminated block comment", start);
        i = end + 2;
        continue;
      }
      return;
    }
  };

  const parseString = (): string => {
    const quote = text[i]!;
    i++;
    let out = "";
    for (;;) {
      if (i >= text.length) fail("unterminated string");
      const c = text[i]!;
      if (c === quote) {
        i++;
        return out;
      }
      if (c === "\n") fail("unescaped newline in string");
      if (c !== "\\") {
        out += c;
        i++;
        continue;
      }
      i++;
      const esc = text[i];
      if (esc === undefined) fail("unterminated escape");
      i++;
      switch (esc) {
        case "n": out += "\n"; break;
        case "t": out += "\t"; break;
        case "r": out += "\r"; break;
        case "b": out += "\b"; break;
        case "f": out += "\f"; break;
        case "0": out += "\0"; break;
        case "\n": break; // line continuation
        case "u": {
          const hex = text.slice(i, i + 4);
          if (!/^[0-9a-fA-F]{4}$/.test(hex)) fail("invalid \\u escape");
          out += String.fromCharCode(parseInt(hex, 16));
          i += 4;
          break;
        }
        default: out += esc;
      }
    }
  };

  const parseNumber = (): number => {
    const start = i;
    if (text[i] === "+" || text[i] === "-") i++;
    if (/^0[xX]/.test(text.slice(i, i + 2))) {
      i += 2;
      while (i < text.length && /[0-9a-fA-F]/.test(text[i]!)) i++;
    } else {
      while (i < text.length && /[0-9]/.test(text[i]!)) i++;
      if (text[i] === ".") {
        i++;
        while (i < text.length && /[0-9]/.test(text[i]!)) i++;
      }
      if (text[i] === "e" || text[i] === "E") {
        i++;
        if (text[i] === "+" || text[i] === "-") i++;
        while (i < text.length && /[0-9]/.test(text[i]!)) i++;
      }
    }
    const raw = text.slice(start, i);
    const value = Number(raw);
    if (raw === "" || !Number.isFinite(value)) fail(`invalid number '${raw}'`, start);
    return value;
  };

  const parseKey = (): string => {
    const c = text[i];
    if (c === '"' || c === "'") return parseString();
    if (c !== undefined && IDENT_START.test(c)) {
      const start = i;
      while (i < text.length && IDENT_PART.test(text[i]!)) i++;
      return text.slice(start, i);
    }
    return fail("expected an object key");
  };

  const parseValue = (): Json => {
    skip();
    const c = text[i];
    if (c === undefined) return fail("unexpected end of input");
    if (c === "{") {
      i++;
      const out: { [key: string]: Json } = {};
      skip();
      if (text[i] === "}") { i++; return out; }
      for (;;) {
        skip();
        const key = parseKey();
        skip();
        if (text[i] !== ":") fail("expected ':' after object key");
        i++;
        out[key] = parseValue();
        skip();
        if (text[i] === ",") { i++; skip(); if (text[i] === "}") { i++; return out; } continue; }
        if (text[i] === "}") { i++; return out; }
        return fail("expected ',' or '}' in object");
      }
    }
    if (c === "[") {
      i++;
      const out: Json[] = [];
      skip();
      if (text[i] === "]") { i++; return out; }
      for (;;) {
        out.push(parseValue());
        skip();
        if (text[i] === ",") { i++; skip(); if (text[i] === "]") { i++; return out; } continue; }
        if (text[i] === "]") { i++; return out; }
        return fail("expected ',' or ']' in array");
      }
    }
    if (c === '"' || c === "'") return parseString();
    if (text.startsWith("true", i)) { i += 4; return true; }
    if (text.startsWith("false", i)) { i += 5; return false; }
    if (text.startsWith("null", i)) { i += 4; return null; }
    if (/[-+0-9.]/.test(c)) return parseNumber();
    return fail(`unexpected character '${c}'`);
  };

  const value = parseValue();
  skip();
  if (i !== text.length) fail("trailing content after the top-level value");
  return value;
}

/** Parse a fragment and require it to be a JSON object, which every `config.d` fragment must be. */
export function parseFragment(text: string, file: string): Record<string, Json> {
  const value = parseJson5(text, file);
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Json5Error("a config fragment must be a JSON object at the top level", 1, 1, file);
  }
  return value as Record<string, Json>;
}
