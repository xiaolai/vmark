# Atajos de Teclado

VMark está diseñado para flujos de trabajo que priorizan el teclado. La mayoría de los atajos se pueden personalizar en Configuración. Un pequeño número de primitivas son fijas: los selectores multicursor `Mod+D` (Seleccionar Siguiente Ocurrencia) y `Mod+Shift+L` (Seleccionar Todas las Ocurrencias), y las asignaciones globales de Deshacer/Rehacer. Los demás atajos multicursor (Omitir Ocurrencia, Deshacer Cursor Suave, Añadir Cursor Arriba/Abajo) son configurables. Los atajos marcados como _(sensibles al contexto)_ son gestionados dentro del editor para estructuras específicas (por ejemplo, alternar la casilla de una lista de tareas) y no están expuestos en el registro de personalización.

## Notación

- **Mod** = Cmd en macOS, Ctrl en Windows/Linux
- **Alt** = Option en macOS

## Teclas de Función en macOS

VMark usa teclas de función (F4–F10) para cambios rápidos de modo. En macOS, estas teclas están asignadas a funciones del sistema (brillo, volumen, etc.) de forma predeterminada.

**Para usar las teclas F directamente sin mantener presionado Fn:**

1. Abre **Configuración del Sistema** → **Teclado**
2. Activa **"Usar F1, F2, etc. como teclas de función estándar"**

Alternativamente, mantén presionada la tecla **Fn** al pulsar F4–F10 para activar los atajos de VMark.

::: tip
Si prefieres mantener las funciones del sistema en las teclas F, puedes personalizar los atajos de VMark en Configuración (`Mod + ,`) para usar diferentes combinaciones de teclas.
:::

### Referencia Rápida de Teclas F

