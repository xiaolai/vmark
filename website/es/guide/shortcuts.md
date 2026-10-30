# Atajos de Teclado

VMark está diseñado para flujos de trabajo que priorizan el teclado. La mayoría de los atajos se pueden personalizar en Ajustes. Un pequeño número de primitivas son fijas: los selectores multicursor `Mod+D` (Seleccionar Siguiente Ocurrencia) y `Mod+Shift+L` (Seleccionar Todas las Ocurrencias), y las asignaciones globales de Deshacer/Rehacer. Los demás atajos multicursor (Omitir Ocurrencia, Deshacer Cursor Suave, Añadir Cursor Arriba/Abajo) son configurables. Los atajos marcados como _(sensibles al contexto)_ son gestionados dentro del editor para estructuras específicas (por ejemplo, alternar la casilla de una lista de tareas) y no están expuestos en el registro de personalización.

## Notación

- **Mod** = Cmd en macOS, Ctrl en Windows/Linux
- **Alt** = Option en macOS

## Teclas de Función en macOS

VMark usa teclas de función (F2–F10) para cambios rápidos de modo. En macOS, estas teclas están asignadas a funciones del sistema (brillo, volumen, etc.) de forma predeterminada.

**Para usar las teclas F directamente sin mantener presionado Fn:**

1. Abre **Ajustes del Sistema** → **Teclado**
2. Activa **"Usar F1, F2, etc. como teclas de función estándar"**

Alternativamente, mantén presionada la tecla **Fn** al pulsar F2–F10 para activar los atajos de VMark.

::: tip
Si prefieres mantener las funciones del sistema en las teclas F, puedes personalizar los atajos de VMark en Ajustes (`Mod + ,`) para usar diferentes combinaciones de teclas.
:::

### Referencia Rápida de Teclas F

| Tecla | Acción |
|-------|--------|
| `F2` | Siguiente problema |
| `Shift + F2` | Problema anterior |
| `F3` | Alternar caracteres invisibles |
| `F4` | Ordenar Líneas Ascendente _(solo en modo Fuente; no hace nada en WYSIWYG)_ |
| `Shift + F4` | Ordenar Líneas Descendente _(solo en modo Fuente; no hace nada en WYSIWYG)_ |
| `F5` | Vista rápida del código fuente |
| `F6` | Vista de código fuente (Markdown: WYSIWYG ⇄ Fuente; otros formatos: Fuente ⇄ Dividida) |
| `Shift + F6` | Dividida / Vista previa (Markdown: vista dividida; otros formatos: Vista previa ⇄ Dividida) |
| `F7` | Alternar Barra de Estado |
| `F8` | Modo Enfoque |
| `F9` | Modo Máquina de Escribir |
| `F10` | Modo Solo Lectura |

## Editar

| Acción | Atajo |
|--------|-------|
| Deshacer | `Mod + Z` |
| Rehacer | `Mod + Shift + Z` |

## Formato de Texto

