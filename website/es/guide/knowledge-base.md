# Base de conocimiento y Slidev

VMark puede servir todo tu espacio de trabajo como una base de conocimiento
navegable y con enlaces cruzados, y previsualizar/exportar presentaciones de
[Slidev](https://sli.dev) — ambas cosas impulsadas por un único servidor de
contenido local que VMark inicia bajo demanda.

::: warning Estado
Esta función se está desplegando por fases, y **ninguna versión publicada en
ninguna plataforma incluye el entorno de ejecución del servidor de contenido**
del que depende — consulta [Requisitos](#requisitos). Por eso **permanece oculta
salvo que el modo de desarrollador esté activado**: el elemento del menú Vista,
la entrada de la paleta de comandos y el atajo `Ctrl + Shift + 4` solo aparecen
cuando activas **Ajustes → Avanzado → Herramientas de desarrollo**. Actívalo y
abre el panel **Base de conocimiento** para ver qué tiene tu equipo y qué le
falta.
:::

## Requisitos

La base de conocimiento, su grafo de relaciones, la búsqueda, la recarga en vivo
y la vista previa de Slidev se ejecutan todos en un único servidor de contenido
local — un programa Node.js independiente que VMark inicia bajo demanda. Deben
estar presentes dos cosas antes de que pueda arrancar:

- **Node.js.** VMark resuelve `node` a través del `PATH` de tu shell de inicio
  de sesión, igual que lo haría un terminal, así que un Node.js que solo ve una
  herramienta local de un proyecto no cuenta. Instálalo de modo que `node` esté
  en el `PATH` de tu shell de inicio de sesión.
- **El propio servidor de contenido** (`server/content` en el repositorio de
  VMark, compilado a un `cli.js`). **Ninguna compilación empaquetada de VMark lo
  incluye todavía — en ninguna plataforma.** No es una carencia de Linux o
  Windows: el DMG de macOS tampoco incluye el entorno de ejecución del servidor
  de contenido, y las comprobaciones de publicación de VMark lo verifican en
  cada versión. Hasta que exista una solución de distribución, la función
  requiere un entorno de desarrollo — una copia del repositorio de VMark con el
  servidor de contenido compilado, puesta a disposición mediante la variable de
  entorno `VMARK_CONTENT_SERVER_CLI` (o un entorno `base-kb` que colocas a mano en
  los datos de la aplicación de VMark; VMark nunca descarga uno).

El panel comprueba ambas cosas al abrirse. Cuando falta alguna, indica cuál y
qué la proporcionaría, en lugar de intentar un arranque que no puede tener
éxito.

## Abrir el panel

La Base de conocimiento está **oculta por defecto**, porque una versión
publicada no puede iniciarla. Para mostrarla, activa **Ajustes → Avanzado →
Herramientas de desarrollo**. El elemento de menú **Vista → Base de
conocimiento**, la entrada de la paleta de comandos ("Alternar base de
conocimiento") y el atajo `Ctrl + Shift + 4` aparecen con ella, y desaparecen
de nuevo cuando la desactivas.

Con las Herramientas de desarrollo activadas, abre el panel desde **Vista →
Base de conocimiento**, la paleta de comandos o `Ctrl + Shift + 4`. El panel se
acopla a la derecha; vuelve a alternarlo para ocultarlo.

Al desactivar de nuevo las Herramientas de desarrollo se ocultan otra vez los
puntos de acceso, y el panel se cierra con ellos: el panel no tiene botón de
cierre propio, así que dejarlo abierto dejaría un panel acoplado que nada
podría cerrar. Un servidor que ya está **en ejecución** no se toca — vuelve a
activar las Herramientas de desarrollo para llegar a su botón Detener; en
cualquier caso, VMark detiene sus servidores de contenido al salir.

## Base de conocimiento

Abre un espacio de trabajo e inicia el panel **Base de conocimiento**. VMark
lanza un servidor local vinculado a `127.0.0.1` (solo bucle invertido) y
convierte cada archivo markdown en HTML con la misma semántica de markdown que
el editor — los enlaces wiki, alertas, matemáticas, tablas, listas de tareas y
bloques de detalles se muestran de forma idéntica.

Capacidades:

- **Navegación por enlaces wiki** — `[[Page]]`, `[[dir/Page]]`, `[[Page#Heading]]`
  y `[[Page|Alias]]` se resuelven en todo el espacio de trabajo. Los enlaces sin
  resolver se muestran como "faltantes" para que las lagunas sean visibles.
- **Grafo de relaciones** — las notas, las etiquetas (`#tag` y `tags:` del
  frontmatter) y las relaciones tipadas del frontmatter (`up`, `related`,
  `links`, …) forman un grafo interactivo con retroenlaces.
- **Búsqueda de texto completo** en todo el espacio de trabajo.
- **Recarga en vivo** — las ediciones guardadas actualizan automáticamente las
  páginas servidas.

Puedes ver la base de conocimiento dentro de VMark (panel integrado) o
**abrirla en tu navegador** — la acción "Abrir en el navegador" realiza un
intercambio autenticado de un solo uso para que tu navegador reciba una cookie
de sesión. El servidor solo escucha en bucle invertido y está protegido por
cookie; nunca expone tu espacio de trabajo fuera de tu equipo.

## Presentaciones de Slidev

Cuando abres un archivo markdown cuyo frontmatter lo marca como presentación de
Slidev (p. ej. `theme:`, `layout:` + diapositivas, o un `format: slidev`
explícito), VMark puede ejecutar la cadena de herramientas real de Slidev para
previsualizarlo en vivo — el mismo renderizador que usa Slidev, así que los
diseños, las animaciones por clic y los componentes son totalmente fieles.

Con la presentación abierta y el panel Base de conocimiento en ejecución, usa
**Previsualizar diapositivas** para abrir la presentación en vivo en tu
navegador y **Exportar diapositivas** para renderizarla. Slidev vigila la
presentación en disco, así que al guardar ediciones en VMark la vista previa
abierta se recarga en caliente.

### Exportar

Las presentaciones de Slidev se exportan a **PDF**, **PNG** o **PPTX**. El
servidor de contenido ejecuta el propio comando `slidev export` de Slidev, que
renderiza las diapositivas en Chromium mediante el paquete
`playwright-chromium`. VMark no descarga ni localiza un navegador para ello: si
`playwright-chromium` no está instalado junto a Slidev en el entorno de
ejecución del servidor de contenido, la exportación falla y muestra el mensaje
de error de Slidev. Una exportación que dura más de tres minutos se detiene.

**Exportar diapositivas** pregunta dónde guardar con el panel de guardado nativo
de VMark, y la exportación escribe solo en la ruta que elegiste allí; la
extensión del archivo debe coincidir con el formato (`.pdf`, `.png`, `.pptx`).

## Privacidad y seguridad

- El servidor solo se vincula a `127.0.0.1` y requiere un token por sesión
  (entregado como una cookie HttpOnly, SameSite=Strict).
- El acceso a archivos se limita a la raíz del espacio de trabajo; el recorrido
  de rutas se rechaza y los enlaces simbólicos no se siguen.
- El HTML renderizado se sanea y se sirve bajo una política de seguridad de
  contenido. **La confianza del espacio de trabajo cambia exactamente una cosa
  aquí: si se muestran las imágenes remotas.** VMark pasa la confianza del
  espacio de trabajo al servidor cuando lo inicia; para un espacio de trabajo
  de confianza la política relaja `img-src` para que se carguen las imágenes
  `https:`, y para uno que no es de confianza solo se muestran las imágenes
  locales e incrustadas. La confianza no decide si un espacio de trabajo se
  sirve — cualquier espacio de trabajo abierto puede servirse. Cambiar la
  confianza de un espacio de trabajo mientras su base de conocimiento está en
  ejecución reinicia el servidor, para que la política siga el cambio.
