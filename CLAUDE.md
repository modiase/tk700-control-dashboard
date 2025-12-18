# Development Guidelines for Claude Code

When making changes to this codebase, always follow these principles:

## 1. Self-Documenting Code

Write code with good variable names and thoughtful semantics. The code itself should clearly communicate its intent without requiring comments to explain what it does.

## 2. Remove Obvious Comments

Remove comments that can be inferred by reading the code. If the code is clear and well-written, comments explaining what the code does are redundant.

## 3. Comment Only Non-Obvious Things

Only add comments for non-obvious things that require out-of-band (outside the code) explanation. This includes:
- Business logic rationale
- Performance considerations
- Workarounds for known issues
- Complex algorithms that benefit from explanation

## 4. Inline Once-Used Variables

If a variable is only used once, inline it directly at the point of use unless it significantly hurts readability.

## 5. Extract Repeated Patterns

Extract repeated patterns noticed across files to DRY out functionality that's used several times. **Important**: This should not be done for one or two duplications; a real pattern must be observed across multiple locations before abstracting.

## 6. Always Run Pre-Commits

After making changes:
1. Run pre-commit hooks on all changed files
2. Fix all linting errors
3. Fix all type errors
4. Ensure all checks pass before committing

Use `pre-commit run --files <file1> <file2> ...` to check specific files.
