# Mermaid gallery

## Flowchart

```mermaid
flowchart LR
  A[Markdown] --> B[Viewer]
```

## Sequence

```mermaid
sequenceDiagram
  User->>Chrome: Open Markdown
  Chrome->>LinguaMark: Render locally
```

## Class

```mermaid
classDiagram
  class Viewer {
    +render(markdown)
  }
```

## Entity relationship

```mermaid
erDiagram
  DOCUMENT ||--o{ SECTION : contains
  SECTION ||--o{ PARAGRAPH : contains
```

## State

```mermaid
stateDiagram-v2
  [*] --> Raw
  Raw --> Rendered
  Rendered --> Analyzed
```

## Gantt

```mermaid
gantt
  title Viewer pipeline
  dateFormat YYYY-MM-DD
  section Local
  Parse Markdown :done, parse, 2026-01-01, 1d
  Render document :render, after parse, 1d
```

## Git graph

```mermaid
gitGraph
  commit id: "design"
  branch viewer
  checkout viewer
  commit id: "render"
```

## Journey

```mermaid
journey
  title Local Markdown reading
  section Read
    Open file: 5: User
    View document: 5: User
```

## Mindmap

```mermaid
mindmap
  root((Viewer))
    Markdown
    Lightmind
    LinguaMark
```

## Packet

```mermaid
packet-beta
  0-7: "Markdown"
  8-15: "Render"
  16-31: "Analyze"
```

## XY chart

```mermaid
xychart-beta
  title "Rendering stages"
  x-axis [Parse, Render, Analyze]
  y-axis "Progress" 0 --> 10
  bar [4, 8, 10]
```

## Sankey

```mermaid
sankey-beta
Markdown,Viewer,10
Viewer,Reading,8
Viewer,Analysis,2
```

## Pie

```mermaid
pie title Viewer output
  "Reading" : 80
  "Analysis" : 20
```

## ZenUML

```mermaid
zenuml
  @Actor User
  User->Chrome: Open Markdown
  Chrome->LinguaMark: Render
```
