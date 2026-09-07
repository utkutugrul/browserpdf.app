#!/usr/bin/env python3
"""Add server-rendered service metadata keys for every non-English locale."""
import argparse
import json
from pathlib import Path

PATH = Path(__file__).resolve().parent.parent / "public" / "translations.json"
HOME = {
    "es": "Inicio", "fr": "Accueil", "de": "Startseite", "pt": "Início",
    "it": "Home", "ru": "Главная", "ja": "ホーム", "ko": "홈", "zh": "首页",
    "zh-TW": "首頁", "ar": "الرئيسية", "hi": "होम", "tr": "Ana sayfa",
    "nl": "Startpagina", "pl": "Strona główna", "id": "Beranda",
    "vi": "Trang chủ", "th": "หน้าหลัก", "uk": "Головна", "cs": "Domů",
    "sv": "Startsida",
}
SERVICES = ("workflows", "privacy_scan", "doctor")


def migrate(locale, language):
    locale["common.home"] = HOME[language]
    for prefix in SERVICES:
        heading = locale[f"{prefix}.h1"]
        description = locale[f"{prefix}.intro"]
        locale[f"{prefix}.meta_title"] = f"{heading} | BrowserPDF"
        locale[f"{prefix}.meta_description"] = description
        locale[f"{prefix}.jsonld_name"] = f"{heading} - BrowserPDF"
        locale[f"{prefix}.jsonld_description"] = description
        locale[f"{prefix}.breadcrumb_name"] = heading


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    original = PATH.read_text(encoding="utf-8")
    data = json.loads(original)
    if set(data) != set(HOME):
        raise SystemExit("Phase 9 locale map mismatch")
    for language, locale in data.items():
        migrate(locale, language)
    rendered = json.dumps(data, ensure_ascii=False, indent=2) + "\n"
    if args.check:
        if rendered != original:
            raise SystemExit("Phase 9 translation migration is not up to date")
    else:
        PATH.write_text(rendered, encoding="utf-8")


if __name__ == "__main__":
    main()
