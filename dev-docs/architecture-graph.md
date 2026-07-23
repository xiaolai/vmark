# VMark architecture — dependency graph (generated)

Computed from the real import graph by `dependency-cruiser`, collapsed to
`src/<top-level>` (node_modules, tests, and benches excluded). The COMPUTED
counterpart to the hand-authored `architecture.md` C4 map — when they disagree,
**this is the ground truth**. Regenerate with `pnpm arch:graph`; do not hand-edit.

```mermaid
flowchart LR

subgraph 0["src"]
1["App.tsx"]
subgraph 2["assets"]
3[" "]
end
subgraph 4["bench"]
5[" "]
end
subgraph 6["components"]
7[" "]
end
subgraph 8["contexts"]
9[" "]
end
subgraph A["export"]
B[" "]
end
subgraph C["hooks"]
D[" "]
end
E["i18n.ts"]
subgraph F["lib"]
G[" "]
end
subgraph H["locales"]
I[" "]
end
J["main.tsx"]
subgraph K["pages"]
L[" "]
end
subgraph M["plugins"]
N[" "]
end
subgraph O["services"]
P[" "]
end
subgraph Q["shared"]
R[" "]
end
subgraph S["shell"]
T[" "]
end
subgraph U["stores"]
V[" "]
end
subgraph W["styles"]
X[" "]
end
subgraph Y["test"]
Z[" "]
end
subgraph 10["theme"]
11[" "]
end
subgraph 12["types"]
13[" "]
end
subgraph 14["utils"]
15[" "]
end
16["vite-env.d.ts"]
subgraph 17["workspace"]
18[" "]
end
end
subgraph 19["vite"]
1A["client"]
end
1-->7
1-->9
1-->D
1-->L
1-->T
1-->V
1-->11
1-->15
7-->9
7-->V
7-->N
7-->P
7-->15
7-->D
7-->G
7-->E
7-->13
7-->X
7-->18
7-->11
9-->V
9-->15
9-->D
9-->P
9-->13
B-->E
B-->P
B-->15
B-->V
B-->7
B-->N
B-->X
B-->L
D-->P
D-->15
D-->V
D-->9
D-->E
D-->G
D-->11
D-->N
D-->7
D-->13
E-->P
E-->V
E-->15
G-->15
G-->V
G-->7
G-->D
G-->N
J-->1
J-->E
J-->G
J-->P
J-->V
J-->X
L-->B
L-->D
L-->15
L-->V
L-->3
L-->P
L-->G
L-->13
L-->E
N-->7
N-->13
N-->V
N-->15
N-->P
N-->G
N-->D
N-->E
N-->B
N-->9
N-->R
P-->V
P-->15
P-->N
P-->E
P-->G
P-->13
P-->B
P-->7
P-->9
V-->P
V-->11
V-->15
V-->G
V-->N
V-->13
V-->E
Z-->I
Z-->P
13-->N
15-->G
15-->13
16-->1A
18-->D
18-->9
18-->V
```
