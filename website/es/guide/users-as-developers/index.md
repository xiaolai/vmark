# Usuarios como Desarrolladores

En la era de las herramientas de codificación con IA, la línea entre "usuario" y "desarrollador" está desapareciendo. Si puedes describir un error, puedes corregirlo. Si puedes imaginar una función, puedes crearla — con un asistente de IA que ya entiende el código base.

VMark abraza esta filosofía. El repositorio incluye reglas de proyecto, documentación de arquitectura y convenciones preconfiguradas para herramientas de codificación con IA. Clona el repositorio, abre tu asistente de IA y empieza a contribuir — la IA ya sabe cómo funciona VMark.

## Primeros Pasos

1. **Clona el repositorio** — La configuración de IA ya está en su lugar.
2. **Instala tu herramienta de IA** — [Claude Code](https://docs.anthropic.com/en/docs/claude-code), [Codex CLI](https://github.com/openai/codex), o [Gemini CLI](https://github.com/google-gemini/gemini-cli).
3. **Abre una sesión** — La herramienta lee `AGENTS.md` y las reglas automáticamente.
4. **Empieza a codificar** — La IA conoce las convenciones del proyecto, los requisitos de pruebas y los patrones de arquitectura.

No se necesita configuración adicional. Solo empieza a pedirle ayuda a tu IA.

## Guía de Lectura

¿Nuevo en el desarrollo asistido por IA? Estas páginas se construyen unas sobre otras:

1. **[Por Qué Construí VMark](/es/guide/users-as-developers/why-i-built-vmark)** — El viaje de un no-programador desde scripts hasta aplicación de escritorio
2. **[Cinco Habilidades Humanas Básicas que Potencian la IA](/es/guide/users-as-developers/what-are-indispensable)** — Git, TDD, terminal, inglés y criterio — las bases sobre las que todo lo demás se construye
3. **[Por Qué los Modelos Caros Son Más Baratos](/es/guide/users-as-developers/why-expensive-models-are-cheaper)** — El precio por token es una métrica de vanidad; el coste por tarea es lo que importa
4. **[Suscripción vs Precios de API](/es/guide/users-as-developers/subscription-vs-api)** — Por qué las suscripciones de tarifa plana superan al pago por token en sesiones de codificación
5. **[Los Prompts en Inglés Funcionan Mejor](/es/guide/users-as-developers/prompt-refinement)** — Traducción, refinamiento y el gancho `::`
6. **[Verificación Cruzada de Modelos](/es/guide/users-as-developers/cross-model-verification)** — Uso de Claude + Codex para auditarse mutuamente y obtener mejor código
7. **[Por Qué Issues, No PRs](/es/guide/users-as-developers/why-issues-not-prs)** — Por qué aceptamos issues pero no pull requests en un código base mantenido por IA
8. **[Evaluación de costos y esfuerzo](/es/guide/users-as-developers/cost-evaluation)** — Cuánto costaría construir VMark con un equipo humano vs. la realidad del desarrollo asistido por IA

¿Ya familiarizado con los conceptos básicos? Salta a [Verificación Cruzada de Modelos](/es/guide/users-as-developers/cross-model-verification) para el flujo de trabajo avanzado, o sigue leyendo para entender cómo funciona la configuración de IA de VMark bajo el capó.

## Un Archivo, Todas las Herramientas

Las herramientas de codificación con IA leen cada una su propio archivo de configuración:

| Herramienta | Archivo de configuración |
|------|------------|
| Claude Code | `CLAUDE.md` |
| Codex CLI | `AGENTS.md` |
| Gemini CLI | `GEMINI.md` |

Mantener las mismas instrucciones en tres lugares es propenso a errores. VMark resuelve esto con una única fuente de verdad:

- **`AGENTS.md`** — Contiene todas las reglas del proyecto, convenciones y notas de arquitectura.
- **`CLAUDE.md`** — Solo una línea: `@AGENTS.md` (una directiva de Claude Code que incluye el archivo).
- **Codex CLI** — Lee `AGENTS.md` directamente.
- **Gemini CLI** — Usa `@AGENTS.md` en `GEMINI.md` para incluir el mismo archivo.

Actualiza `AGENTS.md` una vez y todas las herramientas recogen el cambio.

::: tip ¿Qué es `@AGENTS.md`?
El prefijo `@` es una directiva de Claude Code que incluye el contenido de otro archivo. Es similar a `#include` en C — el contenido de `AGENTS.md` se inserta en `CLAUDE.md` en esa posición. Más información en [agents.md](https://agents.md/).
:::

## Usar Codex como Segunda Opinión

VMark usa verificación cruzada de modelos — Claude escribe el código, luego Codex (un modelo de IA diferente de OpenAI) lo audita de forma independiente. Esto detecta puntos ciegos que un único modelo podría pasar por alto. Para todos los detalles e instrucciones de configuración, consulta [Verificación Cruzada de Modelos](/es/guide/users-as-developers/cross-model-verification).

## Lo que Sabe la IA

Cuando una herramienta de codificación con IA abre el repositorio VMark, recibe automáticamente:

### Reglas del Proyecto (`.claude/rules/`)

Estos archivos se cargan automáticamente en cada sesión de Claude Code. Cubren:

| Regla | Qué aplica |
|------|-----------------|
| Flujo de Trabajo TDD | El enfoque de pruebas primero es obligatorio; los umbrales de cobertura bloquean la compilación |
| Tokens de Diseño | Nunca codificar colores manualmente — referencia completa de tokens CSS incluida |
| Patrones de Componentes | Patrones de popup, barra de herramientas y menú contextual con ejemplos de código |
| Indicadores de Foco | Accesibilidad: el foco del teclado siempre debe ser visible |
| Tema Oscuro | Reglas del selector `.dark-theme`, requisitos de paridad de tokens |
| Atajos de Teclado | Procedimiento de sincronización de tres archivos (Rust, TypeScript, documentación) |
| Incrementos de Versión | Procedimiento de actualización de cinco archivos |
| Convenciones del Código Base | Patrones de store, hook, plugin, prueba e importación |

### Habilidades Personalizadas

Los slash commands dan a la IA capacidades especializadas:

| Comando | Qué hace |
|---------|-------------|
| `/fix` | Corregir issues correctamente — análisis de causa raíz, TDD, sin parches |
| `/fix-issue` | Resolver issues de GitHub de extremo a extremo (obtener, crear rama, corregir, auditar, PR) |
| `/codex-audit` | Auditoría completa de código en 9 dimensiones (seguridad, corrección, cumplimiento, ...) |
| `/codex-audit-mini` | Verificación rápida en 5 dimensiones para cambios pequeños |
| `/codex-verify` | Verificar correcciones de una auditoría anterior |
| `/codex-commit` | Mensajes de commit inteligentes a partir del análisis de cambios |
| `/audit-fix` | Auditar, corregir todos los hallazgos, verificar — repetir hasta que esté limpio |
| `/feature-workflow` | Flujo de trabajo con compuertas de extremo a extremo con agentes especializados |
| `/merge-prs` | Revisar y fusionar PRs abiertos secuencialmente |
| `/bump` | Incremento de versión en los 5 archivos, commit, etiqueta, push |

### Agentes Especializados

Para tareas complejas, Claude Code puede delegar a subagentes enfocados:

| Agente | Rol |
|-------|------|
| Planificador | Investiga mejores prácticas, propone casos límite, produce planes modulares |
| Implementador | Implementación dirigida por TDD con investigación previa |
| Auditor | Revisa diffs en busca de corrección y violaciones de reglas |
| Ejecutor de Pruebas | Ejecuta compuertas, coordina pruebas E2E vía Tauri MCP |
| Verificador | Lista de verificación final antes del lanzamiento |

## Configuraciones Privadas

No todo pertenece a la configuración compartida. Para preferencias personales:

| Archivo | ¿Compartido? | Propósito |
|------|---------|---------|
| `AGENTS.md` | Sí | Reglas del proyecto para todas las herramientas de IA |
| `CLAUDE.md` | Sí | Punto de entrada de Claude Code |
| `.claude/settings.json` | Sí | Permisos compartidos del equipo |
| `CLAUDE.local.md` | **No** | Tus instrucciones personales (ignorado por git) |
| `.claude/settings.local.json` | **No** | Tu configuración personal (ignorada por git) |

Crea `CLAUDE.local.md` en la raíz del proyecto para instrucciones que solo te aplican a ti — idioma preferido, hábitos de flujo de trabajo, preferencias de herramientas.
