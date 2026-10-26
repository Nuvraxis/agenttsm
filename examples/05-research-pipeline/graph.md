# Research pipeline

```mermaid
stateDiagram-v2
  [*] --> plan
  plan --> search
  search --> draft
  draft --> review
  review --> draft
  review --> [*]
```
