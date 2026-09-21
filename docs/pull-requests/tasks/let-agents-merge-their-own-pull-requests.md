# Let agents merge their own pull requests

```yaml
merge:
  policy: auto
```

`manual` is the shipped default and it means an agent never merges. `auto` means it may,
when nothing else objects — `merge.governed_paths`, `merge.gates` and whatever GitHub's
own ruleset requires all still apply, and any one of them firing puts the merge back in
a person's hands. How those members compose is in
[the pull request reference](../reference.md#merge).
