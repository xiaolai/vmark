# Genios de flujo de trabajo

Un **genio de flujo de trabajo** es un [flujo de trabajo de genios](/es/guide/workflows) — un pipeline YAML de varios pasos — guardado en tu carpeta de genios como archivo `.yml` o `.yaml`. Aparece en el selector de genios (`Mod + Y`) y en **Editar → Genios** exactamente igual que un genio markdown; al elegirlo se ejecuta todo el pipeline a través del motor de flujos de trabajo en lugar de enviar un único prompt.

## Requisitos

| Requisito | Por qué |
|-----------|---------|
| **Ajustes → Avanzado → Herramientas de desarrollo**, y luego **Motor de flujo de trabajo** activado | El motor está desactivado por defecto. El selector sigue mostrando un genio de flujo de trabajo mientras el motor está desactivado, pero al ejecutarlo falla con "El motor de flujo de trabajo está desactivado en la configuración" |
| Un espacio de trabajo abierto | Los pasos de acción como `action/save-file` resuelven las rutas respecto a la raíz del espacio de trabajo; sin uno, VMark muestra un aviso y no inicia la ejecución |
| Un [proveedor de IA](/es/guide/ai-providers) configurado | Los pasos de genio llaman al proveedor activo, el mismo que usan los genios markdown |

## Cómo escribir uno

Coloca el archivo YAML en cualquier lugar dentro de la carpeta de genios (**Editar → Genios → Abrir carpeta de genios**); las subcarpetas se convierten en categorías, igual que con los genios markdown. El selector muestra el nombre del archivo como nombre del genio y la `description` del YAML (o, si falta, su `name`) como línea secundaria. El ámbito de un genio de flujo de trabajo es el documento completo — la ejecución no tiene ninguna selección sobre la que trabajar —, así que cada paso aporta su propio `with: { input: … }`, y los genios markdown a los que llama lo vinculan sin cambios a su marcador `{{content}}`.

La muestra incluida `triage-and-translate.yml` es un punto de partida listo para usar: cópiala en la carpeta y sustituye el texto de ejemplo. Dónde se encuentra, el esquema YAML completo, las expresiones, las aprobaciones, los modelos y los tiempos de espera por paso están documentados en [Flujos de trabajo de genios](/es/guide/workflows); la ejecución de un genio de flujo de trabajo se realiza y sus diálogos de aprobación aparecen como de costumbre, pero no muestra el grafo de pasos en vivo, no se puede cancelar desde el panel de flujo de trabajo (el botón de ejecutar del panel indica que el motor está ocupado mientras se ejecuta) y el panel no ofrece **Restaurar archivos** para ella.

Consulta también [Genios de IA](/es/guide/ai-genies) para el formato de genio markdown de un solo prompt.
