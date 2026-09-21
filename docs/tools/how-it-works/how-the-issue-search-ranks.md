# How the issue search ranks

Two stages produce the ranking. A lexical first stage casts a wide net over every
passage; a cross encoder then reads the twenty issues it caught and decides which
of them actually answers the question.

Only the second stage is configurable, because measurement put the whole
difference there. Enlarging the reranker moved top-1 accuracy from 27% to 91%,
while adding a dense vector index alongside the first stage changed no ranking at
all.

That is why [`reranker_model`](../reference.md#reranker_model) is a setting and
the first stage is not, and why a reranker that fails to load degrades the answer
rather than removing it: what is left is the first stage's own order, which is
the 27% case.

A search that came back first-stage ordered says so, attached to the result —
[when a tool answers worse than it should](../when-it-breaks.md).
