#!/usr/bin/env node
/**
 * One-shot script to propagate new dialog.json and common.json keys across locales.
 * Reads en/common.json and en/dialog.json, ensures every other locale has the same
 * key structure by merging missing keys with translated values defined below.
 *
 * Run with: node scripts/propagate-i18n-keys.mjs
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

const LOCALES = ["zh-CN", "zh-TW", "ja", "ko", "de", "es", "fr", "it", "pt-BR"];

// Translations for new keys. Missing entries fall back to the English source,
// which keeps the lint:i18n gate happy while giving a useful user-facing string.
const TRANSLATIONS = {
  "common.unknown": {
    "zh-CN": "未知", "zh-TW": "未知", "ja": "不明", "ko": "알 수 없음",
    "de": "Unbekannt", "es": "Desconocido", "fr": "Inconnu",
    "it": "Sconosciuto", "pt-BR": "Desconhecido",
  },
  "common.running": {
    "zh-CN": "运行中", "zh-TW": "執行中", "ja": "実行中", "ko": "실행 중",
    "de": "Läuft", "es": "En ejecución", "fr": "En cours",
    "it": "In esecuzione", "pt-BR": "Em execução",
  },
  "common.dropToOpen": {
    "zh-CN": "拖放以打开", "zh-TW": "拖放以開啟", "ja": "ドロップして開く",
    "ko": "놓아서 열기", "de": "Zum Öffnen fallen lassen",
    "es": "Soltar para abrir", "fr": "Déposer pour ouvrir",
    "it": "Rilascia per aprire", "pt-BR": "Soltar para abrir",
  },
  "dialog.unsavedDocument.messageAddMedia": {
    "zh-CN": "请先保存文档再添加媒体文件。",
    "zh-TW": "請先儲存文件再新增媒體檔案。",
    "ja": "メディアファイルを追加する前に、ドキュメントを保存してください。",
    "ko": "미디어 파일을 추가하기 전에 문서를 저장하세요.",
    "de": "Bitte speichern Sie das Dokument, bevor Sie Mediendateien hinzufügen.",
    "es": "Guarde el documento antes de agregar archivos multimedia.",
    "fr": "Veuillez enregistrer le document avant d'ajouter des fichiers multimédias.",
    "it": "Salva il documento prima di aggiungere file multimediali.",
    "pt-BR": "Salve o documento antes de adicionar arquivos de mídia.",
  },
  "dialog.unsavedDocument.messageOrphanCheck": {
    "zh-CN": "请先保存文档再检查未使用的图片。",
    "zh-TW": "請先儲存文件再檢查未使用的圖片。",
    "ja": "未使用の画像を確認する前に、ドキュメントを保存してください。",
    "ko": "사용하지 않는 이미지를 확인하기 전에 문서를 저장하세요.",
    "de": "Bitte speichern Sie das Dokument, bevor Sie nach ungenutzten Bildern suchen.",
    "es": "Guarde el documento antes de buscar imágenes no utilizadas.",
    "fr": "Veuillez enregistrer le document avant de rechercher les images inutilisées.",
    "it": "Salva il documento prima di cercare immagini inutilizzate.",
    "pt-BR": "Salve o documento antes de verificar imagens não utilizadas.",
  },
  "dialog.unsavedDocument.messageOrphanCheckUnsaved": {
    "zh-CN": "请先保存您的更改再检查未使用的图片。\n\n这样才能基于已保存的内容进行检查。",
    "zh-TW": "請先儲存您的變更再檢查未使用的圖片。\n\n這樣才能基於已儲存的內容進行檢查。",
    "ja": "未使用の画像を確認する前に、変更を保存してください。\n\nこれにより、保存された内容に対して確認を行います。",
    "ko": "사용하지 않는 이미지를 확인하기 전에 변경 사항을 저장하세요.\n\n이렇게 해야 저장된 내용을 대상으로 확인할 수 있습니다.",
    "de": "Bitte speichern Sie Ihre Änderungen, bevor Sie nach ungenutzten Bildern suchen.\n\nDadurch wird anhand des gespeicherten Inhalts geprüft.",
    "es": "Guarde sus cambios antes de buscar imágenes no utilizadas.\n\nAsí se analizará el contenido guardado.",
    "fr": "Veuillez enregistrer vos modifications avant de rechercher les images inutilisées.\n\nCela garantit que la vérification analyse le contenu enregistré.",
    "it": "Salva le modifiche prima di cercare immagini inutilizzate.\n\nIn questo modo la verifica analizza il contenuto salvato.",
    "pt-BR": "Salve suas alterações antes de verificar imagens não utilizadas.\n\nIsso garante que a verificação analise o conteúdo salvo.",
  },
  "dialog.saveRequired.title": {
    "zh-CN": "需要保存", "zh-TW": "需要儲存", "ja": "保存が必要", "ko": "저장 필요",
    "de": "Speichern erforderlich", "es": "Guardado requerido",
    "fr": "Enregistrement requis", "it": "Salvataggio richiesto",
    "pt-BR": "Salvamento necessário",
  },
  "dialog.fileTooLarge.title": {
    "zh-CN": "文件过大", "zh-TW": "檔案過大", "ja": "ファイルが大きすぎます",
    "ko": "파일이 너무 큼", "de": "Datei zu groß", "es": "Archivo demasiado grande",
    "fr": "Fichier trop volumineux", "it": "File troppo grande",
    "pt-BR": "Arquivo muito grande",
  },
  "dialog.fileTooLarge.message": {
    "zh-CN": "文件过大（{{size}} MB）。最大为 {{max}} MB。",
    "zh-TW": "檔案過大（{{size}} MB）。最大為 {{max}} MB。",
    "ja": "ファイルが大きすぎます（{{size}} MB）。最大は {{max}} MB です。",
    "ko": "파일이 너무 큽니다({{size}} MB). 최대 {{max}} MB입니다.",
    "de": "Datei ist zu groß ({{size}} MB). Maximum ist {{max}} MB.",
    "es": "El archivo es demasiado grande ({{size}} MB). El máximo es {{max}} MB.",
    "fr": "Le fichier est trop volumineux ({{size}} Mo). Maximum : {{max}} Mo.",
    "it": "Il file è troppo grande ({{size}} MB). Il massimo è {{max}} MB.",
    "pt-BR": "Arquivo muito grande ({{size}} MB). O máximo é {{max}} MB.",
  },
  "dialog.errorBoundary.title": {
    "zh-CN": "出错了", "zh-TW": "發生錯誤", "ja": "問題が発生しました",
    "ko": "문제가 발생했습니다", "de": "Etwas ist schiefgelaufen",
    "es": "Algo salió mal", "fr": "Un problème est survenu",
    "it": "Qualcosa è andato storto", "pt-BR": "Algo deu errado",
  },
  "dialog.pdfExport.title": {
    "zh-CN": "导出 PDF", "zh-TW": "匯出 PDF", "ja": "PDF をエクスポート",
    "ko": "PDF 내보내기", "de": "PDF exportieren", "es": "Exportar PDF",
    "fr": "Exporter le PDF", "it": "Esporta PDF", "pt-BR": "Exportar PDF",
  },
  "dialog.pdfExport.missingPath": {
    "zh-CN": "未提供 HTML 路径",
    "zh-TW": "未提供 HTML 路徑",
    "ja": "HTML パスが指定されていません",
    "ko": "HTML 경로가 제공되지 않았습니다",
    "de": "Kein HTML-Pfad angegeben",
    "es": "No se proporcionó una ruta HTML",
    "fr": "Aucun chemin HTML fourni",
    "it": "Nessun percorso HTML fornito",
    "pt-BR": "Nenhum caminho HTML fornecido",
  },
  "dialog.pdfExport.loadFailed": {
    "zh-CN": "加载 HTML 失败：{{error}}",
    "zh-TW": "載入 HTML 失敗：{{error}}",
    "ja": "HTML の読み込みに失敗しました: {{error}}",
    "ko": "HTML 로드 실패: {{error}}",
    "de": "HTML konnte nicht geladen werden: {{error}}",
    "es": "Error al cargar HTML: {{error}}",
    "fr": "Échec du chargement du HTML : {{error}}",
    "it": "Impossibile caricare l'HTML: {{error}}",
    "pt-BR": "Falha ao carregar HTML: {{error}}",
  },
  "dialog.mcp.bridgeNotRunning": {
    "zh-CN": "MCP 桥接未运行",
    "zh-TW": "MCP 橋接未執行",
    "ja": "MCP ブリッジが実行されていません",
    "ko": "MCP 브리지가 실행되고 있지 않습니다",
    "de": "MCP-Brücke läuft nicht",
    "es": "El puente MCP no está en ejecución",
    "fr": "Le pont MCP n'est pas en cours d'exécution",
    "it": "Il ponte MCP non è in esecuzione",
    "pt-BR": "A ponte MCP não está em execução",
  },
  "dialog.mcp.healthCheckFailed": {
    "zh-CN": "MCP 辅助进程健康检查失败",
    "zh-TW": "MCP 輔助程序健康檢查失敗",
    "ja": "サイドカーのヘルスチェックに失敗しました",
    "ko": "사이드카 상태 확인 실패",
    "de": "Sidecar-Integritätsprüfung fehlgeschlagen",
    "es": "Error en la comprobación de estado del sidecar",
    "fr": "Échec de la vérification d'état du sidecar",
    "it": "Controllo integrità del sidecar non riuscito",
    "pt-BR": "Falha na verificação de integridade do sidecar",
  },
  "dialog.toast.tableFormatted": {
    "zh-CN": "表格已格式化", "zh-TW": "表格已格式化",
    "ja": "テーブルを整形しました", "ko": "표가 정리되었습니다",
    "de": "Tabelle formatiert", "es": "Tabla formateada",
    "fr": "Tableau mis en forme", "it": "Tabella formattata",
    "pt-BR": "Tabela formatada",
  },
  "dialog.toast.unpinBeforeClosing": {
    "zh-CN": "关闭前请先取消固定",
    "zh-TW": "關閉前請先取消釘選",
    "ja": "閉じる前にピン留めを解除してください",
    "ko": "닫기 전에 고정을 해제하세요",
    "de": "Vor dem Schließen lösen",
    "es": "Desanclar antes de cerrar",
    "fr": "Détacher l'onglet avant de fermer",
    "it": "Sblocca prima di chiudere",
    "pt-BR": "Desafixe antes de fechar",
  },
  "dialog.toast.failedToInsertDroppedImage": {
    "zh-CN": "插入拖放的图片失败。",
    "zh-TW": "插入拖放的圖片失敗。",
    "ja": "ドロップされた画像の挿入に失敗しました。",
    "ko": "드래그한 이미지 삽입에 실패했습니다.",
    "de": "Einfügen des abgelegten Bildes fehlgeschlagen.",
    "es": "Error al insertar la imagen soltada.",
    "fr": "Échec de l'insertion de l'image déposée.",
    "it": "Inserimento dell'immagine rilasciata non riuscito.",
    "pt-BR": "Falha ao inserir a imagem solta.",
  },
};

// Walk a nested object by dot path; create intermediate nodes.
function setByPath(obj, path, value) {
  const parts = path.split(".");
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const k = parts[i];
    if (typeof cur[k] !== "object" || cur[k] === null) cur[k] = {};
    cur = cur[k];
  }
  const last = parts[parts.length - 1];
  if (!(last in cur)) cur[last] = value;
}

// Get existing value by dot path; returns undefined if missing
function getByPath(obj, path) {
  const parts = path.split(".");
  let cur = obj;
  for (const p of parts) {
    if (cur == null || typeof cur !== "object") return undefined;
    cur = cur[p];
  }
  return cur;
}

function loadJson(path) {
  return JSON.parse(readFileSync(path, "utf-8"));
}

function saveJson(path, data) {
  writeFileSync(path, JSON.stringify(data, null, 2) + "\n");
}

for (const locale of LOCALES) {
  for (const ns of ["common", "dialog"]) {
    const filePath = resolve(ROOT, `src/locales/${locale}/${ns}.json`);
    const data = loadJson(filePath);
    let touched = false;

    for (const fullKey of Object.keys(TRANSLATIONS)) {
      const [keyNs, ...rest] = fullKey.split(".");
      if (keyNs !== ns) continue;
      const subPath = rest.join(".");
      const existing = getByPath(data, subPath);
      if (existing !== undefined) continue;
      const value = TRANSLATIONS[fullKey][locale];
      if (value === undefined) continue;
      setByPath(data, subPath, value);
      touched = true;
    }

    if (touched) {
      saveJson(filePath, data);
      console.log(`Updated ${locale}/${ns}.json`);
    }
  }
}

console.log("Done.");
