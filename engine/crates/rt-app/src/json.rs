//! A small JSON reader (RFC 8259, recursive descent) and the writing helpers the API needs.
//!
//! The launcher reads `src/data/ai-models.json` (embedded at build time), the version of
//! `package.json`, `pending-models.json` from the installer and small request bodies. Objects
//! keep their keys in file order.

use std::fmt;

/// A JSON value.
#[derive(Clone, Debug, PartialEq)]
pub enum Value {
    /// `null`
    Null,
    /// `true` or `false`
    Bool(bool),
    /// Any number, as a double.
    Number(f64),
    /// A string, unescaped.
    String(String),
    /// An array.
    Array(Vec<Value>),
    /// An object, keys in file order (a repeated key keeps every occurrence; `get` finds the
    /// first).
    Object(Vec<(String, Value)>),
}

/// Why a text is not JSON, and where.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Error {
    /// Byte offset of the problem.
    pub offset: usize,
    /// What is wrong.
    pub message: &'static str,
}

impl fmt::Display for Error {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "invalid JSON at byte {}: {}", self.offset, self.message)
    }
}

impl std::error::Error for Error {}

/// Deepest nesting accepted (the parser is recursive).
pub const MAX_DEPTH: usize = 128;

/// Parses a whole JSON text (surrounding whitespace allowed, nothing else after the value).
pub fn parse(text: &str) -> Result<Value, Error> {
    let mut p = Parser {
        bytes: text.as_bytes(),
        pos: 0,
    };
    // A UTF-8 byte order mark is tolerated (Windows tools write one).
    if p.bytes.starts_with(&[0xEF, 0xBB, 0xBF]) {
        p.pos = 3;
    }
    p.skip_ws();
    let value = p.value(0)?;
    p.skip_ws();
    if p.pos != p.bytes.len() {
        return Err(p.error("unexpected text after the value"));
    }
    Ok(value)
}

struct Parser<'a> {
    bytes: &'a [u8],
    pos: usize,
}

