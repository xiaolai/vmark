# Barra de espacios de trabajo

::: warning Experimental
La barra de espacios de trabajo es experimental y está **desactivada por defecto**. Actívala en **Configuración → Archivos e imágenes → Espacio de trabajo → Barra de espacios de trabajo**. Con la barra desactivada, VMark se comporta exactamente igual que siempre — un espacio de trabajo por ventana.
:::

La barra de espacios de trabajo permite que una ventana contenga **varios espacios de trabajo a la vez**, mostrados como una franja vertical de glifos de colores en el borde izquierdo. Hacer clic en un espacio de trabajo realiza un **cambio de contexto completo**: las pestañas del editor, el árbol de archivos de la barra lateral, la disposición de paneles divididos y el estado de la barra lateral y del esquema pasan al conjunto propio de ese espacio de trabajo — como cambiar de Espacio en un navegador, no simplemente cambiar un filtro.

## Qué cambia y qué se mantiene

| Superficie | Al cambiar en la barra |
|------------|------------------------|
| Tira de pestañas del editor | Muestra solo las pestañas del espacio de trabajo activo (más las páginas del navegador) |
| Árbol de archivos de la barra lateral | Toma como raíz el espacio de trabajo activo, con su propio estado de carpetas abiertas y desplazamiento |
| Paneles divididos | Cada espacio de trabajo recuerda su propia disposición dividida |
| Esquema | El estado de plegado, filtro y desplazamiento de cada pestaña sigue al espacio de trabajo |
| Pestaña siguiente/anterior, menú contextual de pestañas, «pestañas abiertas» de Apertura rápida | Limitados al espacio de trabajo activo |
| Reabrir pestaña cerrada | Las pestañas cerradas se registran por espacio de trabajo (más un ámbito compartido para el navegador) y se reabren de la más reciente a la más antigua desde **Archivo → Reabrir pestaña cerrada**, la paleta de comandos o un atajo que asignes en Configuración → Atajos (viene sin asignar: las combinaciones cercanas están ocupadas). Un documento reabierto se vuelve a leer del disco, así que muestra el archivo tal como está ahora; si el archivo se movió o se eliminó, la pestaña no se restaura y un aviso explica por qué. Una pestaña sin título se reabre vacía. Los cambios sin guardar no se recuperan — al cerrar una pestaña con cambios ya se preguntó si guardarlos |
| **Páginas del navegador** | **Globales en la ventana** — accesibles desde todos los espacios de trabajo |
| Menús de archivos recientes / espacios de trabajo recientes | Globales |
| Autoguardado, avisos de guardado, vigilancia de archivos | Cubren **todas** las pestañas, estén ocultas o no |

Cambiar nunca cierra nada: las pestañas de un espacio de trabajo oculto siguen abiertas en segundo plano, siguen guardándose automáticamente y siguen mostrando un aviso de guardado si cierras la ventana con cambios sin guardar.

## Archivos sueltos

Los archivos abiertos desde fuera de todas las raíces de espacio de trabajo viven en una entrada sintética **Archivos sueltos** (el icono de archivos apilados). Al cambiar a ella se muestran esas pestañas; aparece automáticamente cuando hace falta.

## Mover archivos entre espacios de trabajo

La pertenencia sigue a la ruta del archivo:

- **Guardar como** en la carpeta de otro espacio de trabajo mueve la pestaña allí — y, si es la pestaña que estás viendo, el espacio de trabajo visible la sigue.
- Los renombrados o movimientos en el disco (incluidos los hechos desde Finder) reubican la pestaña de la misma manera.
- Abrir un archivo que pertenece a un espacio de trabajo *oculto* (mediante Apertura rápida, los recientes o un diálogo de archivos) cambia primero a ese espacio de trabajo, para que la pestaña que pediste sea la pestaña que ves.

## Sesiones y reinicio

La configuración de cada espacio de trabajo recuerda **solo sus propias pestañas** y su disposición dividida. Las páginas del navegador abiertas por una persona persisten por ventana. La salida en caliente restaura todos los espacios de trabajo de la ventana — incluido el estado de la barra lateral de cada espacio de trabajo y el historial registrado de pestañas cerradas — y reactiva el espacio de trabajo en el que estabas.

## Comportamiento de la IA (MCP)

Los clientes de IA que abren documentos mediante MCP nunca te arrebatan el espacio de trabajo visible: `workspace.open` crea una **pestaña en segundo plano** y devuelve su `tabId` para las llamadas de documento posteriores. Solo la acción explícita `workspace.switch_tab` cambia lo que ves, y su respuesta informa `workspaceSwitched: true` para que la IA pueda decirte que ocurrió. Consulta la [Referencia de herramientas MCP](/es/guide/mcp-tools).

## Acciones de la barra

| Acción | Cómo |
|--------|------|
| Cambiar de espacio de trabajo | Haz clic en su glifo |
| Añadir un espacio de trabajo | **Archivo > Abrir espacio de trabajo** (si la carpeta ya está en la barra, se cambia a ella en lugar de duplicarla) |
| Reordenar | Arrastra un glifo sobre otro |
| Mover a su propia ventana | Arrastra un glifo fuera de la ventana |
| Duplicar en una ventana nueva | El botón **⧉** al pasar el puntero |
| Cerrar un espacio de trabajo | Clic derecho → Cerrar. Todas sus pestañas se cierran con él, también las fijadas; cada pestaña con cambios sin guardar pregunta primero, y si cancelas, el espacio de trabajo se mantiene |

## Sesiones de terminal

Cada espacio de trabajo de la barra tiene sus propias sesiones de terminal. Un cambio en la barra intercambia las pestañas de terminal visibles; los shells de los espacios de trabajo ocultos siguen ejecutándose sin que nadie los toque — no se escribe ningún `cd` en ellos, estén ocupados o inactivos — y al volver se muestran los mismos shells, con la sesión en la que estabas recordada por espacio de trabajo. Las sesiones nuevas (el botón **+**, «Abrir terminal aquí», «Ejecutar en la terminal») se crean en el espacio de trabajo activo y comienzan en su raíz; cerrar un espacio de trabajo o moverlo a su propia ventana cierra sus sesiones con él. Más detalles en la [guía del terminal](/es/guide/terminal#sesiones-del-terminal-y-la-barra-de-espacios-de-trabajo).

## Limitación conocida

En macOS, dos grafías de la misma carpeta que solo difieren en mayúsculas y minúsculas (posibles en volúmenes que no distinguen mayúsculas) se tratan como espacios de trabajo **distintos**. Es deliberado: la identidad del espacio de trabajo es exacta byte a byte en macOS y Linux, y sin distinción de mayúsculas en Windows.
