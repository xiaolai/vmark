// Fixture for WI-15: a schema module that cannot be loaded at all.
// The generator must exit non-zero and write NOTHING — a half-written
// generated file would sail through the next `--check` run.
throw new Error('deliberately unloadable schema module');