| Tecla | Acción |
|-------|--------|
| `F2` | Siguiente problema |
| `Shift + F2` | Problema anterior |
| `F4` | Ordenar Líneas Ascendente |
| `Shift + F4` | Ordenar Líneas Descendente |
| `F5` | Vista Previa de Fuente |
| `F6` | Alternar Modo Fuente |
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
| Abrir Enlace (Modo Fuente) | `Cmd + Clic` |
| Eliminar Enlace | `Alt + Shift + K` |
| Wiki Link | `Alt + Mod + K` |
| Bookmark Link | `Alt + Mod + B` |
| Limpiar Formato | `Mod + \` |

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
| Cambiar Tipo de Lista | _(personalizable)_ |
| Indentar | `Mod + ]` |
| Desindentar | `Mod + [` |
| Línea Horizontal | `Alt + Mod + -` |

## Operaciones de Línea

| Acción | Atajo |
|--------|-------|
| Mover Línea Arriba | `Alt + Arriba` |
| Mover Línea Abajo | `Alt + Abajo` |
| Duplicar Línea | `Shift + Alt + Abajo` |
| Eliminar Línea | `Mod + Shift + K` |
| Unir Líneas | `Mod + J` |
| Ordenar Líneas Ascendente | `F4` |
| Ordenar Líneas Descendente | `Shift + F4` |

## Transformaciones de Texto

| Acción | macOS | Windows/Linux |
|--------|-------|---------------|
| MAYÚSCULAS | `Ctrl + Shift + U` | `Alt + Shift + U` |
| minúsculas | `Ctrl + Shift + L` | `Alt + Shift + L` |
| Título Inicial | `Ctrl + Shift + T` | `Alt + Shift + T` |
| Alternar Estilo de Comillas | `Shift + Mod + '` | `Shift + Mod + '` |

## Insertar

| Acción | Atajo |
|--------|-------|
| Insertar Imagen | `Mod + Shift + I` |
| Insertar Vídeo | — |
| Insertar Audio | — |
| Insertar Tabla | `Mod + Shift + T` |
| Matemáticas en Línea | `Alt + Mod + M` |
| Bloque de Matemáticas | `Alt + Mod + Shift + M` |
| Insertar Nota | `Alt + Mod + N` |
| Insertar Consejo | `Alt + Mod + Shift + T` |
| Insertar Advertencia | `Mod + Shift + W` |
| Insertar Importante | `Alt + Mod + Shift + I` |
| Insertar Precaución | `Mod + Shift + U` |
| Insertar Desplegable | `Alt + Mod + D` |
| Insertar Diagrama | `Alt + Shift + Mod + D` |
| Insertar Mapa Mental | `Alt + Shift + Mod + K` |
| Alternar Comentario | `Mod + /` |

## Selección y Multicursor

| Acción | Atajo |
|--------|-------|
| Seleccionar Línea | `Mod + L` |
| Expandir Selección | `Ctrl + Shift + Arriba` |
| Seleccionar Siguiente Ocurrencia | `Mod + D` |
| Omitir Ocurrencia | `Mod + Shift + D` |
| Seleccionar Todas las Ocurrencias | `Mod + Shift + L` |
| Deshacer Cursor Suave | `Alt + Mod + Z` |
| Añadir Cursor Arriba | `Mod + Alt + Arriba` |
| Añadir Cursor Abajo | `Mod + Alt + Abajo` |
| Colapsar Multicursor | `Escape` |

## Buscar y Reemplazar

| Acción | Atajo |
|--------|-------|
| Buscar y Reemplazar | `Mod + F` |
| Siguiente Coincidencia | `Mod + G` |
| Coincidencia Anterior | `Mod + Shift + G` |
| Usar Selección para Buscar | `Mod + E` |
| Buscar en Archivos | `Mod + Shift + H` |

## Vista y Modo

| Acción | Atajo |
|--------|-------|
| Alternar Modo Fuente | `F6` |
| Alternar Barra de Estado | `F7` |
| Modo Enfoque | `F8` |
| Modo Máquina de Escribir | `F9` |
| Modo Solo Lectura | `F10` |
| Tamaño Real | `Mod + 0` |
| Ampliar | `Mod + =` |
| Reducir | `Mod + -` |
| Ajuste de Línea | `Alt + Z` |
| Alternar Esquema | `Ctrl + Shift + 1` |
| Alternar Explorador de Archivos | `Ctrl + Shift + 2` |
| Alternar Historial | `Ctrl + Shift + 3` |
| Alternar Números de Línea (bloques de código) | `Alt + Mod + L` |
| Alternar Terminal | Ctrl + `` ` `` |
| Alternar Vista Previa de Diagrama | `Alt + Mod + P` |
| Ajustar Tablas al Ancho | _(personalizable)_ |
| Barra de Herramientas Universal | `Mod + Shift + P` |
| Vista Previa de Fuente | `F5` |
| Comprobar Markdown | `Alt + Mod + V` |
| Siguiente problema | `F2` |
| Problema anterior | `Shift + F2` |

## Operaciones de Archivo

| Acción | Atajo |
|--------|-------|
| Nuevo Archivo | `Mod + N` |
| Abrir Rápido | `Mod + O` |
| Abrir Espacio de Trabajo | `Mod + Shift + O` |
| Guardar | `Mod + S` |
| Guardar Como | `Mod + Shift + S` |
| Guardar Todo y Salir | `Alt + Mod + Shift + Q` |
| Mover a | Solo menú |
| Cerrar | `Mod + W` |
| Exportar HTML | Solo menú |
| Imprimir | `Mod + P` |
| Exportar PDF | — |
| Configuración | `Mod + ,` |

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
| Cerrar Pestaña | `Mod + W` |
| Alternar Archivos Ocultos | `Mod + Shift + .` |
| Alternar Todos los Archivos | _(personalizable)_ |

::: tip Nota Windows/Linux
Alternar Archivos Ocultos usa `Ctrl + H` en Windows y Linux.
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
| Dentro de **negrita**, *cursiva*, `código` | Saltar después del formato |
| Dentro de un enlace | Saltar después del enlace |

| Contexto | Acción de Shift+Tab |
|----------|---------------------|
| Después de `(`, `[`, `{`, comillas | Saltar antes del carácter de apertura |
| Después de corchetes CJK `「`, `『`, etc. | Saltar antes del corchete de apertura |
| Dentro de **negrita**, *cursiva*, `código` | Saltar antes del formato |
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
| Eliminar Fila | `Mod + Retroceso` |
| Añadir Columna a la Izquierda | `Alt + Mod + Izquierda` |
| Añadir Columna a la Derecha | `Alt + Mod + Derecha` |
| Eliminar Columna | `Alt + Mod + Retroceso` |
| Alinear Columna a la Izquierda | `Mod + Alt + Shift + L` |
| Alinear Columna a la Derecha | `Mod + Shift + R` |
| Alinear Columna al Centro | _(personalizable)_ |
| Formatear Tabla | `Alt + Mod + T` |
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
| Copiar | `Mod + C` (con selección) |
| Pegar | `Mod + V` |
| Limpiar | `Mod + K` |
| Buscar | `Mod + F` |

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

1. Abre Configuración con `Mod + ,`
2. Navega a la pestaña **Atajos**
3. Haz clic en cualquier atajo para editarlo
4. Pulsa la combinación de teclas deseada
5. Los cambios se guardan automáticamente

::: tip
Los atajos se sincronizan con los aceleradores del menú cuando corresponde, de modo que los elementos del menú mostrarán tus atajos personalizados.
:::
