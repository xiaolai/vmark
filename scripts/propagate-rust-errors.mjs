#!/usr/bin/env node
/**
 * Propagate the `errors:` namespace from src-tauri/locales/en.yml to all other
 * locale YAMLs. Uses a translation table below — falls back to English source
 * if a specific translation isn't provided.
 *
 * Treats the YAML files as text (preserves comments and ordering) because the
 * rust-i18n format uses dotted flat keys at the second level, which is trivial
 * to append.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const LOCALES_DIR = resolve(ROOT, "src-tauri/locales");

const LOCALES = ["zh-CN", "zh-TW", "ja", "ko", "de", "es", "fr", "it", "pt-BR"];

// Full errors block per locale. %{name} placeholders must match en.yml verbatim.
const ERRORS_BY_LOCALE = {
  "zh-CN": `
errors:
  # === Core (lib.rs) ===
  core.htmlTooLarge: "HTML 内容过大（超过 50 MB）"
  core.pathTraversal: "不允许使用路径穿越（..）"
  core.pathNotAbsolute: "路径必须是绝对路径"

  # === Pandoc export ===
  pandoc.pathTraversal: "输出路径中不允许路径穿越"
  pandoc.emptySourceDir: "source_dir 不能为空"
  pandoc.sourcePathTraversal: "source_dir 中不允许路径穿越"
  pandoc.invalidSourceDir: "无效的 source_dir '%{dir}'：%{detail}"
  pandoc.notADirectory: "source_dir '%{dir}' 不是一个目录"
  pandoc.notFound: "在 PATH 中未找到 Pandoc"
  pandoc.exitedWithCode: "Pandoc 以状态码 %{code} 退出"
  pandoc.timeout: "Pandoc 超时（超过 2 分钟）"
  pandoc.taskPanicked: "Pandoc 任务异常终止：%{detail}"
  pandoc.startFailed: "启动 Pandoc 失败：%{detail}"
  pandoc.stdinFailed: "向 Pandoc 标准输入写入失败：%{detail}"
  pandoc.waitFailed: "等待 Pandoc 失败：%{detail}"

  # === PDF export ===
  pdf.invalidExtension: "输出路径必须使用 .pdf 扩展名"
  pdf.dirNotFound: "输出目录不存在"
  pdf.loadTimeout: "HTML 加载超时（10 秒）"
  pdf.emptyOutput: "打印操作生成了空 PDF"
  pdf.printTimeout: "打印操作超时（60 秒）"
  pdf.noPages: "PDF 没有页面"
  pdf.writeFailed: "写入带书签的 PDF 失败"

  # === Workflow execution ===
  workflow.alreadyRunning: "已有工作流正在运行。请等待其完成或取消后再试。"
  workflow.emptyYaml: "工作流 YAML 为空"
  workflow.invalidWorkspace: "工作空间根目录 '%{path}' 不是有效的目录"
  workflow.parseFailed: "解析工作流 YAML 失败：%{detail}"
  workflow.tooManySteps: "工作流包含 %{count} 个步骤（上限 50）"
  workflow.genieNotImplemented: "步骤 %{index}（'%{id}'）使用了尚未实现的 genie 执行方式"
  workflow.webhookNotImplemented: "步骤 %{index}（'%{id}'）使用了尚未实现的 webhook 执行方式"
  workflow.notRunning: "当前没有正在运行的工作流"
  workflow.circularDependency: "工作流步骤中检测到循环依赖"
  workflow.noInteractivePrompt: "工作流执行中不支持交互式提示"

  # === Hot exit ===
  hotExit.noWindows: "没有需要捕获的文档窗口"
  hotExit.captureEmitFailed: "发送捕获请求失败：%{detail}"
  hotExit.captureTimeout: "捕获超时：没有窗口响应"

  # === Content search ===
  search.queryTooShort: "搜索关键字至少需要 3 个字符"

  # === CLI install ===
  cli.noFile: "安装似乎成功，但文件未能创建。"
  cli.mismatch: "安装完成，但文件内容与预期脚本不符。"

  # === Genies ===
  genie.pathBlocked: "Genie 路径位于允许的目录之外"

  # === MCP ===
  mcp.spawnInProgress: "MCP 侧载进程正在启动中"
  mcp.configMismatch: "配置校验失败：写入内容与预期不符"
`,
  "zh-TW": `
errors:
  # === Core (lib.rs) ===
  core.htmlTooLarge: "HTML 內容過大（超過 50 MB）"
  core.pathTraversal: "不允許使用路徑穿越（..）"
  core.pathNotAbsolute: "路徑必須為絕對路徑"

  # === Pandoc export ===
  pandoc.pathTraversal: "輸出路徑中不允許路徑穿越"
  pandoc.emptySourceDir: "source_dir 不能為空"
  pandoc.sourcePathTraversal: "source_dir 中不允許路徑穿越"
  pandoc.invalidSourceDir: "無效的 source_dir '%{dir}'：%{detail}"
  pandoc.notADirectory: "source_dir '%{dir}' 不是目錄"
  pandoc.notFound: "在 PATH 中找不到 Pandoc"
  pandoc.exitedWithCode: "Pandoc 以狀態碼 %{code} 結束"
  pandoc.timeout: "Pandoc 逾時（超過 2 分鐘）"
  pandoc.taskPanicked: "Pandoc 工作異常終止：%{detail}"
  pandoc.startFailed: "啟動 Pandoc 失敗：%{detail}"
  pandoc.stdinFailed: "寫入 Pandoc 標準輸入失敗：%{detail}"
  pandoc.waitFailed: "等待 Pandoc 失敗：%{detail}"

  # === PDF export ===
  pdf.invalidExtension: "輸出路徑必須使用 .pdf 副檔名"
  pdf.dirNotFound: "輸出目錄不存在"
  pdf.loadTimeout: "HTML 載入逾時（10 秒）"
  pdf.emptyOutput: "列印操作產生了空白 PDF"
  pdf.printTimeout: "列印操作逾時（60 秒）"
  pdf.noPages: "PDF 沒有任何頁面"
  pdf.writeFailed: "寫入含書籤的 PDF 失敗"

  # === Workflow execution ===
  workflow.alreadyRunning: "已有工作流程正在執行。請等待完成或取消後再試。"
  workflow.emptyYaml: "工作流程 YAML 為空"
  workflow.invalidWorkspace: "工作區根目錄 '%{path}' 不是有效的目錄"
  workflow.parseFailed: "解析工作流程 YAML 失敗：%{detail}"
  workflow.tooManySteps: "工作流程包含 %{count} 個步驟（上限 50）"
  workflow.genieNotImplemented: "步驟 %{index}（'%{id}'）使用了尚未實作的 genie 執行方式"
  workflow.webhookNotImplemented: "步驟 %{index}（'%{id}'）使用了尚未實作的 webhook 執行方式"
  workflow.notRunning: "目前沒有正在執行的工作流程"
  workflow.circularDependency: "工作流程步驟中偵測到循環相依"
  workflow.noInteractivePrompt: "工作流程執行不支援互動式提示"

  # === Hot exit ===
  hotExit.noWindows: "沒有需要擷取的文件視窗"
  hotExit.captureEmitFailed: "發送擷取請求失敗：%{detail}"
  hotExit.captureTimeout: "擷取逾時：沒有視窗回應"

  # === Content search ===
  search.queryTooShort: "搜尋關鍵字至少需要 3 個字元"

  # === CLI install ===
  cli.noFile: "安裝似乎成功，但檔案未能建立。"
  cli.mismatch: "安裝完成，但檔案內容與預期指令稿不符。"

  # === Genies ===
  genie.pathBlocked: "Genie 路徑位於允許的目錄之外"

  # === MCP ===
  mcp.spawnInProgress: "MCP 側載程序正在啟動中"
  mcp.configMismatch: "設定校驗失敗：寫入內容與預期不符"
`,
  "ja": `
errors:
  # === Core (lib.rs) ===
  core.htmlTooLarge: "HTML コンテンツが大きすぎます（50 MB 超）"
  core.pathTraversal: "パストラバーサル（..）は許可されていません"
  core.pathNotAbsolute: "パスは絶対パスである必要があります"

  # === Pandoc export ===
  pandoc.pathTraversal: "出力パスにパストラバーサルは使用できません"
  pandoc.emptySourceDir: "source_dir は空にできません"
  pandoc.sourcePathTraversal: "source_dir にパストラバーサルは使用できません"
  pandoc.invalidSourceDir: "source_dir '%{dir}' が無効です: %{detail}"
  pandoc.notADirectory: "source_dir '%{dir}' はディレクトリではありません"
  pandoc.notFound: "PATH に Pandoc が見つかりません"
  pandoc.exitedWithCode: "Pandoc が終了コード %{code} で終了しました"
  pandoc.timeout: "Pandoc がタイムアウトしました（2 分超過）"
  pandoc.taskPanicked: "Pandoc タスクが異常終了しました: %{detail}"
  pandoc.startFailed: "Pandoc の起動に失敗しました: %{detail}"
  pandoc.stdinFailed: "Pandoc の標準入力への書き込みに失敗しました: %{detail}"
  pandoc.waitFailed: "Pandoc の待機に失敗しました: %{detail}"

  # === PDF export ===
  pdf.invalidExtension: "出力パスは .pdf 拡張子である必要があります"
  pdf.dirNotFound: "出力ディレクトリが存在しません"
  pdf.loadTimeout: "HTML の読み込みがタイムアウトしました（10 秒）"
  pdf.emptyOutput: "印刷操作で空の PDF が生成されました"
  pdf.printTimeout: "印刷操作がタイムアウトしました（60 秒）"
  pdf.noPages: "PDF にページがありません"
  pdf.writeFailed: "しおり付き PDF の書き込みに失敗しました"

  # === Workflow execution ===
  workflow.alreadyRunning: "別のワークフローがすでに実行中です。完了またはキャンセルをお待ちください。"
  workflow.emptyYaml: "ワークフロー YAML が空です"
  workflow.invalidWorkspace: "ワークスペースルート '%{path}' は有効なディレクトリではありません"
  workflow.parseFailed: "ワークフロー YAML の解析に失敗しました: %{detail}"
  workflow.tooManySteps: "ワークフローには %{count} 個のステップがあります（上限 50）"
  workflow.genieNotImplemented: "ステップ %{index}（'%{id}'）は未実装の genie 実行を使用しています"
  workflow.webhookNotImplemented: "ステップ %{index}（'%{id}'）は未実装の webhook 実行を使用しています"
  workflow.notRunning: "現在実行中のワークフローはありません"
  workflow.circularDependency: "ワークフローのステップに循環依存が検出されました"
  workflow.noInteractivePrompt: "ワークフロー実行では対話型プロンプトはサポートされていません"

  # === Hot exit ===
  hotExit.noWindows: "キャプチャするドキュメントウィンドウがありません"
  hotExit.captureEmitFailed: "キャプチャ要求の送信に失敗しました: %{detail}"
  hotExit.captureTimeout: "キャプチャがタイムアウトしました: ウィンドウからの応答がありません"

  # === Content search ===
  search.queryTooShort: "検索クエリは 3 文字以上である必要があります"

  # === CLI install ===
  cli.noFile: "インストールは成功したように見えますが、ファイルが作成されませんでした。"
  cli.mismatch: "インストールは完了しましたが、ファイル内容が想定したスクリプトと一致しません。"

  # === Genies ===
  genie.pathBlocked: "Genie のパスが許可されたディレクトリの外にあります"

  # === MCP ===
  mcp.spawnInProgress: "MCP サイドカーの起動がすでに進行中です"
  mcp.configMismatch: "設定の検証に失敗しました: 書き込まれた内容が想定と一致しません"
`,
  "ko": `
errors:
  # === Core (lib.rs) ===
  core.htmlTooLarge: "HTML 콘텐츠가 너무 큽니다 (50MB 초과)"
  core.pathTraversal: "경로 탐색(..)은 허용되지 않습니다"
  core.pathNotAbsolute: "경로는 절대 경로여야 합니다"

  # === Pandoc export ===
  pandoc.pathTraversal: "출력 경로에 경로 탐색이 허용되지 않습니다"
  pandoc.emptySourceDir: "source_dir은 비워둘 수 없습니다"
  pandoc.sourcePathTraversal: "source_dir에 경로 탐색이 허용되지 않습니다"
  pandoc.invalidSourceDir: "잘못된 source_dir '%{dir}': %{detail}"
  pandoc.notADirectory: "source_dir '%{dir}'은(는) 디렉터리가 아닙니다"
  pandoc.notFound: "PATH에서 Pandoc을 찾을 수 없습니다"
  pandoc.exitedWithCode: "Pandoc이 코드 %{code}(으)로 종료되었습니다"
  pandoc.timeout: "Pandoc이 시간 초과되었습니다 (2분 초과)"
  pandoc.taskPanicked: "Pandoc 작업이 비정상 종료되었습니다: %{detail}"
  pandoc.startFailed: "Pandoc 시작 실패: %{detail}"
  pandoc.stdinFailed: "Pandoc 표준 입력 쓰기 실패: %{detail}"
  pandoc.waitFailed: "Pandoc 대기 실패: %{detail}"

  # === PDF export ===
  pdf.invalidExtension: "출력 경로는 .pdf 확장자를 사용해야 합니다"
  pdf.dirNotFound: "출력 디렉터리가 존재하지 않습니다"
  pdf.loadTimeout: "HTML 로드 시간 초과 (10초)"
  pdf.emptyOutput: "인쇄 작업이 빈 PDF를 생성했습니다"
  pdf.printTimeout: "인쇄 작업 시간 초과 (60초)"
  pdf.noPages: "PDF에 페이지가 없습니다"
  pdf.writeFailed: "북마크가 포함된 PDF 쓰기 실패"

  # === Workflow execution ===
  workflow.alreadyRunning: "이미 실행 중인 워크플로가 있습니다. 완료되거나 취소된 후 다시 시도하세요."
  workflow.emptyYaml: "워크플로 YAML이 비어 있습니다"
  workflow.invalidWorkspace: "작업 공간 루트 '%{path}'은(는) 유효한 디렉터리가 아닙니다"
  workflow.parseFailed: "워크플로 YAML 구문 분석 실패: %{detail}"
  workflow.tooManySteps: "워크플로에 %{count}개의 단계가 있습니다 (최대 50)"
  workflow.genieNotImplemented: "단계 %{index}('%{id}')는 아직 구현되지 않은 genie 실행을 사용합니다"
  workflow.webhookNotImplemented: "단계 %{index}('%{id}')는 아직 구현되지 않은 webhook 실행을 사용합니다"
  workflow.notRunning: "현재 실행 중인 워크플로가 없습니다"
  workflow.circularDependency: "워크플로 단계에서 순환 종속성이 감지되었습니다"
  workflow.noInteractivePrompt: "워크플로 실행에서는 대화형 프롬프트가 지원되지 않습니다"

  # === Hot exit ===
  hotExit.noWindows: "캡처할 문서 창이 없습니다"
  hotExit.captureEmitFailed: "캡처 요청 발송 실패: %{detail}"
  hotExit.captureTimeout: "캡처 시간 초과: 응답한 창이 없습니다"

  # === Content search ===
  search.queryTooShort: "검색어는 3자 이상이어야 합니다"

  # === CLI install ===
  cli.noFile: "설치가 성공한 것처럼 보이지만 파일이 생성되지 않았습니다."
  cli.mismatch: "설치가 완료되었지만 파일 내용이 예상 스크립트와 일치하지 않습니다."

  # === Genies ===
  genie.pathBlocked: "Genie 경로가 허용된 디렉터리 외부에 있습니다"

  # === MCP ===
  mcp.spawnInProgress: "MCP 사이드카 실행이 이미 진행 중입니다"
  mcp.configMismatch: "구성 검증 실패: 쓴 내용이 예상과 일치하지 않습니다"
`,
  "de": `
errors:
  # === Core (lib.rs) ===
  core.htmlTooLarge: "HTML-Inhalt zu groß (>50 MB)"
  core.pathTraversal: "Pfad-Traversierung (..) ist nicht erlaubt"
  core.pathNotAbsolute: "Pfad muss absolut sein"

  # === Pandoc export ===
  pandoc.pathTraversal: "Pfad-Traversierung im Ausgabepfad nicht erlaubt"
  pandoc.emptySourceDir: "source_dir darf nicht leer sein"
  pandoc.sourcePathTraversal: "Pfad-Traversierung in source_dir nicht erlaubt"
  pandoc.invalidSourceDir: "Ungültiges source_dir '%{dir}': %{detail}"
  pandoc.notADirectory: "source_dir '%{dir}' ist kein Verzeichnis"
  pandoc.notFound: "Pandoc nicht im PATH gefunden"
  pandoc.exitedWithCode: "Pandoc beendet mit Code %{code}"
  pandoc.timeout: "Pandoc-Zeitüberschreitung (länger als 2 Minuten)"
  pandoc.taskPanicked: "Pandoc-Aufgabe abgestürzt: %{detail}"
  pandoc.startFailed: "Pandoc konnte nicht gestartet werden: %{detail}"
  pandoc.stdinFailed: "Schreiben in Pandoc-stdin fehlgeschlagen: %{detail}"
  pandoc.waitFailed: "Warten auf Pandoc fehlgeschlagen: %{detail}"

  # === PDF export ===
  pdf.invalidExtension: "Ausgabepfad muss die Endung .pdf haben"
  pdf.dirNotFound: "Ausgabeverzeichnis existiert nicht"
  pdf.loadTimeout: "HTML-Ladezeitüberschreitung (10 s)"
  pdf.emptyOutput: "Druckvorgang erzeugte leere PDF"
  pdf.printTimeout: "Druckvorgang-Zeitüberschreitung (60 s)"
  pdf.noPages: "PDF enthält keine Seiten"
  pdf.writeFailed: "Schreiben der PDF mit Lesezeichen fehlgeschlagen"

  # === Workflow execution ===
  workflow.alreadyRunning: "Ein Workflow läuft bereits. Warten Sie, bis er fertig ist, oder brechen Sie ihn ab."
  workflow.emptyYaml: "Workflow-YAML ist leer"
  workflow.invalidWorkspace: "Arbeitsbereich-Root '%{path}' ist kein gültiges Verzeichnis"
  workflow.parseFailed: "Workflow-YAML konnte nicht geparst werden: %{detail}"
  workflow.tooManySteps: "Workflow hat %{count} Schritte (Maximum 50)"
  workflow.genieNotImplemented: "Schritt %{index} ('%{id}') verwendet Genie-Ausführung, die noch nicht implementiert ist"
  workflow.webhookNotImplemented: "Schritt %{index} ('%{id}') verwendet Webhook-Ausführung, die noch nicht implementiert ist"
  workflow.notRunning: "Derzeit läuft kein Workflow"
  workflow.circularDependency: "Zirkuläre Abhängigkeit in Workflow-Schritten erkannt"
  workflow.noInteractivePrompt: "Interaktive Eingabeaufforderung in Workflow-Ausführung nicht unterstützt"

  # === Hot exit ===
  hotExit.noWindows: "Keine Dokumentfenster zum Erfassen"
  hotExit.captureEmitFailed: "Senden der Erfassungsanfrage fehlgeschlagen: %{detail}"
  hotExit.captureTimeout: "Erfassung abgelaufen: Keine Fenster haben geantwortet"

  # === Content search ===
  search.queryTooShort: "Suchbegriff muss mindestens 3 Zeichen lang sein"

  # === CLI install ===
  cli.noFile: "Installation schien erfolgreich zu sein, aber die Datei wurde nicht erstellt."
  cli.mismatch: "Installation abgeschlossen, aber Dateiinhalt stimmt nicht mit erwartetem Skript überein."

  # === Genies ===
  genie.pathBlocked: "Genie-Pfad liegt außerhalb der erlaubten Verzeichnisse"

  # === MCP ===
  mcp.spawnInProgress: "MCP-Sidecar-Start bereits in Arbeit"
  mcp.configMismatch: "Konfigurationsvalidierung fehlgeschlagen: geschriebener Inhalt stimmt nicht überein"
`,
  "es": `
errors:
  # === Core (lib.rs) ===
  core.htmlTooLarge: "Contenido HTML demasiado grande (>50 MB)"
  core.pathTraversal: "No se permite el recorrido de rutas (..)"
  core.pathNotAbsolute: "La ruta debe ser absoluta"

  # === Pandoc export ===
  pandoc.pathTraversal: "No se permite el recorrido de rutas en la ruta de salida"
  pandoc.emptySourceDir: "source_dir no puede estar vacío"
  pandoc.sourcePathTraversal: "No se permite el recorrido de rutas en source_dir"
  pandoc.invalidSourceDir: "source_dir no válido '%{dir}': %{detail}"
  pandoc.notADirectory: "source_dir '%{dir}' no es un directorio"
  pandoc.notFound: "Pandoc no encontrado en PATH"
  pandoc.exitedWithCode: "Pandoc terminó con el código %{code}"
  pandoc.timeout: "Tiempo de espera de Pandoc agotado (superó los 2 minutos)"
  pandoc.taskPanicked: "La tarea de Pandoc falló: %{detail}"
  pandoc.startFailed: "Error al iniciar Pandoc: %{detail}"
  pandoc.stdinFailed: "Error al escribir en stdin de Pandoc: %{detail}"
  pandoc.waitFailed: "Error al esperar a Pandoc: %{detail}"

  # === PDF export ===
  pdf.invalidExtension: "La ruta de salida debe tener la extensión .pdf"
  pdf.dirNotFound: "El directorio de salida no existe"
  pdf.loadTimeout: "Tiempo de espera de carga HTML (10 s)"
  pdf.emptyOutput: "La operación de impresión generó un PDF vacío"
  pdf.printTimeout: "Tiempo de espera de impresión (60 s)"
  pdf.noPages: "El PDF no tiene páginas"
  pdf.writeFailed: "Error al escribir el PDF con marcadores"

  # === Workflow execution ===
  workflow.alreadyRunning: "Ya se está ejecutando un flujo de trabajo. Espere a que termine o cancélelo."
  workflow.emptyYaml: "El YAML del flujo de trabajo está vacío"
  workflow.invalidWorkspace: "La raíz del espacio de trabajo '%{path}' no es un directorio válido"
  workflow.parseFailed: "Error al analizar el YAML del flujo de trabajo: %{detail}"
  workflow.tooManySteps: "El flujo de trabajo tiene %{count} pasos (máximo 50)"
  workflow.genieNotImplemented: "El paso %{index} ('%{id}') usa la ejecución genie que aún no está implementada"
  workflow.webhookNotImplemented: "El paso %{index} ('%{id}') usa la ejecución webhook que aún no está implementada"
  workflow.notRunning: "No hay ningún flujo de trabajo en ejecución"
  workflow.circularDependency: "Se detectó una dependencia circular en los pasos del flujo de trabajo"
  workflow.noInteractivePrompt: "El flujo de trabajo no admite solicitudes interactivas"

  # === Hot exit ===
  hotExit.noWindows: "No hay ventanas de documento para capturar"
  hotExit.captureEmitFailed: "Error al enviar la solicitud de captura: %{detail}"
  hotExit.captureTimeout: "Tiempo de captura agotado: ninguna ventana respondió"

  # === Content search ===
  search.queryTooShort: "La búsqueda debe tener al menos 3 caracteres"

  # === CLI install ===
  cli.noFile: "La instalación pareció tener éxito, pero el archivo no se creó."
  cli.mismatch: "La instalación se completó, pero el contenido del archivo no coincide con el script esperado."

  # === Genies ===
  genie.pathBlocked: "La ruta de Genie está fuera de los directorios permitidos"

  # === MCP ===
  mcp.spawnInProgress: "El inicio del sidecar MCP ya está en curso"
  mcp.configMismatch: "Validación de configuración fallida: el contenido escrito no coincide"
`,
  "fr": `
errors:
  # === Core (lib.rs) ===
  core.htmlTooLarge: "Contenu HTML trop volumineux (>50 Mo)"
  core.pathTraversal: "Traversée de chemin (..) non autorisée"
  core.pathNotAbsolute: "Le chemin doit être absolu"

  # === Pandoc export ===
  pandoc.pathTraversal: "Traversée de chemin non autorisée dans le chemin de sortie"
  pandoc.emptySourceDir: "source_dir ne peut pas être vide"
  pandoc.sourcePathTraversal: "Traversée de chemin non autorisée dans source_dir"
  pandoc.invalidSourceDir: "source_dir '%{dir}' invalide : %{detail}"
  pandoc.notADirectory: "source_dir '%{dir}' n'est pas un répertoire"
  pandoc.notFound: "Pandoc introuvable dans PATH"
  pandoc.exitedWithCode: "Pandoc terminé avec le code %{code}"
  pandoc.timeout: "Pandoc a dépassé le délai (plus de 2 minutes)"
  pandoc.taskPanicked: "La tâche Pandoc s'est arrêtée : %{detail}"
  pandoc.startFailed: "Échec du démarrage de Pandoc : %{detail}"
  pandoc.stdinFailed: "Échec d'écriture dans l'entrée standard de Pandoc : %{detail}"
  pandoc.waitFailed: "Échec d'attente de Pandoc : %{detail}"

  # === PDF export ===
  pdf.invalidExtension: "Le chemin de sortie doit avoir l'extension .pdf"
  pdf.dirNotFound: "Le répertoire de sortie n'existe pas"
  pdf.loadTimeout: "Délai de chargement HTML dépassé (10 s)"
  pdf.emptyOutput: "L'opération d'impression a produit un PDF vide"
  pdf.printTimeout: "Délai d'impression dépassé (60 s)"
  pdf.noPages: "Le PDF n'a aucune page"
  pdf.writeFailed: "Échec de l'écriture du PDF avec signets"

  # === Workflow execution ===
  workflow.alreadyRunning: "Un flux de travail est déjà en cours. Attendez qu'il se termine ou annulez-le."
  workflow.emptyYaml: "Le YAML du flux de travail est vide"
  workflow.invalidWorkspace: "La racine de l'espace de travail '%{path}' n'est pas un répertoire valide"
  workflow.parseFailed: "Échec de l'analyse du YAML du flux de travail : %{detail}"
  workflow.tooManySteps: "Le flux de travail comporte %{count} étapes (maximum 50)"
  workflow.genieNotImplemented: "L'étape %{index} ('%{id}') utilise l'exécution genie, qui n'est pas encore implémentée"
  workflow.webhookNotImplemented: "L'étape %{index} ('%{id}') utilise l'exécution webhook, qui n'est pas encore implémentée"
  workflow.notRunning: "Aucun flux de travail n'est en cours d'exécution"
  workflow.circularDependency: "Dépendance circulaire détectée dans les étapes du flux de travail"
  workflow.noInteractivePrompt: "Les invites interactives ne sont pas prises en charge dans l'exécution de flux de travail"

  # === Hot exit ===
  hotExit.noWindows: "Aucune fenêtre de document à capturer"
  hotExit.captureEmitFailed: "Échec d'envoi de la requête de capture : %{detail}"
  hotExit.captureTimeout: "Délai de capture dépassé : aucune fenêtre n'a répondu"

  # === Content search ===
  search.queryTooShort: "La requête doit comporter au moins 3 caractères"

  # === CLI install ===
  cli.noFile: "L'installation semble avoir réussi mais le fichier n'a pas été créé."
  cli.mismatch: "Installation terminée, mais le contenu du fichier ne correspond pas au script attendu."

  # === Genies ===
  genie.pathBlocked: "Le chemin Genie se trouve en dehors des répertoires autorisés"

  # === MCP ===
  mcp.spawnInProgress: "Démarrage du sidecar MCP déjà en cours"
  mcp.configMismatch: "Échec de validation de la configuration : le contenu écrit ne correspond pas"
`,
  "it": `
errors:
  # === Core (lib.rs) ===
  core.htmlTooLarge: "Contenuto HTML troppo grande (>50 MB)"
  core.pathTraversal: "Traversal del percorso (..) non consentito"
  core.pathNotAbsolute: "Il percorso deve essere assoluto"

  # === Pandoc export ===
  pandoc.pathTraversal: "Traversal del percorso non consentito nel percorso di output"
  pandoc.emptySourceDir: "source_dir non può essere vuoto"
  pandoc.sourcePathTraversal: "Traversal del percorso non consentito in source_dir"
  pandoc.invalidSourceDir: "source_dir non valido '%{dir}': %{detail}"
  pandoc.notADirectory: "source_dir '%{dir}' non è una directory"
  pandoc.notFound: "Pandoc non trovato nel PATH"
  pandoc.exitedWithCode: "Pandoc terminato con codice %{code}"
  pandoc.timeout: "Timeout di Pandoc (oltre 2 minuti)"
  pandoc.taskPanicked: "Il task Pandoc si è bloccato: %{detail}"
  pandoc.startFailed: "Impossibile avviare Pandoc: %{detail}"
  pandoc.stdinFailed: "Impossibile scrivere nello stdin di Pandoc: %{detail}"
  pandoc.waitFailed: "Impossibile attendere Pandoc: %{detail}"

  # === PDF export ===
  pdf.invalidExtension: "Il percorso di output deve avere estensione .pdf"
  pdf.dirNotFound: "La directory di output non esiste"
  pdf.loadTimeout: "Timeout caricamento HTML (10 s)"
  pdf.emptyOutput: "L'operazione di stampa ha prodotto un PDF vuoto"
  pdf.printTimeout: "Timeout operazione di stampa (60 s)"
  pdf.noPages: "Il PDF non ha pagine"
  pdf.writeFailed: "Impossibile scrivere il PDF con segnalibri"

  # === Workflow execution ===
  workflow.alreadyRunning: "Un flusso di lavoro è già in esecuzione. Attendere il completamento o annullarlo."
  workflow.emptyYaml: "Il YAML del flusso di lavoro è vuoto"
  workflow.invalidWorkspace: "La radice dell'area di lavoro '%{path}' non è una directory valida"
  workflow.parseFailed: "Impossibile analizzare il YAML del flusso di lavoro: %{detail}"
  workflow.tooManySteps: "Il flusso di lavoro ha %{count} passaggi (massimo 50)"
  workflow.genieNotImplemented: "Il passaggio %{index} ('%{id}') utilizza l'esecuzione genie non ancora implementata"
  workflow.webhookNotImplemented: "Il passaggio %{index} ('%{id}') utilizza l'esecuzione webhook non ancora implementata"
  workflow.notRunning: "Nessun flusso di lavoro è attualmente in esecuzione"
  workflow.circularDependency: "Rilevata dipendenza circolare nei passaggi del flusso di lavoro"
  workflow.noInteractivePrompt: "Il prompt interattivo non è supportato nell'esecuzione del flusso di lavoro"

  # === Hot exit ===
  hotExit.noWindows: "Nessuna finestra documento da catturare"
  hotExit.captureEmitFailed: "Impossibile inviare la richiesta di cattura: %{detail}"
  hotExit.captureTimeout: "Timeout cattura: nessuna finestra ha risposto"

  # === Content search ===
  search.queryTooShort: "La query deve contenere almeno 3 caratteri"

  # === CLI install ===
  cli.noFile: "L'installazione sembra riuscita ma il file non è stato creato."
  cli.mismatch: "Installazione completata, ma il contenuto del file non corrisponde allo script previsto."

  # === Genies ===
  genie.pathBlocked: "Il percorso di Genie è al di fuori delle directory consentite"

  # === MCP ===
  mcp.spawnInProgress: "L'avvio del sidecar MCP è già in corso"
  mcp.configMismatch: "Convalida della configurazione non riuscita: il contenuto scritto non corrisponde"
`,
  "pt-BR": `
errors:
  # === Core (lib.rs) ===
  core.htmlTooLarge: "Conteúdo HTML muito grande (>50 MB)"
  core.pathTraversal: "Travessia de caminho (..) não permitida"
  core.pathNotAbsolute: "O caminho precisa ser absoluto"

  # === Pandoc export ===
  pandoc.pathTraversal: "Travessia de caminho não permitida no caminho de saída"
  pandoc.emptySourceDir: "source_dir não pode estar vazio"
  pandoc.sourcePathTraversal: "Travessia de caminho não permitida em source_dir"
  pandoc.invalidSourceDir: "source_dir inválido '%{dir}': %{detail}"
  pandoc.notADirectory: "source_dir '%{dir}' não é um diretório"
  pandoc.notFound: "Pandoc não encontrado no PATH"
  pandoc.exitedWithCode: "Pandoc encerrou com código %{code}"
  pandoc.timeout: "Tempo esgotado no Pandoc (mais de 2 minutos)"
  pandoc.taskPanicked: "A tarefa do Pandoc falhou: %{detail}"
  pandoc.startFailed: "Falha ao iniciar o Pandoc: %{detail}"
  pandoc.stdinFailed: "Falha ao escrever no stdin do Pandoc: %{detail}"
  pandoc.waitFailed: "Falha ao aguardar o Pandoc: %{detail}"

  # === PDF export ===
  pdf.invalidExtension: "O caminho de saída precisa ter a extensão .pdf"
  pdf.dirNotFound: "O diretório de saída não existe"
  pdf.loadTimeout: "Tempo esgotado ao carregar HTML (10 s)"
  pdf.emptyOutput: "A operação de impressão gerou um PDF vazio"
  pdf.printTimeout: "Tempo esgotado na operação de impressão (60 s)"
  pdf.noPages: "O PDF não tem páginas"
  pdf.writeFailed: "Falha ao gravar o PDF com marcadores"

  # === Workflow execution ===
  workflow.alreadyRunning: "Já existe um fluxo de trabalho em execução. Aguarde a conclusão ou cancele."
  workflow.emptyYaml: "O YAML do fluxo de trabalho está vazio"
  workflow.invalidWorkspace: "A raiz do espaço de trabalho '%{path}' não é um diretório válido"
  workflow.parseFailed: "Falha ao analisar o YAML do fluxo de trabalho: %{detail}"
  workflow.tooManySteps: "O fluxo de trabalho tem %{count} etapas (máximo 50)"
  workflow.genieNotImplemented: "A etapa %{index} ('%{id}') usa execução genie ainda não implementada"
  workflow.webhookNotImplemented: "A etapa %{index} ('%{id}') usa execução webhook ainda não implementada"
  workflow.notRunning: "Nenhum fluxo de trabalho em execução no momento"
  workflow.circularDependency: "Dependência circular detectada nas etapas do fluxo de trabalho"
  workflow.noInteractivePrompt: "Prompt interativo não é suportado na execução do fluxo de trabalho"

  # === Hot exit ===
  hotExit.noWindows: "Nenhuma janela de documento para capturar"
  hotExit.captureEmitFailed: "Falha ao enviar solicitação de captura: %{detail}"
  hotExit.captureTimeout: "Tempo de captura esgotado: nenhuma janela respondeu"

  # === Content search ===
  search.queryTooShort: "A consulta precisa ter pelo menos 3 caracteres"

  # === CLI install ===
  cli.noFile: "A instalação parece ter tido sucesso, mas o arquivo não foi criado."
  cli.mismatch: "Instalação concluída, mas o conteúdo do arquivo não corresponde ao script esperado."

  # === Genies ===
  genie.pathBlocked: "O caminho do Genie está fora dos diretórios permitidos"

  # === MCP ===
  mcp.spawnInProgress: "A inicialização do sidecar MCP já está em andamento"
  mcp.configMismatch: "Falha na validação da configuração: o conteúdo gravado não corresponde"
`,
};

for (const locale of LOCALES) {
  const filePath = resolve(LOCALES_DIR, `${locale}.yml`);
  const current = readFileSync(filePath, "utf-8");
  if (current.includes("\nerrors:")) {
    console.log(`${locale}.yml already has errors section — skipping`);
    continue;
  }
  const block = ERRORS_BY_LOCALE[locale];
  if (!block) {
    console.warn(`No translation block defined for ${locale} — skipping`);
    continue;
  }
  writeFileSync(filePath, current.trimEnd() + "\n" + block);
  console.log(`Updated ${locale}.yml`);
}

console.log("Done.");
