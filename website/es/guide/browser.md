# Navegador integrado

VMark puede alojar un navegador web real **dentro** de una ventana de documento — una página web se convierte en una pestaña de primera clase junto a tus documentos Markdown. Es una webview nativa auténtica (`WKWebView` de macOS), no una ventana externa de Chrome ni un marco incrustado.

::: warning Experimental
El navegador integrado es una función incipiente y **solo funciona en macOS** en esta compilación. La compatibilidad con Windows y Linux llegará más adelante — en esas plataformas los ajustes que se describen a continuación no aparecen en absoluto.
:::


::: info Riel de espacios de trabajo
Con el [riel de espacios de trabajo](/guide/workspace-rail) experimental activado, las páginas del navegador son **globales para la ventana**: siguen siendo accesibles desde cualquier espacio de trabajo de la ventana y nunca quedan ligadas a las pestañas de un solo espacio de trabajo.
:::

## Cómo desactivarlo

El navegador está **activado de forma predeterminada** en macOS. **Nueva pestaña del navegador** está en el menú **Archivo**
(`Alt + Mod + Shift + B`) y en la paleta de comandos — no hace falta
activar nada primero.

Para desactivarlo, ve a **Ajustes → Avanzado → macOS** y desactiva
**Navegador integrado**. Esto también cierra cualquier pestaña del navegador abierta y retira la
superficie de automatización por IA que se describe más abajo.

Dos ajustes de postura de IA se sitúan justo debajo del interruptor y solo aparecen mientras
está activado. Ambos vienen configurados de forma conservadora y no cambian por el hecho de que el navegador esté activado:

| Ajuste | Predeterminado | Significado |
|---|---|---|
| **Sesión de IA** | Sandbox | Las páginas controladas por la IA obtienen una sesión aislada en lugar de compartir aquella en la que has iniciado sesión |
| **Permitir bucle local** | Desactivado | Se rechaza la navegación de la IA a `localhost` o a direcciones de red privada |

Los permisos de sitio no están en Ajustes — se encuentran en la barra lateral del navegador, en la
ventana que los posee.

## Cómo usarlo

Una pestaña del navegador se abre en el área del editor, junto a tus documentos — la barra lateral, la tira de pestañas, el terminal y la barra de estado permanecen donde están. Sus controles se sitúan **encima de la página**: en macOS comparten la barra de título de la ventana, ya que VMark la dibuja por su cuenta. Cuando es el sistema quien dibuja la barra de título (Windows, Linux), se sitúan dentro de la ventana, encima de la página, tal como los disponen todos los demás navegadores de escritorio.

| Control | Acción |
|---------|--------|
| ‹ / › | Atrás / adelante. Aparecen atenuados cuando no hay adónde ir |
| ⟳ / ✕ | Recargar, o detener una carga en curso |
| Barra de direcciones | Un **omnibox**: escribe una URL para ir allí, o cualquier otra cosa para buscar |
| ☆ / ★ | Añadir esta página a marcadores |

La barra de direcciones sigue la página automáticamente: si un sitio redirige, o un enlace te lleva a otro lugar, la barra se actualiza para mostrar dónde estás realmente.

## La barra lateral sigue a la pestaña

Cuando una pestaña del navegador está activa, la barra lateral muestra el **historial de navegación** y los **marcadores**. Cuando vuelves a un documento, muestra de nuevo el explorador de archivos, el esquema y el historial de archivos — automáticamente. No hay un segundo modo que mantener sincronizado, y cada lado recuerda lo que tenías abierto por última vez, de modo que echar un vistazo a una pestaña del navegador no te cuesta el árbol de archivos que estabas usando.

El **historial** es por ventana y solo vive durante la sesión: nunca se escribe en el disco. (Aún hay un botón **Borrar** — «desaparece al salir» no es lo mismo que «puedes deshacerte de él ahora».) Una recarga no añade una entrada duplicada, y un sitio que te redirige registra la página que *pretendías* visitar en lugar de cada salto por el camino.

Los **marcadores** sí persisten. Se almacenan bajo la URL exacta que marcaste — la misma página con una sección distinta (`#install` frente a `#usage`) son dos marcadores, y VMark no «ordenará» en silencio los parámetros de consulta de una URL, porque una URL reescrita podría no llevarte de vuelta a lo que viste.

## La ventana se vuelve neutra alrededor de una página