impl Parser<'_> {
    fn error(&self, message: &'static str) -> Error {
        Error {
            offset: self.pos,
            message,
        }
    }

    fn peek(&self) -> Option<u8> {
        self.bytes.get(self.pos).copied()
    }

    fn skip_ws(&mut self) {
        while let Some(b' ' | b'\t' | b'\n' | b'\r') = self.peek() {
            self.pos += 1;
        }
    }

    fn literal(&mut self, word: &str, value: Value) -> Result<Value, Error> {
        if self.bytes[self.pos..].starts_with(word.as_bytes()) {
            self.pos += word.len();
            Ok(value)
        } else {
            Err(self.error("unknown literal"))
        }
    }

    fn value(&mut self, depth: usize) -> Result<Value, Error> {
        if depth > MAX_DEPTH {
            return Err(self.error("nested too deeply"));
        }
        match self.peek() {
            None => Err(self.error("unexpected end")),
            Some(b'n') => self.literal("null", Value::Null),
            Some(b't') => self.literal("true", Value::Bool(true)),
            Some(b'f') => self.literal("false", Value::Bool(false)),
            Some(b'"') => self.string().map(Value::String),
            Some(b'[') => self.array(depth),
            Some(b'{') => self.object(depth),
            Some(b'-' | b'0'..=b'9') => self.number(),
            Some(_) => Err(self.error("unexpected character")),
        }
    }

    fn array(&mut self, depth: usize) -> Result<Value, Error> {
        self.pos += 1;
        let mut items = Vec::new();
        self.skip_ws();
        if self.peek() == Some(b']') {
            self.pos += 1;
            return Ok(Value::Array(items));
        }
        loop {
            self.skip_ws();
            items.push(self.value(depth + 1)?);
            self.skip_ws();
            match self.peek() {
                Some(b',') => self.pos += 1,
                Some(b']') => {
                    self.pos += 1;
                    return Ok(Value::Array(items));
                }
                _ => return Err(self.error("expected ',' or ']'")),
            }
        }
    }

    fn object(&mut self, depth: usize) -> Result<Value, Error> {
        self.pos += 1;
        let mut members = Vec::new();
        self.skip_ws();
        if self.peek() == Some(b'}') {
            self.pos += 1;
            return Ok(Value::Object(members));
        }
        loop {
            self.skip_ws();
            if self.peek() != Some(b'"') {
                return Err(self.error("expected a string key"));
            }
            let key = self.string()?;
            self.skip_ws();
            if self.peek() != Some(b':') {
                return Err(self.error("expected ':'"));
            }
            self.pos += 1;
            self.skip_ws();
            let value = self.value(depth + 1)?;
            members.push((key, value));
            self.skip_ws();
            match self.peek() {
                Some(b',') => self.pos += 1,
                Some(b'}') => {
                    self.pos += 1;
                    return Ok(Value::Object(members));
                }
                _ => return Err(self.error("expected ',' or '}'")),
            }
        }
    }

    fn hex4(&mut self) -> Result<u32, Error> {
        let digits = self
            .bytes
            .get(self.pos..self.pos + 4)
            .ok_or_else(|| self.error("truncated \\u escape"))?;
        let mut v = 0u32;
        for &d in digits {
            let n = (d as char)
                .to_digit(16)
                .ok_or_else(|| self.error("bad hex digit in \\u escape"))?;
            v = v * 16 + n;
        }
        self.pos += 4;
        Ok(v)
    }

    fn string(&mut self) -> Result<String, Error> {
        self.pos += 1; // the opening quote
        let mut out: Vec<u8> = Vec::new();
        loop {
            let Some(b) = self.peek() else {
                return Err(self.error("unterminated string"));
            };
            match b {
                b'"' => {
                    self.pos += 1;
                    // The input is a &str, so everything copied verbatim is valid UTF-8, and
                    // escapes are pushed as whole characters.
                    return String::from_utf8(out).map_err(|_| self.error("invalid UTF-8"));
                }
                b'\\' => {
                    self.pos += 1;
                    let e = self
                        .peek()
                        .ok_or_else(|| self.error("unterminated escape"))?;
                    self.pos += 1;
                    let c = match e {
                        b'"' => '"',
                        b'\\' => '\\',
                        b'/' => '/',
                        b'b' => '\u{8}',
                        b'f' => '\u{c}',
                        b'n' => '\n',
                        b'r' => '\r',
                        b't' => '\t',
                        b'u' => {
                            let first = self.hex4()?;
                            let code = match first {
                                0xD800..=0xDBFF => {
                                    if !self.bytes[self.pos..].starts_with(b"\\u") {
                                        return Err(self.error("lone high surrogate"));
                                    }
                                    self.pos += 2;
                                    let second = self.hex4()?;
                                    if !(0xDC00..=0xDFFF).contains(&second) {
                                        return Err(self.error("bad low surrogate"));
                                    }
                                    0x10000 + ((first - 0xD800) << 10) + (second - 0xDC00)
                                }
                                0xDC00..=0xDFFF => return Err(self.error("lone low surrogate")),
                                c => c,
                            };
                            char::from_u32(code).ok_or_else(|| self.error("bad code point"))?
                        }
                        _ => return Err(self.error("unknown escape")),
                    };
                    let mut buf = [0u8; 4];
                    out.extend_from_slice(c.encode_utf8(&mut buf).as_bytes());
                }
                0x00..=0x1F => return Err(self.error("control character in string")),
                _ => {
                    out.push(b);
                    self.pos += 1;
                }
            }
        }
    }

    fn number(&mut self) -> Result<Value, Error> {
        let start = self.pos;
        if self.peek() == Some(b'-') {
            self.pos += 1;
        }
        match self.peek() {
            Some(b'0') => self.pos += 1,
            Some(b'1'..=b'9') => {
                while let Some(b'0'..=b'9') = self.peek() {
                    self.pos += 1;
                }
            }
            _ => return Err(self.error("expected a digit")),
        }
        if self.peek() == Some(b'.') {
            self.pos += 1;
            if !matches!(self.peek(), Some(b'0'..=b'9')) {
                return Err(self.error("expected a digit after '.'"));
            }
            while let Some(b'0'..=b'9') = self.peek() {
                self.pos += 1;
            }
        }
        if let Some(b'e' | b'E') = self.peek() {
            self.pos += 1;
            if let Some(b'+' | b'-') = self.peek() {
                self.pos += 1;
            }
            if !matches!(self.peek(), Some(b'0'..=b'9')) {
                return Err(self.error("expected a digit in the exponent"));
            }
            while let Some(b'0'..=b'9') = self.peek() {
                self.pos += 1;
            }
        }
        // The slice is ASCII by construction.
        let text = std::str::from_utf8(&self.bytes[start..self.pos])
            .map_err(|_| self.error("invalid number"))?;
        let v: f64 = text.parse().map_err(|_| self.error("invalid number"))?;
        if !v.is_finite() {
            return Err(self.error("number out of range"));
        }
        Ok(Value::Number(v))
    }
}

impl Value {
    /// The member `key` of an object (the first one if repeated).
    pub fn get(&self, key: &str) -> Option<&Value> {
        match self {
            Value::Object(members) => members.iter().find(|(k, _)| k == key).map(|(_, v)| v),
            _ => None,
        }
    }

