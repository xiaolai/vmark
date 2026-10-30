# Archivos grandes

VMark abre la mayoría de los archivos markdown al instante, pero los archivos muy grandes necesitan un cuidado adicional para mantener la respuesta. Esta página describe cómo VMark los maneja y cómo puedes ajustar su comportamiento.

## Qué cuenta como "grande"

VMark clasifica un archivo por tamaño y, en el caso de markdown, por un recuento estimado de bloques antes de abrirlo:

| Tamaño o recuento de bloques | Categoría | Qué ocurre |
|--------|-----------|------------|
| < 1 MB y menos de 1.200 bloques estimados | Pequeño | Se abre en modo WYSIWYG (texto enriquecido) al instante. |
| 1 MB – 5 MB, o 1.200+ bloques estimados | Grande | Se abre en **modo Fuente** por defecto — en menos de un segundo. La barra de estado ofrece "Cambiar a WYSIWYG". |
| 5 MB – 50 MB | Enorme | Aparece primero un diálogo de confirmación. Solo se abre en modo Fuente. |
| ≥ 50 MB | Rechazado | VMark se niega a abrir el archivo. Usa `less`, `bat` o una herramienta similar en su lugar. |

El tamaño se comprueba a través del sistema operativo sin leer el archivo. Cuando un archivo markdown tiene menos de 1 MB, VMark estima después su número de bloques con un escaneo de líneas de sus bytes — no un análisis de markdown —, por lo que la decisión sigue siendo rápida y el documento nunca se carga en el webview.

## Por qué se usa modo Fuente para los archivos grandes

El modo Fuente usa CodeMirror con virtualización de viewport — solo se renderiza la parte visible del documento. El modo WYSIWYG usa Tiptap/ProseMirror, que debe construir un nodo DOM por cada bloque del documento. En un archivo markdown de 1,4 MB / ~2.250 bloques esto tarda unos 15 segundos al abrirlo por primera vez; el modo Fuente abre el mismo archivo en menos de un segundo.

El coste de construir la vista sigue el número de bloques, no el tamaño del archivo. Tres fixtures de tamaño casi idéntico (377–397 KB) que solo diferían en cómo se dividían sus bytes en bloques se abrieron en 3,6, 5,2 y 18 segundos con 601, 1.201 y 3.401 bloques. Un documento de 524 KB con 3.773 bloques cortos tardó más de 30 segundos en esa máquina: por debajo del umbral de 1 MB, pero muy por encima del punto en que la ventana deja de responder. Por eso la estimación de bloques puede enviar un archivo a modo Fuente por sí sola.

La mayor parte de ese tiempo se va en construir y maquetar la vista, no en el parseo. En un documento CJK largo medido en una máquina lenta, el parseo supuso entre una cuarta parte y dos quintas partes del coste de apertura del editor.

## Mientras se abre un documento

Una ventana responde a sus menús, atajos y botón de cierre antes de que VMark construya la vista de texto enriquecido del documento, que aparece justo después. Antes se construía primero el documento largo, y en una máquina lenta eso podía impedir que la ventana estuviera lista: los menús respondían tarde y el registro decía *menu commands did not mount within 5000ms*.

Lo que hace WYSIWYG al abrir también se mantiene en proporción al documento:

- Las imágenes se cargan cuando se acercan a la zona visible.
- **Espaciado de Caracteres CJK** (**Configuración → Editor → Tipografía**) no hace ningún trabajo mientras está desactivado, su valor por defecto, y recorre el documento una sola vez cuando está activado.
- Las decoraciones, como el resaltado de código, el espaciado CJK y las marcas de lint, cuestan aproximadamente de forma lineal con la longitud del documento. Los documentos muy largos solían costar de forma cuadrática.
- Por encima de 100.000 caracteres, WYSIWYG desactiva el corrector ortográfico del sistema para ese documento, porque volver a revisarlo tras cada edición hace que la escritura se retrase. Se vuelve a activar si el documento baja de ese tamaño. El modo Fuente no se ve afectado.

