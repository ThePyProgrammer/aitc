//! Phase 12 Wave 1 target: regex-over-src/bindings.ts parser.
//! Wave 0 scaffold: exported types + stub parse_bindings() returning empty Vec.

#[allow(dead_code)]
pub struct BindingCommand {
    pub camel_name: String,
    pub snake_name: String,
    pub signature_summary: String,
    pub has_channel_arg: bool,
}

pub fn parse_bindings(_bindings_ts_source: &str) -> Vec<BindingCommand> {
    Vec::new() // Wave 1 fills in (V-12-01..V-12-04)
}

#[cfg(test)]
mod tests {
    use super::*;

    // Wave 0 sanity: empty input → empty output (no panic, just empty Vec).
    #[test]
    fn parse_bindings_empty_input() {
        let result = parse_bindings("");
        assert_eq!(result.len(), 0);
    }
}
