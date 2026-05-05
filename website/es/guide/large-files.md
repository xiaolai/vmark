# Archivos grandes

VMark abre la mayoría de los archivos markdown al instante, pero los archivos muy grandes necesitan un cuidado adicional para mantener la respuesta. Esta página describe cómo VMark los maneja y cómo puedes ajustar su comportamiento.

## Qué cuenta como "grande"

VMark clasifica un archivo por tamaño antes de abrirlo:

| Tamaño | Categoría | Qué ocurre |
|--------|-----------|------------|
| < 1 MB | Pequeño | Se abre en modo WYSIWYG (texto enriquecido) al instante. |
| 1 MB – 5 MB | Grande | Se abre en **modo Fuente** por defecto — en menos de un segundo. La barra de estado ofrece "Cambiar a WYSIWYG". |
| 5 MB – 50 MB | Enorme | Aparece primero un diálogo de confirmación. Solo se abre en modo Fuente. |
| ≥ 50 MB | Rechazado | VMark se niega a abrir el archivo. Usa `less`, `bat` o una herramienta similar en su lugar. |

El tamaño se comprueba a través del sistema operativo sin leer el archivo, por lo que la decisión es rápida y no precarga datos.

## Por qué se usa modo Fuente para los archivos grandes

El modo Fuente usa CodeMirror con virtualización de viewport — solo se renderiza la parte visible del documento. El modo WYSIWYG usa Tiptap/ProseMirror, que debe construir un nodo DOM por cada bloque del documento. En un archivo markdown de 1,4 MB / ~2.250 bloques esto tarda unos 15 segundos al abrirlo por primera vez; el modo Fuente abre el mismo archivo en menos de un segundo.

El parseo no es el cuello de botella — lo es la construcción de la vista de ProseMirror. Mover el parseo fuera del hilo principal no mejoraría de forma significativa la espera percibida.

## Indicadores de la barra de estado

- **Al abrir un archivo grande en WYSIWYG:** aparece un spinner indeterminado con la etiqueta *"Abriendo archivo grande (N MB)…"* a la izquierda de la barra de estado mientras se monta el editor. Desaparece tan pronto como el editor está interactivo.
- **Archivo abierto en modo Fuente automáticamente:** la barra de estado muestra *"Abierto en modo Fuente (archivo grande)."* con un enlace **Cambiar a WYSIWYG**. Al pulsar el enlace, la pestaña activa pasa a WYSIWYG. Cerrar y volver a abrir el archivo lo devuelve al modo Fuente — la sustitución es por sesión.

## Configuración

Abre **Configuración → Editor → Archivos grandes**:

- **Abrir archivos de más de 1 MB en modo Fuente automáticamente** *(activado por defecto)* — desactívalo si prefieres WYSIWYG para archivos de hasta 5 MB, asumiendo el mayor tiempo de apertura.
- **Avisar antes de abrir archivos de más de 5 MB** *(activado por defecto)* — desactívalo para omitir el diálogo de confirmación con archivos entre 5 MB y 50 MB. Aun así, se abrirán en modo Fuente.

El rechazo absoluto a 50 MB no es ajustable por el usuario. La webview no puede contener cadenas arbitrariamente grandes sin riesgo de fallos por falta de memoria.

## Consejos

- Si tienes que seguir editando un archivo muy grande en WYSIWYG, plantéate dividirlo en archivos más pequeños enlazados desde un documento índice. Markdown funciona bien como un conjunto de capítulos más pequeños.
- Si solo necesitas leer o buscar en un archivo grande, el modo Fuente con la regla de números de línea y `Find` (`Mod + F`) suele ser el flujo de trabajo más rápido.
- `Formato > Formatear texto CJK` y otros comandos de documento completo siguen ejecutándose correctamente en documentos en modo Fuente.

## Casos límite

- **El archivo crece mientras está abierto.** VMark decide la categoría según el tamaño en el momento de abrirlo. Un archivo que crezca a 2 MB mientras lo editas se queda en el modo que hayas elegido.
- **Enlaces simbólicos.** Los tamaños reflejan el archivo de destino, así que un symlink a un archivo de 10 MB se trata como enorme.
- **Archivos vacíos.** Los archivos de cero bytes cuentan como pequeños y se abren en WYSIWYG.
- **El archivo desaparece entre la comprobación de tamaño y la lectura.** Surge el error normal de "archivo no encontrado" — no se lanza ninguna advertencia adicional.

## Limitaciones conocidas

- Los umbrales son tamaños en bytes, que son una aproximación al coste real (recuento de bloques). Un archivo de 600 KB con miles de bloques cortos puede ser más lento que uno de 1,2 MB con párrafos largos. Los valores por defecto son conservadores.
- La fase C de la iniciativa de archivos grandes (renderizado WYSIWYG diferido) aún no se ha lanzado — consulta `dev-docs/plans/20260422-large-file-open-ux.md` para conocer el estado.