Los temas de VMark están teñidos deliberadamente — Paper es un gris cálido, y Mint y Sepia lo están aún más. Eso resulta agradable para escribir, y erróneo para envolver la página web de otra persona: un marco de color altera cómo lees cada color que contiene, y por eso ningún navegador real tiñe su propia interfaz.

Así que cuando una pestaña del navegador está enfocada, la ventana que la rodea cambia a un neutro liso — **blanco en un tema claro, oscuro en uno oscuro** — y vuelve a cambiar en cuanto regresas a un documento. Tu tema no cambia; solo lo que rodea a una página web.

**El terminal sigue la misma regla.** Si tienes un terminal abierto junto a una pestaña del navegador, adopta el neutro correspondiente en lugar de mantener el color de tu tema, de modo que las dos mitades de la ventana concuerdan en lugar de encontrarse en una costura visible. Un tema oscuro obtiene un terminal oscuro, no uno blanco — los colores de un terminal están ajustados a su fondo, y forzar el blanco haría que la salida de un tema oscuro fuera difícil de leer.

### Si una página se bloquea

Si el proceso de contenido web de una página muere, la pestaña muestra una superposición **«Esta página se bloqueó»** con un botón **Recargar** en lugar de una vista en blanco o congelada. VMark recarga automáticamente unas cuantas veces ante bloqueos transitorios; si una página sigue bloqueándose al cargar, se detiene y espera a que la recargues manualmente, de modo que nunca te quedas atrapado en un bucle de recarga.

## Cómo está construido (y por qué es privado por diseño)

VMark crea la webview de la plataforma por su cuenta y la añade como hija nativa de la ventana — **no** le pide una al framework de la aplicación. Eso importa para la privacidad: una webview creada por el framework inyectaría un puente de mensajería interno en cada página, entregando a cualquier sitio un canal hacia la aplicación. Como VMark posee una webview recién construida sin semejante puente, **una página navegada no tiene ningún canal hacia VMark**. La página se controla estrictamente en una sola dirección (la aplicación puede leer y actuar sobre la página; la página no puede responder).

Las sesiones (inicios de sesión, cookies) persisten por perfil en el propio almacén de datos de la webview del sistema operativo, así que inicias sesión en cada sitio una sola vez. VMark no almacena ninguna credencial por sí mismo.

## Controlar el navegador con IA

Un asistente de IA conectado mediante [MCP](./mcp-tools) puede operar la pestaña del navegador:

