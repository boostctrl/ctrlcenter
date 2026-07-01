// Serialize a value as JSON that's safe to embed inside an inline <script> in
// HTML. Plain JSON.stringify does NOT escape `<`, `>`, or `&`, so a string value
// containing `</script>` would close the script element early and let following
// bytes be parsed as HTML — a breakout / stored-XSS sink. We escape those (and
// the U+2028/U+2029 line separators, which are valid in JSON strings but can
// break older script parsers) to their `\uXXXX` forms. These characters only
// ever appear inside JSON string literals, and `<` etc. are valid JSON/JS
// escapes, so the output stays a valid object literal that parses back to the
// same value at runtime.
const LINE_SEP = String.fromCharCode(0x2028); // U+2028
const PARA_SEP = String.fromCharCode(0x2029); // U+2029
const SCRIPT_UNSAFE = new RegExp(`[<>&${LINE_SEP}${PARA_SEP}]`, "g");

export function serializeForScript(value: unknown): string {
  return JSON.stringify(value).replace(SCRIPT_UNSAFE, (c) => {
    switch (c) {
      case "<":
        return "\\u003c";
      case ">":
        return "\\u003e";
      case "&":
        return "\\u0026";
      case LINE_SEP:
        return "\\u2028";
      default:
        return "\\u2029";
    }
  });
}
