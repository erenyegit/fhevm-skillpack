# Expected-properties schema

Each `<NN>.json` file specifies the success criteria for that prompt. Format:

```json
{
  "must_include_patterns": ["string", "regex"],   // raw substrings or /regex/
  "must_not_include_patterns": [],                // negative checks
  "must_pass_lint": true,                         // fhe-lint exit 0
  "must_compile": true,                           // forge build succeeds
  "must_pass_tests": ["happy_path"],              // optional named tests
  "min_severity_block": "error"                   // tolerate warnings
}
```

The runner (`tools/fhe-eval.mjs`) evaluates each generated contract against
its corresponding expected-properties file and emits PASS / FAIL plus a
breakdown of which checks failed.
