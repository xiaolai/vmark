# Exportar el historial de edición a Git

VMark guarda un historial de edición para cada documento: cada guardado y cada edición que un cliente de IA hace mediante MCP queda registrado, con quién la hizo. **Archivo → Historial del documento → Exportar historial de edición a Git…** copia ese historial en un repositorio Git, para que puedas recorrerlo con `git log`, compararlo o conservarlo junto a tu proyecto.

## Cómo exportar

1. Abre el documento cuyo historial quieres.
2. Elige **Archivo → Historial del documento → Exportar historial de edición a Git…** (o ejecuta *Exportar historial de edición a Git* desde la paleta de comandos).
3. Elige una carpeta dentro del repositorio Git. El selector se abre en la carpeta del propio documento.

VMark te indica cuántos commits añadió, o que la rama ya estaba al día.

## Qué contiene la rama

El historial va a su propia rama, `vmark-journal/<document-uuid>`. VMark nunca toca tu árbol de trabajo, tu índice, `HEAD` ni ninguna otra rama, y no cambia de rama. La rama contiene un archivo, con el nombre del documento.

- **Un commit por revisión.** Su autor es quien hizo la edición (tú o el cliente de IA), y su fecha es el momento de la edición.
- **Un commit resumen por cada tramo de historial depurado.** VMark depura las revisiones antiguas para que su historial sea pequeño. Una serie de revisiones depuradas se convierte en un solo commit llamado *Collected history*, que nombra a todos los que editaron en ese tramo.

Cada mensaje de commit termina con trailers que lo vinculan a VMark:

| Trailer | Significado |
|---------|-------------|
| `VMark-Document` | La identidad del documento, la misma en todos los commits |
| `VMark-Revision` | La revisión que registra este commit |
| `VMark-Parent` | La revisión anterior |
| `VMark-Actor` | Quién hizo la edición |
| `VMark-Kind` | Cómo se registró: `controlled` (una edición de IA a través de VMark), `observed` (un guardado), `gap` (un cambio hecho fuera de VMark) y otros |
| `VMark-Tool` | La herramienta MCP detrás de una edición de IA |
| `VMark-Session`, `VMark-Client` | La etiqueta de sesión y el nombre del cliente de IA, cuando los dio |
| `VMark-Collected` | En un commit resumen: el rango de revisiones depuradas que cubre |
| `VMark-Actors` | En un commit resumen: todos los que editaron en ese rango, ordenados |

## Exportar de nuevo

Exporta tantas veces como quieras. Una nueva exportación añade solo las revisiones hechas desde la anterior; si no hay nada nuevo, no cambia nada. El mismo historial produce siempre los mismos commits.

VMark se niega, en lugar de sobrescribir, cuando la rama no es lo que dejó allí:

- **La rama cambió desde la última exportación** (alguien hizo commit en ella, la retrocedió o la reescribió). Mueve o elimina la rama y vuelve a exportar.
- **Existe una rama con ese nombre, pero no es la exportación de VMark de este documento.**
- **La rama está activa** en un worktree.

## Requisitos y límites

- Git debe estar instalado. VMark lo busca en el `PATH` de tu shell de inicio de sesión; si falta, la exportación lo indica.
- Solo se exporta el historial guardado. Las ediciones que aún no has guardado no forman parte de él.
- VMark crea los commits con los comandos de bajo nivel de Git, así que los hooks de commit no se ejecutan. Los hooks que vigilan las actualizaciones de ramas sí se ejecutan.
- Un historial grande tarda un rato: cada commit cuesta unos cuantos procesos de Git.
- En un clon superficial (shallow clone), VMark solo continúa una rama que exportó él mismo desde este equipo.
- No actives la rama de exportación mientras se exporta. Un checkout posterior a la última comprobación de worktrees puede dejar el índice y los archivos de ese worktree en desacuerdo con su rama, que se ha movido.
