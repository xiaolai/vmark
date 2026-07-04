//! Tokenizer for the workflow `if:` condition evaluator (see `condition.rs`,
//! which owns the grammar table and the Pratt parser over these tokens).

#[derive(Debug, Clone, PartialEq)]
pub(super) enum Token {
    /// Reference / literal operand text, resolved lazily at eval time.
    /// `is_ref` distinguishes a quoted string literal (false) from a bare
    /// identifier or `${{ }}` reference (true).
    Operand {
        text: String,
        is_ref: bool,
    },
    Eq,
    Ne,
    Gt,
    Lt,
    Ge,
    Le,
    And,
    Or,
    Not,
    LParen,
    RParen,
}

pub(super) fn tokenize(input: &str) -> Result<Vec<Token>, String> {
    let chars: Vec<char> = input.chars().collect();
    let mut tokens = Vec::new();
    let mut i = 0;

    while i < chars.len() {
        let c = chars[i];

        if c.is_whitespace() {
            i += 1;
            continue;
        }

        match c {
            '(' => {
                tokens.push(Token::LParen);
                i += 1;
            }
            ')' => {
                tokens.push(Token::RParen);
                i += 1;
            }
            '!' => {
                if peek(&chars, i + 1) == Some('=') {
                    tokens.push(Token::Ne);
                    i += 2;
                } else {
                    tokens.push(Token::Not);
                    i += 1;
                }
            }
            '=' => {
                if peek(&chars, i + 1) == Some('=') {
                    tokens.push(Token::Eq);
                    i += 2;
                } else {
                    return Err("Unexpected '=' (did you mean '=='?)".to_string());
                }
            }
            '>' => {
                if peek(&chars, i + 1) == Some('=') {
                    tokens.push(Token::Ge);
                    i += 2;
                } else {
                    tokens.push(Token::Gt);
                    i += 1;
                }
            }
            '<' => {
                if peek(&chars, i + 1) == Some('=') {
                    tokens.push(Token::Le);
                    i += 2;
                } else {
                    tokens.push(Token::Lt);
                    i += 1;
                }
            }
            '&' => {
                if peek(&chars, i + 1) == Some('&') {
                    tokens.push(Token::And);
                    i += 2;
                } else {
                    return Err("Unexpected '&' (did you mean '&&'?)".to_string());
                }
            }
            '|' => {
                if peek(&chars, i + 1) == Some('|') {
                    tokens.push(Token::Or);
                    i += 2;
                } else {
                    return Err("Unexpected '|' (did you mean '||'?)".to_string());
                }
            }
            '\'' | '"' => {
                let quote = c;
                let mut s = String::new();
                i += 1;
                let mut closed = false;
                while i < chars.len() {
                    if chars[i] == quote {
                        closed = true;
                        i += 1;
                        break;
                    }
                    s.push(chars[i]);
                    i += 1;
                }
                if !closed {
                    return Err(format!("Unterminated string literal: {}{}", quote, s));
                }
                tokens.push(Token::Operand {
                    text: s,
                    is_ref: false,
                });
            }
            '$' if peek(&chars, i + 1) == Some('{') && peek(&chars, i + 2) == Some('{') => {
                // `${{ ... }}` reference operand — capture up to the matching `}}`.
                let start = i;
                i += 3;
                let mut closed = false;
                while i < chars.len() {
                    if chars[i] == '}' && peek(&chars, i + 1) == Some('}') {
                        i += 2;
                        closed = true;
                        break;
                    }
                    i += 1;
                }
                if !closed {
                    return Err("Unterminated `${{` reference".to_string());
                }
                let text: String = chars[start..i].iter().collect();
                tokens.push(Token::Operand { text, is_ref: true });
            }
            _ => {
                // Bare operand: identifier path, number, or status function.
                // Allowed chars: letters, digits, `.`, `_`, `-`. We stop at
                // any operator, paren, or whitespace — except an immediately
                // trailing `()` is consumed so status functions like
                // `success()` tokenize as a single operand. A standalone `(`
                // or `)` is left for the grouping branches above.
                let start = i;
                while i < chars.len() {
                    let ch = chars[i];
                    if ch.is_alphanumeric() || ch == '.' || ch == '_' || ch == '-' {
                        i += 1;
                    } else {
                        break;
                    }
                }
                // Consume a trailing `()` for function-call syntax only.
                if peek(&chars, i) == Some('(') && peek(&chars, i + 1) == Some(')') {
                    i += 2;
                }
                let text: String = chars[start..i].iter().collect();
                if text.is_empty() {
                    return Err(format!("Unexpected character '{}' in condition", c));
                }
                tokens.push(Token::Operand { text, is_ref: true });
            }
        }
    }

    if tokens.is_empty() {
        return Err("Empty condition".to_string());
    }

    Ok(tokens)
}

fn peek(chars: &[char], idx: usize) -> Option<char> {
    chars.get(idx).copied()
}
