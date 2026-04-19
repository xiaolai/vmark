#!/usr/bin/env node
/**
 * Append the "Speaks Your Language" feature card to each locale's index.md
 * under the VitePress `features:` list. One-shot script for i18n-polish phase 4.
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

const LOCALES = ["zh-CN", "zh-TW", "ja", "ko", "de", "es", "fr", "it", "pt-BR"];

// title + details per locale
const CARDS = {
  "zh-CN": {
    title: "说你的语言",
    details: "开箱即用，支持 10 种语言 —— English、简体中文、繁體中文、日本語、한국어、Deutsch、Español、Français、Italiano、Português (Brasil)。首次启动时自动识别系统语言。菜单、对话框、错误提示，全部翻译到位。",
  },
  "zh-TW": {
    title: "說你的語言",
    details: "開箱即用，支援 10 種語言 —— English、簡體中文、繁體中文、日本語、한국어、Deutsch、Español、Français、Italiano、Português (Brasil)。首次啟動時自動識別系統語言。選單、對話框、錯誤提示，全數翻譯到位。",
  },
  "ja": {
    title: "あなたの言語で",
    details: "初期状態で 10 言語に対応 —— English、簡体中文、繁體中文、日本語、한국어、Deutsch、Español、Français、Italiano、Português (Brasil)。初回起動時に OS のロケールを自動検出。メニュー、ダイアログ、エラーメッセージ、すべて翻訳済み。",
  },
  "ko": {
    title: "당신의 언어로",
    details: "기본 10개 언어 지원 —— English, 简体中文, 繁體中文, 日本語, 한국어, Deutsch, Español, Français, Italiano, Português (Brasil). 첫 실행 시 OS 로케일을 자동 감지합니다. 메뉴, 대화상자, 오류 메시지까지 모두 번역되어 있습니다.",
  },
  "de": {
    title: "Spricht Ihre Sprache",
    details: "10 Sprachen direkt nach der Installation — English, 简体中文, 繁體中文, 日本語, 한국어, Deutsch, Español, Français, Italiano, Português (Brasil). Erkennt Ihre OS-Sprache beim ersten Start automatisch. Menüs, Dialoge, Fehlermeldungen — alles übersetzt.",
  },
  "es": {
    title: "Habla tu idioma",
    details: "10 idiomas listos para usar — English, 简体中文, 繁體中文, 日本語, 한국어, Deutsch, Español, Français, Italiano, Português (Brasil). Detecta automáticamente el idioma del sistema al primer arranque. Menús, diálogos, errores — todo traducido.",
  },
  "fr": {
    title: "Parle votre langue",
    details: "10 langues prêtes à l'emploi — English, 简体中文, 繁體中文, 日本語, 한국어, Deutsch, Español, Français, Italiano, Português (Brasil). Détection automatique de la langue du système au premier lancement. Menus, dialogues, erreurs — tout est traduit.",
  },
  "it": {
    title: "Parla la tua lingua",
    details: "10 lingue pronte all'uso — English, 简体中文, 繁體中文, 日本語, 한국어, Deutsch, Español, Français, Italiano, Português (Brasil). Rileva automaticamente la lingua del sistema al primo avvio. Menu, finestre di dialogo, messaggi di errore — tutto tradotto.",
  },
  "pt-BR": {
    title: "Fala o seu idioma",
    details: "10 idiomas prontos para usar — English, 简体中文, 繁體中文, 日本語, 한국어, Deutsch, Español, Français, Italiano, Português (Brasil). Detecta automaticamente o idioma do SO na primeira execução. Menus, diálogos, mensagens de erro — tudo traduzido.",
  },
};

for (const locale of LOCALES) {
  const filePath = resolve(ROOT, `website/${locale}/index.md`);
  if (!existsSync(filePath)) {
    console.warn(`SKIP ${locale}: file missing`);
    continue;
  }
  const content = readFileSync(filePath, "utf-8");
  if (content.includes("/icons/globe.svg")) {
    console.log(`SKIP ${locale}: already has card`);
    continue;
  }

  const card = CARDS[locale];
  if (!card) continue;

  // Insert before the closing `---` of the front matter, after the last feature.
  // Find the second `---` (end of front matter) and walk backwards to find the
  // end of the features list.
  const lines = content.split("\n");
  let endIdx = -1;
  let count = 0;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() === "---") {
      count++;
      if (count === 2) {
        endIdx = i;
        break;
      }
    }
  }
  if (endIdx === -1) {
    console.warn(`SKIP ${locale}: front matter not found`);
    continue;
  }

  const insertion = [
    "",
    "  - icon:",
    "      src: /icons/globe.svg",
    `    title: ${card.title}`,
    `    details: ${JSON.stringify(card.details).slice(1, -1)}`,
  ];

  lines.splice(endIdx, 0, ...insertion);
  writeFileSync(filePath, lines.join("\n"));
  console.log(`Updated ${locale}/index.md`);
}
console.log("Done.");