| Acción | Atajo |
|--------|-------|
| Negrita | `Mod + B` |
| Cursiva | `Mod + I` |
| Subrayado | `Mod + U` |
| Tachado | `Mod + Shift + X` |
| Código en Línea | Mod + Shift + `` ` `` |
| Resaltado | `Mod + Shift + M` |
| Subíndice | `Alt + Mod + =` |
| Superíndice | `Alt + Mod + Shift + =` |
| Enlace | `Mod + K` |
| Abrir Enlace (Modo Fuente) | `Cmd + Click` |
| Eliminar Enlace | `Alt + Shift + K` |
| Enlace wiki | `Alt + Mod + K` |
| Enlace de marcador | `Alt + Mod + B` |
| Borrar formato | `Mod + \` |

## Formato de Bloque

| Acción | Atajo |
|--------|-------|
| Encabezado 1-6 | `Mod + 1` hasta `Mod + 6` |
| Párrafo | `Mod + Shift + 0` |
| Aumentar Nivel de Encabezado | `Alt + Mod + ]` |
| Disminuir Nivel de Encabezado | `Alt + Mod + [` |
| Cita | `Alt + Mod + Q` |
| Bloque de Código | `Alt + Mod + C` |
| Lista con Viñetas | `Alt + Mod + U` |
| Lista Ordenada | `Alt + Mod + O` |
| Lista de Tareas | `Alt + Mod + X` |
| Alternar Casilla de Tarea | `Mod + Shift + Enter` _(sensible al contexto; no personalizable)_ |
| Aumentar sangría | `Mod + ]` |
| Reducir sangría | `Mod + [` |
| Línea Horizontal | `Alt + Mod + -` |

## Operaciones de Línea

| Acción | Atajo |
|--------|-------|
| Mover Línea Arriba | `Alt + Up` |
| Mover Línea Abajo | `Alt + Down` |
| Duplicar Línea | `Shift + Alt + Down` |
| Eliminar Línea | `Mod + Shift + K` |
| Unir Líneas | `Mod + J` |
| Ordenar Líneas Ascendente | `F4` _(solo en modo Fuente)_ |
| Ordenar Líneas Descendente | `Shift + F4` _(solo en modo Fuente)_ |

## Transformaciones de Texto

| Acción | macOS | Windows/Linux |
|--------|-------|---------------|
| MAYÚSCULAS | `Ctrl + Shift + U` | `Alt + Shift + U` |
| minúsculas | `Ctrl + Shift + L` | `Alt + Shift + L` |
| Título Inicial | `Ctrl + Shift + T` | `Alt + Shift + T` |
| Alternar mayúsculas/minúsculas | _(personalizable)_ | _(personalizable)_ |
| Eliminar líneas en blanco | _(personalizable)_ | _(personalizable)_ |
| Alternar Estilo de Comillas | `Shift + Mod + '` | `Shift + Mod + '` |

## Insertar

| Acción | Atajo |
|--------|-------|
| Insertar Imagen | `Mod + Shift + I` |
| Insertar Vídeo | — |
| Insertar Audio | — |
| Insertar Tabla | `Mod + Shift + T` |
| Tabla de contenidos | _(personalizable)_ |
| Matemáticas en Línea | `Alt + Mod + M` |
| Bloque de Matemáticas | `Alt + Mod + Shift + M` |
| Insertar Nota | `Alt + Mod + N` |
| Insertar Consejo | `Alt + Mod + Shift + T` |
| Insertar Advertencia | `Mod + Shift + W` |
| Insertar Importante | `Alt + Mod + Shift + I` |
| Insertar Precaución | `Mod + Shift + U` |
| Insertar Desplegable | `Alt + Mod + D` |
| Insertar Diagrama | `Alt + Mod + Shift + D` |
| Insertar Diagrama Graphviz | _(personalizable)_ |
| Insertar Mapa Mental | `Alt + Mod + Shift + K` |
| Alternar Comentario | `Mod + /` |

## Selección y Multicursor

| Acción | Atajo |
|--------|-------|
| Seleccionar Línea | `Mod + L` |
| Seleccionar todas las coincidencias del bloque | `Alt + Mod + Shift + L` |
| Expandir Selección | `Ctrl + Shift + Up` |
| Seleccionar Siguiente Ocurrencia | `Mod + D` |
| Omitir Ocurrencia | `Mod + Shift + D` |
| Seleccionar Todas las Ocurrencias | `Mod + Shift + L` |
| Deshacer Cursor Suave | `Alt + Mod + Z` |
| Añadir Cursor Arriba | `Mod + Alt + Up` |
| Añadir Cursor Abajo | `Mod + Alt + Down` |
| Colapsar Multicursor | `Escape` |

## Buscar y Reemplazar

| Acción | Atajo |
|--------|-------|
| Buscar y Reemplazar | `Mod + F` |
| Buscar siguiente | `Mod + G` |
| Buscar anterior | `Mod + Shift + G` |
| Usar Selección para Buscar | `Mod + E` |
| Buscar en Archivos | `Mod + Shift + H` |

## Vista y Modo

| Acción | Atajo |
|--------|-------|
| Vista de código fuente (Markdown ⇄ Fuente; otros formatos Fuente ⇄ Dividida) | `F6` |
| Dividida / Vista previa (Markdown dividida; otros formatos Vista previa ⇄ Dividida) | `Shift + F6` |
| Dividir editor — dos documentos | `Alt + Mod + \` |
| Alternar Barra de Estado | `F7` |
| Modo Enfoque | `F8` |
| Modo Máquina de Escribir | `F9` |
| Modo Solo Lectura | `F10` |
| Tamaño Real | `Mod + 0` |
| Ampliar | `Mod + =` |
| Reducir | `Mod + -` |
| Ajuste de Línea | `Alt + Z` |
| Última pestaña usada | `Ctrl + Tab` |
| Dividir editor — dos documentos | `Alt + Mod + \` |
| Cerrar panel | `Alt + Mod + Shift + \` |
| Enfocar el otro panel | `Alt + Mod + Shift + O` |
| Mostrar/ocultar barra lateral | `Ctrl + Shift + 0` |
| Alternar Esquema | `Ctrl + Shift + 1` |
| Alternar Explorador de Archivos | `Ctrl + Shift + 2` |
| Alternar Historial | `Ctrl + Shift + 3` |
| Mostrar/ocultar base de conocimiento | `Ctrl + Shift + 4` |
| Mostrar/ocultar estado de ventanas | `Ctrl + Shift + 5` |
| Alternar Números de Línea (margen de Fuente/División) | `Alt + Mod + L` |
| Alternar Terminal | Ctrl + `` ` `` |
| Enfocar la terminal o el editor | Ctrl + Shift + `` ` `` (Alt + Shift + `` ` `` en Windows/Linux) |
| Alternar Vista Previa de Diagrama | `Alt + Mod + P` |
| Ajustar Tablas al Ancho | _(personalizable)_ |
| Abrir la barra de herramientas universal | `Mod + Shift + B` |
| Vista rápida del código fuente | `F5` |
| Comprobar Markdown | `Alt + Mod + V` |
| Siguiente problema | `F2` |
| Problema anterior | `Shift + F2` |

