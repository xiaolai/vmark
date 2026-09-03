//! The localStorage replay script a `session.load` runs in the page, and its result.
//!
//! Split from `session_commands.rs`. The values are injected as a JSON literal the
//! script READS — never interpolated into code. The script re-checks the EXECUTING
//! document's live origin against the approved one immediately before any write, in
//! the SAME synchronous turn, so a navigation that raced the main-thread dispatch
//! cannot land the credential in a different origin. Every write is checked: a
//! rejected `setItem` (quota, a storage-disabled origin) puts the preceding writes
//! back to their previous values and reports the failing entry's INDEX — never the
//! key or the value (audit 2026-09-03 round 1; it used to be swallowed and reported
//! as applied:true).

/// What the page reported back, parsed without trusting its shape.
#[derive(Debug, PartialEq, Eq)]
pub(super) enum RestoreOutcome {
    Applied,
    OriginChanged,
    WriteFailed { index: Option<u64> },
    Unreadable,
}

/// `pairs` and `expected` are JSON literals (an array of `[key, value]` pairs and
/// the committed origin URL string), already serialized by the caller.
pub(super) fn restore_script(pairs: &str, expected: &str) -> String {
    format!(
        "if(new URL({expected}).origin!==location.origin){{return JSON.stringify({{applied:false,reason:'origin-changed'}});}}\
         var d={pairs},prev=[];\
         for(var i=0;i<d.length;i++){{\
           var k=d[i][0],old=null;try{{old=localStorage.getItem(k);}}catch(e){{}}\
           try{{localStorage.setItem(k,d[i][1]);prev.push([k,old]);}}\
           catch(e){{for(var j=prev.length-1;j>=0;j--){{try{{if(prev[j][1]===null){{localStorage.removeItem(prev[j][0]);}}else{{localStorage.setItem(prev[j][0],prev[j][1]);}}}}catch(_){{}}}}\
             return JSON.stringify({{applied:false,reason:'write-failed',index:i}});}}\
         }}return JSON.stringify({{applied:true,count:d.length}});"
    )
}

pub(super) fn parse_restore_outcome(raw: &str) -> RestoreOutcome {
    let Ok(outcome) = serde_json::from_str::<serde_json::Value>(raw) else {
        return RestoreOutcome::Unreadable;
    };
    if outcome.get("applied").and_then(|v| v.as_bool()) == Some(true) {
        return RestoreOutcome::Applied;
    }
    match outcome.get("reason").and_then(|v| v.as_str()) {
        Some("origin-changed") => RestoreOutcome::OriginChanged,
        Some("write-failed") => RestoreOutcome::WriteFailed {
            index: outcome.get("index").and_then(|v| v.as_u64()),
        },
        _ => RestoreOutcome::Unreadable,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn outcomes_are_parsed_without_trusting_the_shape() {
        assert_eq!(
            parse_restore_outcome(r#"{"applied":true,"count":3}"#),
            RestoreOutcome::Applied
        );
        assert_eq!(
            parse_restore_outcome(r#"{"applied":false,"reason":"origin-changed"}"#),
            RestoreOutcome::OriginChanged
        );
        assert_eq!(
            parse_restore_outcome(r#"{"applied":false,"reason":"write-failed","index":2}"#),
            RestoreOutcome::WriteFailed { index: Some(2) }
        );
        assert_eq!(
            parse_restore_outcome("not json"),
            RestoreOutcome::Unreadable
        );
        assert_eq!(
            parse_restore_outcome(r#"{"applied":"yes"}"#),
            RestoreOutcome::Unreadable
        );
    }

    #[test]
    fn the_script_reads_its_values_as_data_and_rolls_back_on_a_rejected_write() {
        let script = restore_script(r#"[["k","v"]]"#, r#""https://a.example/""#);
        assert!(
            script.contains("localStorage.getItem(k)"),
            "previous values are captured before writing"
        );
        assert!(
            script.contains("removeItem(prev[j][0])"),
            "a rejected write restores what preceded it"
        );
        assert!(
            script.contains("reason:'write-failed',index:i"),
            "the failing INDEX is reported, never the key"
        );
    }
}