## Indicadores de la barra de estado

- **Al abrir un archivo grande en WYSIWYG:** aparece un spinner indeterminado con la etiqueta *"Abriendo archivo grande (N MB)…"* a la izquierda de la barra de estado mientras se monta el editor. Desaparece tan pronto como el editor está interactivo.
- **Archivo abierto en modo Fuente automáticamente:** la barra de estado muestra *"Abierto en modo Fuente (archivo grande)."* con un enlace **Cambiar a WYSIWYG**. Al pulsar el enlace, la pestaña activa pasa a WYSIWYG. Cerrar y volver a abrir el archivo lo devuelve al modo Fuente — la sustitución es por sesión.
- **Documento que WYSIWYG no puede mostrar:** un documento con citas o listas anidadas más de 1000 niveles no se puede analizar como texto enriquecido, sea cual sea su tamaño. Se abre en modo Fuente con un mensaje que indica la profundidad, y la barra de estado muestra *"Abierto en modo Fuente (no se puede mostrar en WYSIWYG)."* Reduce el anidamiento y luego usa **Cambiar a WYSIWYG**.

## Configuración

Abre **Configuración → Editor → Archivos grandes**:

- **Abrir archivos grandes en modo Fuente automáticamente** *(activado por defecto)* — incluye archivos de más de 1 MB y markdown con muchos bloques. Desactívalo si prefieres WYSIWYG para archivos de hasta 5 MB, asumiendo el mayor tiempo de apertura.
- **Avisar antes de abrir archivos de más de 5 MB** *(activado por defecto)* — desactívalo para omitir el diálogo de confirmación con archivos entre 5 MB y 50 MB. Aun así, se abrirán en modo Fuente.

El rechazo absoluto a 50 MB no es ajustable por el usuario. La webview no puede contener cadenas arbitrariamente grandes sin riesgo de fallos por falta de memoria.

## Consejos

- Si tienes que seguir editando un archivo muy grande en WYSIWYG, plantéate dividirlo en archivos más pequeños enlazados desde un documento índice. Markdown funciona bien como un conjunto de capítulos más pequeños.
- Si solo necesitas leer o buscar en un archivo grande, el modo Fuente con la regla de números de línea y `Find` (`Mod + F`) suele ser el flujo de trabajo más rápido.
- **Formato → CJK → Formatear archivo completo** y otros comandos de documento completo siguen ejecutándose correctamente en documentos en modo Fuente.

## Casos límite

- **El archivo crece mientras está abierto.** VMark decide la categoría según el tamaño en el momento de abrirlo. Un archivo que crezca a 2 MB mientras lo editas se queda en el modo que hayas elegido.
- **Enlaces simbólicos.** Los tamaños reflejan el archivo de destino, así que un symlink a un archivo de 10 MB se trata como enorme.
- **Archivos vacíos.** Los archivos de cero bytes cuentan como pequeños y se abren en WYSIWYG.
- **El archivo desaparece entre la comprobación de tamaño y la lectura.** Surge el error normal de "archivo no encontrado" — no se lanza ninguna advertencia adicional.

## Limitaciones conocidas

- El recuento de bloques es una estimación, no un análisis: el texto separado por líneas en blanco, los encabezados, los elementos de lista, las filas de tabla y cada bloque de código delimitado cuentan como un bloque, mientras que el código dentro de un delimitador y las líneas de frontmatter se omiten. Un documento con una forma inusual puede enviarse a modo Fuente cuando WYSIWYG habría sido suficientemente rápido; **Cambiar a WYSIWYG** es un clic. Los archivos que no son markdown nunca se enrutan por recuento de bloques.
- WYSIWYG sigue construyendo todos los bloques del documento al abrirlo — solo las imágenes y las fórmulas matemáticas en línea esperan hasta acercarse a la zona visible —, así que cambiar un archivo grande a WYSIWYG cuesta el tiempo de apertura completo descrito arriba.