::: tip Mostrar/ocultar base de conocimiento
`Ctrl + Shift + 4` está oculto de forma predeterminada, junto con el elemento de
menú **Vista → Base de conocimiento** y el comando de la paleta. Ninguna
compilación de lanzamiento, en ninguna plataforma, incluye el entorno de ejecución
del servidor de contenido que necesita la función, así que los puntos de entrada
solo aparecen cuando **Ajustes → Avanzado → Herramientas de desarrollo** está
activado — consulta [Base de conocimiento y Slidev](/es/guide/knowledge-base#requisitos).
El atajo sigue apareciendo y siendo personalizable en **Ajustes → Atajos** en
cualquier caso.
:::

## Operaciones de Archivo

| Acción | Atajo |
|--------|-------|
| Nuevo Archivo | `Mod + N` |
| Abrir Rápido | `Mod + O` _(explorador de archivos difuso)_ |
| Abrir la paleta de comandos | `Mod + Shift + P` |
| Abrir Archivo... | Solo menú _(selector de archivos nativo)_ |
| Abrir Espacio de Trabajo | `Mod + Shift + O` |
| Guardar | `Mod + S` |
| Guardar Como | `Mod + Shift + S` |
| Guardar Todo y Salir | `Alt + Mod + Shift + Q` |
| Mover a | Solo menú |
| Cerrar | `Mod + W` |
| Exportar HTML | Solo menú |
| Imprimir | `Mod + P` |
| Exportar PDF | — |
| Ajustes | `Mod + ,` |

## Portapapeles

| Acción | Atajo |
|--------|-------|
| Copiar como HTML | `Mod + Shift + C` |
| Pegar Texto Sin Formato | `Mod + Shift + V` |

## Genios de IA

| Acción | Atajo |
|--------|-------|
| Abrir Genios de IA | `Mod + Y` |
| Aceptar sugerencia | `Enter` |
| Rechazar sugerencia | `Escape` |
| Siguiente sugerencia | `Tab` |
| Sugerencia anterior | `Shift + Tab` |
| Aceptar todas las sugerencias | `Mod + Shift + Enter` |
| Rechazar todas las sugerencias | `Mod + Shift + Escape` |

## Formato CJK

| Acción | Atajo |
|--------|-------|
| Formatear Selección | `Mod + Shift + F` |
| Formatear Documento | `Alt + Mod + Shift + F` |

## Ventana y Pestañas

| Acción | Atajo |
|--------|-------|
| Nueva Ventana | `Mod + Shift + N` |
| Nueva Pestaña | `Mod + T` |
| Nueva pestaña del navegador | `Alt + Mod + Shift + B` |
| Pestaña siguiente | `Mod + Shift + ]` |
| Pestaña anterior | `Mod + Shift + [` |
| Cerrar Pestaña | `Mod + W` |
| Reabrir pestaña cerrada | _(personalizable)_ |
| Alternar Archivos Ocultos | `Mod + Shift + .` |
| Alternar Todos los Archivos | `Mod + Shift + A` |

::: tip Nota Windows/Linux
Alternar Archivos Ocultos usa `Ctrl + H` en Windows y Linux.

Mostrar/ocultar barra lateral usa `Alt + Shift + 0` en Windows y Linux, porque
allí `Mod` es Ctrl — así que la combinación de macOS `Ctrl + Shift + 0` chocaría
con `Mod + Shift + 0` de Párrafo.
:::

::: tip Nueva pestaña del navegador
`Alt + Mod + Shift + B` abre una pestaña del navegador integrado, y también
aparece en el menú **Archivo**. El navegador integrado está activado de forma
predeterminada en macOS; si lo desactivas en **Ajustes → Avanzado → Navegador
integrado**, el elemento de menú se oculta (no se atenúa) hasta que vuelvas a
activarlo. El navegador es exclusivo de macOS, así que el elemento nunca aparece
en Windows ni en Linux.

Es un elemento de menú real y no solo una asignación de teclado, y eso importa:
cuando una página web tiene el foco del teclado, el motor del navegador consume
las pulsaciones de teclas antes de que VMark las vea, así que un atajo interno de
la aplicación no puede dispararse. Un acelerador de menú lo despacha el propio
macOS, así que sigue funcionando mientras navegas.
:::

## Ayuda (solo macOS)

| Acción | Atajo |
|--------|-------|
| Buscar en Menús | `Cmd + Shift + /` |

::: tip
Este es un atajo nativo del sistema macOS que busca en todos los elementos del menú. Escribe una palabra clave para encontrar y ejecutar cualquier acción del menú.
:::

## Navegación Inteligente con Tab

Tab y Shift+Tab son conscientes del contexto — escapan de corchetes, comillas, marcas de formato y enlaces.

| Contexto | Acción de Tab |
|----------|---------------|
| Antes de `)`, `]`, `}`, comillas | Saltar más allá del carácter de cierre |
| Antes de corchetes CJK `」`, `』`, etc. | Saltar más allá del corchete de cierre |
| Dentro de **negrita**, *cursiva*, `code` | Saltar después del formato |
| Dentro de un enlace | Saltar después del enlace |

| Contexto | Acción de Shift+Tab |
|----------|---------------------|
| Después de `(`, `[`, `{`, comillas | Saltar antes del carácter de apertura |
| Después de corchetes CJK `「`, `『`, etc. | Saltar antes del corchete de apertura |
| Dentro de **negrita**, *cursiva*, `code` | Saltar antes del formato |
| Dentro de un enlace | Saltar antes del enlace |

::: tip
Ver [Navegación Inteligente con Tab](/es/guide/tab-navigation) para la guía completa incluyendo corchetes CJK, comillas tipográficas y configuración.
:::

## Edición de Tablas

Cuando el cursor está dentro de una tabla:

| Acción | Atajo |
|--------|-------|
| Siguiente Celda | `Tab` |
| Celda Anterior | `Shift + Tab` |
| Añadir Fila Abajo | `Mod + Enter` |
| Añadir Fila Arriba | `Mod + Shift + Enter` |
| Eliminar Fila | `Mod + Backspace` |
| Dar formato a la tabla | `Alt + Mod + T` |
| Salir de la Tabla | Teclas de flecha en el borde de la tabla |

## Navegación de Popups

Cuando hay un popup abierto (enlace, imagen, matemáticas, etc.):

| Acción | Atajo |
|--------|-------|
| Cerrar Popup | `Escape` |
| Confirmar/Guardar | `Enter` |
| Navegar Campos | `Tab` / `Shift + Tab` |

## Edición de Bloques de Matemáticas

Al editar un bloque de matemáticas:

| Acción | Atajo |
|--------|-------|
| Confirmar y Salir | `Mod + Enter` |
| Cancelar y Salir | `Escape` |

## Terminal

Cuando el terminal integrado está enfocado:

| Acción | Atajo |
|--------|-------|
| Alternar Terminal | `` Ctrl + ` `` |
| Enfocar la terminal o el editor | `` Ctrl + Shift + ` `` (`` Alt + Shift + ` `` en Windows/Linux) |
| Copiar | `Mod + C` (con selección); en Linux también `Ctrl + Shift + C` o `Ctrl + Insert` |
| Pegar | `Mod + V`; en Linux también `Ctrl + Shift + V` o `Shift + Insert` |
| Seleccionar Todo (solo la salida del terminal) | `Mod + A` (`Ctrl + Shift + A` en Linux) |
| Limpiar | `Mod + K` (`Ctrl + Shift + K` en Linux) |
| Buscar | `Mod + F` (`Ctrl + Shift + F` en Linux) |
| Cambiar a la sesión 1–5 | `Mod + 1` hasta `Mod + 5` |
| Aumentar la fuente del terminal | `Mod + =` |
| Reducir la fuente del terminal | `Mod + -` |
| Tamaño de fuente predeterminado del terminal | `Mod + 0` |
| Prompt de comando anterior | `Mod + ↑` |
| Prompt de comando siguiente | `Mod + ↓` |
| Nueva línea en la línea de entrada (Claude Code y herramientas similares) | `Shift + Enter` |

Mientras el terminal está enfocado, `Mod + =`, `Mod + -` y `Mod + 0` cambian el tamaño de la fuente del terminal en lugar de la del editor.

La navegación entre prompts salta de un prompt de comando a otro en el historial de desplazamiento y requiere la integración del shell (zsh o bash).

En macOS, el terminal también traduce para el shell las combinaciones habituales de edición de texto:

| Acción | Atajo |
|--------|-------|
| Mover una palabra a la izquierda / derecha | `Option + ←` / `Option + →` |
| Mover al inicio / final de la línea | `Cmd + ←` / `Cmd + →` |
| Borrar la línea de entrada (envía `Ctrl + U`) | `Cmd + Backspace` |

En macOS, las combinaciones con `Ctrl` como `Ctrl + A`, `Ctrl + R` y `Ctrl + W` van directamente al shell.

En Linux, el terminal sigue la convención habitual de los terminales de Linux: las combinaciones simples de `Ctrl` + letra van al shell, de modo que teclas de readline como `Ctrl + A`, `Ctrl + E`, `Ctrl + K`, `Ctrl + F`, `Ctrl + U` y `Ctrl + W` funcionan como en cualquier otro terminal de Linux, y las acciones propias del terminal pasan a `Ctrl + Shift`: `Ctrl + Shift + A` selecciona todo, `Ctrl + Shift + K` limpia, `Ctrl + Shift + F` busca, y `Ctrl + Shift + C` / `Ctrl + Shift + V` copian y pegan. `Ctrl + Insert` y `Shift + Insert` también copian y pegan. El terminal conserva dos combinaciones simples de `Ctrl`: `Ctrl + C` copia una selección (y envía SIGINT si no hay nada seleccionado), y `Ctrl + V` pega. `Ctrl + 1` hasta `Ctrl + 5` siguen cambiando de sesión.

Cuando la barra de búsqueda del terminal está abierta:

| Acción | Atajo |
|--------|-------|
| Siguiente Coincidencia | `Enter` |
| Coincidencia Anterior | `Shift + Enter` |
| Cerrar Búsqueda | `Escape` |

::: tip
`Mod + C` sin selección envía SIGINT al proceso en ejecución. Ver [Terminal Integrado](/es/guide/terminal) para la guía completa.
:::

## Personalizar Atajos

1. Abre Ajustes con `Mod + ,`
2. Navega a la pestaña **Atajos** (escribe en el cuadro de búsqueda para filtrar por nombre, categoría, descripción o tecla)
3. Haz clic en la tecla que aparece junto a un atajo — o en **Sin asignar** si todavía no tiene ninguna
4. Pulsa la combinación de teclas deseada y luego haz clic en **Asignar** (`Escape` cancela)

El diálogo te avisa antes de asignar una combinación:

- **Conflicto** — otro atajo ya usa esa combinación, y el diálogo indica cuál. Aun así puedes elegir **Asignar de todos modos**.
- **No compatible** — VMark no puede usar esa combinación, así que no se puede asignar. Prueba con otra.

Un atajo personalizado aparece resaltado y recibe un botón **Restablecer al predeterminado**. **Restablecer todos** restaura todos los valores predeterminados tras pedir confirmación. **Exportar** guarda tus atajos como un archivo JSON (`vmark-shortcuts.json`) e **Importar** carga uno; si alguna entrada del archivo no es válida, no se importa nada y se enumeran los problemas.

::: tip
Los atajos se sincronizan con los aceleradores del menú cuando corresponde, de modo que los elementos del menú mostrarán tus atajos personalizados.
:::
