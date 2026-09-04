// The localStorage replay a `session.load` runs in the page's isolated world.
//
// `session_restore_script.rs` `include_str!`s this file and appends the two JSON
// arguments as a CALL — `return (<this file>)(<pairs>,<expected>);` — so neither the
// saved values nor the approved origin is ever interpolated into code. The isolated
// world shares the page's storage but not its globals, so `localStorage`, `JSON` and
// `URL` here are the engine's own. `src/services/browser/sessionRestoreScript.test.ts`
// executes this exact file against a storage that throws.
//
// Returns a JSON string the Rust side parses without trusting its shape:
//   {applied:true, count}                      every write landed
//   {applied:false, reason:"origin-changed"}   the page moved on; nothing was written
//   {applied:false, reason:"read-failed", index}  storage could not be READ at data
//       index `index` before any write: nothing was written (a rollback that does
//       not know the previous value could only guess, and guessing "absent" deleted
//       real data)
//   {applied:false, reason:"write-failed", index, rollbackFailed}
//       write `index` was rejected (quota, a storage-disabled origin). Every earlier
//       write was put back to its previous value, and `rollbackFailed` lists the
//       indices whose put-back ALSO threw — empty means the page is exactly as it
//       was; non-empty means it is only partly restored, and the caller is told so.
// Only indices ever leave the page: never a key, never a value.
(function (d, expected) {
  if (new URL(expected).origin !== location.origin) {
    return JSON.stringify({ applied: false, reason: "origin-changed" });
  }
  // Snapshot FIRST: every previous value is read before the first write, so a
  // rollback always knows what to put back. A read that throws aborts here, with
  // nothing written — rolling back to a guessed "absent" used to delete a value.
  var snapshot = [];
  for (var s = 0; s < d.length; s++) {
    try {
      snapshot.push(localStorage.getItem(d[s][0]));
    } catch (e) {
      return JSON.stringify({ applied: false, reason: "read-failed", index: s });
    }
  }
  var prev = [];
  for (var i = 0; i < d.length; i++) {
    var k = d[i][0];
    try {
      localStorage.setItem(k, d[i][1]);
      prev.push([k, snapshot[i]]);
    } catch (e) {
      var rollbackFailed = [];
      for (var j = prev.length - 1; j >= 0; j--) {
        try {
          if (prev[j][1] === null) {
            localStorage.removeItem(prev[j][0]);
          } else {
            localStorage.setItem(prev[j][0], prev[j][1]);
          }
        } catch (_) {
          rollbackFailed.push(j);
        }
      }
      return JSON.stringify({ applied: false, reason: "write-failed", index: i, rollbackFailed: rollbackFailed });
    }
  }
  return JSON.stringify({ applied: true, count: d.length });
})