    /// The string, if this is one.
    pub fn as_str(&self) -> Option<&str> {
        match self {
            Value::String(s) => Some(s),
            _ => None,
        }
    }

    /// The number, if this is one.
    pub fn as_f64(&self) -> Option<f64> {
        match self {
            Value::Number(n) => Some(*n),
            _ => None,
        }
    }

    /// The boolean, if this is one.
    pub fn as_bool(&self) -> Option<bool> {
        match self {
            Value::Bool(b) => Some(*b),
            _ => None,
        }
    }

    /// The items, if this is an array.
    pub fn as_array(&self) -> Option<&[Value]> {
        match self {
            Value::Array(items) => Some(items),
            _ => None,
        }
    }

    /// True for `null`.
    pub fn is_null(&self) -> bool {
        matches!(self, Value::Null)
    }

    /// Serialises the value (compact).
    pub fn to_json(&self) -> String {
        let mut out = String::new();
        self.write(&mut out);
        out
    }

    fn write(&self, out: &mut String) {
        match self {
            Value::Null => out.push_str("null"),
            Value::Bool(b) => out.push_str(if *b { "true" } else { "false" }),
            Value::Number(n) => out.push_str(&number(*n)),
            Value::String(s) => out.push_str(&string(s)),
            Value::Array(items) => {
                out.push('[');
                for (i, v) in items.iter().enumerate() {
                    if i > 0 {
                        out.push(',');
                    }
                    v.write(out);
                }
                out.push(']');
            }
            Value::Object(members) => {
                out.push('{');
                for (i, (k, v)) in members.iter().enumerate() {
                    if i > 0 {
                        out.push(',');
                    }
                    out.push_str(&string(k));
                    out.push(':');
                    v.write(out);
                }
                out.push('}');
            }
        }
    }
}

/// `text` as a JSON string literal, quotes included.
pub fn string(text: &str) -> String {
    let mut out = String::with_capacity(text.len() + 2);
    out.push('"');
    for c in text.chars() {
        match c {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            c if (c as u32) < 0x20 => out.push_str(&format!("\\u{:04x}", c as u32)),
            c => out.push(c),
        }
    }
    out.push('"');
    out
}

/// A number as JSON: integers without a fraction, non-finite values as `null`.
pub fn number(n: f64) -> String {
    if !n.is_finite() {
        "null".into()
    } else if n.fract() == 0.0 && n.abs() < 9.0e15 {
        format!("{}", n as i64)
    } else {
        format!("{n}")
    }
}

/// Builds a JSON object member by member.
#[derive(Default)]
pub struct Object {
    out: String,
}

impl Object {
    /// An empty object.
    pub fn new() -> Object {
        Object::default()
    }

    fn key(&mut self, key: &str) {
        self.out.push(if self.out.is_empty() { '{' } else { ',' });
        self.out.push_str(&string(key));
        self.out.push(':');
    }

    /// A string member.
    pub fn str(mut self, key: &str, value: &str) -> Object {
        self.key(key);
        self.out.push_str(&string(value));
        self
    }

    /// A string member, or `null`.
    pub fn opt_str(mut self, key: &str, value: Option<&str>) -> Object {
        self.key(key);
        self.out
            .push_str(&value.map_or_else(|| "null".to_string(), string));
        self
    }

    /// A number member.
    pub fn num(mut self, key: &str, value: f64) -> Object {
        self.key(key);
        self.out.push_str(&number(value));
        self
    }

    /// A number member, or `null`.
    pub fn opt_num(mut self, key: &str, value: Option<f64>) -> Object {
        self.key(key);
        self.out
            .push_str(&value.map_or_else(|| "null".to_string(), number));
        self
    }

    /// A boolean member.
    pub fn bool(mut self, key: &str, value: bool) -> Object {
        self.key(key);
        self.out.push_str(if value { "true" } else { "false" });
        self
    }

    /// A member whose value is already JSON.
    pub fn raw(mut self, key: &str, json: &str) -> Object {
        self.key(key);
        self.out.push_str(json);
        self
    }

    /// The object's text.
    pub fn build(mut self) -> String {
        if self.out.is_empty() {
            self.out.push('{');
        }
        self.out.push('}');
        self.out
    }
}