- **Leer** — obtiene una instantánea de accesibilidad estructurada de la página (cada elemento interactivo o estructural como un rol + nombre accesible, más un identificador **ref** estable como `e5`).
- **Actuar** — hace clic o escribe en un objetivo, ya sea por su **ref** precisa de una lectura previa, o por el **rol + nombre accesible** de ARIA (por ejemplo, hacer clic en el enlace llamado «Learn more»). Una ref solo se respeta para una acción ya concedida; cualquier cosa que necesite tu aprobación usa rol + nombre, de modo que el aviso pueda mostrarte un elemento legible. Un clic **verifica que realmente ha alcanzado su objetivo**: desplaza el objetivo hasta que quede a la vista, exige que esté renderizado de forma visible — un botón duplicado dentro de una sección colapsada se omite, no se pulsa — y comprueba por hit-test el punto del clic, de modo que un objetivo cubierto por una superposición se informa como «cubierto por…» en lugar de pulsarse a través de él. A la IA se le dice lo que *ocurrió*, no simplemente que lo intentó, así que no puede actuar en silencio sobre lo que no debe e informar de éxito.
- **Desplazar** — lleva un elemento (por ref) a la vista, o desplaza una cantidad de píxeles. Clase Actuar (sujeto a aprobación como Hacer clic).
- **Tecla** — envía una pulsación de tecla (`Enter`, `Escape`, `Tab`, flechas, con Ctrl/Shift/Alt/Meta opcionales) a un elemento enfocado o a una ref — por ejemplo, enviar un formulario o cerrar un diálogo. Clase Actuar. Nota: las teclas y los desplazamientos son eventos **sintéticos** del DOM, así que un sitio que solo confía en la entrada real de hardware puede ignorarlos.
- **Consultar** — detección estructurada del DOM que la instantánea de accesibilidad no puede nombrar (tablas, valores calculados, atributos) mediante selector CSS. Clase Leer.
- **Extraer** — la página como Markdown en modo lectura (título, autoría, prosa del artículo, con el contenido repetitivo eliminado), para páginas que la IA quiere *leer* en lugar de operar. Los complementos de sitio refinan la extracción por origen — el complemento integrado de Wikipedia elimina la interfaz de wiki por nombre — con un lector genérico como alternativa. La página solo exporta bytes; la extracción se ejecuta en VMark. Clase Leer.
- **Estilo** — manipulación de CSS (descartar una superposición que bloquea, resaltar un objetivo) estableciendo estilos en línea, alternando clases o inyectando un bloque `<style>` (para toda la página, no acotado a un selector). Clase Actuar, y la aprobación vincula el estilo exacto — no puede sustituirse por otro CSS después de que lo permitas.
- **Ejecutar JS** — la vía de escape: ejecuta un script para lo que los verbos estructurados no pueden expresar. Se ejecuta en el **mundo de contenido aislado** (DOM + CSS, **nunca** el propio JavaScript de la página), se aprueba **por llamada** (nunca se recuerda — no hay ningún «Permitir en este sitio» para ello), y su resultado se trata como **no confiable**. El aviso de aprobación te muestra el **script exacto**, y ese script es el que se ejecuta — la IA no puede hacer que apruebes un script y luego ejecutar otro. Prefiere Consultar/Estilo; recurre a esto solo cuando se queden cortos.
- **Guardar / cargar sesión** — guarda la sesión actual de la pestaña bajo un **identificador** (un nombre que apruebas), y restáurala más tarde para que un flujo comience con la sesión ya iniciada — *sin que la IA vea nunca tus cookies ni tokens*. Los valores se almacenan en el **keychain del sistema operativo** (cifrados en reposo), y la IA recibe solo el identificador y un resumen de recuento. Tanto guardar como cargar se **aprueban por llamada**, y una aprobación para un identificador no puede gastarse en otro. Una restauración solo se aplica a una página del **mismo origen** desde el que se guardó. Esto es credencial **por referencia**: la IA nombra una sesión, VMark guarda el secreto.
- **Consola** — lee la salida `console.*` capturada de la página (log/warn/error…), **más los errores no capturados y los rechazos de promesa no gestionados** — la señal que emite una página cuando su propio script se rompe, que el registro `console` corriente nunca muestra — para que la IA pueda depurar una página que está controlando. De solo lectura, y la salida se trata como datos de página **no confiables**. Esto está diseñado para preservar la garantía de privacidad por diseño: la captura escribe en el propio DOM de la página y VMark la lee de ahí, de modo que no se abre ningún canal de mensajería de vuelta hacia la aplicación.

