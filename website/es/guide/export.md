# Exportar e Imprimir

VMark ofrece múltiples formas de exportar y compartir tus documentos.

## Modos de Exportación

### Modo Carpeta (Predeterminado)

Crea una carpeta autocontenida con una estructura limpia:

```text
MyDocument/
├── index.html
└── assets/
    ├── image1.png
    ├── image2.jpg
    └── ...
```

**Ventajas:**
- URLs limpias al servirse (`/MyDocument/` en lugar de `/MyDocument.html`)
- Fácil de compartir como una sola carpeta
- Rutas de recursos simples (`assets/image.png`)
- Funciona muy bien con servidores de sitios estáticos

### Modo Archivo Único

Crea un único archivo HTML autocontenido:

```text
MyDocument.html
```

Todas las imágenes se embeben como URIs de datos, lo que lo hace completamente portátil pero con un tamaño de archivo mayor.

## Cómo Exportar

### Exportar HTML

1. Usa **Archivo → Exportar HTML**
2. Elige la ubicación de exportación
3. Para el modo carpeta: introduce el nombre de la carpeta (por ejemplo, `MyDocument`)
4. Para el modo archivo único: introduce el nombre de archivo con extensión `.html`

### Imprimir / Exportar PDF

1. Presiona `Cmd/Ctrl + P` o usa **Archivo → Imprimir**
2. Usa el cuadro de diálogo de impresión del sistema para imprimir o guardar como PDF

### Exportar a Otros Formatos

VMark se integra con [Pandoc](https://pandoc.org/) — un convertidor de documentos universal — para exportar tu markdown a formatos adicionales. Elige un formato directamente desde el menú:

**Archivo → Exportar → Otros Formatos →**

| Elemento del Menú | Extensión |
|-------------------|-----------|
| Word (.docx) | `.docx` |
| EPUB (.epub) | `.epub` |
| LaTeX (.tex) | `.tex` |
| OpenDocument (.odt) | `.odt` |
| Texto Enriquecido (.rtf) | `.rtf` |
| Texto Sin Formato (.txt) | `.txt` |

**Configuración:**

1. Instala Pandoc desde [pandoc.org/installing](https://pandoc.org/installing.html) o mediante tu gestor de paquetes:
   - macOS: `brew install pandoc`
   - Windows: `winget install pandoc`
   - Linux: `apt install pandoc`
2. Reinicia VMark (o ve a **Configuración → Archivos e Imágenes → Herramientas de Documentos** y haz clic en **Detectar**)
3. Usa **Archivo → Exportar → Otros Formatos → [formato]** para exportar

Si Pandoc no está instalado, el menú muestra un enlace **"Requiere Pandoc — pandoc.org"** al final del submenú Otros Formatos.

Puedes verificar que Pandoc ha sido detectado en **Configuración → Archivos e Imágenes → Herramientas de Documentos**.

### Copiar como HTML

Presiona `Cmd/Ctrl + Shift + C` para copiar el HTML renderizado al portapapeles y pegarlo en otras aplicaciones.

## VMark Reader

Cuando exportas a HTML (modo estilizado), tu documento incluye el **VMark Reader** — una experiencia de lectura interactiva con potentes características.

### Panel de Configuración

Haz clic en el icono de engranaje (abajo a la derecha) o presiona `Esc` para abrir el panel de configuración:

| Configuración | Descripción |
|---------------|-------------|
| Tamaño de Fuente | Ajusta el tamaño del texto (12px – 24px) |
| Altura de Línea | Ajusta el interlineado (1.2 – 2.0) |
| Tema | Cambiar entre temas (White, Paper, Mint, Sepia, Night) |
| Espaciado CJK-Latino | Activa/desactiva el espaciado entre caracteres CJK y latinos |

### Tabla de Contenidos

La barra lateral de la tabla de contenidos ayuda a navegar documentos largos:

- **Alternar**: Haz clic en el encabezado del panel o presiona `T`
- **Navegar**: Haz clic en cualquier encabezado para saltar a él
- **Teclado**: Usa las flechas `↑`/`↓` para moverte, `Enter` para saltar
- **Resaltado**: La sección actual se resalta mientras desplazas

### Progreso de Lectura

Una sutil barra de progreso en la parte superior de la página muestra hasta dónde has leído el documento.

### Volver al Inicio

Aparece un botón flotante cuando desplazas hacia abajo. Haz clic en él o presiona `Home` para volver al inicio.

### Visor de Imágenes

Haz clic en cualquier imagen para verla en un visor a pantalla completa:

- **Cerrar**: Haz clic fuera, presiona `Esc` o haz clic en el botón X
- **Navegar**: Usa las flechas `←`/`→` para múltiples imágenes
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
| `Esc` | Alternar panel de configuración |
| `T` | Alternar Tabla de Contenidos |
| `↑` / `↓` | Navegar elementos de la tabla de contenidos |
| `Enter` | Saltar al elemento seleccionado de la tabla de contenidos |
| `←` / `→` | Navegar imágenes en el visor |
| `Home` | Desplazarse al inicio |

## Atajos de Exportación

| Acción | Atajo |
|--------|-------|
| Exportar HTML | _(solo menú)_ |
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

Ambos modos de exportación funcionan completamente sin conexión:

- **Modo carpeta**: Abre `index.html` en cualquier navegador
- **Modo archivo único**: Abre el archivo `.html` directamente

Las ecuaciones matemáticas (KaTeX) requieren conexión a internet para la hoja de estilos, pero todo el demás contenido funciona sin conexión.

### Mejores Prácticas

1. **Usa el modo carpeta** para documentos que vayas a compartir o alojar
2. **Usa el modo archivo único** para compartir rápidamente por correo o chat
3. **Incluye texto alternativo descriptivo en las imágenes** para accesibilidad
4. **Prueba el HTML exportado** en diferentes navegadores
