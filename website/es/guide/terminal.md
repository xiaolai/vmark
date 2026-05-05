# Terminal Integrado

VMark incluye un panel de terminal integrado para que puedas ejecutar comandos sin salir del editor.

Presiona `` Ctrl + ` `` para alternar el panel del terminal.

## Sesiones

El terminal admite hasta 5 sesiones concurrentes, cada una con su propio proceso de shell. Una barra de pestañas vertical en el lado derecho muestra las pestañas de sesión numeradas.

| Acción | Cómo |
|--------|------|
| Nueva sesión | Haz clic en el botón **+** |
| Cambiar sesión | Haz clic en un número de pestaña |
| Cerrar sesión | Haz clic en el icono de papelera |
| Reiniciar shell | Haz clic en el icono de reinicio |

Cuando cierras la última sesión, el panel se oculta pero la sesión sigue activa — vuelve a abrirlo con `` Ctrl + ` `` y estarás donde lo dejaste. Si un proceso de shell termina, presiona cualquier tecla para reiniciarlo.

## Atajos de Teclado

Estos atajos funcionan cuando el panel del terminal está enfocado:

| Acción | Atajo |
|--------|-------|
| Copiar | `Mod + C` (con selección) |
| Pegar | `Mod + V` |
| Limpiar | `Mod + K` |
| Buscar | `Mod + F` |
| Alternar Terminal | `` Ctrl + ` `` |

::: tip
`Mod + C` sin una selección de texto envía SIGINT al proceso en ejecución — igual que presionar Ctrl+C en un terminal normal.
:::

## Búsqueda

Presiona `Mod + F` para abrir la barra de búsqueda. Escribe para buscar de forma incremental en el buffer del terminal.

| Acción | Atajo |
|--------|-------|
| Siguiente coincidencia | `Enter` |
| Coincidencia anterior | `Shift + Enter` |
| Cerrar búsqueda | `Escape` |

## Menú Contextual

Haz clic derecho dentro del terminal para acceder a:

- **Copiar** — copiar el texto seleccionado (deshabilitado cuando no hay nada seleccionado)
- **Pegar** — pegar desde el portapapeles al shell
- **Seleccionar Todo** — seleccionar todo el buffer del terminal
- **Limpiar** — limpiar la salida visible

## Enlaces Clicables

El terminal detecta dos tipos de enlaces en la salida de comandos:

- **URLs web** — haz clic para abrir en tu navegador predeterminado
- **Rutas de archivo** — haz clic para abrir el archivo en el editor (admite sufijos `:línea:columna` y rutas relativas resueltas respecto a la raíz del espacio de trabajo)

## Entorno de Shell

VMark establece estas variables de entorno en cada sesión del terminal:

| Variable | Valor |
|----------|-------|
| `TERM_PROGRAM` | `vmark` |
| `EDITOR` | `vmark` |
| `VMARK_WORKSPACE` | Ruta raíz del espacio de trabajo (cuando hay una carpeta abierta) |
| `PATH` | PATH completo del shell de inicio de sesión (igual que en tu terminal del sistema) |

El terminal integrado hereda el `PATH` de tu shell de inicio de sesión, por lo que las herramientas CLI como `node`, `claude` y otros binarios instalados por el usuario son detectables — igual que en una ventana de terminal normal.

El shell se lee desde `$SHELL` (recurre a `/bin/sh`). El directorio de trabajo comienza en la raíz del espacio de trabajo, o el directorio principal del archivo activo, o `$HOME`.

Los atajos de shell estándar como `Ctrl+R` (búsqueda inversa del historial en zsh/bash) funcionan cuando el terminal está enfocado — el editor no los intercepta.

Cuando abres un espacio de trabajo o archivo después de que el terminal ya está en ejecución, todas las sesiones cambian automáticamente su directorio a la nueva raíz del espacio de trabajo mediante `cd`.

## Pausar / Reanudar

Para procesos de larga duración que producen una salida verbosa, puedes suspender el proceso de shell subyacente desde VMark para liberar CPU sin matar la sesión. Al reanudar, el proceso continúa desde donde se quedó.

| Acción | Cómo |
|---|---|
| Pausar la sesión activa | Clic derecho en la pestaña de sesión → **Pausar** |
| Reanudar la sesión pausada | Clic derecho en la pestaña pausada → **Reanudar** |

Mientras está en pausa:

- La pestaña de sesión muestra un indicador atenuado
- El shell recibe `SIGSTOP` (POSIX); el sistema operativo suspende la planificación del proceso
- La salida almacenada en búfer que ya estaba escrita en el terminal se conserva en pantalla, pero no aparece nueva salida hasta que reanudes
- Los controles de matar / limpiar / reiniciar permanecen disponibles

Pausar/Reanudar es una función exclusiva de macOS/Linux — el control de procesos de Windows no expone una señal de suspensión equivalente, por lo que los elementos del menú están ocultos en las compilaciones para Windows.

## Configuración

Abre **Configuración → Terminal** para configurar:

| Configuración | Rango | Predeterminado | Plataformas |
|---------------|-------|----------------|-------------|
| Tamaño de Fuente | 10 – 24 px | 13 px | Todas |
| Altura de Línea | 1.0 – 2.0 | 1.2 | Todas |
| Copiar al Seleccionar | Activado / Desactivado | Desactivado | Todas |
| Tecla Option de Mac como Meta | Activado / Desactivado | Desactivado | macOS |

Los cambios se aplican inmediatamente a todas las sesiones abiertas. **Tecla Option de Mac como Meta** enruta la tecla Option de macOS como Meta en el terminal integrado para que emacs, tmux y herramientas similares vean los atajos con prefijo Alt.

## Persistencia

La visibilidad y la altura del panel del terminal se guardan y restauran en los reinicios con salida en caliente. Los procesos de shell en sí no pueden preservarse — se genera un nuevo shell para cada sesión al reiniciar, y cualquier sesión pausada pierde su estado de `SIGSTOP` junto con el propio proceso.