::: tip Guardar/cargar sesión — alcance
Una sesión guardada abarca **`localStorage` y las cookies**, ambos acotados al origen al
que la página quedó fijada cuando la guardaste. Las cookies se leen y se reproducen a través del
almacén de cookies nativo y están **acotadas por dominio en ambas direcciones** — guardar nunca copia
todo tu tarro de cookies, y restaurar nunca planta una cookie bajo un sitio no relacionado.
:::
- **Abrir** — crea una pestaña propiedad de la IA y carga una URL HTTP(S).
- **Navegar** — navega una pestaña propiedad de la IA y espera su ticket de navegación. Cuando la página que se carga se interpreta como una **barrera** en lugar del contenido solicitado — un muro de inicio de sesión, una pantalla intersticial de consentimiento, un desafío de verificación humana (reCAPTCHA/Turnstile) o un aviso de límite de frecuencia — el resultado lo indica, y a la IA se le dice que **te involucre** en lugar de intentar sortearla. La detección prioriza la precisión: un precio que menciona «$429» o un pie de página que dice «Cloudflare» no la activa.
- **Esperar** — espera un ticket de navegación específico sin iniciar otra carga.
- **Esperar a** — sondea hasta que se cumpla una condición (un elemento por ref o rol + nombre, un fragmento de texto visible, o que la **URL de la pestaña contenga** una subcadena — esto último confirma que una navegación provocada por un clic ha llegado a su destino) o hasta que transcurra un tiempo de espera, informando de si hubo coincidencia. Hace que un flujo de varios pasos sea determinista — actuar, luego esperar el resultado, luego leer — en lugar de adivinar.
- **Captura de pantalla** — obtiene una imagen JPEG del renderizado actual de la página, para que la IA pueda ver la disposición y el estado renderizado que la instantánea de accesibilidad no nombra. Al igual que *Leer*, no modifica nada: se permite en una pestaña propiedad de la IA, y en una pestaña humana solo mientras la hayas vinculado.
- **Ejecutar un flujo de trabajo** — reproduce una secuencia corta de pasos guardada (hacer clic / escribir / navegar / extraer, escrita en una pequeña gramática de texto y pasada como `source`) como una única **ejecución asíncrona**: devuelve un identificador de ejecución de inmediato y tú sondeas su estado, porque una ejecución de varios pasos sobrevive a una sola solicitud. Cada paso que contiene está **sujeto a aprobación individualmente**, exactamente como una acción emitida a mano — un flujo de trabajo no es una manera de eludir los avisos — y los pasos que la IA no puede realizar de forma determinista (un «objetivo» en prosa libre, un «confirmar») pausan la ejecución para que los gestiones a mano. Una nueva ejecución omite los pasos que ya tuvieron éxito, así que volver a ejecutar tras una pausa nunca envía nada dos veces. Las ejecuciones están acotadas y son de una en una por pestaña, y pueden cancelarse — cancelar siempre está permitido, y tomar el control del navegador por ti mismo detiene la ejecución.
- **Grabar un flujo de trabajo** — en lugar de escribir la gramática a mano, puedes **grabar** uno: con tu aprobación (que se pide de nuevo cada vez — grabar nunca es un permiso permanente), VMark captura los **clics y las ediciones de campos** que realizas en la pestaña y te devuelve texto de flujo de trabajo listo para ejecutar. Está **libre de valores por construcción**: nada de lo que escribes se guarda — cada campo se convierte en un `{input}` con nombre que rellenas en la reproducción, un campo de contraseña se convierte en un paso `confirm:` manual, y las URL se reducen a origen + ruta. Graba *qué* controles tocaste, nunca *lo que* introdujiste.

La postura del navegador para la IA se configura en **Ajustes → Avanzado → Navegador integrado**:

- **Sandbox** (recomendado) usa un único almacén de webview de IA compartido y no persistente. Comparte
  cookies con otras pestañas sandbox, pero no con las pestañas humanas.
- **Perfil compartido** usa el almacén de webview humano y pide aprobación del destino antes
  de cada navegación de la IA, a menos que ese origen tenga un permiso `navigate` correspondiente.

Las pestañas creadas por la IA son transitorias y no se restauran tras reiniciar. Sus URL, modo, título,
generación y estado de carga aparecen en `session.get_state`; las credenciales se ocultan en las respuestas de MCP.

Las acciones están **sujetas a aprobación**: una operación que no hayas autorizado no se realiza — a la IA se le dice que se requiere aprobación y espera. Las subidas de archivos **nunca** se permiten a la IA (una subida de archivo elegida por la IA sería una vía de exfiltración de datos); esas quedan estrictamente en manos humanas.

### Aprobar una acción

Cuando la IA pide actuar, VMark muestra un aviso y pausa la página. Te dice exactamente tres cosas — el **sitio**, la **acción** y el **elemento** (su rol y su nombre accesible, p. ej. `button "Publish"`):

- **Permitir una vez** — autoriza exactamente esa única acción, sobre ese elemento, en esa página. Se gasta de inmediato y no se convierte en un permiso permanente.
- **Permitir en este sitio** — la IA puede realizar *esa operación* en *ese sitio* sin volver a preguntar. No se amplía a otras operaciones ni a otros sitios.
- **Denegar** — no ocurre nada. Pulsar `Escape`, o simplemente pulsar `Enter`, también deniega: el aviso está sesgado deliberadamente hacia el rechazo.

El aviso te muestra una **descripción de la acción, no una imagen de la página** — y eso es intencionado. Una página web controla sus propios píxeles, así que una hostil podría dar a un botón «Borrar todo» el aspecto de «Publicar». Lo que VMark te muestra es exactamente aquello que hace cumplir la barrera de seguridad, tomado del motor del navegador en lugar de las afirmaciones que la propia página hace sobre sí misma.

El permiso también **caduca cuando la página navega**. Un aviso describe una acción en una página *específica*; si la página cambia mientras decides, la solicitud se descarta en lugar de aplicarse a lo que se haya cargado en su lugar. Un «Permitir una vez» sin gastar se descarta del mismo modo.

