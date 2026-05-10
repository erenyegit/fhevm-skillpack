# Aider runner

```bash
pip install aider-chat
cd fhevm-skillpack
aider --read SKILL.md --read references/ \
      --model claude-opus-4-7 \
      --no-auto-commits
```

For each prompt:
```
/ask <paste prompt verbatim>
```
Save the resulting `.sol` to `eval-suite/results/aider/<NN>.sol`.
Then `node tools/fhe-eval.mjs report`.
