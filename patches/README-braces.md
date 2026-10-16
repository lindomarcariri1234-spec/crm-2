# Braces security patch

`braces-3.0.4-replit.1.tgz` is a local patched build of `braces` from upstream
commit `a795ee83ecd011131b2d618fe754ac5a8e124dae` (upstream PR
https://github.com/micromatch/braces/pull/88). It bounds parser nesting and
validates AST depth/cycles before recursive compile, expand, and stringify.

The upstream PR has not yet been published as an npm release. Keep the
dependency pinned to this exact local build until an upstream release includes
the fix, then replace the archive and remove this note.