Esto incluye la navegación *dentro* de una página. La mayoría de los sitios modernos se mueven entre vistas sin llegar a cargar una página nueva — la dirección cambia, el contenido se reescribe, pero el sitio nunca se abandona. Eso importa aquí, porque el sitio y el origen siguen siendo los mismos mientras que el `button "Publish"` que aprobaste puede que ya no sea el botón que lleva ese nombre. Así que VMark trata una navegación dentro de la página exactamente como cualquier otra: la autorización caduca con la **vista** contra la que se concedió, no solo con la página.

Lo que soporta el peso, sin embargo, es el propio descriptor. Un sitio puede reescribir su propio contenido en cualquier momento sin navegar en absoluto, y ningún motor de navegador informa de eso. Así que lo que un «Permitir una vez» autoriza es precisamente una operación, sobre un elemento identificado por su rol y su nombre accesible, en un sitio — y se gasta de inmediato. «Permitir en este sitio» es el que hay que pensárselo dos veces: es un permiso permanente para esa operación en ese sitio, y un sitio al que se lo concedes es un sitio en el que confías con él.

### Revisar y revocar permisos

**Ajustes → Avanzado → Permisos de sitio** enumera todos los sitios a los que has concedido permisos, y lo que pueden hacer. **Revocar** lo retira de inmediato — la siguiente acción de la IA en ese sitio vuelve a preguntar.

Los permisos de sitio se mantienen solo en memoria: **nunca se escriben en el disco** y caducan cuando VMark se cierra. Dejar que una IA conserve la capacidad de hacer clic en un sitio entre reinicios es una promesa mayor de lo que parece, así que VMark no la hace en silencio.

Cuando una IA apunta a una pestaña creada por un humano, VMark pregunta primero si debe vincular el acceso de la IA a
esa pestaña. La vinculación queda ligada a la generación de navegación actual. **Permitir una vez** se
gasta tras una lectura o acción exitosa; **Permitir hasta la navegación** expira en la siguiente navegación
completa o dentro de la página, cierre, desactivación o reinicio.

La navegación de la IA rechaza de forma predeterminada los destinos de bucle local, LAN privada, enlace local, metadatos, con
formato incorrecto y de esquema no compatible. El reenganche de DNS (DNS rebinding) sigue siendo una limitación propia de WebKit;
VMark no afirma eliminarlo.

## Conducción compartida: observa a una IA controlar el navegador desde el terminal

El navegador es un panel, no un modo. Eso hace posible un flujo de trabajo particular: abre un **terminal** (`Ctrl + \``) junto a una pestaña del navegador, ejecuta en él un agente de IA y observa cómo responde la página mientras trabaja.

El terminal y el navegador se sitúan **uno al lado del otro** — el navegador cambia de tamaño para dejar sitio en lugar de quedar cubierto. Así ves la página todo el tiempo que el agente está operando sobre ella, y toda acción que emprende todavía tiene que pasar por ti (consulta *Aprobar una acción* más arriba).

Esta es la forma prevista para el uso del navegador por la IA en VMark: el agente propone, la página es visible y tú apruebas. No es el agente trabajando en una ventana que no puedes ver.

**Recuperar el control es un solo gesto.** Mientras la ejecución de un flujo de trabajo de IA controla una pestaña, su interfaz muestra un indicador **«La IA está al mando — haz clic para tomar el control»**. Al hacer clic en él — o simplemente al interactuar tú mismo con la página o su barra de direcciones — recuperas la pestaña de inmediato y detienes la ejecución. Nunca tienes que buscar un botón de detención en el terminal del agente; tocar el navegador es el botón de detención.

## Cuando una página no carga

Una red sin conexión, un nombre de host incorrecto, un certificado rechazado o una conexión rechazada producen todos
un mensaje en el panel del navegador que indica qué salió mal, con un botón **Reintentar**. Las compilaciones
anteriores mostraban en su lugar un panel en blanco, que era indistinguible de una página que simplemente iba lenta.

## Limitaciones actuales

- Solo macOS en esta compilación.
- Los diálogos `confirm()` / `prompt()` de JavaScript están suprimidos por ahora (solo se muestra `alert()`); las ventanas emergentes (`window.open`) se bloquean en lugar de abrirse como pestañas nuevas.
- Las descargas, la impresión y la política de red por solicitud aún no están implementadas.

Estos aspectos se van completando de forma incremental; la página anterior describe lo que funciona hoy.
