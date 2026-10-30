# Exportar e Imprimir

VMark ofrece múltiples formas de exportar y compartir tus documentos.

## Qué Produce una Exportación

**Archivo → Exportar → HTML** escribe una carpeta, con el nombre de tu documento, que siempre contiene **ambos** archivos — no hay ningún modo que elegir:

```text
MyDocument/
├── index.html          ← enlaza a los archivos de assets/
├── standalone.html     ← todo incrustado como URIs de datos (CSS, JS, imágenes, fuentes)
└── assets/
    ├── vmark-reader.css
    ├── vmark-reader.js
    ├── images/
    │   ├── image1.png
    │   └── ...
    └── fonts/          ← solo cuando el documento tiene matemáticas o usas una fuente web
```

Usa el archivo que mejor convenga en cada momento:

| Archivo | Ideal para | Contrapartida |
|---------|------------|---------------|
| `index.html` | Alojarlo en un sitio estático (URLs limpias `/MyDocument/`), editarlo en otra herramienta, mantener el tamaño reducido | Necesita la carpeta `assets/` a su lado |
| `standalone.html` | Enviar por correo o mensajería un único archivo que no puede perder sus imágenes | Más grande — cada recurso va incrustado |

Ambos archivos se generan con el mismo renderizador WYSIWYG y la misma hoja de estilos que usa el editor, y ambos incluyen el [VMark Reader](#vmark-reader).

## Cómo Exportar

### Exportar HTML

1. Usa **Archivo → Exportar → HTML**
2. Elige dónde guardar e introduce un nombre — se convierte en el nombre de la carpeta (se elimina un `.html` final)
3. Abre `index.html` o `standalone.html` desde la nueva carpeta

#### Volver a exportar a una carpeta que ya has usado

Una exportación HTML es todo o nada. Todo se escribe primero en una carpeta
temporal `.vmark-export-…` dentro del destino elegido, y solo se mueve a su
lugar cuando existen todos los archivos — así, una exportación que falla a
mitad de camino deja la exportación anterior exactamente como estaba, en lugar
de sobrescribirla a medias.

Dos cosas que podrías ver:

- **"Otra exportación ya está escribiendo en…"** Solo una exportación puede
  escribir en una carpeta a la vez, entre todas las ventanas. Espera a que
  termine la otra o — si no hay nada más en curso — elimina el archivo
  `.vmark-export.lock` que indica el mensaje e inténtalo de nuevo.
- **Una carpeta `.vmark-export-…` que queda atrás.** VMark la elimina cuando
  termina. Solo permanece si también falló devolver a su sitio tus archivos
  anteriores, en cuyo caso los contiene y el mensaje de error indica
  exactamente dónde están. No se elimina nada mientras esa sea la única copia.

### Imprimir / Exportar PDF

Disponible en macOS, Windows y Linux.

**Exportar PDF** (**Archivo → Exportar → PDF**) escribe un PDF directamente,
con el tamaño de página, la orientación, los márgenes y la tipografía que
elijas en el diálogo de exportación.

**Imprimir** (`Cmd/Ctrl + P`, o **Archivo → Imprimir**) abre en cambio el
diálogo de impresión del sistema, para que puedas enviar el documento a una
impresora o usar la opción "guardar como PDF" de tu sistema operativo. En macOS
y Linux, VMark confirma un trabajo de impresión terminado con un breve aviso y
no dice nada si cancelas el diálogo; la interfaz de impresión de Windows no
informa del resultado, así que allí no se muestra ningún aviso.

El diálogo de exportación muestra las mismas etapas de progreso — cargando,
generando, finalizando, listo — en las tres plataformas.

::: info Tamaño de página en macOS
El Tamaño y la Orientación que elijas en el diálogo determinan la página
exportada en todas las plataformas. En macOS prevalecen sobre el tamaño de
papel configurado en el sistema — si tu Mac usa Carta por defecto y eliges A4,
el PDF será A4.
:::

**Esquema en la barra lateral.** Los PDF exportados incluyen un esquema de
encabezados — la tabla de contenidos en la que se puede hacer clic que tu
visor de PDF muestra en su barra lateral — en las tres plataformas.

#### Números de página

La sección **Números de página** del diálogo añade un número a cada página.
Está activada por defecto, centrada abajo.

| Ajuste | Opciones |
|--------|----------|
| Posición | Abajo centrado, abajo a la derecha o ninguno |
| Formato | `7`, `7 / 12` o `Página 7 de 12` |
| Omitir la primera página | Deja la página 1 sin número, el tratamiento habitual para una portada |

El número se sitúa dentro del margen inferior que elegiste y se escala con el
tamaño de fuente del cuerpo. La numeración siempre refleja la página real, así
que omitir la primera página te da 2, 3, 4… en las páginas siguientes en lugar
de volver a numerarlas.

::: info Los números de página usan un alfabeto latino
El número se dibuja con una fuente PDF estándar que ningún visor tiene que
descargar, lo que mantiene las exportaciones rápidas y autocontenidas — pero
esa fuente no puede representar chino, japonés, coreano ni cirílico. Los dos
formatos numéricos funcionan en todos los idiomas. Si el idioma de tu interfaz
escribe `Página 7 de 12` en una escritura que esa fuente no puede dibujar,
VMark imprime en su lugar la forma numérica `7 / 12` en vez de huecos o
caracteres erróneos.
:::

### Exportar con Pandoc

VMark se integra con [Pandoc](https://pandoc.org/) — un convertidor de documentos universal — para exportar tu markdown a formatos adicionales. Elige un formato directamente desde el menú:

**Archivo → Exportar → Con Pandoc →**

| Elemento del Menú | Extensión |
|-------------------|-----------|
| Word (.docx) | `.docx` |
| EPUB (.epub) | `.epub` |
| LaTeX (.tex) | `.tex` |
| OpenDocument (.odt) | `.odt` |
| Texto enriquecido (.rtf) | `.rtf` |
| Texto plano (.txt) | `.txt` |

**Configuración:**

1. Instala Pandoc desde [pandoc.org/installing](https://pandoc.org/installing.html) o mediante tu gestor de paquetes:
   - macOS: `brew install pandoc`
   - Windows: `winget install pandoc`
   - Linux: `apt install pandoc`
2. Reinicia VMark (o ve a **Configuración → Archivos e imágenes → Herramientas de documento** y haz clic en **Detectar**)
3. Usa **Archivo → Exportar → Con Pandoc → [formato]** para exportar

Si Pandoc no está instalado, el submenú **Con Pandoc** muestra un único elemento — **"Instalar Pandoc para exportar a Word, EPUB, LaTeX…"** — que abre la guía de instalación de Pandoc al hacer clic.

Puedes verificar que Pandoc ha sido detectado en **Configuración → Archivos e imágenes → Herramientas de documento**.

### Copiar como HTML

Presiona `Cmd/Ctrl + Shift + C` para copiar el documento renderizado como **código fuente** HTML. El marcado se copia al portapapeles como texto sin formato y sin estilos, así que pégalo donde se espera código HTML — la vista HTML de un CMS, una plantilla, un editor de código; un editor de texto enriquecido como Word o Mail muestra las etiquetas literalmente. Las imágenes locales se embeben como URIs de datos, por lo que se siguen mostrando cuando el HTML sale de VMark.

## VMark Reader

Cada exportación HTML incluye el **VMark Reader** — una experiencia de lectura interactiva con sus propios ajustes, navegación y visor de imágenes.

### Panel de Configuración

Haz clic en el icono de engranaje (abajo a la derecha) para abrir el panel de configuración; `Esc` lo vuelve a cerrar. El navegador recuerda tus elecciones (`localStorage`), así que se aplican la próxima vez que abras el archivo.

| Configuración | Opciones |
|---------------|----------|
| Tamaño de Fuente | 12px – 28px |
| Altura de Línea | 1.2 – 2.4 |
| Ancho del Contenido | 30em – 80em |
| Fuente Latina | System, Athelas, Palatino, Georgia, Charter, Literata |
| Fuente CJK | System, PingFang, Songti, Kaiti, Noto Serif, Source Han |
| Tema | White, Paper (predeterminado), Mint, Sepia, Night |
| Espaciado entre Letras CJK | 0.02em – 0.12em |
| Espaciado CJK-Latino | Activa/desactiva el espaciado automático entre caracteres CJK y latinos |
| Tabla de Contenidos | Muestra/oculta la barra lateral de la tabla de contenidos (igual que pulsar `T`) |
| Expandir Todas las Secciones | Abre todos los bloques desplegables `<details>` |
| Restablecer Valores Predeterminados | Devuelve todos los ajustes a su valor inicial |

### Tabla de Contenidos

La barra lateral de la tabla de contenidos ayuda a navegar documentos largos:

- **Alternar**: Haz clic en la pestaña del borde de la página o presiona `T`
- **Navegar**: Haz clic en cualquier encabezado para saltar a él
- **Resaltado**: La sección actual se resalta mientras desplazas

### Progreso de Lectura

Una sutil barra de progreso en la parte superior de la página muestra hasta dónde has leído el documento.

### Volver al Inicio

Aparece un botón flotante cuando desplazas hacia abajo. Haz clic en él para volver al inicio.

### Visor de Imágenes

Haz clic en cualquier imagen para verla en un visor a pantalla completa:

- **Cerrar**: Haz clic fuera, presiona `Esc` o haz clic en el botón X
- **Zoom**: Las imágenes se muestran a su tamaño natural

### Bloques de Código

Cada bloque de código incluye controles interactivos:

| Botón | Función |
|-------|---------|
| Alternar números de línea | Muestra/oculta los números de línea para este bloque |
| Botón de copiar | Copia el código al portapapeles |

El botón de copiar muestra una marca de verificación cuando tiene éxito.

### Navegación de Notas al Pie

Las notas al pie son completamente interactivas:

- Haz clic en una referencia de nota al pie `[1]` para saltar a su definición
- Haz clic en el `↩` de retorno para volver al punto donde estabas leyendo

### Atajos de Teclado

| Tecla | Acción |
|-------|--------|
| `Esc` | Cerrar el panel de configuración o el visor de imágenes |
| `T` | Alternar Tabla de Contenidos |
| `+` / `=` | Aumentar el tamaño de fuente |
| `-` | Reducir el tamaño de fuente |

## Atajos de Exportación

| Acción | Atajo |
|--------|-------|
| Exportar HTML | _(solo menú)_ |
| Exportar PDF | _(solo menú)_ |
| Imprimir | `Mod + P` |
| Copiar como HTML | `Mod + Shift + C` |

## Consejos

### Servir el HTML Exportado

La estructura de exportación en carpeta funciona bien con cualquier servidor de archivos estáticos:

```bash
# Python
cd MyDocument && python -m http.server 8000

# Node.js (npx)
npx serve MyDocument

# Abrir directamente
open MyDocument/index.html
```

### Visualización Sin Conexión

Ambos archivos se abren sin conexión, con una diferencia para los documentos que contienen matemáticas:

- **`standalone.html`** es totalmente autocontenido — la hoja de estilos y las fuentes de KaTeX se incrustan al exportar, así que las matemáticas se muestran sin conexión.
- **`index.html`** carga la hoja de estilos de KaTeX desde una CDN (jsDelivr), así que sus matemáticas necesitan conexión a internet cuando se abre la página; el lector, las imágenes y las fuentes de `assets/` son locales.

Las fuentes se descargan mientras exportas: las fuentes de KaTeX cuando el documento tiene matemáticas, y tus fuentes latina y monoespaciada cuando son fuentes web que VMark conoce (Literata, JetBrains Mono, Fira Code, IBM Plex Mono). El ajuste de fuente CJK nunca se incrusta, y tampoco una fuente del sistema ni una familia de fuentes personalizada — la página exportada usa para ellas la pila de fuentes del sistema del lector. Exporta en un equipo con acceso a internet si quieres incrustar las fuentes — una exportación sin conexión recurre a las fuentes del sistema.

### Qué Imágenes se Incrustan

Un archivo exportado lleva los bytes reales de las imágenes, y las exportaciones
se comparten — así que VMark limita de dónde pueden proceder esos bytes:

| Tu documento está… | Las imágenes pueden proceder de |
|---|---|
| dentro de un espacio de trabajo abierto | cualquier lugar de ese espacio de trabajo |
| abierto por sí solo | la propia carpeta del documento y sus subcarpetas |
| sin guardar (nunca guardado en disco) | ninguna parte — no se incrusta ninguna imagen local, ni siquiera con un espacio de trabajo abierto; las imágenes remotas no se ven afectadas |

Si el documento no está guardado, guárdalo primero y vuelve a exportarlo. Esto se aplica a HTML, impresión, PDF y Copiar como HTML.

Las rutas relativas se resuelven desde la carpeta del documento, exactamente
igual que en el editor — así que `../images/photo.png` funciona siempre que el
destino quede dentro del límite anterior. Todo lo que quede fuera
(`~/.ssh/id_rsa`, `/etc/passwd`, una ruta absoluta en otro lugar del disco) se
rechaza y se exporta como un marcador "Image not found", que se contabiliza en
el aviso de la exportación.

Si una imagen `../` se exporta como marcador, abre su carpeta como espacio de
trabajo y vuelve a exportar.

### Mejores Prácticas

1. **Aloja `index.html`** para los documentos que vayas a publicar — mantén la carpeta `assets/` a su lado
2. **Envía `standalone.html`** para compartir rápidamente por correo o chat
3. **Incluye texto alternativo descriptivo en las imágenes** para accesibilidad
4. **Prueba el HTML exportado** en diferentes navegadores