/// A JSON array of already serialised items.
pub fn array<I: IntoIterator<Item = String>>(items: I) -> String {
    let mut out = String::from("[");
    for (i, item) in items.into_iter().enumerate() {
        if i > 0 {
            out.push(',');
        }
        out.push_str(&item);
    }
    out.push(']');
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_every_kind_of_value() {
        let v = parse(r#" { "a": [1, -2.5, 3e2, 0, -0.0, 1E-2], "b": {"c": null, "d": true, "e": false}, "s": "x" } "#)
            .unwrap();
        assert_eq!(
            v.get("a").unwrap().as_array().unwrap(),
            &[
                Value::Number(1.0),
                Value::Number(-2.5),
                Value::Number(300.0),
                Value::Number(0.0),
                Value::Number(-0.0),
                Value::Number(0.01)
            ]
        );
        assert!(v.get("b").unwrap().get("c").unwrap().is_null());
        assert_eq!(v.get("b").unwrap().get("d").unwrap().as_bool(), Some(true));
        assert_eq!(v.get("s").unwrap().as_str(), Some("x"));
        assert_eq!(parse("[]").unwrap(), Value::Array(vec![]));
        assert_eq!(parse("{}").unwrap(), Value::Object(vec![]));
        // A byte order mark (Windows tools write one) is skipped, but it is not a value.
        assert_eq!(parse("\u{feff}1"), Ok(Value::Number(1.0)));
        assert_eq!(
            parse("\u{feff}"),
            Err(Error {
                offset: 3,
                message: "unexpected end"
            })
        );
    }

    #[test]
    fn keeps_key_order() {
        let v = parse(r#"{"z":1,"a":2,"m":3}"#).unwrap();
        let Value::Object(members) = &v else {
            panic!("object expected")
        };
        let keys: Vec<&str> = members.iter().map(|(k, _)| k.as_str()).collect();
        assert_eq!(keys, ["z", "a", "m"]);
        assert_eq!(v.to_json(), r#"{"z":1,"a":2,"m":3}"#);
    }

    #[test]
    fn unicode_escapes_and_raw_utf8() {
        assert_eq!(
            parse(r#""é· 😀 \n\t\"\\\/""#).unwrap(),
            Value::String("é· 😀 \n\t\"\\/".into())
        );
        assert_eq!(
            parse("\"Z-Image-Turbo · Q8, más luz\"").unwrap(),
            Value::String("Z-Image-Turbo · Q8, más luz".into())
        );
        for bad in [
            r#""\ud83d""#,
            r#""\ud83dA""#,
            r#""\ude00""#,
            r#""\u12""#,
            r#""\u12g4""#,
            r#""\x""#,
            "\"a\u{1}b\"",
            "\"open",
        ] {
            assert!(parse(bad).is_err(), "{bad} should be rejected");
        }
    }

    #[test]
    fn numbers_follow_the_grammar() {
        for (text, value) in [
            ("0", 0.0),
            ("-1", -1.0),
            ("12.5", 12.5),
            ("1e3", 1000.0),
            ("1E+3", 1000.0),
            ("25e-1", 2.5),
            ("23.99", 23.99),
            ("9300000000", 9.3e9),
        ] {
            assert_eq!(parse(text).unwrap(), Value::Number(value), "{text}");
        }
        for bad in [
            "01", "+1", "1.", ".5", "-", "1e", "1e+", "0x10", "NaN", "Infinity", "1e400",
        ] {
            assert!(parse(bad).is_err(), "{bad} should be rejected");
        }
    }

    #[test]
    fn rejects_invalid_documents() {
        for bad in [
            "",
            " ",
            "[1,]",
            "[1 2]",
            "{\"a\" 1}",
            "{\"a\":1,}",
            "{a:1}",
            "[1]x",
            "nul",
            "tru",
            "{\"a\":}",
            "[",
            "{",
            "\"\\",
            "[1,,2]",
        ] {
            assert!(parse(bad).is_err(), "{bad:?} should be rejected");
        }
        let deep = "[".repeat(MAX_DEPTH + 2) + &"]".repeat(MAX_DEPTH + 2);
        assert_eq!(parse(&deep).unwrap_err().message, "nested too deeply");
        let ok = "[".repeat(MAX_DEPTH) + &"]".repeat(MAX_DEPTH);
        assert!(parse(&ok).is_ok());
        assert_eq!(parse("[1,]").unwrap_err().offset, 3);
    }

    #[test]
    fn writes_escaped_strings_and_numbers() {
        assert_eq!(string("a\"b\\c\n\u{1}é"), "\"a\\\"b\\\\c\\n\\u0001é\"");
        assert_eq!(number(3.0), "3");
        assert_eq!(number(2.5), "2.5");
        assert_eq!(number(f64::NAN), "null");
        let o = Object::new()
            .str("s", "x")
            .num("n", 1.5)
            .bool("b", true)
            .opt_str("none", None)
            .raw("a", &array(["1".to_string(), "2".to_string()]))
            .build();
        assert_eq!(o, r#"{"s":"x","n":1.5,"b":true,"none":null,"a":[1,2]}"#);
        assert_eq!(Object::new().build(), "{}");
        let round = parse(&o).unwrap();
        assert_eq!(round.to_json(), o);
    }
}
