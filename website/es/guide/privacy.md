# Privacidad

VMark es un editor local primero: tus documentos son archivos en tu disco, el renderizado ocurre en tu equipo y no hay cuenta, ni telemetría, ni informes de errores. Esta página enumera cada forma en que VMark accede a la red, qué envía cada una y cómo desactivarla — y qué puede leer VMark en tu disco.

## Todas las conexiones de red que realiza VMark

| Cuándo | Adónde va | Qué se envía | Cómo detenerlo |
|--------|-----------|--------------|----------------|
| Comprobación de actualizaciones — al iniciar, por defecto | `log.vmark.app` y, como alternativa, GitHub Releases | Plataforma, arquitectura, versión de la app y un hash anónimo de la máquina — [detalles más abajo](#la-comprobacion-de-actualizaciones-en-detalle) | **Ajustes → Acerca de → Frecuencia de comprobación → Solo manual**, o bloquea `log.vmark.app` |
| Ejecutar un genio de IA con un **proveedor REST** | El endpoint que configuraste — Anthropic, OpenAI, un host compatible con OpenAI, Google AI o tu host de Ollama | El prompt completado: el texto, bloque o documento seleccionado más el contexto circundante que pida el genio, y tu clave de API. Los botones **Probar** y de actualizar modelos también contactan con el endpoint | No configures ningún proveedor, o usa un Ollama local |
| Ejecutar un genio de IA con un **proveedor CLI** | Nada desde el propio VMark — la CLI `claude`, `codex` o `gemini` que instalaste se comunica con su propio proveedor bajo su propia cuenta | VMark pasa el prompt a la CLI en tu equipo | Igual que arriba |
| Exportar HTML | jsDelivr (cdnjs como alternativa) y Google Fonts | Nada — solo descargas: las fuentes matemáticas de KaTeX cuando el documento contiene fórmulas, y cualquier fuente web que hayas elegido en Ajustes, para poder incrustarlas | Exporta sin conexión; la exportación recurre a las fuentes del sistema |
| Abrir un `index.html` exportado | jsDelivr | Nada — descarga la hoja de estilos de KaTeX para documentos con fórmulas | Usa `standalone.html`, que la incluye en línea |
| Editar un flujo de trabajo de GitHub Actions | `raw.githubusercontent.com` | El `owner/repo@ref` de cada paso `uses:`, para obtener su `action.yml` (en caché 24 h) | Desactiva **Ajustes → Avanzado → Obtener metadatos de acciones** |
| El navegador integrado | Cualquier sitio que abras tú — o, con tu aprobación, un asistente de IA | Es un navegador web; consulta la [guía del navegador](/es/guide/browser) para la postura ante la IA, las sesiones aisladas y la política de destinos | Desactiva **Ajustes → Avanzado → Navegador integrado** |
| Documentos que hacen referencia a la web | Los hosts nombrados en tu documento | Las imágenes remotas y los vídeos incrustados de YouTube / Vimeo / Bilibili se cargan desde sus hosts al renderizarse en el editor o en el HTML exportado | Mantén las imágenes en local |

Dos cosas que parecen servicios de red son solo de bucle local (loopback) y nunca salen de tu equipo:

- **El servidor MCP** — los asistentes de IA se conectan mediante un puente WebSocket vinculado a `127.0.0.1`, autenticado con un token que VMark guarda en su directorio de datos de la aplicación. El asistente en sí (Claude Desktop, Claude Code, Codex CLI…) se comunica con su propio proveedor; VMark solo responde a sus llamadas de herramientas. Consulta [Integración de IA](/es/guide/mcp-setup).
- **La base de conocimiento y la vista previa de Slidev** — un servidor local vinculado a `127.0.0.1` con un token por sesión; la [guía de la base de conocimiento](/es/guide/knowledge-base#privacidad-y-seguridad) describe su aislamiento.

La terminal integrada ejecuta tu propio shell — cualquier cosa a la que se conecte es comando tuyo, no de VMark.

## Qué NO envía VMark

- Tus documentos ni su contenido (salvo a un proveedor de IA que hayas configurado, cuando ejecutas un genio)
- Nombres de archivos o rutas
- Patrones de uso ni análisis de características
- Información personal de ningún tipo
- Informes de errores
- Datos de pulsaciones de teclas o edición
- Identificadores de hardware reversibles o huellas digitales

## La comprobación de actualizaciones en detalle

El **verificador de actualizaciones automáticas** de VMark contacta con nuestro servidor para ver si hay una nueva versión disponible. Cada verificación envía exactamente estos campos — nada más:

| Dato | Ejemplo | Propósito |
|------|---------|-----------|
| Dirección IP | `203.0.113.42` | Inherente a cualquier solicitud HTTP — no podemos no recibirla |
| SO | `darwin`, `windows`, `linux` | Para entregar el paquete de actualización correcto |
| Arquitectura | `aarch64`, `x86_64` | Para entregar el paquete de actualización correcto |
| Versión de la app | `0.5.10` | Para determinar si hay una actualización disponible |
| Hash de máquina | `a3f8c2...` (64 caracteres hexadecimales) | Contador anónimo de dispositivos — SHA-256 del nombre de host + SO + arquitectura; no reversible |

La URL completa tiene este aspecto:

```text
GET https://log.vmark.app/update/latest.json?target=darwin&arch=aarch64&version=0.5.10
X-Machine-Id: a3f8c2b1d4e5f6078a9b0c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d0e1
```

Si no se puede contactar con ese servidor, el actualizador intenta obtener el mismo manifiesto desde GitHub Releases (`github.com/xiaolai/vmark/releases/latest/download/latest.json`). Las propias actualizaciones se verifican con una firma minisign antes de instalarse.

Puedes verificarlo tú mismo — los endpoints están en [`tauri.conf.json`](https://github.com/xiaolai/vmark/blob/main/src-tauri/tauri.conf.json) (busca `"endpoints"`), y el hash está en [`app_setup.rs`](https://github.com/xiaolai/vmark/blob/main/src-tauri/src/app_setup.rs) (busca `machine_id_hash`).

### Cómo usamos los datos

Agregamos los registros de verificación de actualizaciones para producir las estadísticas en vivo que se muestran en nuestra [página de inicio](/es/):

| Métrica | Cómo se calcula |
|---------|-----------------|
| **Dispositivos únicos** | Recuento de hashes de máquina distintos por día/semana/mes |
| **IPs únicas** | Recuento de direcciones IP distintas por día/semana/mes |
| **Pings** | Número total de solicitudes de verificación de actualización |
| **Plataformas** | Recuento de pings por combinación de SO + arquitectura |
| **Versiones** | Recuento de pings por versión de la app |

Estos números se publican abiertamente en [`log.vmark.app/api/stats`](https://log.vmark.app/api/stats). Nada está oculto.

**Advertencias importantes:**
- Las IPs únicas subestiman a los usuarios reales — varias personas detrás del mismo router/VPN cuentan como uno
- Los dispositivos únicos proporcionan recuentos más precisos, pero un cambio de nombre de host o una instalación nueva del SO genera un nuevo hash
- Los pings sobreestiman a los usuarios reales — una misma persona puede verificar varias veces al día

### Retención de datos

- Los registros se almacenan en nuestro servidor en formato estándar de registro de acceso
- Los archivos de registro rotan a 1 MB y solo se conservan los 3 archivos más recientes
- Los registros no se comparten con nadie
- No hay sistema de cuentas — VMark no sabe quién eres
- El hash de máquina no está vinculado a ninguna cuenta, correo electrónico o dirección IP — es únicamente un contador pseudónimo de dispositivos
- No usamos cookies de seguimiento, huellas digitales ni ningún SDK de análisis

### Desactivar las comprobaciones de actualizaciones

Establece **Ajustes → Acerca de → Frecuencia de comprobación** en **Solo manual** y VMark nunca contactará por sí solo con el servidor de actualizaciones; **Comprobar ahora** sigue funcionando cuando lo necesites. Para tener la certeza a nivel de red, bloquea `log.vmark.app` (cortafuegos, `/etc/hosts` o DNS) — VMark sigue funcionando con normalidad sin él; simplemente no recibirás notificaciones de actualización.

## Dónde se guardan las claves de API

Las claves de API de los proveedores de IA REST se guardan en el almacén de credenciales del sistema operativo — el Llavero de macOS, el Administrador de credenciales de Windows o el Secret Service de Linux — bajo el nombre de servicio `app.vmark.secrets`. Nunca se escriben en los archivos de ajustes de VMark ni en `localStorage`, y los ajustes de proveedor que la app persiste se guardan sin la clave. Las claves solo se envían al endpoint del proveedor que configuraste, cuando ejecutas un genio o pulsas **Probar**. Más detalles en [Proveedores de IA](/es/guide/ai-providers#donde-se-guardan-las-claves-de-api).

## A qué puede acceder un asistente de IA

Un asistente conectado por MCP solo actúa dentro de lo que ya has abierto: sus operaciones de archivo están limitadas a la raíz del espacio de trabajo abierto y a las carpetas de los documentos abiertos en VMark, y una solicitud fuera de ese límite se rechaza. Guardar un documento en una ruta **nueva** requiere el ajuste **Aprobar automáticamente guardados en una ubicación nueva y resultados de genios** (desactivado por defecto) — de lo contrario la llamada se rechaza y VMark muestra un aviso con el nombre del archivo; incluso con él activado, un asistente nunca puede sobrescribir de ese modo otro archivo existente. Abrir un espacio de trabajo que el asistente nombre te pide confirmación primero. Cada escritura de la IA en un documento se registra primero en el historial de ediciones, para que puedas restaurar lo que había ([puntos de control de edición](/es/guide/mcp-setup#puntos-de-control-de-edicion)). El navegador integrado tiene su propio modelo de aprobación, descrito en la [guía del navegador](/es/guide/browser).

## Qué puede leer VMark en el disco

El acceso de VMark a los archivos es un ámbito de permisos acotado, no el disco entero:

- **Ámbito estático**: tu carpeta personal (`$HOME/**`) más los volúmenes montados — `/Volumes/**` en macOS, `/mnt/**` y `/media/**` en Linux. En Windows también abarca las unidades `C:\` a `F:\`, así que solo `G:\` y las unidades posteriores, y las carpetas compartidas de red, necesitan un permiso en tiempo de ejecución. En macOS y Linux, todo lo que está dentro de una carpeta oculta (cuyo nombre empieza por `.`) queda fuera del ámbito estático.
- **Permisos en tiempo de ejecución**: un archivo que abres expresamente — desde Finder o el Explorador de Archivos, la línea de comandos `vmark` o un diálogo de archivos — recibe un permiso solo para ese archivo. Una **carpeta** solo recibe permiso cuando VMark puede saber que la elegiste tú: la seleccionaste en el diálogo de carpetas de VMark o la abriste desde Finder. VMark guarda una lista de esas carpetas (`workspace-grants.json` en su carpeta de datos de la aplicación) y vuelve a concederles permiso en cada inicio, para que tu sesión restaurada y **Abrir reciente** sigan funcionando. Un espacio de trabajo reciente que no está en esa lista, y que el ámbito estático no cubre, abre el diálogo de carpetas en esa carpeta — elígela para confirmarlo. Cuando un asistente de IA pide abrir una carpeta así, VMark hace lo mismo después de que apruebes la solicitud.
- **Imágenes y multimedia**: las imágenes, los vídeos y el audio locales se muestran mediante el protocolo de recursos de VMark, que llega a los mismos lugares — el ámbito estático más los permisos en tiempo de ejecución anteriores. El visor multimedia añade un permiso para el único archivo que muestra, y solo si tiene una extensión multimedia; una solicitud para cualquier otra ruta se rechaza en lugar de ampliar el ámbito. Una imagen fuera de esos lugares, como una junto a un documento que abriste por separado desde fuera del ámbito estático, no se muestra hasta que abres su carpeta como espacio de trabajo.

Nada de esto se envía a ningún sitio; el ámbito decide lo que la propia aplicación puede leer.

## Transparencia de código abierto

VMark es completamente de código abierto. Puedes verificar todo lo descrito aquí:

- Configuración del endpoint de actualización: [`src-tauri/tauri.conf.json`](https://github.com/xiaolai/vmark/blob/main/src-tauri/tauri.conf.json)
- Generación del hash de máquina: [`src-tauri/src/app_setup.rs`](https://github.com/xiaolai/vmark/blob/main/src-tauri/src/app_setup.rs) — busca `machine_id_hash`
- Ámbito del sistema de archivos y de recursos: [`src-tauri/capabilities/default.json`](https://github.com/xiaolai/vmark/blob/main/src-tauri/capabilities/default.json), la entrada `assetProtocol` de [`src-tauri/tauri.conf.json`](https://github.com/xiaolai/vmark/blob/main/src-tauri/tauri.conf.json), [`src-tauri/src/fs_scope.rs`](https://github.com/xiaolai/vmark/blob/main/src-tauri/src/fs_scope.rs) y [`src-tauri/src/workspace/grants/`](https://github.com/xiaolai/vmark/tree/main/src-tauri/src/workspace/grants)
- Almacenamiento en el llavero: [`src-tauri/src/secure_store.rs`](https://github.com/xiaolai/vmark/blob/main/src-tauri/src/secure_store.rs)
- Agregación de estadísticas del lado del servidor: [`scripts/vmark-stats-json`](https://github.com/xiaolai/vmark/blob/main/scripts/vmark-stats-json) — el script exacto que se ejecuta en nuestro servidor para producir las [estadísticas públicas](https://log.vmark.app/api/stats)
- Los puntos de llamada de red son los enumerados arriba — busca `reqwest` (Rust) y `fetch(` (TypeScript) en el repositorio para comprobarlo tú mismo

## Informar de un problema de seguridad

Si encuentras una vulnerabilidad en VMark, por ejemplo en el puente MCP, el navegador integrado, el actualizador o el manejo de archivos, comunícala de forma privada mediante [el informe privado de vulnerabilidades de GitHub](https://github.com/xiaolai/vmark/security/advisories/new) en lugar de abrir una incidencia pública. La [política de seguridad](https://github.com/xiaolai/vmark/blob/main/SECURITY.md) indica qué entra en su alcance y qué puedes esperar.
